// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./TokenPool.sol";
import "./NullifierRegistry.sol";
import {ISwapVerifier, IProjectPoolLPVerifier, IWithdrawVerifier, IClaimLPFeesVerifier} from "./interfaces/IVerifier.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @title ZkProjectPoolCore
/// @author r00t.fund
/// @notice Core AMM pool for launchpad project tokens - minimal contract for factory deployment
/// @dev This is the Core component of the split ZkProjectPool (Core + Router pattern).
///      Factory deploys this contract (~12KB) to stay under 24KB limit.
///      User-facing operations (deposit, withdraw, fees) are handled by ZkProjectPoolRouter.
///
/// Split Architecture:
/// - ZkProjectPoolCore: Core AMM logic, state, view functions (~12KB)
/// - ZkProjectPoolRouter: User-facing ops, deployed once, shared by all pools (~12KB)
contract ZkProjectPoolCore is ReentrancyGuard {
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
    uint256 public constant MIN_LP_DEPOSIT = 1e17;
    uint256 public constant SNARK_SCALAR_FIELD = 21888242871839275222246405745257275088548364400416034343698204186575808495617;
    uint256 public constant DEV_VESTING_PERIOD = 180 days;
    uint256 public constant DEV_VESTING_CLIFF = 30 days;
    uint256 public constant EMERGENCY_CLAIM_DELAY = 30 days;

    // ============ State Variables ============

    string public name;
    string public symbol;
    uint256 public totalSupply;
    TokenPool public immutable projectTokenPool;
    TokenPool public immutable lpPool;
    TokenPool public immutable r00tPool;
    NullifierRegistry public immutable nullifierRegistry;
    IERC20 public immutable token;

    address public swapVerifier;
    address public lpWithdrawVerifier;
    address public withdrawVerifier;
    address public claimLPFeesVerifier;

    uint256 public r00tReserve;
    uint256 public tokenReserve;
    uint256 public totalLPShares;
    uint256 public feePerShare;

    mapping(uint256 => bool) public nullifiers;
    mapping(uint256 => bool) public r00tNullifiers;
    mapping(uint256 => bool) public lpNullifiers;
    mapping(uint256 => uint256) public lpDepositTime;
    mapping(uint256 => uint256) public lastClaimedFeePerShare;
    mapping(uint256 => uint256) public lpCommitmentShares;
    mapping(uint256 => bool) public lpCommitmentWithdrawn;
    mapping(uint256 => mapping(uint256 => bool)) public claimedInBlock;

    address public creator;
    address public platform;
    uint256 public accumulatedPlatformFees;
    uint256 public accumulatedCreatorFees;
    uint256 public accumulatedLPFees;

    address public governance;
    address public router;
    uint256 public proposalId;
    address public authorizedAtomicSwapper;

    uint256 public immutable maxDevAllocation;
    uint256 public devAllocationClaimed;
    uint256 public immutable poolCreatedAt;

    // Pending R00T Claims
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
    event InitialLiquidityBurned(uint256 r00tAmount, uint256 tokenAmount, uint256 burnedShares);
    event PublicWithdrawal(uint256 indexed nullifierHash, address indexed recipient, uint256 amount);
    event PublicDeposit(uint256 indexed commitment, address indexed depositor, uint256 amount);
    event DevAllocationClaimed(uint256 indexed commitment, address indexed creator, uint256 amount);
    event R00tClaimRegistered(uint256 indexed claimId, uint256 amount, uint256 outputCommitment);
    event R00tClaimProcessed(uint256 indexed claimId, uint256 amount);
    event R00tCommitmentCreated(uint256 indexed commitment, uint256 indexed leafIndex, bytes encryptedNote);
    event AtomicSwapFromR00T(uint256 r00tAmount, uint256 tokensOut, uint256 indexed outputCommitment);
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
    error VerifierAlreadySet();
    error R00TPoolUnauthorized();
    error InvalidScalarField();
    error AlreadyClaimedInBlock();
    error VestingCliffNotReached();
    error VestingExceedsAllowance();
    error AtomicSwapperAlreadySet();
    error NeverAuthorizedInR00TPool();
    error RouterAlreadySet();

    // ============ Modifiers ============

    modifier onlyGovernance() {
        if (msg.sender != governance) revert Unauthorized();
        _;
    }

    modifier onlyRouter() {
        if (msg.sender != router) revert Unauthorized();
        _;
    }

    modifier onlyGovernanceOrRouter() {
        if (msg.sender != governance && msg.sender != router) revert Unauthorized();
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

    // ============ Constructor ============

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
        uint256 _maxDevAllocationBps,
        address _router
    ) {
        if (_token == address(0) || _r00tPool == address(0) || _creator == address(0) || _platform == address(0)) revert ZeroAddress();
        if (_nullifierRegistry == address(0) || _router == address(0)) revert ZeroAddress();
        if (_initialRootReserve == 0) revert ZeroAmount();

        token = IERC20(_token);
        uint256 _totalSupply = token.totalSupply();
        if (_totalSupply == 0) revert ZeroAmount();

        name = _name;
        symbol = _symbol;
        totalSupply = _totalSupply;

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
        r00tReserve = _initialRootReserve;

        uint256 initialLPShares = sqrt(_initialRootReserve * tokenReserve);
        if (initialLPShares <= MINIMUM_LIQUIDITY) revert InsufficientInitialLiquidity();
        totalLPShares = MINIMUM_LIQUIDITY;

        emit InitialLiquidityBurned(_initialRootReserve, tokenReserve, MINIMUM_LIQUIDITY);

        creator = _creator;
        platform = _platform;
        governance = msg.sender;
        router = _router;
        proposalId = _proposalId;
        poolCreatedAt = block.timestamp;
    }

    function sqrt(uint256 x) internal pure returns (uint256 y) {
        if (x == 0) return 0;
        uint256 z = (x + 1) / 2;
        y = x;
        while (z < y) {
            y = z;
            z = (x / z + z) / 2;
        }
    }

    // ============ Core Swap Functions ============

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
        if (r00tMerkleRoot >= SNARK_SCALAR_FIELD) revert InvalidScalarField();
        if (r00tNullifierHash >= SNARK_SCALAR_FIELD) revert InvalidScalarField();
        if (outputCommitment >= SNARK_SCALAR_FIELD) revert InvalidScalarField();
        if (r00tChangeCommitment >= SNARK_SCALAR_FIELD) revert InvalidScalarField();
        if (publicInputsBinding >= SNARK_SCALAR_FIELD) revert InvalidScalarField();

        if (!r00tPool.isKnownRoot(r00tMerkleRoot)) revert UnknownMerkleRoot();
        if (r00tNullifiers[r00tNullifierHash]) revert NullifierAlreadySpent();
        if (nullifierRegistry.isSpent(r00tNullifierHash)) revert NullifierAlreadySpent();
        if (r00tAmount == 0) revert ZeroAmount();

        // CRITICAL FIX: pubSignals order must match circuit output order
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

        r00tNullifiers[r00tNullifierHash] = true;
        r00tReserve += r00tAfterFees;
        tokenReserve -= tokensOut;
        accumulatedPlatformFees += platformFee;
        accumulatedCreatorFees += creatorFee;
        _distributeLPFees(lpFee);

        nullifierRegistry.markSpent(r00tNullifierHash);
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
        if (tokenMerkleRoot >= SNARK_SCALAR_FIELD) revert InvalidScalarField();
        if (tokenNullifierHash >= SNARK_SCALAR_FIELD) revert InvalidScalarField();
        if (outputR00tCommitment >= SNARK_SCALAR_FIELD) revert InvalidScalarField();
        if (tokenChangeCommitment >= SNARK_SCALAR_FIELD) revert InvalidScalarField();
        if (publicInputsBinding >= SNARK_SCALAR_FIELD) revert InvalidScalarField();

        if (!projectTokenPool.isKnownRoot(tokenMerkleRoot)) revert UnknownMerkleRoot();
        if (nullifiers[tokenNullifierHash]) revert NullifierAlreadySpent();
        if (tokenAmount == 0) revert ZeroAmount();

        // CRITICAL FIX: pubSignals order must match circuit output order
        // Circuit outputs: [publicInputsBinding, inputMerkleRoot, inputNullifierHash, inputAmount, outputCommitment, minOutputAmount, changeCommitment]
        uint256[7] memory pubSignals = [publicInputsBinding, tokenMerkleRoot, tokenNullifierHash, tokenAmount, outputR00tCommitment, minR00tOut, tokenChangeCommitment];
        if (!ISwapVerifier(swapVerifier).verifyProof(proof, pubSignals)) revert InvalidProof();

        // SECURITY FIX: Use _getAmountOutRaw to avoid double fee (explicit fees applied below)
        uint256 r00tOut = _getAmountOutRaw(tokenAmount, tokenReserve, r00tReserve);
        if (r00tOut < minR00tOut) revert SlippageExceeded();
        if (r00tOut > r00tReserve) revert InsufficientReserve();

        uint256 platformFee = (r00tOut * PLATFORM_FEE_BPS) / FEE_DENOMINATOR;
        uint256 creatorFee = (r00tOut * CREATOR_FEE_BPS) / FEE_DENOMINATOR;
        uint256 lpFee = (r00tOut * LP_FEE_BPS) / FEE_DENOMINATOR;
        uint256 r00tAfterFees = r00tOut - platformFee - creatorFee - lpFee;

        // SECURITY FIX (VULN-3): Check all obligations (pending claims + all accumulated fees + new claim)
        uint256 newReserve = r00tReserve - r00tOut;
        uint256 totalObligations = totalPendingClaims + r00tAfterFees + accumulatedPlatformFees + platformFee + accumulatedCreatorFees + creatorFee + accumulatedLPFees + lpFee;
        if (newReserve < totalObligations) revert InsufficientR00tReserve();

        nullifiers[tokenNullifierHash] = true;
        tokenReserve += tokenAmount;
        r00tReserve -= r00tOut;
        accumulatedPlatformFees += platformFee;
        accumulatedCreatorFees += creatorFee;
        _distributeLPFees(lpFee);

        if (tokenChangeCommitment != 0) {
            uint256 changeIndex = projectTokenPool.insert(tokenChangeCommitment);
            emit NewProjectTokenCommitment(tokenChangeCommitment, changeIndex, changeNote);
        }

        if (outputR00tCommitment != 0) {
            _registerPendingClaim(r00tAfterFees, outputR00tCommitment, outputNote);
        }

        emit NullifierSpent(tokenNullifierHash);
        emit TokenSwappedForR00t(tokenAmount, r00tOut, platformFee, creatorFee);
    }

    // ============ Core Liquidity Functions ============

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
        if (r00tMerkleRoot >= SNARK_SCALAR_FIELD) revert InvalidScalarField();
        if (r00tNullifierHash >= SNARK_SCALAR_FIELD) revert InvalidScalarField();
        if (r00tPublicInputsBinding >= SNARK_SCALAR_FIELD) revert InvalidScalarField();
        if (tokenMerkleRoot >= SNARK_SCALAR_FIELD) revert InvalidScalarField();
        if (tokenNullifierHash >= SNARK_SCALAR_FIELD) revert InvalidScalarField();
        if (tokenPublicInputsBinding >= SNARK_SCALAR_FIELD) revert InvalidScalarField();
        if (lpCommitment >= SNARK_SCALAR_FIELD) revert InvalidScalarField();

        if (r00tAmount == 0 || tokenAmount == 0) revert ZeroAmount();
        if (r00tAmount < MIN_LP_DEPOSIT || tokenAmount < MIN_LP_DEPOSIT) revert InsufficientLiquidity();
        if (r00tReserve == 0 || tokenReserve == 0) revert InsufficientReserve();

        if (!r00tPool.isKnownRoot(r00tMerkleRoot)) revert UnknownMerkleRoot();
        if (nullifierRegistry.isSpent(r00tNullifierHash)) revert NullifierAlreadySpent();
        if (!projectTokenPool.isKnownRoot(tokenMerkleRoot)) revert UnknownMerkleRoot();
        if (nullifiers[tokenNullifierHash]) revert NullifierAlreadySpent();

        uint256 lhs = tokenAmount * r00tReserve;
        uint256 rhs = r00tAmount * tokenReserve;
        if (lhs * 200 < rhs * 199 || lhs * 200 > rhs * 201) revert ImbalancedLiquidity();

        // CRITICAL FIX: pubSignals order must match circuit output order (binding first)
        // Circuit outputs: [publicInputsBinding, inputMerkleRoot, inputNullifierHash, inputAmount, outputCommitment, minOutputAmount, changeCommitment]
        uint256[7] memory r00tPubSignals = [r00tPublicInputsBinding, r00tMerkleRoot, r00tNullifierHash, r00tAmount, lpCommitment, 0, 0];
        if (!ISwapVerifier(swapVerifier).verifyProof(r00tProof, r00tPubSignals)) revert InvalidProof();

        uint256[7] memory tokenPubSignals = [tokenPublicInputsBinding, tokenMerkleRoot, tokenNullifierHash, tokenAmount, lpCommitment, 0, 0];
        if (!ISwapVerifier(swapVerifier).verifyProof(tokenProof, tokenPubSignals)) revert InvalidProof();

        if (totalLPShares == 0) revert InvalidLPShares();
        uint256 lpShares = (r00tAmount * totalLPShares) / r00tReserve;
        if (lpShares == 0) revert InvalidLPShares();

        uint256 expectedProduct = r00tAmount * totalLPShares;
        uint256 actualProduct = lpShares * r00tReserve;
        require(actualProduct * 10000 >= expectedProduct * 9995, "Rounding loss too high");

        if (lpDepositTime[lpCommitment] != 0 && !lpCommitmentWithdrawn[lpCommitment]) revert InvalidLPShares();

        nullifiers[tokenNullifierHash] = true;
        // SECURITY FIX: Mark R00T nullifier locally (consistent with swapR00tForToken)
        r00tNullifiers[r00tNullifierHash] = true;
        r00tReserve += r00tAmount;
        tokenReserve += tokenAmount;
        totalLPShares += lpShares;
        lpDepositTime[lpCommitment] = block.timestamp;
        lastClaimedFeePerShare[lpCommitment] = feePerShare;
        lpCommitmentShares[lpCommitment] = lpShares;
        if (lpCommitmentWithdrawn[lpCommitment]) lpCommitmentWithdrawn[lpCommitment] = false;

        nullifierRegistry.markSpent(r00tNullifierHash);
        uint256 leafIndex = lpPool.insert(lpCommitment);

        emit NewLPCommitment(lpCommitment, leafIndex, lpShares, lpNote);
        emit LiquidityAdded(lpCommitment, r00tAmount, tokenAmount, lpShares);
    }

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
        if (lpMerkleRoot >= SNARK_SCALAR_FIELD) revert InvalidScalarField();
        if (nullifierHash >= SNARK_SCALAR_FIELD) revert InvalidScalarField();
        if (commitment >= SNARK_SCALAR_FIELD) revert InvalidScalarField();
        if (r00tOutputCommitment >= SNARK_SCALAR_FIELD) revert InvalidScalarField();
        if (tokenOutputCommitment >= SNARK_SCALAR_FIELD) revert InvalidScalarField();
        if (publicInputsBinding >= SNARK_SCALAR_FIELD) revert InvalidScalarField();

        if (!lpPool.isKnownRoot(lpMerkleRoot)) revert UnknownMerkleRoot();
        if (lpNullifiers[nullifierHash]) revert NullifierAlreadySpent();
        if (lpShares == 0) revert ZeroAmount();
        if (block.timestamp < lpDepositTime[commitment] + LP_LOCK_PERIOD) revert LPLocked();
        if (lpCommitmentShares[commitment] != lpShares) revert InvalidLPShares();

        // CRITICAL FIX: pubSignals order must match circuit output order (binding first)
        // Circuit outputs: [publicInputsBinding, lpMerkleRoot, nullifierHash, commitment, lpShares, r00tOutputCommitment, tokenOutputCommitment, minR00tOut]
        uint256[8] memory pubSignals = [publicInputsBinding, lpMerkleRoot, nullifierHash, commitment, lpShares, r00tOutputCommitment, tokenOutputCommitment, minR00tOut];
        if (!IProjectPoolLPVerifier(lpWithdrawVerifier).verifyProof(proof, pubSignals)) revert InvalidProof();

        uint256 r00tOut = (lpShares * r00tReserve) / totalLPShares;
        uint256 tokenOut = (lpShares * tokenReserve) / totalLPShares;
        if (r00tOut < minR00tOut) revert SlippageExceeded();
        if (tokenOut < minTokenOut) revert SlippageExceeded();
        if (r00tReserve < totalPendingClaims + r00tOut) revert InsufficientR00tReserve();
        // SECURITY FIX (M-10): Ensure minimum liquidity remains after removal
        if (r00tReserve - r00tOut < MINIMUM_LIQUIDITY || tokenReserve - tokenOut < MINIMUM_LIQUIDITY) revert InsufficientLiquidity();

        lpNullifiers[nullifierHash] = true;
        lpCommitmentShares[commitment] = 0;
        lpCommitmentWithdrawn[commitment] = true;
        r00tReserve -= r00tOut;
        tokenReserve -= tokenOut;
        totalLPShares -= lpShares;

        uint256 tokenLeafIndex = projectTokenPool.insert(tokenOutputCommitment);
        emit NewProjectTokenCommitment(tokenOutputCommitment, tokenLeafIndex, tokenNote);

        _registerPendingClaim(r00tOut, r00tOutputCommitment, r00tNote);

        emit LPNullifierSpent(nullifierHash);
        emit LiquidityRemoved(nullifierHash, r00tOut, tokenOut);
    }

    // ============ Router-Only Functions ============

    function routerWithdrawPublic(
        uint256[8] calldata proof,
        uint256 merkleRoot,
        uint256 nullifierHash,
        uint256 amount,
        address recipient,
        uint256 recipientBinding
    ) external nonReentrant onlyRouter {
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

    function routerDepositPublic(
        uint256 amount,
        uint256 commitment,
        bytes32 depositorBinding,
        address depositor,
        bytes calldata encryptedNote
    ) external nonReentrant onlyRouter {
        if (amount == 0) revert ZeroAmount();
        if (commitment == 0) revert ZeroAmount();
        if (commitment >= SNARK_SCALAR_FIELD) revert InvalidScalarField();

        bytes32 expectedBinding = keccak256(abi.encodePacked(commitment, depositor, amount));
        if (depositorBinding != expectedBinding) revert InvalidProof();

        token.safeTransferFrom(depositor, address(this), amount);
        uint256 leafIndex = projectTokenPool.insert(commitment);

        emit NewProjectTokenCommitment(commitment, leafIndex, encryptedNote);
        emit PublicDeposit(commitment, depositor, amount);
    }

    function routerClaimDevAllocation(
        uint256 commitment,
        uint256 amount,
        address caller,
        bytes calldata encryptedNote
    ) external nonReentrant onlyRouter {
        if (caller != creator) revert Unauthorized();
        if (amount == 0) revert ZeroAmount();
        if (commitment == 0) revert ZeroAmount();
        if (commitment >= SNARK_SCALAR_FIELD) revert InvalidScalarField();
        if (block.timestamp < poolCreatedAt + DEV_VESTING_CLIFF) revert VestingCliffNotReached();

        uint256 timeSinceCreation = block.timestamp - poolCreatedAt;
        uint256 vestedAmount = timeSinceCreation >= DEV_VESTING_PERIOD ? maxDevAllocation : (maxDevAllocation * timeSinceCreation) / DEV_VESTING_PERIOD;
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

    function routerCollectPlatformFees(
        uint256 outputCommitment,
        address caller,
        bytes calldata encryptedNote
    ) external nonReentrant onlyRouter returns (uint256 claimId) {
        if (caller != platform) revert Unauthorized();
        if (outputCommitment == 0) revert ZeroAmount();
        // SECURITY FIX (Vuln 14): Validate SNARK scalar field
        if (outputCommitment >= SNARK_SCALAR_FIELD) revert InvalidScalarField();
        uint256 amount = accumulatedPlatformFees;
        if (amount == 0) revert NoFeesToCollect();
        uint256 totalObligations = totalPendingClaims + accumulatedCreatorFees + accumulatedLPFees;
        if (totalObligations + amount > r00tReserve) revert InsufficientR00tReserve();

        accumulatedPlatformFees = 0;
        claimId = _registerPendingClaim(amount, outputCommitment, encryptedNote);
        emit PlatformFeesCollected(platform, amount);
    }

    function routerCollectCreatorFees(
        uint256 outputCommitment,
        address caller,
        bytes calldata encryptedNote
    ) external nonReentrant onlyRouter returns (uint256 claimId) {
        if (caller != creator) revert Unauthorized();
        if (outputCommitment == 0) revert ZeroAmount();
        // SECURITY FIX (Vuln 14): Validate SNARK scalar field
        if (outputCommitment >= SNARK_SCALAR_FIELD) revert InvalidScalarField();
        uint256 amount = accumulatedCreatorFees;
        if (amount == 0) revert NoFeesToCollect();
        uint256 totalObligations = totalPendingClaims + accumulatedPlatformFees + accumulatedLPFees;
        if (totalObligations + amount > r00tReserve) revert InsufficientR00tReserve();

        accumulatedCreatorFees = 0;
        claimId = _registerPendingClaim(amount, outputCommitment, encryptedNote);
        emit CreatorFeesCollected(creator, amount);
    }

    function routerClaimLPFees(
        uint256[8] calldata proof,
        uint256 lpMerkleRoot,
        uint256 claimNullifier,
        uint256 feeEpoch,
        uint256 lpShares,
        uint256 commitment,
        uint256 outputCommitment,
        address caller,
        uint256 publicInputsBinding,
        bytes calldata encryptedNote
    ) external nonReentrant onlyRouter returns (uint256 claimId) {
        if (lpMerkleRoot >= SNARK_SCALAR_FIELD) revert InvalidScalarField();
        if (claimNullifier >= SNARK_SCALAR_FIELD) revert InvalidScalarField();
        if (publicInputsBinding >= SNARK_SCALAR_FIELD) revert InvalidScalarField();
        if (commitment >= SNARK_SCALAR_FIELD) revert InvalidScalarField();
        if (outputCommitment >= SNARK_SCALAR_FIELD) revert InvalidScalarField();
        if (outputCommitment == 0) revert ZeroAmount();
        if (lpShares == 0) revert ZeroAmount();
        if (claimLPFeesVerifier == address(0)) revert NotImplemented();
        if (!lpPool.isKnownRoot(lpMerkleRoot)) revert UnknownMerkleRoot();
        // SECURITY FIX (VULN-4): Record claim nullifier to prevent proof replay
        if (claimNullifier >= SNARK_SCALAR_FIELD) revert InvalidScalarField();
        if (lpNullifiers[claimNullifier]) revert NullifierAlreadySpent();

        // CRITICAL FIX: pubSignals order must match circuit output order
        // Circuit outputs: [publicInputsBinding, lpMerkleRoot, claimNullifier, feeEpoch, lpShares, recipient]
        uint256[6] memory pubSignals = [publicInputsBinding, lpMerkleRoot, claimNullifier, feeEpoch, lpShares, uint256(uint160(caller))];
        if (!IClaimLPFeesVerifier(claimLPFeesVerifier).verifyProof(proof, pubSignals)) revert InvalidProof();

        lpNullifiers[claimNullifier] = true;
        if (lpCommitmentWithdrawn[commitment]) revert LPAlreadyWithdrawn();
        if (claimedInBlock[commitment][block.number]) revert AlreadyClaimedInBlock();
        if (lpCommitmentShares[commitment] == 0 || lpCommitmentShares[commitment] != lpShares) revert InvalidLPShares();

        uint256 feeGrowth = feePerShare - lastClaimedFeePerShare[commitment];
        uint256 claimable = (lpShares * feeGrowth) / FEE_PRECISION;
        if (claimable == 0) revert NoFeesToCollect();
        if (claimable > accumulatedLPFees) claimable = accumulatedLPFees;
        uint256 totalObligations = totalPendingClaims + accumulatedPlatformFees + accumulatedCreatorFees;
        if (totalObligations + claimable > r00tReserve) revert InsufficientR00tReserve();

        claimedInBlock[commitment][block.number] = true;
        lastClaimedFeePerShare[commitment] = feePerShare;
        accumulatedLPFees -= claimable;

        claimId = _registerPendingClaim(claimable, outputCommitment, encryptedNote);
        emit LPFeesClaimed(commitment, caller, claimable);
    }

    function routerProcessR00tClaim(uint256 claimId, address caller) external nonReentrant onlyRouter {
        if (caller != governance) revert Unauthorized();
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

    function routerEmergencyProcessR00tClaim(uint256 claimId) external nonReentrant onlyRouter {
        PendingR00tClaim storage claim = pendingR00tClaims[claimId];
        if (claim.amount == 0) revert InvalidClaimId();
        if (claim.claimed) revert ClaimAlreadyProcessed();
        if (block.timestamp < claim.createdAt + EMERGENCY_CLAIM_DELAY) revert EmergencyDelayNotMet();

        claim.claimed = true;
        totalPendingClaims -= claim.amount;

        uint256 leafIndex;
        if (r00tPool.authorizedCallers(address(this))) {
            leafIndex = r00tPool.insert(claim.outputCommitment);
        } else {
            if (!r00tPool.wasEverAuthorized(address(this))) revert NeverAuthorizedInR00TPool();
            leafIndex = r00tPool.emergencyInsert(claim.outputCommitment);
        }

        emit R00tCommitmentCreated(claim.outputCommitment, leafIndex, claim.encryptedNote);
        emit R00tClaimProcessed(claimId, claim.amount);
    }

    function routerAtomicSwapFromR00T(
        uint256 r00tAmount,
        uint256 r00tNullifier,
        uint256 minTokensOut,
        uint256 outputCommitment,
        address swapper,
        bytes calldata encryptedNote
    ) external nonReentrant onlyRouter returns (uint256 tokensOut) {
        if (swapper != authorizedAtomicSwapper) revert Unauthorized();
        if (r00tAmount == 0) revert ZeroAmount();
        if (outputCommitment == 0) revert ZeroAmount();
        if (outputCommitment >= SNARK_SCALAR_FIELD) revert InvalidScalarField();
        if (r00tNullifier >= SNARK_SCALAR_FIELD) revert InvalidScalarField();
        if (nullifierRegistry.isSpent(r00tNullifier)) revert NullifierAlreadySpent();

        // SECURITY FIX: Use _getAmountOutRaw to avoid double fee
        uint256 platformFee = (r00tAmount * PLATFORM_FEE_BPS) / FEE_DENOMINATOR;
        uint256 creatorFee = (r00tAmount * CREATOR_FEE_BPS) / FEE_DENOMINATOR;
        uint256 lpFee = (r00tAmount * LP_FEE_BPS) / FEE_DENOMINATOR;
        uint256 r00tAfterFees = r00tAmount - platformFee - creatorFee - lpFee;

        tokensOut = _getAmountOutRaw(r00tAfterFees, r00tReserve, tokenReserve);
        if (tokensOut < minTokensOut) revert SlippageExceeded();

        r00tReserve += r00tAfterFees;
        tokenReserve -= tokensOut;
        accumulatedPlatformFees += platformFee;
        accumulatedCreatorFees += creatorFee;
        _distributeLPFees(lpFee);

        uint256 leafIndex = projectTokenPool.insert(outputCommitment);
        nullifierRegistry.markSpent(r00tNullifier);

        emit NewProjectTokenCommitment(outputCommitment, leafIndex, encryptedNote);
        emit AtomicSwapFromR00T(r00tAmount, tokensOut, outputCommitment);
    }

    // ============ Direct Atomic Swap (for ZkAMMv3) ============

    /// @notice Atomic swap from R00T - called directly by ZkAMMv3
    /// @dev This is the direct interface used by ZkAMMv3 for ETH -> ProjectToken atomic swaps
    function atomicSwapFromR00T(
        uint256 r00tAmount,
        uint256 r00tNullifier,
        uint256 minTokensOut,
        uint256 outputCommitment,
        bytes calldata encryptedNote
    ) external nonReentrant returns (uint256 tokensOut) {
        if (msg.sender != authorizedAtomicSwapper) revert Unauthorized();
        if (r00tAmount == 0) revert ZeroAmount();
        if (outputCommitment == 0) revert ZeroAmount();
        if (outputCommitment >= SNARK_SCALAR_FIELD) revert InvalidScalarField();
        if (r00tNullifier >= SNARK_SCALAR_FIELD) revert InvalidScalarField();
        if (nullifierRegistry.isSpent(r00tNullifier)) revert NullifierAlreadySpent();

        // SECURITY FIX: Use _getAmountOutRaw to avoid double fee
        uint256 platformFee = (r00tAmount * PLATFORM_FEE_BPS) / FEE_DENOMINATOR;
        uint256 creatorFee = (r00tAmount * CREATOR_FEE_BPS) / FEE_DENOMINATOR;
        uint256 lpFee = (r00tAmount * LP_FEE_BPS) / FEE_DENOMINATOR;
        uint256 r00tAfterFees = r00tAmount - platformFee - creatorFee - lpFee;

        tokensOut = _getAmountOutRaw(r00tAfterFees, r00tReserve, tokenReserve);
        if (tokensOut < minTokensOut) revert SlippageExceeded();

        r00tReserve += r00tAfterFees;
        tokenReserve -= tokensOut;
        accumulatedPlatformFees += platformFee;
        accumulatedCreatorFees += creatorFee;
        _distributeLPFees(lpFee);

        uint256 leafIndex = projectTokenPool.insert(outputCommitment);
        nullifierRegistry.markSpent(r00tNullifier);

        emit NewProjectTokenCommitment(outputCommitment, leafIndex, encryptedNote);
        emit AtomicSwapFromR00T(r00tAmount, tokensOut, outputCommitment);
    }

    // ============ Governance Functions ============

    function setSwapVerifier(address _newVerifier) external onlyGovernanceOrRouter {
        if (_newVerifier == address(0)) revert ZeroAddress();
        if (swapVerifier != address(0)) revert VerifierAlreadySet();
        address oldVerifier = swapVerifier;
        swapVerifier = _newVerifier;
        emit VerifierUpdated("swap", oldVerifier, _newVerifier);
    }

    function setLPWithdrawVerifier(address _newVerifier) external onlyGovernanceOrRouter {
        if (_newVerifier == address(0)) revert ZeroAddress();
        if (lpWithdrawVerifier != address(0)) revert VerifierAlreadySet();
        address oldVerifier = lpWithdrawVerifier;
        lpWithdrawVerifier = _newVerifier;
        emit VerifierUpdated("lpWithdraw", oldVerifier, _newVerifier);
    }

    function setWithdrawVerifier(address _newVerifier) external onlyGovernanceOrRouter {
        if (_newVerifier == address(0)) revert ZeroAddress();
        if (withdrawVerifier != address(0)) revert VerifierAlreadySet();
        address oldVerifier = withdrawVerifier;
        withdrawVerifier = _newVerifier;
        emit VerifierUpdated("withdraw", oldVerifier, _newVerifier);
    }

    function setClaimLPFeesVerifier(address _newVerifier) external onlyGovernanceOrRouter {
        if (_newVerifier == address(0)) revert ZeroAddress();
        if (claimLPFeesVerifier != address(0)) revert VerifierAlreadySet();
        address oldVerifier = claimLPFeesVerifier;
        claimLPFeesVerifier = _newVerifier;
        emit VerifierUpdated("claimLPFees", oldVerifier, _newVerifier);
    }

    function setAuthorizedAtomicSwapper(address _swapper) external onlyGovernanceOrRouter {
        if (_swapper == address(0)) revert ZeroAddress();
        if (authorizedAtomicSwapper != address(0)) revert AtomicSwapperAlreadySet();
        authorizedAtomicSwapper = _swapper;
    }

    // ============ Internal Functions ============

    function _distributeLPFees(uint256 lpFee) internal {
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
    }

    function _registerPendingClaim(uint256 amount, uint256 outputCommitment, bytes calldata encryptedNote) internal returns (uint256 claimId) {
        // SECURITY FIX (Vuln 14): Defense-in-depth SNARK scalar field validation
        if (outputCommitment >= SNARK_SCALAR_FIELD) revert InvalidScalarField();
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
    }

    /// @notice Raw AMM output calculation without fee (used internally when fees are applied explicitly)
    function _getAmountOutRaw(uint256 amountIn, uint256 reserveIn, uint256 reserveOut) internal pure returns (uint256 amountOut) {
        uint256 numerator = amountIn * reserveOut;
        uint256 denominator = reserveIn + amountIn;
        amountOut = numerator / denominator;
    }

    // ============ View Functions ============

    /// @notice Public AMM output calculation with built-in fee (for external price queries)
    function getAmountOut(uint256 amountIn, uint256 reserveIn, uint256 reserveOut) public pure returns (uint256 amountOut) {
        uint256 amountInWithFee = amountIn * (FEE_DENOMINATOR - FEE_BPS);
        uint256 numerator = amountInWithFee * reserveOut;
        uint256 denominator = reserveIn * FEE_DENOMINATOR + amountInWithFee;
        amountOut = numerator / denominator;
    }

    function getTokenPrice() external view returns (uint256) { return getAmountOut(1e18, r00tReserve, tokenReserve); }
    function getR00tPrice() external view returns (uint256) { return getAmountOut(1e18, tokenReserve, r00tReserve); }
    function getReserves() external view returns (uint256, uint256) { return (r00tReserve, tokenReserve); }
    function getProjectTokenPool() external view returns (address) { return address(projectTokenPool); }
    function getLPPool() external view returns (address) { return address(lpPool); }
    function getLPInfo() external view returns (uint256, uint256, uint256) { return (totalLPShares, feePerShare, accumulatedLPFees); }

    function getLPCommitmentInfo(uint256 commitment) external view returns (uint256, uint256, uint256, bool) {
        return (lpCommitmentShares[commitment], lpDepositTime[commitment], lastClaimedFeePerShare[commitment], lpCommitmentWithdrawn[commitment]);
    }

    function getCirculatingSupply() external view returns (uint256) { return totalSupply - tokenReserve; }

    function getPrivateHoldings() external view returns (uint256) {
        uint256 poolBalance = token.balanceOf(address(this));
        return poolBalance > tokenReserve ? poolBalance - tokenReserve : 0;
    }

    function getPublicWithdrawn() external view returns (uint256) { return totalSupply - token.balanceOf(address(this)); }

    function getSupplyBreakdown() external view returns (uint256 inReserve, uint256 privateCommitments, uint256 publicCirculating) {
        inReserve = tokenReserve;
        uint256 poolBalance = token.balanceOf(address(this));
        privateCommitments = poolBalance > tokenReserve ? poolBalance - tokenReserve : 0;
        publicCirculating = totalSupply - poolBalance;
    }

    function checkReserveHealth() external view returns (bool healthy, uint256 totalObligations, uint256 surplus) {
        totalObligations = totalPendingClaims + accumulatedPlatformFees + accumulatedCreatorFees + accumulatedLPFees;
        healthy = r00tReserve >= totalObligations;
        surplus = healthy ? r00tReserve - totalObligations : 0;
    }

    function getVestedDevAllocation() external view returns (uint256 vestedAmount, uint256 claimableNow) {
        if (block.timestamp < poolCreatedAt + DEV_VESTING_CLIFF) return (0, 0);
        uint256 timeSinceCreation = block.timestamp - poolCreatedAt;
        vestedAmount = timeSinceCreation >= DEV_VESTING_PERIOD ? maxDevAllocation : (maxDevAllocation * timeSinceCreation) / DEV_VESTING_PERIOD;
        claimableNow = vestedAmount > devAllocationClaimed ? vestedAmount - devAllocationClaimed : 0;
    }

    function getPendingClaim(uint256 claimId) external view returns (uint256, uint256, bool, uint256) {
        PendingR00tClaim storage claim = pendingR00tClaims[claimId];
        return (claim.amount, claim.outputCommitment, claim.claimed, claim.createdAt);
    }

    function getPendingClaimsInfo() external view returns (uint256, uint256) { return (nextClaimId, totalPendingClaims); }
    function getToken() external view returns (address) { return address(token); }
}
