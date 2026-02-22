// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./TokenPool.sol";
import "./NullifierRegistry.sol";
import {ISwapVerifier, IProjectPoolLPVerifier, IWithdrawVerifier, IClaimLPFeesVerifier} from "./interfaces/IVerifier.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/proxy/utils/Initializable.sol";

/// @title ZkProjectPoolImpl
/// @author r00t.fund
/// @notice Implementation contract for ZkProjectPool clones (EIP-1167 pattern)
/// @dev This is deployed once, then cloned via PoolDeployer for each new project
///      Identical to ZkProjectPool but uses initialize() instead of constructor
contract ZkProjectPoolImpl is ReentrancyGuard, Initializable {
    using SafeERC20 for IERC20;

    // ============ Constants ============
    uint256 public constant FEE_BPS = 30;
    uint256 public constant PLATFORM_FEE_BPS = 10;
    uint256 public constant CREATOR_FEE_BPS = 10;
    uint256 public constant LP_FEE_BPS = 10;
    uint256 public constant FEE_DENOMINATOR = 10000;
    uint256 public constant LP_LOCK_PERIOD = 1 minutes; // TESTNET: Changed from 24 hours for testing
    uint256 public constant FEE_PRECISION = 1e18;
    uint256 public constant MIN_LP_FEE_FOR_DISTRIBUTION = 1e12;
    uint256 public constant MINIMUM_LIQUIDITY = 1000;
    uint256 public constant MIN_LP_DEPOSIT = 1e17; // SECURITY FIX: Match ZkProjectPool value to prevent small deposit attacks
    uint256 public constant SNARK_SCALAR_FIELD = 21888242871839275222246405745257275088548364400416034343698204186575808495617;
    uint256 public constant DEV_VESTING_PERIOD = 180 days;
    uint256 public constant DEV_VESTING_CLIFF = 30 days;
    uint256 public constant EMERGENCY_CLAIM_DELAY = 30 days;

    // ============ Storage Variables ============
    string public name;
    string public symbol;
    uint256 public totalSupply;

    // Pool references (storage instead of immutable for clones)
    TokenPool public projectTokenPool;
    TokenPool public lpPool;
    TokenPool public r00tPool;
    NullifierRegistry public nullifierRegistry;
    IERC20 public token;
    uint256 public maxDevAllocation;
    uint256 public poolCreatedAt;

    // Verifiers
    address public swapVerifier;
    address public lpWithdrawVerifier;
    address public withdrawVerifier;
    address public claimLPFeesVerifier;

    // Pool state
    uint256 public r00tReserve;
    uint256 public tokenReserve;
    uint256 public totalLPShares;
    uint256 public feePerShare;

    // Nullifier tracking
    mapping(uint256 => bool) public nullifiers;
    mapping(uint256 => bool) public r00tNullifiers;
    mapping(uint256 => bool) public lpNullifiers;

    // LP tracking
    mapping(uint256 => uint256) public lpDepositTime;
    mapping(uint256 => uint256) public lastClaimedFeePerShare;
    mapping(uint256 => uint256) public lpCommitmentShares;
    mapping(uint256 => bool) public lpCommitmentWithdrawn;
    mapping(uint256 => mapping(uint256 => bool)) public claimedInBlock;

    // Fee and admin
    address public creator;
    address public platform;
    uint256 public accumulatedPlatformFees;
    uint256 public accumulatedCreatorFees;
    uint256 public accumulatedLPFees;
    address public governance;
    uint256 public proposalId;
    address public authorizedAtomicSwapper;
    uint256 public devAllocationClaimed;

    // Pending claims
    struct PendingR00tClaim {
        uint256 amount;
        uint256 outputCommitment;
        bytes encryptedNote;
        bool claimed;
        uint256 createdAt;
    }
    uint256 public nextClaimId;
    mapping(uint256 => PendingR00tClaim) public pendingR00tClaims;
    uint256 public totalPendingClaims;

    // ============ Events ============
    event NewProjectTokenCommitment(uint256 indexed commitment, uint256 indexed leafIndex, bytes encryptedNote);
    event NewLPCommitment(uint256 indexed commitment, uint256 indexed leafIndex, uint256 lpShares, bytes encryptedNote);
    event NullifierSpent(uint256 indexed nullifierHash);
    event LPNullifierSpent(uint256 indexed nullifierHash);
    event R00tSwappedForToken(uint256 r00tIn, uint256 tokensOut, uint256 platformFee, uint256 creatorFee);
    event TokenSwappedForR00t(uint256 tokensIn, uint256 r00tOut, uint256 platformFee, uint256 creatorFee);
    event LiquidityAdded(uint256 indexed lpCommitment, uint256 r00tAmount, uint256 tokenAmount, uint256 lpShares);
    event LiquidityRemoved(uint256 indexed nullifierHash, uint256 r00tOut, uint256 tokenOut);
    event PublicWithdrawal(uint256 indexed nullifierHash, address indexed recipient, uint256 amount);
    event PublicDeposit(uint256 indexed commitment, address indexed depositor, uint256 amount);
    event DevAllocationClaimed(uint256 indexed commitment, address indexed creator, uint256 amount);
    event R00tClaimRegistered(uint256 indexed claimId, uint256 amount, uint256 outputCommitment);
    event R00tClaimProcessed(uint256 indexed claimId, uint256 amount);
    event AtomicSwapFromR00T(uint256 r00tAmount, uint256 tokensOut, uint256 indexed outputCommitment);
    event R00tCommitmentCreated(uint256 indexed commitment, uint256 indexed leafIndex, bytes encryptedNote);
    event InitialLiquidityBurned(uint256 r00tAmount, uint256 tokenAmount, uint256 burnedShares);
    event PlatformFeesCollected(address indexed to, uint256 amount);
    event CreatorFeesCollected(address indexed to, uint256 amount);
    event LPFeesClaimed(uint256 indexed commitment, address indexed recipient, uint256 amount);
    event VerifierUpdated(string indexed verifierType, address indexed oldVerifier, address indexed newVerifier);

    // ============ Errors ============
    error ZeroAmount();
    error SlippageExceeded();
    error InvalidProof();
    error NullifierAlreadySpent();
    error UnknownMerkleRoot();
    error InsufficientReserve();
    error InsufficientLiquidity();
    error Unauthorized();
    error ZeroAddress();
    error NoFeesToCollect();
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
    error EmergencyDelayNotMet();
    error NeverAuthorizedInR00TPool();
    error VerifierAlreadySet();
    error R00TPoolUnauthorized();
    error InvalidScalarField();
    error AlreadyClaimedInBlock();
    error VestingCliffNotReached();
    error VestingExceedsAllowance();
    error AtomicSwapperAlreadySet(); // SECURITY FIX (Vuln 2): Cannot change atomic swapper once set

    // ============ Modifiers ============
    modifier onlyGovernance() {
        if (msg.sender != governance) revert Unauthorized();
        _;
    }

    modifier notExpired(uint256 deadline) {
        if (block.timestamp > deadline) revert TransactionExpired();
        _;
    }

    modifier requiresSwapVerifier() {
        if (swapVerifier == address(0)) revert NotImplemented();
        _;
    }

    modifier requiresLPVerifier() {
        if (lpWithdrawVerifier == address(0)) revert NotImplemented();
        _;
    }

    modifier onlyAuthorizedAtomicSwapper() {
        if (msg.sender != authorizedAtomicSwapper) revert Unauthorized();
        _;
    }

    // ============ Constructor (disabled for implementation) ============
    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    // ============ Initializer ============
    function initialize(
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
    ) external initializer {
        if (_token == address(0) || _r00tPool == address(0) || _creator == address(0) || _platform == address(0)) revert ZeroAddress();
        if (_nullifierRegistry == address(0)) revert ZeroAddress();
        if (_initialRootReserve == 0) revert ZeroAmount();

        token = IERC20(_token);
        uint256 _totalSupply = token.totalSupply();
        if (_totalSupply == 0) revert ZeroAmount();

        name = _name;
        symbol = _symbol;
        totalSupply = _totalSupply;

        // Create commitment pools
        address poseidonAddr = TokenPool(_r00tPool).poseidon();
        projectTokenPool = new TokenPool(poseidonAddr);
        lpPool = new TokenPool(poseidonAddr);
        r00tPool = TokenPool(_r00tPool);
        nullifierRegistry = NullifierRegistry(_nullifierRegistry);

        // SECURITY FIX (Vuln 15): Separate dev allocation from AMM reserves at initialization
        // Dev tokens are held by the contract but NOT part of the AMM trading curve,
        // preventing LP dilution when dev claims their vested allocation
        maxDevAllocation = (_totalSupply * _maxDevAllocationBps) / 10000;
        tokenReserve = _totalSupply - maxDevAllocation;
        // SECURITY NOTE (Vuln 2): r00tReserve is initialized with the pledged amount from governance.
        // This is a "virtual" reserve - the actual R00T stays in the governance contract.
        // The pool's r00tReserve grows with real R00T as users swap R00T → ProjectToken.
        // Users swapping ProjectToken → R00T receive pending claims (processed by governance),
        // not direct R00T from this pool. This design is intentional for the launchpad model.
        // INVARIANT: r00tReserve >= totalPendingClaims (enforced in swap/withdraw functions)
        r00tReserve = _initialRootReserve;

        // Burn initial LP shares
        uint256 initialLPShares = _sqrt(_initialRootReserve * tokenReserve);
        if (initialLPShares <= MINIMUM_LIQUIDITY) revert InsufficientInitialLiquidity();
        totalLPShares = MINIMUM_LIQUIDITY;

        emit InitialLiquidityBurned(_initialRootReserve, tokenReserve, MINIMUM_LIQUIDITY);

        creator = _creator;
        platform = _platform;
        governance = msg.sender;
        proposalId = _proposalId;
        poolCreatedAt = block.timestamp;
    }

    function _sqrt(uint256 x) internal pure returns (uint256 y) {
        if (x == 0) return 0;
        uint256 z = (x + 1) / 2;
        y = x;
        while (z < y) { y = z; z = (x / z + z) / 2; }
    }

    // ============ AMM Functions ============
    function getAmountOut(uint256 amountIn, uint256 reserveIn, uint256 reserveOut) public pure returns (uint256) {
        uint256 amountInWithFee = amountIn * (FEE_DENOMINATOR - FEE_BPS);
        return (amountInWithFee * reserveOut) / (reserveIn * FEE_DENOMINATOR + amountInWithFee);
    }

    /// @notice Raw AMM output without fee (used internally when fees are applied explicitly)
    function _getAmountOutRaw(uint256 amountIn, uint256 reserveIn, uint256 reserveOut) internal pure returns (uint256) {
        return (amountIn * reserveOut) / (reserveIn + amountIn);
    }

    // ============ Atomic Swap (from ZkAMM) ============
    /// @notice Receive R00T atomically from ZkAMM (no proof required - trusted call)
    /// @dev SECURITY NOTE: This function trusts that the authorizedAtomicSwapper (ZkAMM) has:
    ///      1. Verified a valid ZK proof for the R00T commitment being spent
    ///      2. Marked the nullifier in its local r00tNullifiers mapping
    ///      3. Updated its own ethReserve to reflect the R00T spent
    ///      The r00tAmount parameter is trusted because only ZkAMM can call this function,
    ///      and ZkAMM calculates it from verified ZK proof public inputs.
    ///      SECURITY FIX (Vuln 3): Added additional logging for off-chain monitoring
    function atomicSwapFromR00T(
        uint256 r00tAmount,
        uint256 r00tNullifier,
        uint256 minTokensOut,
        uint256 outputCommitment,
        bytes calldata encryptedNote
    ) external nonReentrant onlyAuthorizedAtomicSwapper returns (uint256 tokensOut) {
        if (r00tAmount == 0) revert ZeroAmount();
        if (outputCommitment == 0) revert ZeroAmount();

        // SECURITY FIX (Vuln 4): Validate outputCommitment is within SNARK scalar field
        // Commitments >= SNARK_SCALAR_FIELD cannot be spent via ZK proofs (aliasing attack)
        if (outputCommitment >= SNARK_SCALAR_FIELD) revert InvalidScalarField();

        // SECURITY FIX (Vuln 3): Validate r00tNullifier is within SNARK scalar field
        // Prevents nullifier aliasing attacks in the registry
        if (r00tNullifier >= SNARK_SCALAR_FIELD) revert InvalidScalarField();

        // CHECKS: Verify nullifier not already spent (read-only check first)
        if (nullifierRegistry.isSpent(r00tNullifier)) revert NullifierAlreadySpent();

        // SECURITY FIX: Use _getAmountOutRaw to avoid double fee (explicit fees applied below)
        uint256 platformFee = (r00tAmount * PLATFORM_FEE_BPS) / FEE_DENOMINATOR;
        uint256 creatorFee = (r00tAmount * CREATOR_FEE_BPS) / FEE_DENOMINATOR;
        uint256 lpFee = (r00tAmount * LP_FEE_BPS) / FEE_DENOMINATOR;
        uint256 r00tAfterFees = r00tAmount - platformFee - creatorFee - lpFee;

        tokensOut = _getAmountOutRaw(r00tAfterFees, r00tReserve, tokenReserve);
        if (tokensOut < minTokensOut) revert SlippageExceeded();

        // EFFECTS: Update all internal state before any external calls
        r00tReserve += r00tAfterFees;
        tokenReserve -= tokensOut;
        accumulatedPlatformFees += platformFee;
        accumulatedCreatorFees += creatorFee;

        if (totalLPShares > 0) {
            feePerShare += (lpFee * FEE_PRECISION) / totalLPShares;
            accumulatedLPFees += lpFee;
        } else {
            accumulatedPlatformFees += lpFee;
        }

        // Insert commitment (internal call to our own contract's pool)
        uint256 leafIndex = projectTokenPool.insert(outputCommitment);

        // INTERACTIONS: External call to nullifier registry AFTER all state updates
        // SECURITY FIX (Audit Vuln 1): Moved markSpent() after state updates to follow CEI pattern
        // This prevents cross-contract reentrancy if nullifierRegistry is compromised
        nullifierRegistry.markSpent(r00tNullifier);

        emit NewProjectTokenCommitment(outputCommitment, leafIndex, encryptedNote);
        emit AtomicSwapFromR00T(r00tAmount, tokensOut, outputCommitment);
    }

    // ============ Swap Functions ============

    /// @notice Swap R00T for project tokens privately
    function swapR00tForToken(
        uint256[8] calldata proof,
        uint256 r00tMerkleRoot,
        uint256 r00tNullifierHash,
        uint256 r00tAmount,
        uint256 minTokensOut,
        uint256 outputCommitment,
        uint256 r00tChangeCommitment,
        uint256 publicInputsBinding,
        uint256 deadline,
        bytes calldata outputNote,
        bytes calldata changeNote
    ) external nonReentrant notExpired(deadline) requiresSwapVerifier {
        // SECURITY FIX: Validate all ZK public inputs are within SNARK scalar field
        if (r00tMerkleRoot >= SNARK_SCALAR_FIELD) revert InvalidScalarField();
        if (r00tNullifierHash >= SNARK_SCALAR_FIELD) revert InvalidScalarField();
        if (outputCommitment >= SNARK_SCALAR_FIELD) revert InvalidScalarField();
        if (r00tChangeCommitment >= SNARK_SCALAR_FIELD) revert InvalidScalarField();
        if (publicInputsBinding >= SNARK_SCALAR_FIELD) revert InvalidScalarField();

        // CHECKS
        if (!r00tPool.isKnownRoot(r00tMerkleRoot)) revert UnknownMerkleRoot();
        if (r00tNullifiers[r00tNullifierHash]) revert NullifierAlreadySpent();
        if (nullifierRegistry.isSpent(r00tNullifierHash)) revert NullifierAlreadySpent();
        if (r00tAmount == 0) revert ZeroAmount();

        // CRITICAL FIX: pubSignals order must match circuit output order (binding first)
        // Circuit outputs: [publicInputsBinding, inputMerkleRoot, inputNullifierHash, inputAmount, outputCommitment, minOutputAmount, changeCommitment]
        uint256[7] memory pubSignals = [publicInputsBinding, r00tMerkleRoot, r00tNullifierHash, r00tAmount, outputCommitment, minTokensOut, r00tChangeCommitment];
        if (!ISwapVerifier(swapVerifier).verifyProof(proof, pubSignals)) revert InvalidProof();

        // SECURITY FIX: Use _getAmountOutRaw to avoid double fee (explicit fees applied below)
        uint256 platformFee = (r00tAmount * PLATFORM_FEE_BPS) / FEE_DENOMINATOR;
        uint256 creatorFee = (r00tAmount * CREATOR_FEE_BPS) / FEE_DENOMINATOR;
        uint256 lpFee = (r00tAmount * LP_FEE_BPS) / FEE_DENOMINATOR;
        uint256 r00tAfterFees = r00tAmount - platformFee - creatorFee - lpFee;

        uint256 tokensOut = _getAmountOutRaw(r00tAfterFees, r00tReserve, tokenReserve);
        if (tokensOut < minTokensOut) revert SlippageExceeded();

        // EFFECTS
        r00tNullifiers[r00tNullifierHash] = true;
        r00tReserve += r00tAfterFees;
        tokenReserve -= tokensOut;
        accumulatedPlatformFees += platformFee;
        accumulatedCreatorFees += creatorFee;

        // Distribute LP fees
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

        // INTERACTIONS
        nullifierRegistry.markSpent(r00tNullifierHash);

        // Insert output commitment
        uint256 leafIndex = projectTokenPool.insert(outputCommitment);
        emit NewProjectTokenCommitment(outputCommitment, leafIndex, outputNote);

        // SECURITY FIX: Insert R00T change commitment so user doesn't lose leftover R00T
        if (r00tChangeCommitment != 0) {
            uint256 changeLeafIndex = r00tPool.insert(r00tChangeCommitment);
            emit R00tCommitmentCreated(r00tChangeCommitment, changeLeafIndex, changeNote);
        }

        emit NullifierSpent(r00tNullifierHash);
        emit R00tSwappedForToken(r00tAmount, tokensOut, platformFee, creatorFee);
    }

    /// @notice Swap project tokens for R00T privately
    function swapTokenForR00t(
        uint256[8] calldata proof,
        uint256 tokenMerkleRoot,
        uint256 tokenNullifierHash,
        uint256 tokenAmount,
        uint256 minR00tOut,
        uint256 outputR00tCommitment,
        uint256 tokenChangeCommitment,
        uint256 publicInputsBinding,
        uint256 deadline,
        bytes calldata outputNote,
        bytes calldata changeNote
    ) external nonReentrant notExpired(deadline) requiresSwapVerifier {
        // SECURITY FIX: Validate all ZK public inputs are within SNARK scalar field
        if (tokenMerkleRoot >= SNARK_SCALAR_FIELD) revert InvalidScalarField();
        if (tokenNullifierHash >= SNARK_SCALAR_FIELD) revert InvalidScalarField();
        if (outputR00tCommitment >= SNARK_SCALAR_FIELD) revert InvalidScalarField();
        if (tokenChangeCommitment >= SNARK_SCALAR_FIELD) revert InvalidScalarField();
        if (publicInputsBinding >= SNARK_SCALAR_FIELD) revert InvalidScalarField();

        // CHECKS
        if (!projectTokenPool.isKnownRoot(tokenMerkleRoot)) revert UnknownMerkleRoot();
        if (nullifiers[tokenNullifierHash]) revert NullifierAlreadySpent();
        if (tokenAmount == 0) revert ZeroAmount();

        // CRITICAL FIX: pubSignals order must match circuit output order (binding first)
        // Circuit outputs: [publicInputsBinding, inputMerkleRoot, inputNullifierHash, inputAmount, outputCommitment, minOutputAmount, changeCommitment]
        uint256[7] memory pubSignals = [publicInputsBinding, tokenMerkleRoot, tokenNullifierHash, tokenAmount, outputR00tCommitment, minR00tOut, tokenChangeCommitment];
        if (!ISwapVerifier(swapVerifier).verifyProof(proof, pubSignals)) revert InvalidProof();

        // SECURITY FIX: Use _getAmountOutRaw to avoid double fee (explicit fees applied below)
        uint256 r00tOut = _getAmountOutRaw(tokenAmount, tokenReserve, r00tReserve);
        if (r00tOut < minR00tOut) revert SlippageExceeded();
        if (r00tOut > r00tReserve) revert InsufficientReserve();

        // Calculate fees
        uint256 platformFee = (r00tOut * PLATFORM_FEE_BPS) / FEE_DENOMINATOR;
        uint256 creatorFee = (r00tOut * CREATOR_FEE_BPS) / FEE_DENOMINATOR;
        uint256 lpFee = (r00tOut * LP_FEE_BPS) / FEE_DENOMINATOR;
        uint256 r00tAfterFees = r00tOut - platformFee - creatorFee - lpFee;

        // SECURITY FIX: Check all obligations (pending claims + all accumulated fees + new claim)
        uint256 newReserve = r00tReserve - r00tOut;
        uint256 totalObligations = totalPendingClaims + r00tAfterFees + accumulatedPlatformFees + platformFee + accumulatedCreatorFees + creatorFee + accumulatedLPFees + lpFee;
        if (newReserve < totalObligations) revert InsufficientR00tReserve();

        // EFFECTS
        nullifiers[tokenNullifierHash] = true;
        tokenReserve += tokenAmount;
        r00tReserve -= r00tOut;
        accumulatedPlatformFees += platformFee;
        accumulatedCreatorFees += creatorFee;

        // Distribute LP fees
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

        // Create pending R00T claim
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
    function addLiquidity(
        uint256[8] calldata r00tProof,
        uint256 r00tMerkleRoot,
        uint256 r00tNullifierHash,
        uint256 r00tAmount,
        uint256 r00tPublicInputsBinding,
        uint256[8] calldata tokenProof,
        uint256 tokenMerkleRoot,
        uint256 tokenNullifierHash,
        uint256 tokenAmount,
        uint256 tokenPublicInputsBinding,
        uint256 lpCommitment,
        uint256 deadline,
        bytes calldata lpNote
    ) external nonReentrant notExpired(deadline) requiresSwapVerifier {
        // SECURITY FIX: Validate all ZK public inputs are within SNARK scalar field
        if (r00tMerkleRoot >= SNARK_SCALAR_FIELD) revert InvalidScalarField();
        if (r00tNullifierHash >= SNARK_SCALAR_FIELD) revert InvalidScalarField();
        if (r00tPublicInputsBinding >= SNARK_SCALAR_FIELD) revert InvalidScalarField();
        if (tokenMerkleRoot >= SNARK_SCALAR_FIELD) revert InvalidScalarField();
        if (tokenNullifierHash >= SNARK_SCALAR_FIELD) revert InvalidScalarField();
        if (tokenPublicInputsBinding >= SNARK_SCALAR_FIELD) revert InvalidScalarField();
        if (lpCommitment >= SNARK_SCALAR_FIELD) revert InvalidScalarField();

        // CHECKS
        if (r00tAmount == 0 || tokenAmount == 0) revert ZeroAmount();
        if (r00tAmount < MIN_LP_DEPOSIT || tokenAmount < MIN_LP_DEPOSIT) revert InsufficientLiquidity();
        if (r00tReserve == 0 || tokenReserve == 0) revert InsufficientReserve();

        // Verify R00T commitment
        if (!r00tPool.isKnownRoot(r00tMerkleRoot)) revert UnknownMerkleRoot();
        if (nullifierRegistry.isSpent(r00tNullifierHash)) revert NullifierAlreadySpent();

        // Verify Token commitment
        if (!projectTokenPool.isKnownRoot(tokenMerkleRoot)) revert UnknownMerkleRoot();
        if (nullifiers[tokenNullifierHash]) revert NullifierAlreadySpent();

        // Verify amounts are proportional (within 0.5% tolerance)
        uint256 lhs = tokenAmount * r00tReserve;
        uint256 rhs = r00tAmount * tokenReserve;
        if (lhs * 200 < rhs * 199 || lhs * 200 > rhs * 201) {
            revert ImbalancedLiquidity();
        }

        // CRITICAL FIX: pubSignals order must match circuit output order (binding first)
        // Circuit outputs: [publicInputsBinding, inputMerkleRoot, inputNullifierHash, inputAmount, outputCommitment, minOutputAmount, changeCommitment]
        uint256[7] memory r00tPubSignals = [r00tPublicInputsBinding, r00tMerkleRoot, r00tNullifierHash, r00tAmount, lpCommitment, 0, 0];
        if (!ISwapVerifier(swapVerifier).verifyProof(r00tProof, r00tPubSignals)) revert InvalidProof();

        uint256[7] memory tokenPubSignals = [tokenPublicInputsBinding, tokenMerkleRoot, tokenNullifierHash, tokenAmount, lpCommitment, 0, 0];
        if (!ISwapVerifier(swapVerifier).verifyProof(tokenProof, tokenPubSignals)) revert InvalidProof();

        // Calculate LP shares
        if (totalLPShares == 0) revert InvalidLPShares();
        uint256 lpShares = (r00tAmount * totalLPShares) / r00tReserve;
        if (lpShares == 0) revert InvalidLPShares();

        // SECURITY FIX: Stricter rounding check
        uint256 expectedProduct = r00tAmount * totalLPShares;
        uint256 actualProduct = lpShares * r00tReserve;
        require(actualProduct * 10000 >= expectedProduct * 9995, "Rounding loss too high");

        // Check for LP commitment collision
        if (lpDepositTime[lpCommitment] != 0 && !lpCommitmentWithdrawn[lpCommitment]) {
            revert InvalidLPShares();
        }

        // EFFECTS
        nullifiers[tokenNullifierHash] = true;
        // SECURITY FIX: Mark R00T nullifier locally (consistent with swapR00tForToken)
        r00tNullifiers[r00tNullifierHash] = true;
        r00tReserve += r00tAmount;
        tokenReserve += tokenAmount;
        totalLPShares += lpShares;
        lpDepositTime[lpCommitment] = block.timestamp;
        lastClaimedFeePerShare[lpCommitment] = feePerShare;
        lpCommitmentShares[lpCommitment] = lpShares;
        if (lpCommitmentWithdrawn[lpCommitment]) {
            lpCommitmentWithdrawn[lpCommitment] = false;
        }

        // INTERACTIONS
        nullifierRegistry.markSpent(r00tNullifierHash);
        uint256 leafIndex = lpPool.insert(lpCommitment);

        emit NewLPCommitment(lpCommitment, leafIndex, lpShares, lpNote);
        emit LiquidityAdded(lpCommitment, r00tAmount, tokenAmount, lpShares);
    }

    /// @notice Remove liquidity from the pool (returns both R00T + Token)
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
        uint256 publicInputsBinding,
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
        if (publicInputsBinding >= SNARK_SCALAR_FIELD) revert InvalidScalarField();

        // CHECKS
        if (!lpPool.isKnownRoot(lpMerkleRoot)) revert UnknownMerkleRoot();
        if (lpNullifiers[nullifierHash]) revert NullifierAlreadySpent();
        if (lpShares == 0) revert ZeroAmount();
        if (block.timestamp < lpDepositTime[commitment] + LP_LOCK_PERIOD) revert LPLocked();
        if (lpCommitmentShares[commitment] != lpShares) revert InvalidLPShares();

        // CRITICAL FIX: pubSignals order must match circuit output order (binding first)
        // Circuit outputs: [publicInputsBinding, lpMerkleRoot, nullifierHash, commitment, lpShares, r00tOutputCommitment, tokenOutputCommitment, minR00tOut]
        uint256[8] memory pubSignals = [publicInputsBinding, lpMerkleRoot, nullifierHash, commitment, lpShares, r00tOutputCommitment, tokenOutputCommitment, minR00tOut];
        if (!IProjectPoolLPVerifier(lpWithdrawVerifier).verifyProof(proof, pubSignals)) revert InvalidProof();

        // Calculate proportional amounts
        uint256 r00tOut = (lpShares * r00tReserve) / totalLPShares;
        uint256 tokenOut = (lpShares * tokenReserve) / totalLPShares;
        if (r00tOut < minR00tOut) revert SlippageExceeded();
        if (tokenOut < minTokenOut) revert SlippageExceeded();

        // SECURITY FIX: Ensure reserves don't go below pending claims
        if (r00tReserve < totalPendingClaims + r00tOut) revert InsufficientR00tReserve();
        // SECURITY FIX: Ensure minimum liquidity remains after removal
        if (r00tReserve - r00tOut < MINIMUM_LIQUIDITY || tokenReserve - tokenOut < MINIMUM_LIQUIDITY) revert InsufficientLiquidity();

        // EFFECTS
        lpNullifiers[nullifierHash] = true;
        lpCommitmentShares[commitment] = 0;
        lpCommitmentWithdrawn[commitment] = true;
        r00tReserve -= r00tOut;
        tokenReserve -= tokenOut;
        totalLPShares -= lpShares;

        // Insert token commitment
        uint256 tokenLeafIndex = projectTokenPool.insert(tokenOutputCommitment);
        emit NewProjectTokenCommitment(tokenOutputCommitment, tokenLeafIndex, tokenNote);

        // Create pending R00T claim
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

    // ============ Public Withdrawal ============
    function withdrawPublic(
        uint256[8] calldata proof,
        uint256 merkleRoot,
        uint256 nullifierHash,
        uint256 amount,
        address recipient,
        uint256 recipientBinding
    ) external nonReentrant {
        if (merkleRoot >= SNARK_SCALAR_FIELD) revert InvalidScalarField();
        if (nullifierHash >= SNARK_SCALAR_FIELD) revert InvalidScalarField();
        if (recipientBinding >= SNARK_SCALAR_FIELD) revert InvalidScalarField();
        if (!projectTokenPool.isKnownRoot(merkleRoot)) revert UnknownMerkleRoot();
        if (nullifiers[nullifierHash]) revert NullifierAlreadySpent();
        if (recipient == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        if (token.balanceOf(address(this)) < amount) revert InsufficientReserve();
        if (withdrawVerifier == address(0)) revert NotImplemented();

        // CRITICAL FIX: pubSignals order must match circuit output order
        // Circuit outputs: [recipientBinding, merkleRoot, nullifierHash, amount, recipient]
        uint256[5] memory pubSignals = [recipientBinding, merkleRoot, nullifierHash, amount, uint256(uint160(recipient))];
        if (!IWithdrawVerifier(withdrawVerifier).verifyProof(proof, pubSignals)) revert InvalidProof();

        nullifiers[nullifierHash] = true;
        token.safeTransfer(recipient, amount);

        emit NullifierSpent(nullifierHash);
        emit PublicWithdrawal(nullifierHash, recipient, amount);
    }

    // ============ Public Deposit ============
    function depositPublic(
        uint256 amount,
        uint256 commitment,
        bytes32 depositorBinding,
        bytes calldata encryptedNote
    ) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        if (commitment == 0) revert ZeroAmount();

        // SECURITY FIX (Vuln 5): Validate commitment is within SNARK scalar field
        // Commitments >= SNARK_SCALAR_FIELD cannot be spent via ZK proofs
        // This prevents users from accidentally locking their tokens forever
        if (commitment >= SNARK_SCALAR_FIELD) revert InvalidScalarField();

        bytes32 expectedBinding = keccak256(abi.encodePacked(commitment, msg.sender, amount));
        if (depositorBinding != expectedBinding) revert InvalidProof();

        token.safeTransferFrom(msg.sender, address(this), amount);
        uint256 leafIndex = projectTokenPool.insert(commitment);

        emit NewProjectTokenCommitment(commitment, leafIndex, encryptedNote);
        emit PublicDeposit(commitment, msg.sender, amount);
    }

    // ============ Dev Allocation ============
    function claimDevAllocation(uint256 commitment, uint256 amount, bytes calldata encryptedNote) external nonReentrant {
        if (msg.sender != creator) revert Unauthorized();
        if (amount == 0 || commitment == 0) revert ZeroAmount();

        // SECURITY FIX (Vuln 6): Validate commitment is within SNARK scalar field
        // Commitments >= SNARK_SCALAR_FIELD cannot be spent via ZK proofs
        // This prevents the creator from accidentally locking their vested tokens
        if (commitment >= SNARK_SCALAR_FIELD) revert InvalidScalarField();

        if (block.timestamp < poolCreatedAt + DEV_VESTING_CLIFF) revert VestingCliffNotReached();

        uint256 timeSinceCreation = block.timestamp - poolCreatedAt;
        uint256 vestedAmount = timeSinceCreation >= DEV_VESTING_PERIOD
            ? maxDevAllocation
            : (maxDevAllocation * timeSinceCreation) / DEV_VESTING_PERIOD;

        uint256 claimableNow = vestedAmount > devAllocationClaimed ? vestedAmount - devAllocationClaimed : 0;
        if (amount > claimableNow) revert VestingExceedsAllowance();
        if (devAllocationClaimed + amount > maxDevAllocation) revert DevAllocationExceeded();
        // SECURITY FIX (Vuln 15): Dev allocation is separate from AMM reserves (tokenReserve).
        // Check actual token balance minus AMM reserve to ensure dev tokens are available.
        uint256 availableForDev = token.balanceOf(address(this)) > tokenReserve
            ? token.balanceOf(address(this)) - tokenReserve
            : 0;
        if (amount > availableForDev) revert InsufficientReserve();

        devAllocationClaimed += amount;
        uint256 leafIndex = projectTokenPool.insert(commitment);

        emit NewProjectTokenCommitment(commitment, leafIndex, encryptedNote);
        emit DevAllocationClaimed(commitment, creator, amount);
    }

    function getVestedDevAllocation() external view returns (uint256 vestedAmount, uint256 claimableNow) {
        if (block.timestamp < poolCreatedAt + DEV_VESTING_CLIFF) return (0, 0);
        uint256 timeSinceCreation = block.timestamp - poolCreatedAt;
        vestedAmount = timeSinceCreation >= DEV_VESTING_PERIOD ? maxDevAllocation : (maxDevAllocation * timeSinceCreation) / DEV_VESTING_PERIOD;
        claimableNow = vestedAmount > devAllocationClaimed ? vestedAmount - devAllocationClaimed : 0;
    }

    // ============ View Functions ============
    function getTokenPrice() external view returns (uint256) { return getAmountOut(1e18, r00tReserve, tokenReserve); }
    function getR00tPrice() external view returns (uint256) { return getAmountOut(1e18, tokenReserve, r00tReserve); }
    function getReserves() external view returns (uint256, uint256) { return (r00tReserve, tokenReserve); }
    function getProjectTokenPool() external view returns (address) { return address(projectTokenPool); }
    function getLPPool() external view returns (address) { return address(lpPool); }
    function getToken() external view returns (address) { return address(token); }
    function getLPInfo() external view returns (uint256, uint256, uint256) { return (totalLPShares, feePerShare, accumulatedLPFees); }

    function getLPCommitmentInfo(uint256 commitment) external view returns (uint256, uint256, uint256, bool) {
        return (lpCommitmentShares[commitment], lpDepositTime[commitment], lastClaimedFeePerShare[commitment], lpCommitmentWithdrawn[commitment]);
    }

    function getCirculatingSupply() external view returns (uint256) { return totalSupply - tokenReserve; }
    function getPrivateHoldings() external view returns (uint256) {
        uint256 b = token.balanceOf(address(this));
        return b > tokenReserve ? b - tokenReserve : 0;
    }
    function getPublicWithdrawn() external view returns (uint256) { return totalSupply - token.balanceOf(address(this)); }

    function getSupplyBreakdown() external view returns (uint256 inReserve, uint256 privateCommitments, uint256 publicCirculating) {
        inReserve = tokenReserve;
        uint256 b = token.balanceOf(address(this));
        privateCommitments = b > tokenReserve ? b - tokenReserve : 0;
        publicCirculating = totalSupply - b;
    }

    function getPendingClaim(uint256 claimId) external view returns (uint256, uint256, bool, uint256) {
        PendingR00tClaim storage c = pendingR00tClaims[claimId];
        return (c.amount, c.outputCommitment, c.claimed, c.createdAt);
    }

    function getPendingClaimsInfo() external view returns (uint256, uint256) { return (nextClaimId, totalPendingClaims); }

    // ============ Fee Collection Functions ============

    /// @notice Collect accumulated platform fees as a pending R00T claim
    function collectPlatformFees(
        uint256 outputCommitment,
        bytes calldata encryptedNote
    ) external nonReentrant returns (uint256 claimId) {
        if (msg.sender != platform) revert Unauthorized();
        if (outputCommitment == 0) revert ZeroAmount();
        // SECURITY FIX (Vuln 14): Validate commitment is within SNARK scalar field
        if (outputCommitment >= SNARK_SCALAR_FIELD) revert InvalidScalarField();
        uint256 amount = accumulatedPlatformFees;
        if (amount == 0) revert NoFeesToCollect();

        // SECURITY FIX: Ensure we have enough R00T reserve to back this claim
        if (totalPendingClaims >= r00tReserve || amount > r00tReserve - totalPendingClaims) {
            revert InsufficientR00tReserve();
        }

        accumulatedPlatformFees = 0;
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
    function collectCreatorFees(
        uint256 outputCommitment,
        bytes calldata encryptedNote
    ) external nonReentrant returns (uint256 claimId) {
        if (msg.sender != creator) revert Unauthorized();
        if (outputCommitment == 0) revert ZeroAmount();
        // SECURITY FIX (Vuln 14): Validate commitment is within SNARK scalar field
        if (outputCommitment >= SNARK_SCALAR_FIELD) revert InvalidScalarField();
        uint256 amount = accumulatedCreatorFees;
        if (amount == 0) revert NoFeesToCollect();

        // SECURITY FIX: Ensure we have enough R00T reserve to back this claim
        if (totalPendingClaims >= r00tReserve || amount > r00tReserve - totalPendingClaims) {
            revert InsufficientR00tReserve();
        }

        accumulatedCreatorFees = 0;
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
        if (claimLPFeesVerifier == address(0)) revert NotImplemented();
        if (!lpPool.isKnownRoot(lpMerkleRoot)) revert UnknownMerkleRoot();

        // SECURITY FIX (Vuln 2): Align signal ordering with circuit output order
        // Circuit outputs: [publicInputsBinding, lpMerkleRoot, claimNullifier, feeEpoch, lpShares, caller]
        // Use deterministic claimNullifier derived from commitment + feePerShare to prevent replay
        uint256 claimNullifier = uint256(keccak256(abi.encodePacked(commitment, feePerShare))) % SNARK_SCALAR_FIELD;
        if (lpNullifiers[claimNullifier]) revert NullifierAlreadySpent();

        uint256 publicInputsBinding = uint256(keccak256(abi.encodePacked(
            lpMerkleRoot, claimNullifier, feePerShare, lpShares, msg.sender
        ))) % SNARK_SCALAR_FIELD;

        uint256[6] memory pubSignals = [
            publicInputsBinding, lpMerkleRoot, claimNullifier, feePerShare, lpShares,
            uint256(uint160(msg.sender))
        ];
        if (!IClaimLPFeesVerifier(claimLPFeesVerifier).verifyProof(proof, pubSignals)) revert InvalidProof();

        // SECURITY FIX: Prevent claims from withdrawn commitments
        if (lpCommitmentWithdrawn[commitment]) revert LPAlreadyWithdrawn();

        // SECURITY FIX: Prevent same-block double claims
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
        if (totalPendingClaims >= r00tReserve || claimable > r00tReserve - totalPendingClaims) {
            revert InsufficientR00tReserve();
        }

        // Update state
        claimedInBlock[commitment][block.number] = true;
        lastClaimedFeePerShare[commitment] = feePerShare;
        accumulatedLPFees -= claimable;

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
    function processR00tClaim(uint256 claimId) external nonReentrant onlyGovernance {
        if (!r00tPool.authorizedCallers(address(this))) revert R00TPoolUnauthorized();

        PendingR00tClaim storage claim = pendingR00tClaims[claimId];
        if (claim.amount == 0) revert InvalidClaimId();
        if (claim.claimed) revert ClaimAlreadyProcessed();

        claim.claimed = true;
        totalPendingClaims -= claim.amount;

        uint256 leafIndex = r00tPool.insert(claim.outputCommitment);

        emit R00tCommitmentCreated(claim.outputCommitment, leafIndex, claim.encryptedNote);
        emit R00tClaimProcessed(claimId, claim.amount);
    }

    /// @notice Emergency process a pending R00T claim after delay (called by anyone)
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

        // Try normal insert first, fall back to emergency insert
        uint256 leafIndex;
        if (r00tPool.authorizedCallers(address(this))) {
            leafIndex = r00tPool.insert(claim.outputCommitment);
        } else {
            // SECURITY FIX: Check wasEverAuthorized before emergency insert (matches ZkProjectPool)
            if (!r00tPool.wasEverAuthorized(address(this))) revert NeverAuthorizedInR00TPool();
            leafIndex = r00tPool.emergencyInsert(claim.outputCommitment);
        }

        emit R00tCommitmentCreated(claim.outputCommitment, leafIndex, claim.encryptedNote);
        emit R00tClaimProcessed(claimId, claim.amount);
    }

    // ============ Admin Functions ============
    /// @notice Set the authorized atomic swapper (ZkAMM) - can only be set once
    /// @dev SECURITY FIX (Vuln 2): Only callable by governance, and only once.
    ///      Once set, the atomic swapper cannot be changed to prevent compromised governance
    ///      from redirecting atomic swaps to a malicious contract.
    function setAuthorizedAtomicSwapper(address _swapper) external onlyGovernance {
        if (_swapper == address(0)) revert ZeroAddress();
        if (authorizedAtomicSwapper != address(0)) revert AtomicSwapperAlreadySet(); // SECURITY FIX
        authorizedAtomicSwapper = _swapper;
    }

    function setSwapVerifier(address _v) external onlyGovernance {
        if (_v == address(0)) revert ZeroAddress();
        if (swapVerifier != address(0)) revert VerifierAlreadySet();
        swapVerifier = _v;
        emit VerifierUpdated("swap", address(0), _v);
    }

    function setLPWithdrawVerifier(address _v) external onlyGovernance {
        if (_v == address(0)) revert ZeroAddress();
        if (lpWithdrawVerifier != address(0)) revert VerifierAlreadySet();
        lpWithdrawVerifier = _v;
        emit VerifierUpdated("lpWithdraw", address(0), _v);
    }

    function setWithdrawVerifier(address _v) external onlyGovernance {
        if (_v == address(0)) revert ZeroAddress();
        if (withdrawVerifier != address(0)) revert VerifierAlreadySet();
        withdrawVerifier = _v;
        emit VerifierUpdated("withdraw", address(0), _v);
    }

    function setClaimLPFeesVerifier(address _v) external onlyGovernance {
        if (_v == address(0)) revert ZeroAddress();
        if (claimLPFeesVerifier != address(0)) revert VerifierAlreadySet();
        claimLPFeesVerifier = _v;
        emit VerifierUpdated("claimLPFees", address(0), _v);
    }
}
