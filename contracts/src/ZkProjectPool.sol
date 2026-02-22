// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./TokenPool.sol";
import "./NullifierRegistry.sol";
import {ISwapVerifier, IProjectPoolLPVerifier, IWithdrawVerifier, IClaimLPFeesVerifier} from "./interfaces/IVerifier.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @title ZkProjectPool
/// @author r00t.fund
/// @notice Private AMM for launchpad project tokens with R00T as base currency
/// @dev Each launchpad project gets its own pool: ProjectToken <-> R00T
///
/// Key Design:
/// - R00T is the base currency (not ETH) - users swap R00T for project tokens
/// - R00T commitments come from the main ZkAMM R00T pool
/// - Project tokens have their own commitment pool in this contract
/// - Fees go to project creator and platform
///
/// Security Features:
/// - ReentrancyGuard on all external functions
/// - Range checks enforced in circuits
/// - Fee validation
/// - LP lock period (24h)
/// - SECURITY FIX: requiresSwapVerifier/requiresLPVerifier modifiers prevent
///   unauthorized operations until verifiers are deployed (governance-only fallback)
contract ZkProjectPool is ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ============ Constants ============

    /// @notice AMM fee in basis points (30 = 0.3%)
    uint256 public constant FEE_BPS = 30;

    /// @notice Platform fee in basis points (10 = 0.1% of trade)
    uint256 public constant PLATFORM_FEE_BPS = 10;

    /// @notice Creator fee in basis points (10 = 0.1% of trade, goes to project creator)
    uint256 public constant CREATOR_FEE_BPS = 10;

    /// @notice LP fee in basis points (10 = 0.1% of trade, distributed to LPs)
    uint256 public constant LP_FEE_BPS = 10;

    /// @notice Fee denominator (10000 = 100%)
    uint256 public constant FEE_DENOMINATOR = 10000;

    /// @notice LP lock period to prevent gaming attacks
    uint256 public constant LP_LOCK_PERIOD = 1 minutes; // TESTNET: Changed from 24 hours for testing

    /// @notice Scaling factor for fee per share calculations
    uint256 public constant FEE_PRECISION = 1e18;

    /// @notice Minimum LP fee required before distribution (prevents rounding dust)
    /// @dev SECURITY FIX (Audit Vuln 2): When totalLPShares is very large relative to lpFee,
    ///      the increment (lpFee * FEE_PRECISION) / totalLPShares can round to zero.
    ///      This minimum ensures meaningful fee distribution per LP share.
    ///      Value: 1e12 wei = 0.000001 R00T minimum fee to distribute.
    ///      Fees below this threshold accumulate in accumulatedPlatformFees instead.
    uint256 public constant MIN_LP_FEE_FOR_DISTRIBUTION = 1e12;

    /// @notice Minimum liquidity burned forever on pool initialization (prevents price manipulation)
    uint256 public constant MINIMUM_LIQUIDITY = 1000;

    /// @notice Minimum LP deposit amount (prevents dust deposits and rounding exploitation)
    /// @dev SECURITY FIX (Vuln 3): Prevents ratio manipulation via micro-deposits with zero tolerance
    ///      SECURITY FIX (Audit Vuln 3): Increased from 1000 wei to 1e15 (0.001 tokens)
    ///      SECURITY FIX (Audit Vuln 4): Increased from 1e15 to 1e17 (0.1 tokens) to make
    ///      repeated small deposit attacks economically infeasible. At 0.05% max rounding
    ///      benefit per deposit, an attacker would need ~2000 deposits to gain 1x their capital,
    ///      but with MIN_LP_DEPOSIT at 0.1 tokens, the gas costs far exceed any rounding benefit.
    uint256 public constant MIN_LP_DEPOSIT = 1e17;

    /// @notice BN254 scalar field order - all ZK public inputs must be less than this
    /// @dev SECURITY FIX: Prevents nullifier aliasing attacks where values >= SNARK_SCALAR_FIELD
    ///      are equivalent to their remainder mod SNARK_SCALAR_FIELD in the circuit
    uint256 public constant SNARK_SCALAR_FIELD =
        21888242871839275222246405745257275088548364400416034343698204186575808495617;

    /// @notice Dev allocation vesting period (180 days = 6 months)
    /// @dev SECURITY FIX (Vuln 5): Prevents immediate drain of dev allocation if creator key is compromised
    uint256 public constant DEV_VESTING_PERIOD = 180 days;

    /// @notice Cliff period before any dev allocation can be claimed (30 days)
    /// @dev SECURITY FIX (Vuln 5): Provides time window to detect compromised keys
    uint256 public constant DEV_VESTING_CLIFF = 30 days;

    // ============ State Variables ============

    /// @notice Project token name
    string public name;

    /// @notice Project token symbol
    string public symbol;

    /// @notice Total supply of project tokens
    uint256 public totalSupply;

    /// @notice Project token commitment merkle tree
    TokenPool public immutable projectTokenPool;

    /// @notice LP commitment merkle tree
    TokenPool public immutable lpPool;

    /// @notice Reference to main R00T token pool (for validating R00T commitments)
    TokenPool public immutable r00tPool;

    /// @notice Global nullifier registry for cross-pool R00T nullifier coordination
    /// @dev SECURITY FIX: Prevents same R00T commitment from being spent in multiple pools
    NullifierRegistry public immutable nullifierRegistry;

    /// @notice Verifier for swap proofs (R00T <-> ProjectToken)
    address public swapVerifier;

    /// @notice Verifier for LP withdrawal proofs
    address public lpWithdrawVerifier;

    /// @notice Verifier for public withdrawal proofs (commitment → ERC20)
    address public withdrawVerifier;

    /// @notice Verifier for LP fee claiming proofs (SECURITY FIX)
    address public claimLPFeesVerifier;

    /// @notice ERC20 token contract (fixed supply, all minted to this pool)
    IERC20 public immutable token;

    /// @notice R00T reserve in the pool (tracked as commitments)
    uint256 public r00tReserve;

    /// @notice Project token reserve in the pool
    uint256 public tokenReserve;

    /// @notice Total LP shares issued
    uint256 public totalLPShares;

    /// @notice Accumulated fees per LP share (scaled by FEE_PRECISION)
    uint256 public feePerShare;

    /// @notice Mapping of spent nullifier hashes (for project token operations)
    mapping(uint256 => bool) public nullifiers;

    /// @notice Mapping of spent R00T nullifier hashes (local tracking for CEI pattern)
    /// @dev SECURITY FIX: Local tracking ensures state updates before external calls
    mapping(uint256 => bool) public r00tNullifiers;

    /// @notice Mapping of spent LP nullifier hashes
    mapping(uint256 => bool) public lpNullifiers;

    /// @notice Mapping of LP commitment deposit times
    mapping(uint256 => uint256) public lpDepositTime;

    /// @notice Mapping of last claimed fee per share for LP commitments
    mapping(uint256 => uint256) public lastClaimedFeePerShare;

    /// @notice Mapping of LP commitment shares (SECURITY FIX: tracks shares per commitment)
    mapping(uint256 => uint256) public lpCommitmentShares;

    /// @notice Mapping of withdrawn LP commitments (SECURITY FIX: prevents fee claim abuse)
    mapping(uint256 => bool) public lpCommitmentWithdrawn;

    /// @notice Mapping to prevent same-block double claims (commitment => block number => claimed)
    /// @dev SECURITY FIX (Audit Vuln 6): Prevents race condition where feePerShare changes
    ///      within the same block, allowing double claims
    mapping(uint256 => mapping(uint256 => bool)) public claimedInBlock;

    /// @notice Project creator address (receives creator fees)
    address public creator;

    /// @notice Platform treasury (receives platform fees)
    address public platform;

    /// @notice Accumulated platform fees (in R00T commitments)
    uint256 public accumulatedPlatformFees;

    /// @notice Accumulated creator fees (in R00T commitments)
    uint256 public accumulatedCreatorFees;

    /// @notice Accumulated LP fees (in R00T)
    uint256 public accumulatedLPFees;

    /// @notice Governance contract that deployed this pool
    address public governance;

    /// @notice Proposal ID that created this pool
    uint256 public proposalId;

    /// @notice Authorized atomic swapper (ZkAMM) for ETH → ProjectToken atomic swaps
    address public authorizedAtomicSwapper;

    /// @notice Maximum dev allocation in tokens (SECURITY FIX: prevents unlimited claims)
    uint256 public immutable maxDevAllocation;

    /// @notice Amount of dev allocation already claimed (SECURITY FIX: tracks claimed amount)
    uint256 public devAllocationClaimed;

    /// @notice Pool creation timestamp for vesting calculations
    /// @dev SECURITY FIX (Vuln 5): Used to calculate vested dev allocation
    uint256 public immutable poolCreatedAt;

    // ============ Pending R00T Claims System ============
    // SECURITY FIX: Instead of creating R00T commitments directly (which this pool cannot back),
    // we track pending claims that users can redeem through ZkAMM (the actual R00T custodian)

    /// @notice Emergency claim delay (30 days) - allows anyone to process claims if governance is inactive
    /// @dev SECURITY FIX (Vuln 6): Prevents permanent fund lock if governance is compromised
    uint256 public constant EMERGENCY_CLAIM_DELAY = 30 days;

    /// @notice Structure for pending R00T claims
    struct PendingR00tClaim {
        uint256 amount;           // Amount of R00T to claim
        uint256 outputCommitment; // Desired output commitment
        bytes encryptedNote;      // Encrypted note for commitment
        bool claimed;             // Whether this claim has been processed
        uint256 createdAt;        // SECURITY FIX (Vuln 6): Timestamp for emergency processing
    }

    /// @notice Counter for claim IDs
    uint256 public nextClaimId;

    /// @notice Mapping of claim ID to pending claim details
    mapping(uint256 => PendingR00tClaim) public pendingR00tClaims;

    /// @notice Total pending R00T claims (must not exceed r00tReserve)
    uint256 public totalPendingClaims;

    // ============ Events ============

    event NewProjectTokenCommitment(uint256 indexed commitment, uint256 indexed leafIndex, bytes encryptedNote);
    event NewLPCommitment(uint256 indexed commitment, uint256 indexed leafIndex, uint256 lpShares, bytes encryptedNote);
    event NullifierSpent(uint256 indexed nullifierHash);
    event LPNullifierSpent(uint256 indexed nullifierHash);
    event R00tSwappedForToken(uint256 r00tIn, uint256 tokensOut, uint256 platformFee, uint256 creatorFee);
    event TokenSwappedForR00t(uint256 tokensIn, uint256 r00tOut, uint256 platformFee, uint256 creatorFee);
    event LiquidityAddedPrivate(uint256 indexed commitment, uint256 r00tAmount, uint256 lpShares);
    event LiquidityRemovedPrivate(uint256 indexed nullifierHash, uint256 r00tOut);
    event PlatformFeesCollected(address indexed to, uint256 amount);
    event CreatorFeesCollected(address indexed to, uint256 amount);
    event LPFeesClaimed(uint256 indexed commitment, address indexed recipient, uint256 amount);
    event InitialLiquidityBurned(uint256 r00tAmount, uint256 tokenAmount, uint256 burnedShares);
    event LiquidityAdded(uint256 indexed lpCommitment, uint256 r00tAmount, uint256 tokenAmount, uint256 lpShares);
    event LiquidityRemoved(uint256 indexed nullifierHash, uint256 r00tOut, uint256 tokenOut);
    event PublicWithdrawal(uint256 indexed nullifierHash, address indexed recipient, uint256 amount);
    event PublicDeposit(uint256 indexed commitment, address indexed depositor, uint256 amount);
    event DevAllocationClaimed(uint256 indexed commitment, address indexed creator, uint256 amount);
    event R00tClaimRegistered(uint256 indexed claimId, uint256 amount, uint256 outputCommitment);
    event R00tClaimProcessed(uint256 indexed claimId, uint256 amount);
    event AtomicSwapFromR00T(uint256 r00tAmount, uint256 tokensOut, uint256 indexed outputCommitment);
    /// @notice Emitted when a R00T commitment is created in the r00tPool on behalf of this contract
    /// @dev SECURITY FIX (Vuln 6): Using local event instead of TokenPool.NewCommitment
    ///      to properly attribute the event source to ZkProjectPool for indexers
    event R00tCommitmentCreated(uint256 indexed commitment, uint256 indexed leafIndex, bytes encryptedNote);

    // ============ Errors ============

    error ZeroAmount();
    error SlippageExceeded();
    error InvalidProof();
    error NullifierAlreadySpent();
    error UnknownMerkleRoot();
    error InsufficientReserve();
    error InsufficientLiquidity();
    error TransferFailed();
    error Unauthorized();
    error ZeroAddress();
    error NoFeesToCollect();
    error ExcessiveFee();
    error TransactionExpired();
    error LPLocked();
    error InvalidLPShares();
    error NotImplemented();
    error LPAlreadyWithdrawn();
    error InsufficientInitialLiquidity();
    error ImbalancedLiquidity();
    error DevAllocationExceeded();
    error ClaimAlreadyProcessed();
    error InvalidClaimId();
    error InsufficientR00tReserve();
    error EmergencyDelayNotMet(); // SECURITY FIX (Vuln 6): Claim too new for emergency processing
    error VerifierAlreadySet();   // SECURITY FIX M-01: Cannot reset verifier once set
    error R00TPoolUnauthorized(); // SECURITY FIX H-05: This pool not authorized in r00tPool
    error InvalidScalarField();   // SECURITY FIX: Value >= SNARK_SCALAR_FIELD (nullifier aliasing)
    error AlreadyClaimedInBlock(); // SECURITY FIX (Audit Vuln 6): Cannot claim twice in same block
    error VestingCliffNotReached(); // SECURITY FIX (Vuln 5): Cliff period not yet passed
    error VestingExceedsAllowance(); // SECURITY FIX (Vuln 5): Claim exceeds vested amount
    error AtomicSwapperAlreadySet(); // SECURITY FIX (Audit Vuln 3): Cannot change atomic swapper once set
    error NeverAuthorizedInR00TPool(); // SECURITY FIX (Audit Vuln 7): Pool was never authorized in r00tPool, cannot use emergency insert

    // ============ Events ============
    event VerifierUpdated(string indexed verifierType, address indexed oldVerifier, address indexed newVerifier);  // SECURITY FIX M-04

    // ============ Modifiers ============

    modifier onlyGovernance() {
        if (msg.sender != governance) revert Unauthorized();
        _;
    }

    modifier notExpired(uint256 deadline) {
        if (block.timestamp > deadline) revert TransactionExpired();
        _;
    }

    /// @notice Requires swap verifier to be deployed
    /// @dev SECURITY FIX: No governance bypass - verifier MUST be deployed
    ///      Allowing governance bypass would enable fake swaps without valid proofs
    modifier requiresSwapVerifier() {
        if (swapVerifier == address(0)) revert NotImplemented();
        _;
    }

    /// @notice Requires LP withdraw verifier to be deployed
    /// @dev SECURITY FIX: No governance bypass - verifier MUST be deployed
    ///      Allowing governance bypass would enable theft of LP positions
    modifier requiresLPVerifier() {
        if (lpWithdrawVerifier == address(0)) revert NotImplemented();
        _;
    }

    /// @notice Requires caller to be the authorized atomic swapper (ZkAMM)
    /// @dev SECURITY: Only ZkAMM can perform atomic swaps without proof
    modifier onlyAuthorizedAtomicSwapper() {
        if (msg.sender != authorizedAtomicSwapper) revert Unauthorized();
        _;
    }

    // ============ Constructor ============

    /// @notice Initialize the project pool
    /// @param _name Project token name
    /// @param _symbol Project token symbol
    /// @param _token ERC20 token address (must have totalSupply already minted to this pool)
    /// @param _initialRootReserve Initial R00T reserve (committed by creator)
    /// @param _r00tPool Address of main R00T token pool
    /// @param _nullifierRegistry Global nullifier registry address
    /// @param _creator Project creator address
    /// @param _platform Platform treasury address
    /// @param _proposalId Governance proposal ID
    /// @param _maxDevAllocationBps Maximum dev allocation in basis points (max 500 = 5%)
    constructor(
        string memory _name,
        string memory _symbol,
        address _token,
        uint256 _initialRootReserve,
        address _r00tPool,
        address _nullifierRegistry,
        address _creator,
        address _platform,
        uint256 _proposalId,
        uint256 _maxDevAllocationBps
    ) {
        if (_token == address(0) || _r00tPool == address(0) || _creator == address(0) || _platform == address(0)) revert ZeroAddress();
        if (_nullifierRegistry == address(0)) revert ZeroAddress();
        if (_initialRootReserve == 0) revert ZeroAmount();

        token = IERC20(_token);
        uint256 _totalSupply = token.totalSupply();
        if (_totalSupply == 0) revert ZeroAmount();

        name = _name;
        symbol = _symbol;
        totalSupply = _totalSupply;

        // Get Poseidon address from r00t pool
        address poseidonAddr = TokenPool(_r00tPool).poseidon();

        // Create commitment pools
        projectTokenPool = new TokenPool(poseidonAddr);
        lpPool = new TokenPool(poseidonAddr);
        r00tPool = TokenPool(_r00tPool);
        nullifierRegistry = NullifierRegistry(_nullifierRegistry);

        // Token reserve = tokens held by this pool (should be totalSupply after deployment)
        // This will be verified after construction by checking token.balanceOf(this)
        tokenReserve = _totalSupply;
        // SECURITY NOTE (Vuln 2): r00tReserve is initialized with the pledged amount from governance.
        // This is a "virtual" reserve - the actual R00T stays in the governance contract.
        // The pool's r00tReserve grows with real R00T as users swap R00T → ProjectToken.
        // Users swapping ProjectToken → R00T receive pending claims (processed by governance),
        // not direct R00T from this pool. This design is intentional for the launchpad model.
        // INVARIANT: r00tReserve >= totalPendingClaims (enforced in swap/withdraw functions)
        r00tReserve = _initialRootReserve;

        // Burn initial LP shares (MINIMUM_LIQUIDITY) to prevent price manipulation
        // This is similar to Uniswap V2's approach - first LP is permanently locked
        // LP shares = sqrt(r00tReserve * tokenReserve) for initial deposit
        uint256 initialLPShares = sqrt(_initialRootReserve * _totalSupply);
        if (initialLPShares <= MINIMUM_LIQUIDITY) revert InsufficientInitialLiquidity();

        // Burn MINIMUM_LIQUIDITY by not assigning it to anyone (permanently locked)
        // Note: The burned MINIMUM_LIQUIDITY shares are conceptually owned by address(0)
        // This prevents the pool from ever being fully drained
        totalLPShares = MINIMUM_LIQUIDITY; // Only the burned amount exists initially
        // The creator doesn't get LP tokens - their liquidity is locked forever as pool seed

        emit InitialLiquidityBurned(_initialRootReserve, _totalSupply, MINIMUM_LIQUIDITY);

        creator = _creator;
        platform = _platform;
        governance = msg.sender;
        proposalId = _proposalId;

        // SECURITY FIX: Calculate and store maximum dev allocation
        // Max 5% (500 bps) enforced by governance, but we store exact amount here
        maxDevAllocation = (_totalSupply * _maxDevAllocationBps) / 10000;

        // SECURITY FIX (Vuln 5): Record pool creation time for vesting calculations
        poolCreatedAt = block.timestamp;
    }

    /// @notice Square root function for LP share calculation (Babylonian method)
    function sqrt(uint256 x) internal pure returns (uint256 y) {
        if (x == 0) return 0;
        uint256 z = (x + 1) / 2;
        y = x;
        while (z < y) {
            y = z;
            z = (x / z + z) / 2;
        }
    }

    // ============ Swap Functions ============

    /// @notice Swap R00T for project tokens privately
    /// @dev User spends R00T commitment, receives project token commitment
    /// @param proof ZK proof of R00T commitment ownership
    /// @param r00tMerkleRoot Merkle root of R00T commitment tree
    /// @param r00tNullifierHash Nullifier hash for R00T commitment
    /// @param r00tAmount Amount of R00T being spent
    /// @param minTokensOut Minimum project tokens to receive
    /// @param outputCommitment New commitment for project tokens received
    /// @param r00tChangeCommitment Change commitment for remaining R00T (or 0)
    /// @param deadline Transaction deadline
    /// @param outputNote Encrypted note for output commitment
    /// @param changeNote Encrypted note for change commitment
    function swapR00tForToken(
        uint256[8] calldata proof,
        uint256 r00tMerkleRoot,
        uint256 r00tNullifierHash,
        uint256 r00tAmount,
        uint256 minTokensOut,
        uint256 outputCommitment,
        uint256 r00tChangeCommitment,
        uint256 deadline,
        bytes calldata outputNote,
        bytes calldata changeNote
    ) external nonReentrant notExpired(deadline) requiresSwapVerifier {
        // SECURITY FIX: Validate all ZK public inputs are within SNARK scalar field
        // This prevents nullifier aliasing attacks (see fv-zk-2-c1-nullifier-aliasing.md)
        if (r00tMerkleRoot >= SNARK_SCALAR_FIELD) revert InvalidScalarField();
        if (r00tNullifierHash >= SNARK_SCALAR_FIELD) revert InvalidScalarField();
        if (outputCommitment >= SNARK_SCALAR_FIELD) revert InvalidScalarField();
        if (r00tChangeCommitment >= SNARK_SCALAR_FIELD) revert InvalidScalarField();

        // CHECKS
        if (!r00tPool.isKnownRoot(r00tMerkleRoot)) revert UnknownMerkleRoot();
        // SECURITY FIX: Check BOTH local and global nullifier tracking
        if (r00tNullifiers[r00tNullifierHash]) revert NullifierAlreadySpent();
        if (nullifierRegistry.isSpent(r00tNullifierHash)) revert NullifierAlreadySpent();
        if (r00tAmount == 0) revert ZeroAmount();

        // Verify ZK proof (requiresSwapVerifier modifier guarantees verifier exists)
        uint256[7] memory pubSignals = [
            r00tMerkleRoot,
            r00tNullifierHash,
            r00tAmount,
            outputCommitment,
            minTokensOut,
            r00tChangeCommitment,
            0 // publicInputsBinding
        ];
        if (!ISwapVerifier(swapVerifier).verifyProof(proof, pubSignals)) revert InvalidProof();

        // Calculate tokens out
        uint256 tokensOut = getAmountOut(r00tAmount, r00tReserve, tokenReserve);
        if (tokensOut < minTokensOut) revert SlippageExceeded();

        // Calculate fees (in R00T)
        uint256 platformFee = (r00tAmount * PLATFORM_FEE_BPS) / FEE_DENOMINATOR;
        uint256 creatorFee = (r00tAmount * CREATOR_FEE_BPS) / FEE_DENOMINATOR;
        uint256 lpFee = (r00tAmount * LP_FEE_BPS) / FEE_DENOMINATOR;
        uint256 r00tAfterFees = r00tAmount - platformFee - creatorFee - lpFee;

        // EFFECTS - Update ALL local state BEFORE any external calls (CEI pattern)
        // SECURITY FIX: All local state updates FIRST, then external calls
        r00tNullifiers[r00tNullifierHash] = true;

        r00tReserve += r00tAfterFees;
        tokenReserve -= tokensOut;
        accumulatedPlatformFees += platformFee;
        accumulatedCreatorFees += creatorFee;

        // Distribute LP fees
        // SECURITY FIX (Audit Vuln 2): Only distribute if fee is large enough to avoid rounding to zero
        if (totalLPShares > 0 && lpFee >= MIN_LP_FEE_FOR_DISTRIBUTION) {
            uint256 feeIncrement = (lpFee * FEE_PRECISION) / totalLPShares;
            if (feeIncrement > 0) {
                feePerShare += feeIncrement;
                accumulatedLPFees += lpFee;
            } else {
                accumulatedPlatformFees += lpFee;
            }
        } else {
            accumulatedPlatformFees += lpFee;
        }

        // INTERACTIONS - All external calls happen AFTER state updates
        // SECURITY FIX: nullifierRegistry.markSpent moved here (after ALL local state updates)
        // This prevents reentrancy via malicious NullifierRegistry from exploiting stale reserves
        nullifierRegistry.markSpent(r00tNullifierHash);

        // Insert output commitment
        uint256 leafIndex = projectTokenPool.insert(outputCommitment);
        emit NewProjectTokenCommitment(outputCommitment, leafIndex, outputNote);

        // Handle R00T change commitment - this would be inserted into r00tPool
        // (handled by calling contract if needed)

        emit NullifierSpent(r00tNullifierHash);
        emit R00tSwappedForToken(r00tAmount, tokensOut, platformFee, creatorFee);
    }

    /// @notice Swap project tokens for R00T privately
    /// @dev User spends project token commitment, receives R00T commitment
    function swapTokenForR00t(
        uint256[8] calldata proof,
        uint256 tokenMerkleRoot,
        uint256 tokenNullifierHash,
        uint256 tokenAmount,
        uint256 minR00tOut,
        uint256 outputR00tCommitment,
        uint256 tokenChangeCommitment,
        uint256 deadline,
        bytes calldata outputNote,
        bytes calldata changeNote
    ) external nonReentrant notExpired(deadline) requiresSwapVerifier {
        // SECURITY FIX: Validate all ZK public inputs are within SNARK scalar field
        if (tokenMerkleRoot >= SNARK_SCALAR_FIELD) revert InvalidScalarField();
        if (tokenNullifierHash >= SNARK_SCALAR_FIELD) revert InvalidScalarField();
        if (outputR00tCommitment >= SNARK_SCALAR_FIELD) revert InvalidScalarField();
        if (tokenChangeCommitment >= SNARK_SCALAR_FIELD) revert InvalidScalarField();

        // CHECKS
        if (!projectTokenPool.isKnownRoot(tokenMerkleRoot)) revert UnknownMerkleRoot();
        if (nullifiers[tokenNullifierHash]) revert NullifierAlreadySpent();
        if (tokenAmount == 0) revert ZeroAmount();

        // Verify ZK proof (requiresSwapVerifier modifier guarantees verifier exists)
        uint256[7] memory pubSignals = [
            tokenMerkleRoot,
            tokenNullifierHash,
            tokenAmount,
            outputR00tCommitment,
            minR00tOut,
            tokenChangeCommitment,
            0 // publicInputsBinding
        ];
        if (!ISwapVerifier(swapVerifier).verifyProof(proof, pubSignals)) revert InvalidProof();

        // Calculate R00T out
        uint256 r00tOut = getAmountOut(tokenAmount, tokenReserve, r00tReserve);
        if (r00tOut < minR00tOut) revert SlippageExceeded();
        if (r00tOut > r00tReserve) revert InsufficientReserve();

        // Calculate fees (in R00T out) - needed for reserve check below
        uint256 platformFee = (r00tOut * PLATFORM_FEE_BPS) / FEE_DENOMINATOR;
        uint256 creatorFee = (r00tOut * CREATOR_FEE_BPS) / FEE_DENOMINATOR;
        uint256 lpFee = (r00tOut * LP_FEE_BPS) / FEE_DENOMINATOR;
        uint256 r00tAfterFees = r00tOut - platformFee - creatorFee - lpFee;

        // SECURITY FIX (Vuln 4 + Audit Vuln 1): Ensure reserves don't go below pending claims
        // This prevents a race condition where multiple swaps could drain reserves
        // below what's needed to honor existing pending R00T claims.
        // IMPORTANT: We check against r00tAfterFees (the actual claim amount), not r00tOut.
        // After this swap: new r00tReserve = r00tReserve - r00tOut
        // New pending claims = totalPendingClaims + r00tAfterFees
        // Invariant: (r00tReserve - r00tOut) >= (totalPendingClaims + r00tAfterFees)
        // Note: Fees (platformFee + creatorFee + lpFee) stay in the system and back other claims
        if (r00tReserve - r00tOut < totalPendingClaims + r00tAfterFees) revert InsufficientR00tReserve();

        // EFFECTS
        nullifiers[tokenNullifierHash] = true;
        tokenReserve += tokenAmount;
        r00tReserve -= r00tOut;
        accumulatedPlatformFees += platformFee;
        accumulatedCreatorFees += creatorFee;

        // Distribute LP fees
        // SECURITY FIX (Audit Vuln 2): Only distribute if fee is large enough to avoid rounding to zero
        if (totalLPShares > 0 && lpFee >= MIN_LP_FEE_FOR_DISTRIBUTION) {
            uint256 feeIncrement = (lpFee * FEE_PRECISION) / totalLPShares;
            if (feeIncrement > 0) {
                feePerShare += feeIncrement;
                accumulatedLPFees += lpFee;
            } else {
                accumulatedPlatformFees += lpFee;
            }
        } else {
            accumulatedPlatformFees += lpFee;
        }

        // Handle token change commitment
        if (tokenChangeCommitment != 0) {
            uint256 changeIndex = projectTokenPool.insert(tokenChangeCommitment);
            emit NewProjectTokenCommitment(tokenChangeCommitment, changeIndex, changeNote);
        }

        // SECURITY FIX: Create pending R00T claim for the user
        // Previously the user sold tokens but never received R00T - critical bug!
        // The user receives r00tAfterFees (r00tOut minus platform/creator/LP fees)
        if (outputR00tCommitment != 0) {
            uint256 claimId = nextClaimId++;
            pendingR00tClaims[claimId] = PendingR00tClaim({
                amount: r00tAfterFees,
                outputCommitment: outputR00tCommitment,
                encryptedNote: outputNote,
                claimed: false,
                createdAt: block.timestamp
            });
            totalPendingClaims += r00tAfterFees;
            emit R00tClaimRegistered(claimId, r00tAfterFees, outputR00tCommitment);
        }

        emit NullifierSpent(tokenNullifierHash);
        emit TokenSwappedForR00t(tokenAmount, r00tOut, platformFee, creatorFee);
    }

    // ============ Liquidity Functions ============

    /// @notice Add liquidity to the pool (dual-sided: R00T + Token)
    /// @dev User provides both R00T and project token commitments, receives LP commitment
    ///      The amounts must be proportional to current reserves to maintain price
    /// @param r00tProof ZK proof of R00T commitment ownership
    /// @param r00tMerkleRoot R00T commitment merkle root
    /// @param r00tNullifierHash R00T nullifier being spent
    /// @param r00tAmount Amount of R00T being added
    /// @param tokenProof ZK proof of project token commitment ownership
    /// @param tokenMerkleRoot Project token merkle root
    /// @param tokenNullifierHash Token nullifier being spent
    /// @param tokenAmount Amount of tokens being added
    /// @param lpCommitment New LP commitment to receive
    /// @param deadline Transaction deadline
    /// @param lpNote Encrypted LP note
    function addLiquidity(
        uint256[8] calldata r00tProof,
        uint256 r00tMerkleRoot,
        uint256 r00tNullifierHash,
        uint256 r00tAmount,
        uint256[8] calldata tokenProof,
        uint256 tokenMerkleRoot,
        uint256 tokenNullifierHash,
        uint256 tokenAmount,
        uint256 lpCommitment,
        uint256 deadline,
        bytes calldata lpNote
    ) external nonReentrant notExpired(deadline) requiresSwapVerifier {
        // SECURITY FIX: Validate all ZK public inputs are within SNARK scalar field
        if (r00tMerkleRoot >= SNARK_SCALAR_FIELD) revert InvalidScalarField();
        if (r00tNullifierHash >= SNARK_SCALAR_FIELD) revert InvalidScalarField();
        if (tokenMerkleRoot >= SNARK_SCALAR_FIELD) revert InvalidScalarField();
        if (tokenNullifierHash >= SNARK_SCALAR_FIELD) revert InvalidScalarField();
        if (lpCommitment >= SNARK_SCALAR_FIELD) revert InvalidScalarField();

        // CHECKS
        if (r00tAmount == 0 || tokenAmount == 0) revert ZeroAmount();

        // SECURITY FIX (Vuln 3): Require minimum deposit amounts to prevent dust deposits
        // and ensure tolerance calculation (expectedTokenAmount / 200) yields meaningful values
        if (r00tAmount < MIN_LP_DEPOSIT || tokenAmount < MIN_LP_DEPOSIT) revert InsufficientLiquidity();

        // SECURITY FIX: Prevent division by zero if reserves are drained
        if (r00tReserve == 0 || tokenReserve == 0) revert InsufficientReserve();

        // Verify R00T commitment
        if (!r00tPool.isKnownRoot(r00tMerkleRoot)) revert UnknownMerkleRoot();
        if (nullifierRegistry.isSpent(r00tNullifierHash)) revert NullifierAlreadySpent();

        // Verify Token commitment
        if (!projectTokenPool.isKnownRoot(tokenMerkleRoot)) revert UnknownMerkleRoot();
        if (nullifiers[tokenNullifierHash]) revert NullifierAlreadySpent();

        // Verify amounts are proportional to reserves (within 0.5% tolerance)
        // This ensures LP doesn't change the price
        // SECURITY FIX: Use cross-multiplication to avoid division precision issues
        // tokenAmount should be within 0.5% of (r00tAmount * tokenReserve / r00tReserve)
        // Cross-multiply: tokenAmount * r00tReserve * 200 should be within 199-201 of r00tAmount * tokenReserve * 200
        // Simplified: tokenAmount * r00tReserve should be within [r00tAmount * tokenReserve * 199/200, r00tAmount * tokenReserve * 201/200]
        // Further simplified with cross-mult: tokenAmount * r00tReserve * 200 in [r00tAmount * tokenReserve * 199, r00tAmount * tokenReserve * 201]
        uint256 lhs = tokenAmount * r00tReserve;
        uint256 rhs = r00tAmount * tokenReserve;
        // Check if lhs is within 0.5% of rhs (199/200 to 201/200)
        if (lhs * 200 < rhs * 199 || lhs * 200 > rhs * 201) {
            revert ImbalancedLiquidity();
        }

        // Verify ZK proofs (requiresSwapVerifier modifier guarantees verifier exists)
        // Verify R00T proof
        uint256[7] memory r00tPubSignals = [
            r00tMerkleRoot,
            r00tNullifierHash,
            r00tAmount,
            lpCommitment,
            0,
            0, // no change commitment for liquidity
            0
        ];
        if (!ISwapVerifier(swapVerifier).verifyProof(r00tProof, r00tPubSignals)) revert InvalidProof();

        // Verify Token proof
        uint256[7] memory tokenPubSignals = [
            tokenMerkleRoot,
            tokenNullifierHash,
            tokenAmount,
            lpCommitment,
            0,
            0,
            0
        ];
        if (!ISwapVerifier(swapVerifier).verifyProof(tokenProof, tokenPubSignals)) revert InvalidProof();

        // Calculate LP shares based on R00T contribution (proportional to total)
        // SECURITY FIX (Audit Vuln 2): totalLPShares is always > 0 because MINIMUM_LIQUIDITY
        // is burned in constructor (line 392). This check defends against edge cases.
        if (totalLPShares == 0) revert InvalidLPShares();

        uint256 lpShares = (r00tAmount * totalLPShares) / r00tReserve;
        if (lpShares == 0) revert InvalidLPShares();

        // SECURITY FIX (Audit Vuln 4): Stricter rounding check to prevent LP share exploitation
        // Ensure rounding loss is minimal (max 0.05% instead of 0.1%)
        // lpShares * r00tReserve should be within 0.05% of r00tAmount * totalLPShares
        uint256 expectedProduct = r00tAmount * totalLPShares;
        uint256 actualProduct = lpShares * r00tReserve;
        // Allow 0.05% rounding loss: actualProduct >= expectedProduct * 9995 / 10000
        // This is stricter than before (0.1%) to prevent cumulative rounding exploitation
        require(actualProduct * 10000 >= expectedProduct * 9995, "Rounding loss too high");

        // SECURITY FIX (Vuln 5): Check for LP commitment collision
        // If this commitment already exists AND is active, reject to prevent overwriting shares
        // Allow reuse of withdrawn commitment slots
        if (lpDepositTime[lpCommitment] != 0 && !lpCommitmentWithdrawn[lpCommitment]) {
            revert InvalidLPShares(); // Reuse existing error - commitment already in use
        }

        // EFFECTS - ALL state updates BEFORE external calls (CEI pattern)
        // SECURITY FIX (Vuln 4): Moved all state updates before nullifierRegistry.markSpent()
        // to prevent cross-contract reentrancy with stale reserve values
        nullifiers[tokenNullifierHash] = true;

        // Update reserves BEFORE external calls
        r00tReserve += r00tAmount;
        tokenReserve += tokenAmount;
        totalLPShares += lpShares;

        // Track LP commitment BEFORE external calls
        lpDepositTime[lpCommitment] = block.timestamp;
        lastClaimedFeePerShare[lpCommitment] = feePerShare;
        lpCommitmentShares[lpCommitment] = lpShares;
        // SECURITY FIX (Vuln 5): Reset withdrawn flag if reusing a withdrawn commitment slot
        if (lpCommitmentWithdrawn[lpCommitment]) {
            lpCommitmentWithdrawn[lpCommitment] = false;
        }

        // INTERACTIONS - External calls AFTER all state updates
        // SECURITY FIX (Vuln 4): nullifierRegistry.markSpent() now happens after state updates
        nullifierRegistry.markSpent(r00tNullifierHash);

        // Insert LP commitment into merkle tree
        uint256 leafIndex = lpPool.insert(lpCommitment);

        emit NewLPCommitment(lpCommitment, leafIndex, lpShares, lpNote);
        emit LiquidityAdded(lpCommitment, r00tAmount, tokenAmount, lpShares);
    }

    /// @notice Remove liquidity from the pool (returns both R00T + Token)
    /// @dev User burns LP commitment, receives R00T commitment (in this pool's r00tCommitments)
    ///      and Token commitment (in projectTokenPool)
    /// @param proof ZK proof of LP commitment ownership
    /// @param lpMerkleRoot LP merkle root
    /// @param nullifierHash LP nullifier being spent
    /// @param commitment The LP commitment being burned
    /// @param lpShares Amount of LP shares in the commitment
    /// @param minR00tOut Minimum R00T to receive (slippage protection)
    /// @param minTokenOut Minimum tokens to receive (slippage protection)
    /// @param r00tOutputCommitment Commitment for R00T received
    /// @param tokenOutputCommitment Commitment for tokens received
    /// @param deadline Transaction deadline
    /// @param r00tNote Encrypted note for R00T commitment
    /// @param tokenNote Encrypted note for token commitment
    function removeLiquidity(
        uint256[8] calldata proof,
        uint256 lpMerkleRoot,
        uint256 nullifierHash,
        uint256 commitment,
        uint256 lpShares,
        uint256 minR00tOut,
        uint256 minTokenOut,
        uint256 r00tOutputCommitment,
        uint256 tokenOutputCommitment,
        uint256 deadline,
        bytes calldata r00tNote,
        bytes calldata tokenNote
    ) external nonReentrant notExpired(deadline) requiresLPVerifier {
        // SECURITY FIX: Validate all ZK public inputs are within SNARK scalar field
        if (lpMerkleRoot >= SNARK_SCALAR_FIELD) revert InvalidScalarField();
        if (nullifierHash >= SNARK_SCALAR_FIELD) revert InvalidScalarField();
        if (commitment >= SNARK_SCALAR_FIELD) revert InvalidScalarField();
        if (r00tOutputCommitment >= SNARK_SCALAR_FIELD) revert InvalidScalarField();
        if (tokenOutputCommitment >= SNARK_SCALAR_FIELD) revert InvalidScalarField();

        // CHECKS
        if (!lpPool.isKnownRoot(lpMerkleRoot)) revert UnknownMerkleRoot();
        if (lpNullifiers[nullifierHash]) revert NullifierAlreadySpent();
        if (lpShares == 0) revert ZeroAmount();

        // Check LP lock period
        if (block.timestamp < lpDepositTime[commitment] + LP_LOCK_PERIOD) revert LPLocked();

        // Verify LP shares match stored value
        if (lpCommitmentShares[commitment] != lpShares) revert InvalidLPShares();

        // Verify ZK proof (requiresLPVerifier modifier guarantees verifier exists)
        // SECURITY FIX: 8 pubSignals - commitment included to bind proof to specific LP position
        uint256[8] memory pubSignals = [
            lpMerkleRoot,
            nullifierHash,
            commitment,      // SECURITY FIX: Bind proof to this specific commitment
            lpShares,
            r00tOutputCommitment,
            tokenOutputCommitment,
            minR00tOut,
            0 // publicInputsBinding
        ];
        if (!IProjectPoolLPVerifier(lpWithdrawVerifier).verifyProof(proof, pubSignals)) revert InvalidProof();

        // Calculate proportional amounts to return
        uint256 r00tOut = (lpShares * r00tReserve) / totalLPShares;
        uint256 tokenOut = (lpShares * tokenReserve) / totalLPShares;

        if (r00tOut < minR00tOut) revert SlippageExceeded();
        if (tokenOut < minTokenOut) revert SlippageExceeded();

        // SECURITY FIX (Vuln 4): Ensure reserves don't go below pending claims
        // This prevents LP withdrawals from draining reserves needed to honor existing claims
        if (r00tReserve < totalPendingClaims + r00tOut) revert InsufficientR00tReserve();

        // EFFECTS - Mark LP nullifier as spent
        lpNullifiers[nullifierHash] = true;

        // Clear LP commitment tracking (no partial withdrawal supported - full burn only)
        lpCommitmentShares[commitment] = 0;
        lpCommitmentWithdrawn[commitment] = true;

        // Update reserves
        r00tReserve -= r00tOut;
        tokenReserve -= tokenOut;
        totalLPShares -= lpShares;

        // Create output commitments for the user
        // Insert token output commitment into project token pool
        uint256 tokenLeafIndex = projectTokenPool.insert(tokenOutputCommitment);
        emit NewProjectTokenCommitment(tokenOutputCommitment, tokenLeafIndex, tokenNote);

        // SECURITY FIX: Instead of creating R00T commitments directly (which this pool cannot back),
        // register a pending claim that can be processed by ZkAMM (the actual R00T custodian)
        // This prevents creating unbacked R00T commitments
        uint256 claimId = nextClaimId++;
        pendingR00tClaims[claimId] = PendingR00tClaim({
            amount: r00tOut,
            outputCommitment: r00tOutputCommitment,
            encryptedNote: r00tNote,
            claimed: false,
            createdAt: block.timestamp
        });
        totalPendingClaims += r00tOut;

        emit R00tClaimRegistered(claimId, r00tOut, r00tOutputCommitment);
        emit LPNullifierSpent(nullifierHash);
        emit LiquidityRemoved(nullifierHash, r00tOut, tokenOut);
    }

    // ============ Public Bridge Functions (Private <-> ERC20) ============

    /// @notice Withdraw tokens from privacy pool to public ERC20
    /// @dev Burns a private commitment and transfers ERC20 tokens to recipient
    /// @param proof ZK proof of commitment ownership
    /// @param merkleRoot Merkle root of project token pool
    /// @param nullifierHash Nullifier to prevent double-spending
    /// @param amount Amount of tokens to withdraw
    /// @param recipient Public address to receive ERC20 tokens
    function withdrawPublic(
        uint256[8] calldata proof,
        uint256 merkleRoot,
        uint256 nullifierHash,
        uint256 amount,
        address recipient
    ) external nonReentrant {
        // SECURITY FIX: Validate all ZK public inputs are within SNARK scalar field
        if (merkleRoot >= SNARK_SCALAR_FIELD) revert InvalidScalarField();
        if (nullifierHash >= SNARK_SCALAR_FIELD) revert InvalidScalarField();

        // CHECKS
        if (!projectTokenPool.isKnownRoot(merkleRoot)) revert UnknownMerkleRoot();
        if (nullifiers[nullifierHash]) revert NullifierAlreadySpent();
        if (recipient == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();

        // Verify pool has enough tokens
        if (token.balanceOf(address(this)) < amount) revert InsufficientReserve();

        // SECURITY FIX: Verifier MUST be deployed - no governance bypass allowed
        // Allowing governance bypass would enable theft of user funds without valid proof
        if (withdrawVerifier == address(0)) revert NotImplemented();

        // Verify ZK proof
        uint256[5] memory pubSignals = [
            merkleRoot,
            nullifierHash,
            amount,
            uint256(uint160(recipient)),
            0 // publicInputsBinding (computed by circuit)
        ];
        if (!IWithdrawVerifier(withdrawVerifier).verifyProof(proof, pubSignals)) revert InvalidProof();

        // EFFECTS - Mark nullifier as spent
        nullifiers[nullifierHash] = true;

        // Note: tokenReserve tracks virtual tokens in the AMM
        // ERC20 balance is separate - users can withdraw ERC20 without affecting AMM reserves
        // The commitment pool tracks private ownership

        // INTERACTIONS - Transfer ERC20 tokens to recipient
        token.safeTransfer(recipient, amount);

        emit NullifierSpent(nullifierHash);
        emit PublicWithdrawal(nullifierHash, recipient, amount);
    }

    /// @notice Deposit ERC20 tokens into the privacy pool
    /// @dev Transfers ERC20 from sender and creates a private commitment
    ///
    /// SECURITY FIX (Vuln 5): Added depositorBinding to prevent front-running attacks.
    /// The depositorBinding is a hash of (commitment, msg.sender, amount) that ensures
    /// only the intended depositor can make this deposit. Even if an attacker sees
    /// the commitment in a pending transaction, they cannot use it because their
    /// depositorBinding would be different (different msg.sender).
    ///
    /// Users compute: depositorBinding = keccak256(abi.encodePacked(commitment, depositorAddress, amount))
    ///
    /// The same commitment CAN be inserted multiple times (each as a separate leaf), which is
    /// intentional for privacy (allows plausible deniability). Each insertion creates a new leaf
    /// that can be spent with its own proof.
    ///
    /// @param amount Amount of tokens to deposit
    /// @param commitment New commitment for the deposited tokens
    /// @param depositorBinding Hash binding commitment to depositor: keccak256(commitment, msg.sender, amount)
    /// @param encryptedNote Encrypted note for commitment recovery
    function depositPublic(
        uint256 amount,
        uint256 commitment,
        bytes32 depositorBinding,
        bytes calldata encryptedNote
    ) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        if (commitment == 0) revert ZeroAmount();
        // SECURITY FIX (Audit Vuln 4): Validate commitment is within SNARK scalar field
        // Without this check, commitments >= SNARK_SCALAR_FIELD cannot be spent via ZK proofs
        // because the circuit operates modulo SNARK_SCALAR_FIELD, causing permanent fund loss
        if (commitment >= SNARK_SCALAR_FIELD) revert InvalidScalarField();

        // SECURITY FIX: Verify depositor binding to prevent front-running
        // This ensures only the intended depositor can make this deposit with this commitment
        bytes32 expectedBinding = keccak256(abi.encodePacked(commitment, msg.sender, amount));
        if (depositorBinding != expectedBinding) revert InvalidProof();

        // Transfer ERC20 tokens from sender to this pool
        token.safeTransferFrom(msg.sender, address(this), amount);

        // Insert commitment into merkle tree
        // Note: Same commitment can be inserted multiple times (different leaves, same value)
        uint256 leafIndex = projectTokenPool.insert(commitment);

        emit NewProjectTokenCommitment(commitment, leafIndex, encryptedNote);
        emit PublicDeposit(commitment, msg.sender, amount);
    }

    /// @notice Claim dev allocation as a private commitment
    /// @dev Only callable by creator, creates commitment for up to maxDevAllocation tokens.
    ///      SECURITY: Tokens are deducted from tokenReserve to prevent double-spending.
    ///      SECURITY FIX (Vuln 5): Dev allocation is subject to vesting:
    ///      - 30-day cliff before any claims allowed
    ///      - Linear vesting over 180 days from pool creation
    ///      - This prevents immediate drain if creator key is compromised
    /// @param commitment Commitment for dev allocation
    /// @param amount Amount to claim (must not exceed vested amount)
    /// @param encryptedNote Encrypted note for commitment recovery
    function claimDevAllocation(
        uint256 commitment,
        uint256 amount,
        bytes calldata encryptedNote
    ) external nonReentrant {
        if (msg.sender != creator) revert Unauthorized();
        if (amount == 0) revert ZeroAmount();
        if (commitment == 0) revert ZeroAmount();
        // SECURITY FIX (Audit Vuln 3): Validate commitment is within SNARK scalar field
        // Without this check, commitments >= SNARK_SCALAR_FIELD cannot be spent via ZK proofs
        // because the circuit operates modulo SNARK_SCALAR_FIELD, causing permanent fund loss
        if (commitment >= SNARK_SCALAR_FIELD) revert InvalidScalarField();

        // SECURITY FIX (Vuln 5): Enforce vesting cliff
        // No claims allowed before cliff period ends
        if (block.timestamp < poolCreatedAt + DEV_VESTING_CLIFF) revert VestingCliffNotReached();

        // SECURITY FIX (Vuln 5): Calculate vested amount based on linear vesting
        // After cliff, allocation vests linearly over DEV_VESTING_PERIOD
        uint256 timeSinceCreation = block.timestamp - poolCreatedAt;
        uint256 vestedAmount;
        if (timeSinceCreation >= DEV_VESTING_PERIOD) {
            // Fully vested after vesting period
            vestedAmount = maxDevAllocation;
        } else {
            // Linear vesting: (time passed / vesting period) * max allocation
            vestedAmount = (maxDevAllocation * timeSinceCreation) / DEV_VESTING_PERIOD;
        }

        // Calculate how much can still be claimed (vested - already claimed)
        uint256 claimableNow = vestedAmount > devAllocationClaimed ? vestedAmount - devAllocationClaimed : 0;

        // SECURITY FIX (Vuln 5): Check that requested amount doesn't exceed vested allowance
        if (amount > claimableNow) revert VestingExceedsAllowance();

        // SECURITY FIX: Enforce max dev allocation on-chain
        // Check that claimed + amount doesn't exceed maxDevAllocation
        if (devAllocationClaimed + amount > maxDevAllocation) revert DevAllocationExceeded();

        // SECURITY FIX: Ensure pool has enough tokens in reserve
        // Dev allocation comes from the tokenReserve, not thin air
        if (amount > tokenReserve) revert InsufficientReserve();

        // EFFECTS: Update all state before any external interactions
        devAllocationClaimed += amount;
        tokenReserve -= amount; // SECURITY FIX: Deduct from reserve to prevent inflation

        // Insert commitment into merkle tree
        uint256 leafIndex = projectTokenPool.insert(commitment);

        emit NewProjectTokenCommitment(commitment, leafIndex, encryptedNote);
        emit DevAllocationClaimed(commitment, creator, amount);
    }

    /// @notice Get current vested dev allocation amount
    /// @return vestedAmount Total amount vested so far
    /// @return claimableNow Amount that can be claimed now (vested - claimed)
    function getVestedDevAllocation() external view returns (uint256 vestedAmount, uint256 claimableNow) {
        if (block.timestamp < poolCreatedAt + DEV_VESTING_CLIFF) {
            return (0, 0);
        }

        uint256 timeSinceCreation = block.timestamp - poolCreatedAt;
        if (timeSinceCreation >= DEV_VESTING_PERIOD) {
            vestedAmount = maxDevAllocation;
        } else {
            vestedAmount = (maxDevAllocation * timeSinceCreation) / DEV_VESTING_PERIOD;
        }

        claimableNow = vestedAmount > devAllocationClaimed ? vestedAmount - devAllocationClaimed : 0;
    }

    // ============ View Functions ============

    function getAmountOut(
        uint256 amountIn,
        uint256 reserveIn,
        uint256 reserveOut
    ) public pure returns (uint256 amountOut) {
        uint256 amountInWithFee = amountIn * (FEE_DENOMINATOR - FEE_BPS);
        uint256 numerator = amountInWithFee * reserveOut;
        uint256 denominator = reserveIn * FEE_DENOMINATOR + amountInWithFee;
        amountOut = numerator / denominator;
    }

    function getTokenPrice() external view returns (uint256) {
        return getAmountOut(1e18, r00tReserve, tokenReserve);
    }

    function getR00tPrice() external view returns (uint256) {
        return getAmountOut(1e18, tokenReserve, r00tReserve);
    }

    function getReserves() external view returns (uint256 _r00tReserve, uint256 _tokenReserve) {
        return (r00tReserve, tokenReserve);
    }

    function getProjectTokenPool() external view returns (address) {
        return address(projectTokenPool);
    }

    function getLPPool() external view returns (address) {
        return address(lpPool);
    }

    function getLPInfo() external view returns (uint256 _totalShares, uint256 _feePerShare, uint256 _accumulatedFees) {
        return (totalLPShares, feePerShare, accumulatedLPFees);
    }

    /// @notice Get LP commitment info
    function getLPCommitmentInfo(uint256 commitment) external view returns (
        uint256 shares,
        uint256 depositTime,
        uint256 lastClaimed,
        bool isWithdrawn
    ) {
        return (
            lpCommitmentShares[commitment],
            lpDepositTime[commitment],
            lastClaimedFeePerShare[commitment],
            lpCommitmentWithdrawn[commitment]
        );
    }

    // ============ Supply Tracking View Functions ============

    /// @notice Get the circulating supply (tokens bought from AMM)
    /// @return Amount of tokens that have been bought (not in AMM reserve)
    function getCirculatingSupply() external view returns (uint256) {
        return totalSupply - tokenReserve;
    }

    /// @notice Get tokens held privately (bought but not withdrawn to ERC20)
    /// @return Amount of tokens owned via commitments, still in pool as ERC20
    function getPrivateHoldings() external view returns (uint256) {
        uint256 poolBalance = token.balanceOf(address(this));
        // Pool balance should always be >= tokenReserve
        // Difference = tokens bought but not yet withdrawn
        return poolBalance > tokenReserve ? poolBalance - tokenReserve : 0;
    }

    /// @notice Get tokens that have been withdrawn to public ERC20
    /// @return Amount of tokens withdrawn from pool to public addresses
    function getPublicWithdrawn() external view returns (uint256) {
        uint256 poolBalance = token.balanceOf(address(this));
        // Public withdrawn = total supply - what's still in pool
        return totalSupply - poolBalance;
    }

    /// @notice Get full supply breakdown
    /// @return inReserve Tokens available for trading in AMM
    /// @return privateCommitments Tokens bought but held as commitments (not withdrawn)
    /// @return publicCirculating Tokens withdrawn to public ERC20
    function getSupplyBreakdown() external view returns (
        uint256 inReserve,
        uint256 privateCommitments,
        uint256 publicCirculating
    ) {
        inReserve = tokenReserve;
        uint256 poolBalance = token.balanceOf(address(this));
        privateCommitments = poolBalance > tokenReserve ? poolBalance - tokenReserve : 0;
        publicCirculating = totalSupply - poolBalance;
    }

    // ============ Reserve Health Functions ============

    /// @notice Check the reserve health and solvency (for off-chain monitoring)
    /// @dev SECURITY FIX (Audit Vuln 1): Provides visibility into reserve backing
    ///      Invariant: r00tReserve >= totalPendingClaims + accumulatedPlatformFees + accumulatedCreatorFees + accumulatedLPFees
    ///      This should ALWAYS return true. If false, there's a critical accounting bug.
    /// @return healthy Whether r00tReserve can cover all obligations
    /// @return totalObligations Sum of all pending claims and accumulated fees
    /// @return surplus How much r00tReserve exceeds obligations (0 if unhealthy)
    function checkReserveHealth() external view returns (
        bool healthy,
        uint256 totalObligations,
        uint256 surplus
    ) {
        totalObligations = totalPendingClaims + accumulatedPlatformFees + accumulatedCreatorFees + accumulatedLPFees;
        healthy = r00tReserve >= totalObligations;
        surplus = healthy ? r00tReserve - totalObligations : 0;
    }

    // ============ Fee Collection Functions ============

    /// @notice Collect accumulated platform fees as a pending R00T claim
    /// @dev Called by platform treasury to withdraw accumulated fees
    /// @param outputCommitment Commitment for receiving R00T
    /// @param encryptedNote Encrypted note for commitment recovery
    /// @return claimId The ID of the registered claim
    function collectPlatformFees(
        uint256 outputCommitment,
        bytes calldata encryptedNote
    ) external nonReentrant returns (uint256 claimId) {
        if (msg.sender != platform) revert Unauthorized();
        if (outputCommitment == 0) revert ZeroAmount();
        uint256 amount = accumulatedPlatformFees;
        if (amount == 0) revert NoFeesToCollect();

        // SECURITY FIX: Ensure we have enough R00T reserve to back this claim
        // Prevents underflow when totalPendingClaims > r00tReserve
        if (totalPendingClaims >= r00tReserve || amount > r00tReserve - totalPendingClaims) {
            revert InsufficientR00tReserve();
        }

        accumulatedPlatformFees = 0;

        // SECURITY FIX: Register as pending claim instead of creating unbacked commitment
        claimId = nextClaimId++;
        pendingR00tClaims[claimId] = PendingR00tClaim({
            amount: amount,
            outputCommitment: outputCommitment,
            encryptedNote: encryptedNote,
            claimed: false,
            createdAt: block.timestamp
        });
        totalPendingClaims += amount;

        emit R00tClaimRegistered(claimId, amount, outputCommitment);
        emit PlatformFeesCollected(platform, amount);
    }

    /// @notice Collect accumulated creator fees as a pending R00T claim
    /// @dev Called by project creator to withdraw accumulated fees
    /// @param outputCommitment Commitment for receiving R00T
    /// @param encryptedNote Encrypted note for commitment recovery
    /// @return claimId The ID of the registered claim
    function collectCreatorFees(
        uint256 outputCommitment,
        bytes calldata encryptedNote
    ) external nonReentrant returns (uint256 claimId) {
        if (msg.sender != creator) revert Unauthorized();
        if (outputCommitment == 0) revert ZeroAmount();
        uint256 amount = accumulatedCreatorFees;
        if (amount == 0) revert NoFeesToCollect();

        // SECURITY FIX: Ensure we have enough R00T reserve to back this claim
        // Prevents underflow when totalPendingClaims > r00tReserve
        if (totalPendingClaims >= r00tReserve || amount > r00tReserve - totalPendingClaims) {
            revert InsufficientR00tReserve();
        }

        accumulatedCreatorFees = 0;

        // SECURITY FIX: Register as pending claim instead of creating unbacked commitment
        claimId = nextClaimId++;
        pendingR00tClaims[claimId] = PendingR00tClaim({
            amount: amount,
            outputCommitment: outputCommitment,
            encryptedNote: encryptedNote,
            claimed: false,
            createdAt: block.timestamp
        });
        totalPendingClaims += amount;

        emit R00tClaimRegistered(claimId, amount, outputCommitment);
        emit CreatorFeesCollected(creator, amount);
    }

    /// @notice Claim accumulated LP fees for a commitment as a pending R00T claim
    /// @dev LP holders must prove ownership via ZK proof to claim fees
    /// @param proof ZK proof of LP commitment ownership
    /// @param lpMerkleRoot LP merkle root for proof verification
    /// @param commitment The LP commitment claiming fees
    /// @param lpShares Amount of LP shares in the commitment
    /// @param outputCommitment Commitment for receiving R00T fees
    /// @param encryptedNote Encrypted note for commitment recovery
    /// @return claimId The ID of the registered claim
    function claimLPFees(
        uint256[8] calldata proof,
        uint256 lpMerkleRoot,
        uint256 commitment,
        uint256 lpShares,
        uint256 outputCommitment,
        bytes calldata encryptedNote
    ) external nonReentrant returns (uint256 claimId) {
        // SECURITY FIX: Validate all ZK public inputs are within SNARK scalar field
        if (lpMerkleRoot >= SNARK_SCALAR_FIELD) revert InvalidScalarField();
        if (commitment >= SNARK_SCALAR_FIELD) revert InvalidScalarField();
        if (outputCommitment >= SNARK_SCALAR_FIELD) revert InvalidScalarField();

        if (outputCommitment == 0) revert ZeroAmount();
        if (lpShares == 0) revert ZeroAmount();

        // SECURITY FIX: Verifier MUST be deployed - no governance bypass allowed
        // Allowing governance bypass would enable theft of LP fees without valid proof
        if (claimLPFeesVerifier == address(0)) revert NotImplemented();

        // Verify merkle root is valid in LP pool
        if (!lpPool.isKnownRoot(lpMerkleRoot)) revert UnknownMerkleRoot();

        // Verify ZK proof (6 signals to match IClaimLPFeesVerifier interface)
        // NOTE: ZkProjectPool uses commitment-based tracking instead of epoch-based.
        // The signals are: [lpMerkleRoot, commitment (as claimNullifier), feeEpoch (set to 0),
        //                   lpShares, recipient, publicInputsBinding]
        // For ZkProjectPool, we use commitment in place of claimNullifier since each LP
        // position can only be claimed based on lastClaimedFeePerShare tracking.
        uint256[6] memory pubSignals = [
            lpMerkleRoot,
            commitment,               // Acts as claimNullifier for this pool
            feePerShare,              // Current fee epoch (feePerShare serves as epoch marker)
            lpShares,
            uint256(uint160(msg.sender)),
            0 // publicInputsBinding (computed by circuit)
        ];
        if (!IClaimLPFeesVerifier(claimLPFeesVerifier).verifyProof(proof, pubSignals)) revert InvalidProof();

        // SECURITY FIX: Prevent claims from withdrawn commitments
        if (lpCommitmentWithdrawn[commitment]) revert LPAlreadyWithdrawn();

        // SECURITY FIX (Audit Vuln 6): Prevent same-block double claims
        // This prevents race conditions where feePerShare could change between
        // proof verification and state update, allowing multiple claims
        if (claimedInBlock[commitment][block.number]) revert AlreadyClaimedInBlock();

        // Verify lpShares matches stored value
        if (lpCommitmentShares[commitment] == 0) revert InvalidLPShares();
        if (lpCommitmentShares[commitment] != lpShares) revert InvalidLPShares();

        // Calculate claimable fees
        uint256 lastClaimed = lastClaimedFeePerShare[commitment];
        uint256 feeGrowth = feePerShare - lastClaimed;
        uint256 claimable = (lpShares * feeGrowth) / FEE_PRECISION;

        if (claimable == 0) revert NoFeesToCollect();
        if (claimable > accumulatedLPFees) claimable = accumulatedLPFees;

        // SECURITY FIX: Ensure we have enough R00T reserve to back this claim
        // Prevents underflow when totalPendingClaims > r00tReserve
        if (totalPendingClaims >= r00tReserve || claimable > r00tReserve - totalPendingClaims) {
            revert InsufficientR00tReserve();
        }

        // Update state
        // SECURITY FIX (Audit Vuln 6): Mark this commitment as claimed in this block FIRST
        claimedInBlock[commitment][block.number] = true;
        lastClaimedFeePerShare[commitment] = feePerShare;
        accumulatedLPFees -= claimable;

        // SECURITY FIX: Register as pending claim instead of creating unbacked commitment
        claimId = nextClaimId++;
        pendingR00tClaims[claimId] = PendingR00tClaim({
            amount: claimable,
            outputCommitment: outputCommitment,
            encryptedNote: encryptedNote,
            claimed: false,
            createdAt: block.timestamp
        });
        totalPendingClaims += claimable;

        emit R00tClaimRegistered(claimId, claimable, outputCommitment);
        emit LPFeesClaimed(commitment, msg.sender, claimable);
    }

    // ============ Pending Claims Processing ============

    /// @notice Process a pending R00T claim (called by governance)
    /// @dev This creates the actual R00T commitment in the main R00T pool
    ///      SECURITY: Only governance can process claims to ensure R00T commitments
    ///      are only created when there's actual R00T backing in the system
    /// @param claimId The claim ID to process
    function processR00tClaim(uint256 claimId) external nonReentrant onlyGovernance {
        // SECURITY FIX H-05: Verify this pool is authorized in r00tPool
        if (!r00tPool.authorizedCallers(address(this))) revert R00TPoolUnauthorized();

        PendingR00tClaim storage claim = pendingR00tClaims[claimId];
        if (claim.amount == 0) revert InvalidClaimId();
        if (claim.claimed) revert ClaimAlreadyProcessed();

        claim.claimed = true;
        totalPendingClaims -= claim.amount;

        // Now create the R00T commitment in the main R00T pool
        // This is authorized because this function is only callable by trusted entities
        uint256 leafIndex = r00tPool.insert(claim.outputCommitment);

        // SECURITY FIX (Vuln 6): Use local event for proper event source attribution
        emit R00tCommitmentCreated(claim.outputCommitment, leafIndex, claim.encryptedNote);
        emit R00tClaimProcessed(claimId, claim.amount);
    }

    /// @notice Emergency process a pending R00T claim after delay (called by anyone)
    /// @dev SECURITY FIX (Vuln 6): Prevents permanent fund lock if governance is compromised.
    ///      After EMERGENCY_CLAIM_DELAY (30 days), anyone can process pending claims.
    ///      This ensures users can always recover their funds even if governance fails.
    ///
    ///      SECURITY FIX (Vuln 6): Uses TokenPool.emergencyInsert() if authorization revoked.
    ///      This allows fund recovery even if pool authorization was maliciously revoked.
    ///      The 30-day delay provides sufficient time for legitimate security responses.
    /// @param claimId The claim ID to process
    function emergencyProcessR00tClaim(uint256 claimId) external nonReentrant {
        PendingR00tClaim storage claim = pendingR00tClaims[claimId];
        if (claim.amount == 0) revert InvalidClaimId();
        if (claim.claimed) revert ClaimAlreadyProcessed();

        // SECURITY: Require emergency delay to have passed
        if (block.timestamp < claim.createdAt + EMERGENCY_CLAIM_DELAY) {
            revert EmergencyDelayNotMet();
        }

        claim.claimed = true;
        totalPendingClaims -= claim.amount;

        // Create the R00T commitment in the main R00T pool
        // SECURITY FIX (Vuln 6): Try normal insert first, fall back to emergency insert
        uint256 leafIndex;
        if (r00tPool.authorizedCallers(address(this))) {
            // Pool is authorized, use normal insert
            leafIndex = r00tPool.insert(claim.outputCommitment);
        } else {
            // Pool authorization was revoked, use emergency insert
            // SECURITY FIX (Audit Vuln 7): Verify pool was ever authorized before attempting emergencyInsert
            // If pool was never authorized in r00tPool, emergencyInsert will fail with NeverAuthorized
            // We check here to provide a clearer error message
            if (!r00tPool.wasEverAuthorized(address(this))) revert NeverAuthorizedInR00TPool();
            // This requires 30 days to have passed since revocation (enforced by TokenPool)
            leafIndex = r00tPool.emergencyInsert(claim.outputCommitment);
        }

        // SECURITY FIX (Vuln 6): Use local event for proper event source attribution
        emit R00tCommitmentCreated(claim.outputCommitment, leafIndex, claim.encryptedNote);
        emit R00tClaimProcessed(claimId, claim.amount);
    }

    /// @notice Get pending claim details
    function getPendingClaim(uint256 claimId) external view returns (
        uint256 amount,
        uint256 outputCommitment,
        bool claimed,
        uint256 createdAt
    ) {
        PendingR00tClaim storage claim = pendingR00tClaims[claimId];
        return (claim.amount, claim.outputCommitment, claim.claimed, claim.createdAt);
    }

    /// @notice Get total pending claims count
    function getPendingClaimsInfo() external view returns (
        uint256 nextId,
        uint256 totalPending
    ) {
        return (nextClaimId, totalPendingClaims);
    }

    // ============ Atomic Swap Functions ============

    /// @notice Receive R00T atomically from ZkAMM (no proof required - trusted call)
    /// @dev Only callable by authorized ZkAMM. R00T commitment already created and
    ///      nullifier already marked in ZkAMM. We just mark in global registry and
    ///      create the ProjectToken commitment.
    ///      SECURITY NOTE: This function trusts that the authorizedAtomicSwapper (ZkAMM) has:
    ///      1. Verified a valid ZK proof for the R00T commitment being spent
    ///      2. Marked the nullifier in its local r00tNullifiers mapping
    ///      3. Updated its own ethReserve to reflect the R00T spent
    ///      The r00tAmount parameter is trusted because only ZkAMM can call this function,
    ///      and ZkAMM calculates it from verified ZK proof public inputs.
    /// @param r00tAmount Amount of R00T being swapped
    /// @param r00tNullifier Nullifier for the R00T commitment (already marked locally in ZkAMM)
    /// @param minTokensOut Minimum project tokens to receive (slippage protection)
    /// @param outputCommitment Commitment for the project tokens received
    /// @param encryptedNote Encrypted note for commitment recovery
    /// @return tokensOut Amount of project tokens received
    function atomicSwapFromR00T(
        uint256 r00tAmount,
        uint256 r00tNullifier,
        uint256 minTokensOut,
        uint256 outputCommitment,
        bytes calldata encryptedNote
    ) external nonReentrant onlyAuthorizedAtomicSwapper returns (uint256 tokensOut) {
        if (r00tAmount == 0) revert ZeroAmount();
        if (outputCommitment == 0) revert ZeroAmount();

        // SECURITY FIX (Vuln 3): Validate all inputs are within SNARK scalar field
        if (outputCommitment >= SNARK_SCALAR_FIELD) revert InvalidScalarField();
        if (r00tNullifier >= SNARK_SCALAR_FIELD) revert InvalidScalarField();

        // CHECKS: Verify nullifier not already spent (read-only check first)
        // This prevents the R00T commitment from being spent elsewhere
        if (nullifierRegistry.isSpent(r00tNullifier)) revert NullifierAlreadySpent();

        // Calculate tokens out
        tokensOut = getAmountOut(r00tAmount, r00tReserve, tokenReserve);
        if (tokensOut < minTokensOut) revert SlippageExceeded();

        // Calculate fees (in R00T)
        uint256 platformFee = (r00tAmount * PLATFORM_FEE_BPS) / FEE_DENOMINATOR;
        uint256 creatorFee = (r00tAmount * CREATOR_FEE_BPS) / FEE_DENOMINATOR;
        uint256 lpFee = (r00tAmount * LP_FEE_BPS) / FEE_DENOMINATOR;
        uint256 r00tAfterFees = r00tAmount - platformFee - creatorFee - lpFee;

        // EFFECTS: Update ALL state BEFORE any external calls (CEI pattern)
        // SECURITY FIX (Vuln 2): Moved all state updates before nullifierRegistry.markSpent()
        r00tReserve += r00tAfterFees;
        tokenReserve -= tokensOut;
        accumulatedPlatformFees += platformFee;
        accumulatedCreatorFees += creatorFee;

        // Distribute LP fees
        // SECURITY FIX (Audit Vuln 2): Only distribute if fee is large enough to avoid rounding to zero
        if (totalLPShares > 0 && lpFee >= MIN_LP_FEE_FOR_DISTRIBUTION) {
            uint256 feeIncrement = (lpFee * FEE_PRECISION) / totalLPShares;
            if (feeIncrement > 0) {
                feePerShare += feeIncrement;
                accumulatedLPFees += lpFee;
            } else {
                accumulatedPlatformFees += lpFee;
            }
        } else {
            accumulatedPlatformFees += lpFee;
        }

        // Create ProjectToken commitment (internal call to our own pool)
        uint256 leafIndex = projectTokenPool.insert(outputCommitment);

        // INTERACTIONS: External call to nullifier registry AFTER all state updates
        // SECURITY FIX (Vuln 2): Moved markSpent() after state updates to follow CEI pattern
        // This prevents cross-contract reentrancy if nullifierRegistry is compromised
        nullifierRegistry.markSpent(r00tNullifier);

        emit NewProjectTokenCommitment(outputCommitment, leafIndex, encryptedNote);
        emit AtomicSwapFromR00T(r00tAmount, tokensOut, outputCommitment);

        return tokensOut;
    }

    // ============ Admin Functions ============

    /// @notice Set the authorized atomic swapper (ZkAMM) - can only be set once
    /// @dev SECURITY FIX (Audit Vuln 3): Only callable by governance, and only once.
    ///      Once set, the atomic swapper cannot be changed to prevent compromised governance
    ///      from redirecting atomic swaps to a malicious contract.
    ///      Must be set for atomic ETH → ProjectToken swaps to work.
    function setAuthorizedAtomicSwapper(address _swapper) external onlyGovernance {
        if (_swapper == address(0)) revert ZeroAddress();
        if (authorizedAtomicSwapper != address(0)) revert AtomicSwapperAlreadySet();  // SECURITY FIX
        authorizedAtomicSwapper = _swapper;
    }

    /// @notice Set swap verifier (can only be set once to prevent malicious downgrades)
    /// @dev SECURITY FIX M-01: Once a verifier is set, it cannot be changed to prevent
    ///      governance compromise from disabling verification
    function setSwapVerifier(address _newVerifier) external onlyGovernance {
        if (_newVerifier == address(0)) revert ZeroAddress();
        if (swapVerifier != address(0)) revert VerifierAlreadySet();  // SECURITY FIX M-01
        address oldVerifier = swapVerifier;
        swapVerifier = _newVerifier;
        emit VerifierUpdated("swap", oldVerifier, _newVerifier);
    }

    /// @notice Set LP withdraw verifier (can only be set once)
    function setLPWithdrawVerifier(address _newVerifier) external onlyGovernance {
        if (_newVerifier == address(0)) revert ZeroAddress();
        if (lpWithdrawVerifier != address(0)) revert VerifierAlreadySet();  // SECURITY FIX M-01
        address oldVerifier = lpWithdrawVerifier;
        lpWithdrawVerifier = _newVerifier;
        emit VerifierUpdated("lpWithdraw", oldVerifier, _newVerifier);
    }

    /// @notice Set withdraw verifier (can only be set once)
    function setWithdrawVerifier(address _newVerifier) external onlyGovernance {
        if (_newVerifier == address(0)) revert ZeroAddress();
        if (withdrawVerifier != address(0)) revert VerifierAlreadySet();  // SECURITY FIX M-01
        address oldVerifier = withdrawVerifier;
        withdrawVerifier = _newVerifier;
        emit VerifierUpdated("withdraw", oldVerifier, _newVerifier);
    }

    /// @notice Set LP fees verifier (can only be set once)
    function setClaimLPFeesVerifier(address _newVerifier) external onlyGovernance {
        if (_newVerifier == address(0)) revert ZeroAddress();
        if (claimLPFeesVerifier != address(0)) revert VerifierAlreadySet();  // SECURITY FIX M-01
        address oldVerifier = claimLPFeesVerifier;
        claimLPFeesVerifier = _newVerifier;
        emit VerifierUpdated("claimLPFees", oldVerifier, _newVerifier);
    }

    /// @notice Get the ERC20 token address
    function getToken() external view returns (address) {
        return address(token);
    }
}
