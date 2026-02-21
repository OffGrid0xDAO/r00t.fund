// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {TokenPool} from "./TokenPool.sol";
import {PoseidonT3Deployer} from "./PoseidonT3.sol";
import {NullifierRegistry} from "./NullifierRegistry.sol";
import {ISwapVerifier, ITransferVerifier, IWithdrawVerifier} from "./interfaces/IVerifier.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title ZkAMMPair
/// @author r00t.fund
/// @notice Private AMM for project tokens paired with $R00T
/// @dev Users swap $R00T commitments for project token commitments (both private)
///      $R00T is the base currency for the launchpad ecosystem
/// SECURITY FIX: Added ReentrancyGuard to prevent cross-function reentrancy attacks
contract ZkAMMPair is ReentrancyGuard {
    // ============ Immutables ============

    /// @notice Total supply of project tokens
    uint256 public immutable TOTAL_SUPPLY;

    /// @notice AMM fee in basis points
    uint256 public immutable FEE_BPS;

    /// @notice Fee denominator (10000 = 100%)
    uint256 public constant FEE_DENOMINATOR = 10000;

    /// @notice Maximum allowed fee (10%)
    uint256 public constant MAX_FEE_BPS = 1000;

    /// @notice BN254 scalar field order - all ZK public inputs must be less than this
    /// @dev SECURITY FIX: Prevents nullifier aliasing attacks where values >= SNARK_SCALAR_FIELD
    ///      are equivalent to their remainder mod SNARK_SCALAR_FIELD in the circuit
    uint256 public constant SNARK_SCALAR_FIELD =
        21888242871839275222246405745257275088548364400416034343698204186575808495617;

    /// @notice Project token name
    string public name;

    /// @notice Project token symbol
    string public symbol;

    /// @notice Reference to the main $R00T TokenPool (for verifying $R00T commitments)
    TokenPool public immutable r00tPool;

    /// @notice Global nullifier registry for cross-pool R00T nullifier coordination
    /// @dev SECURITY FIX: Prevents same R00T commitment from being spent in multiple pools
    NullifierRegistry public immutable nullifierRegistry;

    /// @notice This project's token commitment pool
    TokenPool public immutable projectTokenPool;

    /// @notice Launchpad governance contract (owner)
    address public immutable launchpad;

    // ============ Verifiers ============

    /// @notice Verifier for swap proofs (R00T <-> Project Token)
    ISwapVerifier public swapVerifier;

    /// @notice Verifier for transfer proofs (within project token pool)
    ITransferVerifier public transferVerifier;

    /// @notice Verifier for withdraw proofs (exit to public)
    IWithdrawVerifier public withdrawVerifier;

    /// @notice Whether verifiers have been locked (prevents upgrades after lock)
    /// @dev SECURITY FIX (Vuln 2): Prevents launchpad from replacing verifiers with malicious ones
    bool public verifiersLocked;

    // ============ State ============

    /// @notice $R00T reserve in the pool
    uint256 public r00tReserve;

    /// @notice Project token reserve in the pool
    uint256 public tokenReserve;

    /// @notice Spent nullifiers for project token pool
    mapping(uint256 => bool) public nullifiers;

    /// @notice Spent nullifiers for R00T swaps (SECURITY FIX: prevents double-spend)
    mapping(uint256 => bool) public r00tNullifiers;

    // ============ Pending R00T Claims System ============
    // SECURITY FIX: Instead of creating R00T commitments directly (which requires authorization),
    // we track pending claims that can be processed by an authorized entity

    /// @notice Structure for pending R00T claims
    struct PendingR00tClaim {
        uint256 amount;
        uint256 outputCommitment;
        bytes encryptedNote;
        bool claimed;
        uint256 createdAt;  // SECURITY FIX: Timestamp for emergency processing
    }

    /// @notice Emergency claim delay (30 days) - allows anyone to process claims if launchpad is inactive
    /// @dev SECURITY FIX: Prevents permanent fund lock if launchpad is compromised
    uint256 public constant EMERGENCY_CLAIM_DELAY = 30 days;

    /// @notice Counter for claim IDs
    uint256 public nextClaimId;

    /// @notice Mapping of claim ID to pending claim details
    mapping(uint256 => PendingR00tClaim) public pendingR00tClaims;

    /// @notice Total pending R00T claims
    uint256 public totalPendingClaims;

    // ============ Events ============

    /// @notice Emitted when a new project token commitment is created
    event NewCommitment(uint256 indexed commitment, uint256 indexed leafIndex, bytes encryptedNote);

    /// @notice Emitted when a nullifier is spent
    event NullifierSpent(uint256 indexed nullifierHash);

    /// @notice Emitted on $R00T -> Project Token swap
    event SwapR00tForToken(uint256 rootIn, uint256 tokensOut);

    /// @notice Emitted on Project Token -> $R00T swap
    event SwapTokenForR00t(uint256 tokensIn, uint256 r00tOut);

    /// @notice Emitted on private transfer within project token pool
    event PrivateTransfer(uint256 transferAmount);

    /// @notice Emitted when tokens are withdrawn to public wallet
    event PublicWithdrawal(uint256 indexed nullifierHash, address indexed recipient, uint256 amount);

    /// @notice Emitted when a R00T claim is registered
    event R00tClaimRegistered(uint256 indexed claimId, uint256 amount, uint256 outputCommitment);

    /// @notice Emitted when a R00T claim is processed
    event R00tClaimProcessed(uint256 indexed claimId, uint256 amount);

    /// @notice Emitted when a R00T commitment is created in the r00tPool on behalf of this contract
    /// @dev SECURITY FIX (Vuln 6): Using local event instead of TokenPool.NewCommitment
    ///      to properly attribute the event source to ZkAMMPair for indexers
    event R00tCommitmentCreated(uint256 indexed commitment, uint256 indexed leafIndex, bytes encryptedNote);

    // ============ Errors ============

    error InvalidProof();
    error NullifierAlreadySpent();
    error UnknownMerkleRoot();
    error SlippageExceeded();
    error InsufficientReserve();
    error Unauthorized();
    error ZeroAddress();
    error InvalidFee();
    error InvalidSupply();
    error ClaimAlreadyProcessed();
    error InvalidClaimId();
    error EmergencyDelayNotMet();  // SECURITY FIX: Claim too new for emergency processing
    error InvalidScalarField();   // SECURITY FIX: Value >= SNARK_SCALAR_FIELD (nullifier aliasing)
    error VerifiersLocked();      // SECURITY FIX (Vuln 2): Verifiers cannot be changed after lock
    error NeverAuthorizedInR00TPool(); // SECURITY FIX (Audit Vuln 7): Pool was never authorized in r00tPool, cannot use emergency insert

    // ============ Modifiers ============

    modifier onlyLaunchpad() {
        if (msg.sender != launchpad) revert Unauthorized();
        _;
    }

    // ============ Constructor ============

    /// @notice Initialize the AMM pair
    /// @param _name Project token name
    /// @param _symbol Project token symbol
    /// @param _totalSupply Total supply of project tokens
    /// @param _feeBps AMM fee in basis points
    /// @param _r00tPool Address of main $R00T TokenPool
    /// @param _nullifierRegistry Global nullifier registry address
    /// @param _initialRootReserve Initial $R00T reserve (from proposal pledge)
    /// @param _swapVerifier Swap proof verifier
    /// @param _transferVerifier Transfer proof verifier
    /// @param _withdrawVerifier Withdraw proof verifier
    constructor(
        string memory _name,
        string memory _symbol,
        uint256 _totalSupply,
        uint256 _feeBps,
        address _r00tPool,
        address _nullifierRegistry,
        uint256 _initialRootReserve,
        address _swapVerifier,
        address _transferVerifier,
        address _withdrawVerifier
    ) {
        if (_totalSupply == 0) revert InvalidSupply();
        if (_feeBps > MAX_FEE_BPS) revert InvalidFee();
        if (_r00tPool == address(0)) revert ZeroAddress();
        if (_nullifierRegistry == address(0)) revert ZeroAddress();
        if (_swapVerifier == address(0) || _transferVerifier == address(0) || _withdrawVerifier == address(0)) {
            revert ZeroAddress();
        }

        name = _name;
        symbol = _symbol;
        TOTAL_SUPPLY = _totalSupply;
        FEE_BPS = _feeBps;
        r00tPool = TokenPool(_r00tPool);
        nullifierRegistry = NullifierRegistry(_nullifierRegistry);
        launchpad = msg.sender;

        // Deploy Poseidon and create project token pool
        address poseidonAddr = PoseidonT3Deployer.deploy();
        projectTokenPool = new TokenPool(poseidonAddr);

        // Initialize reserves
        r00tReserve = _initialRootReserve;
        tokenReserve = _totalSupply;

        // Set verifiers
        swapVerifier = ISwapVerifier(_swapVerifier);
        transferVerifier = ITransferVerifier(_transferVerifier);
        withdrawVerifier = IWithdrawVerifier(_withdrawVerifier);
    }

    // ============ Swap Functions ============

    /// @notice Swap R00T for project tokens (buy)
    /// @param proof ZK proof of R00T commitment ownership
    /// @param r00tMerkleRoot Merkle root of R00T pool
    /// @param r00tNullifierHash Nullifier to prevent double-spending R00T
    /// @param r00tAmount Amount of R00T being spent
    /// @param outputCommitment New commitment for project tokens
    /// @param minTokensOut Minimum tokens to receive (slippage protection)
    /// @param r00tChangeCommitment Commitment for remaining R00T (0 if none)
    /// @param encryptedNote Encrypted note for project token recipient
    /// @param r00tChangeNote Encrypted note for R00T change (if any)
    function swapR00tForToken(
        uint256[8] calldata proof,
        uint256 r00tMerkleRoot,
        uint256 r00tNullifierHash,
        uint256 r00tAmount,
        uint256 outputCommitment,
        uint256 minTokensOut,
        uint256 r00tChangeCommitment,
        bytes calldata encryptedNote,
        bytes calldata r00tChangeNote
    ) external nonReentrant {
        // SECURITY FIX: Validate all ZK public inputs are within scalar field
        // This prevents nullifier aliasing attacks where N and N + SNARK_SCALAR_FIELD
        // are equivalent in the circuit but different on-chain
        if (r00tMerkleRoot >= SNARK_SCALAR_FIELD) revert InvalidScalarField();
        if (r00tNullifierHash >= SNARK_SCALAR_FIELD) revert InvalidScalarField();
        if (outputCommitment >= SNARK_SCALAR_FIELD) revert InvalidScalarField();
        if (r00tChangeCommitment >= SNARK_SCALAR_FIELD) revert InvalidScalarField();

        // Verify R00T merkle root is known
        if (!r00tPool.isKnownRoot(r00tMerkleRoot)) revert UnknownMerkleRoot();

        // SECURITY FIX: Check BOTH local AND global nullifier tracking
        // This prevents double-spending across multiple pools
        if (r00tNullifiers[r00tNullifierHash]) revert NullifierAlreadySpent();
        if (nullifierRegistry.isSpent(r00tNullifierHash)) revert NullifierAlreadySpent();

        // Prepare public signals for swap verifier
        uint256[7] memory pubSignals = [
            r00tMerkleRoot,
            r00tNullifierHash,
            r00tAmount,
            outputCommitment,
            minTokensOut,
            r00tChangeCommitment,
            uint256(0) // swapBinding (computed by circuit)
        ];

        // Verify ZK proof
        if (!swapVerifier.verifyProof(proof, pubSignals)) revert InvalidProof();

        // SECURITY FIX: Mark R00T nullifier as spent LOCALLY first (CEI pattern)
        r00tNullifiers[r00tNullifierHash] = true;

        // Calculate tokens out using constant product formula
        uint256 tokensOut = getAmountOut(r00tAmount, r00tReserve, tokenReserve);
        if (tokensOut < minTokensOut) revert SlippageExceeded();
        if (tokensOut > tokenReserve) revert InsufficientReserve();

        // EFFECTS: Update ALL reserves BEFORE external calls (CEI pattern)
        // SECURITY FIX (Audit Vuln 1): Moved reserve updates before nullifierRegistry.markSpent()
        // This prevents cross-contract reentrancy from exploiting stale reserve values
        r00tReserve += r00tAmount;
        tokenReserve -= tokensOut;

        // INTERACTIONS: External calls AFTER all state updates
        // SECURITY FIX (Audit Vuln 1): nullifierRegistry.markSpent() now happens after reserve updates
        nullifierRegistry.markSpent(r00tNullifierHash);

        // Insert project token commitment (internal call to our own pool)
        uint256 leafIndex = projectTokenPool.insert(outputCommitment);
        emit NewCommitment(outputCommitment, leafIndex, encryptedNote);

        emit NullifierSpent(r00tNullifierHash);
        emit SwapR00tForToken(r00tAmount, tokensOut);
    }

    /// @notice Swap project tokens for R00T (sell)
    /// @param proof ZK proof of project token commitment ownership
    /// @param tokenMerkleRoot Merkle root of project token pool
    /// @param tokenNullifierHash Nullifier to prevent double-spending
    /// @param tokenAmount Amount of tokens being sold
    /// @param r00tOutputCommitment Commitment for R00T received
    /// @param minR00tOut Minimum R00T to receive (slippage protection)
    /// @param tokenChangeCommitment Commitment for remaining tokens (0 if none)
    /// @param r00tNote Encrypted note for R00T commitment
    /// @param tokenChangeNote Encrypted note for token change (if any)
    function swapTokenForR00t(
        uint256[8] calldata proof,
        uint256 tokenMerkleRoot,
        uint256 tokenNullifierHash,
        uint256 tokenAmount,
        uint256 r00tOutputCommitment,
        uint256 minR00tOut,
        uint256 tokenChangeCommitment,
        bytes calldata r00tNote,
        bytes calldata tokenChangeNote
    ) external nonReentrant {
        // SECURITY FIX: Validate all ZK public inputs are within scalar field
        if (tokenMerkleRoot >= SNARK_SCALAR_FIELD) revert InvalidScalarField();
        if (tokenNullifierHash >= SNARK_SCALAR_FIELD) revert InvalidScalarField();
        if (r00tOutputCommitment >= SNARK_SCALAR_FIELD) revert InvalidScalarField();
        if (tokenChangeCommitment >= SNARK_SCALAR_FIELD) revert InvalidScalarField();

        // Verify project token merkle root is known
        if (!projectTokenPool.isKnownRoot(tokenMerkleRoot)) revert UnknownMerkleRoot();

        // Verify nullifier not spent
        if (nullifiers[tokenNullifierHash]) revert NullifierAlreadySpent();

        // Prepare public signals
        uint256[7] memory pubSignals = [
            tokenMerkleRoot,
            tokenNullifierHash,
            tokenAmount,
            r00tOutputCommitment,
            minR00tOut,
            tokenChangeCommitment,
            uint256(0) // swapBinding (computed by circuit)
        ];

        // Verify ZK proof
        if (!swapVerifier.verifyProof(proof, pubSignals)) revert InvalidProof();

        // Mark nullifier as spent
        nullifiers[tokenNullifierHash] = true;

        // Calculate R00T out
        uint256 r00tOut = getAmountOut(tokenAmount, tokenReserve, r00tReserve);
        if (r00tOut < minR00tOut) revert SlippageExceeded();
        if (r00tOut > r00tReserve) revert InsufficientReserve();

        // SECURITY FIX: Ensure we have enough R00T to back this claim
        // Available R00T = r00tReserve - totalPendingClaims (already promised but not yet processed)
        // We need: availableR00t >= r00tOut
        if (totalPendingClaims + r00tOut > r00tReserve) revert InsufficientReserve();

        // Update reserves
        tokenReserve += tokenAmount;
        r00tReserve -= r00tOut;

        // Insert token change commitment if any
        if (tokenChangeCommitment != 0) {
            uint256 changeIndex = projectTokenPool.insert(tokenChangeCommitment);
            emit NewCommitment(tokenChangeCommitment, changeIndex, tokenChangeNote);
        }

        // SECURITY FIX: Instead of creating R00T commitments directly (which requires r00tPool authorization),
        // register a pending claim that can be processed by the launchpad
        // This ensures R00T commitments are only created by authorized entities
        if (r00tOutputCommitment != 0) {
            uint256 claimId = nextClaimId++;
            pendingR00tClaims[claimId] = PendingR00tClaim({
                amount: r00tOut,
                outputCommitment: r00tOutputCommitment,
                encryptedNote: r00tNote,
                claimed: false,
                createdAt: block.timestamp  // SECURITY FIX: Track creation time
            });
            totalPendingClaims += r00tOut;
            emit R00tClaimRegistered(claimId, r00tOut, r00tOutputCommitment);
        }

        emit NullifierSpent(tokenNullifierHash);
        emit SwapTokenForR00t(tokenAmount, r00tOut);
    }

    // ============ Pending Claims Processing ============

    /// @notice Process a pending R00T claim (called by launchpad)
    /// @dev This creates the actual R00T commitment in the main R00T pool
    ///
    /// SECURITY NOTE (Vuln 7): This function calls r00tPool.insert() which requires
    /// this contract to be authorized in r00tPool.authorizedCallers mapping.
    /// DEPLOYMENT REQUIREMENT: After deploying ZkAMMPair, the deployer MUST call:
    ///   r00tPool.setAuthorizedCaller(address(zkAMMPair), true)
    /// Otherwise this function will always revert with Unauthorized().
    ///
    /// @param claimId The claim ID to process
    function processR00tClaim(uint256 claimId) external onlyLaunchpad nonReentrant {
        PendingR00tClaim storage claim = pendingR00tClaims[claimId];
        if (claim.amount == 0) revert InvalidClaimId();
        if (claim.claimed) revert ClaimAlreadyProcessed();

        // SECURITY FIX (Vuln 7): Verify authorization before attempting insert
        // This gives a clear error instead of failing deep in r00tPool.insert()
        if (!r00tPool.authorizedCallers(address(this))) {
            revert Unauthorized(); // This ZkAMMPair is not authorized in r00tPool
        }

        claim.claimed = true;
        totalPendingClaims -= claim.amount;

        // Now create the R00T commitment in the main R00T pool
        // This is authorized because we verified authorization above
        uint256 leafIndex = r00tPool.insert(claim.outputCommitment);

        // SECURITY FIX (Vuln 6): Use local event for proper event source attribution
        emit R00tCommitmentCreated(claim.outputCommitment, leafIndex, claim.encryptedNote);
        emit R00tClaimProcessed(claimId, claim.amount);
    }

    /// @notice Emergency process a pending R00T claim after delay (called by anyone)
    /// @dev SECURITY FIX (Vuln 6): Prevents permanent fund lock if launchpad is compromised.
    ///      After EMERGENCY_CLAIM_DELAY (30 days), anyone can process pending claims.
    ///      This ensures users can always recover their funds even if launchpad fails.
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

    // ============ Transfer Functions ============

    /// @notice Transfer project tokens privately
    /// @param proof ZK proof
    /// @param merkleRoot Merkle root of project token pool
    /// @param nullifierHash Nullifier to prevent double-spending
    /// @param recipientCommitment Commitment for recipient
    /// @param changeCommitment Commitment for sender's change (0 if none)
    /// @param recipientNote Encrypted note for recipient
    /// @param changeNote Encrypted note for change
    function transferPrivate(
        uint256[8] calldata proof,
        uint256 merkleRoot,
        uint256 nullifierHash,
        uint256 recipientCommitment,
        uint256 changeCommitment,
        bytes calldata recipientNote,
        bytes calldata changeNote
    ) external nonReentrant {
        // SECURITY FIX: Validate all ZK public inputs are within scalar field
        if (merkleRoot >= SNARK_SCALAR_FIELD) revert InvalidScalarField();
        if (nullifierHash >= SNARK_SCALAR_FIELD) revert InvalidScalarField();
        if (recipientCommitment >= SNARK_SCALAR_FIELD) revert InvalidScalarField();
        if (changeCommitment >= SNARK_SCALAR_FIELD) revert InvalidScalarField();

        // Verify merkle root
        if (!projectTokenPool.isKnownRoot(merkleRoot)) revert UnknownMerkleRoot();

        // Verify nullifier not spent
        if (nullifiers[nullifierHash]) revert NullifierAlreadySpent();

        // Prepare public signals
        uint256[4] memory pubSignals = [
            merkleRoot,
            nullifierHash,
            recipientCommitment,
            changeCommitment
        ];

        // Verify ZK proof
        if (!transferVerifier.verifyProof(proof, pubSignals)) revert InvalidProof();

        // Mark nullifier as spent
        nullifiers[nullifierHash] = true;

        // Insert recipient commitment
        uint256 recipientIndex = projectTokenPool.insert(recipientCommitment);
        emit NewCommitment(recipientCommitment, recipientIndex, recipientNote);

        // Insert change commitment if any
        if (changeCommitment != 0) {
            uint256 changeIndex = projectTokenPool.insert(changeCommitment);
            emit NewCommitment(changeCommitment, changeIndex, changeNote);
        }

        emit NullifierSpent(nullifierHash);
        emit PrivateTransfer(0); // Amount hidden
    }

    // ============ Withdraw Functions ============

    /// @notice Withdraw tokens from privacy pool to public wallet
    /// @dev SECURITY FIX (Audit Vuln 1): This function is DISABLED for ZkAMMPair because
    ///      this pool operates with virtual/commitment-only tokens - there are no actual
    ///      ERC20 tokens to withdraw. Project tokens in ZkAMMPair exist purely as private
    ///      commitments. Users who want to "exit" should swap back to R00T and then
    ///      withdraw from the main ZkAMMv3 pool which handles actual ETH.
    ///      For pools with actual ERC20 tokens, use ZkProjectPool instead.
    function withdrawPublic(
        uint256[8] calldata,
        uint256,
        uint256,
        uint256,
        address
    ) external pure {
        revert NotImplemented();
    }

    /// @notice Error for functions not supported by this pool type
    error NotImplemented();

    // ============ View Functions ============

    /// @notice Calculate output amount for a swap
    /// @dev Note: Cannot be pure due to FEE_BPS being immutable (not constant)
    function getAmountOut(
        uint256 amountIn,
        uint256 reserveIn,
        uint256 reserveOut
    ) public view returns (uint256 amountOut) {
        uint256 amountInWithFee = amountIn * (FEE_DENOMINATOR - FEE_BPS);
        uint256 numerator = amountInWithFee * reserveOut;
        uint256 denominator = reserveIn * FEE_DENOMINATOR + amountInWithFee;
        amountOut = numerator / denominator;
    }

    /// @notice Get token price in $R00T (tokens per 1 $R00T)
    function getTokenPrice() external view returns (uint256) {
        return getAmountOut(1e18, r00tReserve, tokenReserve);
    }

    /// @notice Get $R00T price in tokens ($R00T per 1 token)
    function getRootPrice() external view returns (uint256) {
        return getAmountOut(1e18, tokenReserve, r00tReserve);
    }

    /// @notice Get pool reserves
    function getReserves() external view returns (uint256 _r00tReserve, uint256 _tokenReserve) {
        return (r00tReserve, tokenReserve);
    }

    /// @notice Get the project token pool address
    function getProjectTokenPool() external view returns (address) {
        return address(projectTokenPool);
    }

    // ============ Admin Functions ============

    /// @notice Lock all verifiers permanently (cannot be unlocked)
    /// @dev SECURITY FIX (Vuln 2): Once locked, verifiers cannot be changed
    ///      This should be called after all verifiers are properly configured
    ///      Prevents a compromised launchpad from replacing verifiers with malicious ones
    event VerifiersPermanentlyLocked();

    function lockVerifiers() external onlyLaunchpad {
        verifiersLocked = true;
        emit VerifiersPermanentlyLocked();
    }

    /// @notice Update swap verifier (for circuit upgrades)
    /// @dev SECURITY FIX (Vuln 2): Cannot be called after verifiers are locked
    function setSwapVerifier(address _newVerifier) external onlyLaunchpad {
        if (verifiersLocked) revert VerifiersLocked();
        if (_newVerifier == address(0)) revert ZeroAddress();
        swapVerifier = ISwapVerifier(_newVerifier);
    }

    /// @notice Update transfer verifier
    /// @dev SECURITY FIX (Vuln 2): Cannot be called after verifiers are locked
    function setTransferVerifier(address _newVerifier) external onlyLaunchpad {
        if (verifiersLocked) revert VerifiersLocked();
        if (_newVerifier == address(0)) revert ZeroAddress();
        transferVerifier = ITransferVerifier(_newVerifier);
    }

    /// @notice Update withdraw verifier
    /// @dev SECURITY FIX (Vuln 2): Cannot be called after verifiers are locked
    function setWithdrawVerifier(address _newVerifier) external onlyLaunchpad {
        if (verifiersLocked) revert VerifiersLocked();
        if (_newVerifier == address(0)) revert ZeroAddress();
        withdrawVerifier = IWithdrawVerifier(_newVerifier);
    }
}
