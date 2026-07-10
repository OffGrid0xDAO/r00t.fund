// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./TokenPool.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @title ZkAMMPair
/// @author r00t.fund
/// @notice Core state and low-level operations for ZkAMM (like UniswapV2Pair)
/// @dev This contract holds all state (ETH + ROOT tokens) and provides low-level operations.
///      Only the Router contract can modify state. Users interact via Router.
contract ZkAMMPair is ReentrancyGuard {
    using SafeERC20 for IERC20;
    // ============ Constants ============

    /// @notice Total supply of tokens (69 million with 18 decimals)
    uint256 public constant TOTAL_SUPPLY = 69_000_000 * 1e18;

    /// @notice Fee denominator (10000 = 100%)
    uint256 public constant FEE_DENOMINATOR = 10000;

    /// @notice Minimum ETH liquidity that must remain in pool
    uint256 public constant MIN_LIQUIDITY = 0.01 ether;

    /// @notice BN254 scalar field size for SNARK commitments
    uint256 public constant SNARK_SCALAR_FIELD = 21888242871839275222246405745257275088548364400416034343698204186575808495617;

    /// @notice LP lock period to prevent flash LP attacks. Mutable — raise toward 24h for mainnet.
    uint256 public LP_LOCK_PERIOD = 1 minutes;

    /// @notice Scaling factor for fee per share calculations (1e18)
    uint256 public constant FEE_PRECISION = 1e18;

    /// @notice Minimum LP fee required before distribution
    uint256 public constant MIN_LP_FEE_FOR_DISTRIBUTION = 1e12;

    /// @notice Minimum time between fee epoch increments (7 days)
    uint256 public constant MIN_EPOCH_DURATION = 7 days;

    /// @notice Minimum claim window before epoch can be incremented (72 hours)
    uint256 public constant MIN_CLAIM_WINDOW = 72 hours;

    // ============ Immutables ============

    /// @notice ROOT ERC20 token - real tokens held by this contract
    IERC20 public immutable rootToken;

    // ============ Router (set once after deployment) ============

    /// @notice Router contract (only address allowed to modify state)
    address public router;

    /// @notice Admin contract (can set router once)
    address public admin;

    /// @notice Shorts contract (can modify reserves for short positions)
    address public shortsContract;

    /// @notice Token commitment merkle tree
    TokenPool public immutable tokenPool;

    /// @notice LP commitment merkle tree
    TokenPool public immutable lpPool;

    // ============ State Variables ============

    /// @notice Token name
    string public name;

    /// @notice Token symbol
    string public symbol;

    /// @notice ETH reserve in the pool
    uint256 public ethReserve;

    /// @notice Token reserve in the pool
    uint256 public tokenReserve;

    /// @notice Total LP shares issued
    uint256 public totalLPShares;

    /// @notice Accumulated fees per LP share (scaled by FEE_PRECISION)
    uint256 public feePerShare;

    /// @notice Accumulated protocol fees (in ETH)
    uint256 public accumulatedProtocolFees;

    /// @notice Accumulated LP fees awaiting claim (in ETH)
    uint256 public accumulatedLPFees;

    /// @notice Burned LP shares (from bootstrap, permanently unclaimable by LPs)
    uint256 public burnedLPShares;

    /// @notice Tracks fee-per-share already swept for burned shares
    uint256 public lastSweptFeePerShare;

    /// @notice Mapping of spent nullifier hashes (for trading)
    mapping(uint256 => bool) public nullifiers;

    /// @notice Mapping of spent LP nullifier hashes
    mapping(uint256 => bool) public lpNullifiers;

    /// @notice Mapping of spent claim nullifiers
    mapping(uint256 => bool) public spentClaimNullifiers;

    /// @notice Mapping of LP commitment to LP shares
    mapping(uint256 => uint256) public lpCommitmentShares;

    /// @notice Mapping of LP commitment deposit times
    mapping(uint256 => uint256) public lpDepositTime;

    /// @notice Mapping of last claimed fee per share for LP commitments
    mapping(uint256 => uint256) public lastClaimedFeePerShare;

    /// @notice Mapping of withdrawn LP commitments
    mapping(uint256 => bool) public lpCommitmentWithdrawn;

    /// @notice Mapping of used commitment bindings (prevents front-running)
    mapping(bytes32 => bool) public usedCommitmentBindings;

    /// @notice Current fee epoch
    uint256 public currentFeeEpoch;

    /// @notice Fee per share at the start of each epoch
    mapping(uint256 => uint256) public feePerShareAtEpochStart;

    /// @notice Timestamp of last fee epoch increment
    uint256 public lastEpochIncrementTime;

    /// @notice Whether epoch increment has been announced
    bool public epochIncrementPending;

    /// @notice Timestamp when epoch increment was announced
    uint256 public epochIncrementAnnouncedAt;

    /// @notice Timestamp of most recent LP deposit
    uint256 public lastLPDepositTime;

    /// @notice Whether initial liquidity has been bootstrapped
    bool public bootstrapped;

    /// @notice Nonce counter for atomic swap commitment uniqueness
    uint256 public atomicSwapNonce;

    // ============ Events ============

    event NewCommitment(uint256 indexed commitment, uint256 indexed leafIndex, bytes encryptedNote);
    event NewLPCommitment(uint256 indexed commitment, uint256 indexed leafIndex, uint256 lpShares, bytes encryptedNote);
    event NullifierSpent(uint256 indexed nullifierHash);
    event LPNullifierSpent(uint256 indexed nullifierHash);
    event ClaimNullifierSpent(uint256 indexed claimNullifier);
    event FeeEpochIncremented(uint256 newEpoch, uint256 totalLPFees);
    event EpochIncrementAnnounced(uint256 indexed epoch, uint256 effectiveTime);
    event EpochIncrementCancelled(uint256 indexed epoch);
    event LiquidityBootstrapped(uint256 ethAmount, uint256 lpShares, uint256 burnedShares);
    event ETHAccountingSynced(uint256 previousReserve, uint256 actualBalance, uint256 surplus);
    event PublicDeposit(uint256 indexed commitment, address indexed depositor, uint256 amount);

    // ============ Errors ============

    error Unauthorized();
    error ZeroAddress();
    error ZeroAmount();
    error NullifierAlreadySpent();
    error UnknownMerkleRoot();
    error InsufficientLiquidity();
    error InsufficientETH();
    error InvalidLPShares();
    error LPLocked();
    error CommitmentAlreadyExists();
    error ClaimNullifierAlreadySpent();
    error AlreadyBootstrapped();
    error EpochTooSoon();
    error RecentLPDeposit();
    error EpochIncrementNotAnnounced();
    error ClaimWindowNotPassed();
    error NoFeesToCollect();
    error TransferFailed();
    error CommitmentBindingAlreadyUsed();
    error InvalidScalarField();
    error InvalidDepositorBinding();

    // ============ Modifiers ============

    modifier onlyRouter() {
        if (msg.sender != router) revert Unauthorized();
        _;
    }

    modifier onlyAdmin() {
        if (msg.sender != admin) revert Unauthorized();
        _;
    }

    modifier onlyRouterOrAdmin() {
        if (msg.sender != router && msg.sender != admin) revert Unauthorized();
        _;
    }

    modifier onlyShorts() {
        if (msg.sender != shortsContract) revert Unauthorized();
        _;
    }

    modifier onlyRouterOrShorts() {
        if (msg.sender != router && msg.sender != shortsContract) revert Unauthorized();
        _;
    }

    // ============ Constructor ============

    /// @notice Initialize the Pair contract
    /// @param _admin Admin contract address (can set router once)
    /// @param _rootToken ROOT ERC20 token address
    /// @param _name Token name
    /// @param _symbol Token symbol
    constructor(
        address _admin,
        address _rootToken,
        string memory _name,
        string memory _symbol
    ) payable {
        if (_admin == address(0)) revert ZeroAddress();
        if (_rootToken == address(0)) revert ZeroAddress();

        admin = _admin;
        rootToken = IERC20(_rootToken);
        name = _name;
        symbol = _symbol;

        // Deploy Poseidon and create merkle trees
        address poseidonAddr = PoseidonT3Deployer.deploy();
        tokenPool = new TokenPool(poseidonAddr);
        lpPool = new TokenPool(poseidonAddr);

        // Initialize reserves
        tokenReserve = TOTAL_SUPPLY;
        ethReserve = msg.value;

        // Initialize fee epoch
        currentFeeEpoch = 1;
        feePerShareAtEpochStart[1] = 0;
        lastEpochIncrementTime = block.timestamp;
    }

    /// @notice Set the router address (can only be called once by admin)
    /// @param _router Router contract address
    function setRouter(address _router) external {
        if (msg.sender != admin) revert Unauthorized();
        if (router != address(0)) revert("Router already set");
        if (_router == address(0)) revert ZeroAddress();
        router = _router;
    }

    /// @notice Upgrade the router address
    /// @dev SECURITY FIX (Vuln 6): Now requires pending + timelock via admin contract
    ///      The admin contract's proposeRouterUpgrade/executeRouterUpgrade enforces the timelock.
    ///      This function validates the caller is the admin contract.
    /// @param _newRouter New router contract address
    function upgradeRouter(address _newRouter) external {
        if (msg.sender != admin) revert Unauthorized();
        if (_newRouter == address(0)) revert ZeroAddress();
        router = _newRouter;
    }

    /// @notice Set the shorts contract address (one-time only after initial zero)
    /// @dev SECURITY FIX (Vuln 6): Can only be set once. For upgrades, use admin timelock pattern.
    /// @param _shortsContract Shorts contract address
    function setShortsContract(address _shortsContract) external {
        if (msg.sender != admin) revert Unauthorized();
        if (_shortsContract == address(0)) revert ZeroAddress();
        // SECURITY FIX (Vuln 6): Prevent repeated changes - require timelock for upgrades
        if (shortsContract != address(0)) revert Unauthorized();
        shortsContract = _shortsContract;
    }

    /// @notice Allocate ROOT tokens from pool reserves to the shorts contract
    /// @dev Admin-only. Reduces tokenReserve and transfers ERC20 tokens to shorts contract.
    ///      This is needed to seed the shorts contract with tokens it can sell when users open shorts.
    /// @param amount Amount of ROOT tokens to allocate
    function allocateTokensForShorts(uint256 amount) external {
        if (msg.sender != admin) revert Unauthorized();
        if (shortsContract == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        if (amount > tokenReserve - MIN_LIQUIDITY) revert InsufficientLiquidity();

        tokenReserve -= amount;
        rootToken.safeTransfer(shortsContract, amount);
    }

    // ============ Router-Only State Modification Functions ============

    /// @notice Update reserves after a swap
    /// @param ethDelta ETH amount to add (positive) or remove (negative via separate param)
    /// @param tokenDelta Token amount change
    /// @param isEthIn True if ETH is being added, false if removed
    /// @dev DESIGN NOTE (Vuln 8): isEthIn acts as a direction flag — when true: ethReserve += ethDelta
    ///      AND tokenReserve -= tokenDelta. When false: ethReserve -= ethDelta AND tokenReserve += tokenDelta.
    ///      This bidirectional behavior has caused previous bugs (see removeLiquidity BUGFIX).
    ///      Consider refactoring into explicit addETH/removeETH/addTokens/removeTokens in production.
    function updateReserves(
        uint256 ethDelta,
        uint256 tokenDelta,
        bool isEthIn
    ) external onlyRouter {
        if (isEthIn) {
            ethReserve += ethDelta;
            tokenReserve -= tokenDelta;
        } else {
            if (ethDelta > ethReserve - MIN_LIQUIDITY) revert InsufficientLiquidity();
            ethReserve -= ethDelta;
            tokenReserve += tokenDelta;
        }
    }

    /// @notice Mark a trading nullifier as spent
    function markNullifierSpent(uint256 nullifierHash) external onlyRouter {
        if (nullifiers[nullifierHash]) revert NullifierAlreadySpent();
        nullifiers[nullifierHash] = true;
        emit NullifierSpent(nullifierHash);
    }

    /// @notice Mark an LP nullifier as spent
    function markLPNullifierSpent(uint256 nullifierHash) external onlyRouter {
        if (lpNullifiers[nullifierHash]) revert NullifierAlreadySpent();
        lpNullifiers[nullifierHash] = true;
        emit LPNullifierSpent(nullifierHash);
    }

    /// @notice Mark a claim nullifier as spent
    function markClaimNullifierSpent(uint256 claimNullifier) external onlyRouter {
        if (spentClaimNullifiers[claimNullifier]) revert ClaimNullifierAlreadySpent();
        spentClaimNullifiers[claimNullifier] = true;
        emit ClaimNullifierSpent(claimNullifier);
    }

    /// @notice Insert a commitment into the token pool
    function insertCommitment(uint256 commitment, bytes calldata encryptedNote) external onlyRouter returns (uint256 leafIndex) {
        leafIndex = tokenPool.insert(commitment);
        emit NewCommitment(commitment, leafIndex, encryptedNote);
    }

    /// @notice Insert an LP commitment into the LP pool
    function insertLPCommitment(
        uint256 commitment,
        uint256 lpShares,
        bytes calldata encryptedNote
    ) external onlyRouter returns (uint256 leafIndex) {
        leafIndex = lpPool.insert(commitment);
        emit NewLPCommitment(commitment, leafIndex, lpShares, encryptedNote);
    }

    /// @notice Record an LP commitment with shares and fee snapshot
    function recordLPCommitment(
        uint256 commitment,
        uint256 shares,
        bool isReuse
    ) external onlyRouter {
        // Check for collision (unless reusing withdrawn slot)
        if (lpDepositTime[commitment] != 0 && !lpCommitmentWithdrawn[commitment]) {
            revert CommitmentAlreadyExists();
        }

        lpCommitmentShares[commitment] = shares;
        lpDepositTime[commitment] = block.timestamp;
        lastClaimedFeePerShare[commitment] = feePerShare;
        lastLPDepositTime = block.timestamp;

        // Reset withdrawn flag if reusing
        if (isReuse && lpCommitmentWithdrawn[commitment]) {
            lpCommitmentWithdrawn[commitment] = false;
        }
    }

    /// @notice Clear LP commitment data after withdrawal
    function clearLPCommitment(uint256 commitment) external onlyRouter returns (uint256 shares) {
        shares = lpCommitmentShares[commitment];
        if (shares == 0) revert InvalidLPShares();

        lpCommitmentShares[commitment] = 0;
        lpCommitmentWithdrawn[commitment] = true;
    }

    /// @notice Add LP shares to total
    function addLPShares(uint256 shares) external onlyRouter {
        totalLPShares += shares;
    }

    /// @notice Remove LP shares from total
    function removeLPShares(uint256 shares) external onlyRouter {
        totalLPShares -= shares;
    }

    /// @notice Add protocol fees
    function addProtocolFees(uint256 amount) external onlyRouterOrShorts {
        accumulatedProtocolFees += amount;
        // SECURITY FIX (M-4): Ensure accumulated fees never exceed ETH reserve
        if (accumulatedProtocolFees + accumulatedLPFees > ethReserve) {
            accumulatedProtocolFees = ethReserve > accumulatedLPFees ? ethReserve - accumulatedLPFees : 0;
        }
    }

    /// @notice Distribute LP fees
    function distributeLPFees(uint256 lpFee) external onlyRouter {
        if (totalLPShares > 0 && lpFee >= MIN_LP_FEE_FOR_DISTRIBUTION) {
            uint256 feeIncrement = (lpFee * FEE_PRECISION) / totalLPShares;
            if (feeIncrement > 0) {
                feePerShare += feeIncrement;
                accumulatedLPFees += lpFee;
            } else {
                accumulatedProtocolFees += lpFee;
            }
        } else {
            accumulatedProtocolFees += lpFee;
        }
    }

    /// @notice Deduct claimed LP fees
    function deductLPFees(uint256 amount) external onlyRouter {
        if (amount > accumulatedLPFees) {
            amount = accumulatedLPFees;
        }
        accumulatedLPFees -= amount;
    }

    /// @notice Check and use commitment binding
    function useCommitmentBinding(bytes32 binding) external onlyRouter {
        if (usedCommitmentBindings[binding]) revert CommitmentBindingAlreadyUsed();
        usedCommitmentBindings[binding] = true;
    }

    /// @notice Increment atomic swap nonce and return previous value
    function useAtomicSwapNonce() external onlyRouter returns (uint256 nonce) {
        nonce = atomicSwapNonce++;
    }

    /// @notice Bootstrap initial liquidity
    function bootstrap(
        uint256 lpCommitment,
        uint256 ownerShares,
        uint256 burnedShares,
        bytes calldata lpNote
    ) external payable onlyRouter returns (uint256 leafIndex) {
        if (bootstrapped) revert AlreadyBootstrapped();
        bootstrapped = true;

        ethReserve += msg.value;
        totalLPShares = ownerShares + burnedShares;
        burnedLPShares = burnedShares;

        lpDepositTime[lpCommitment] = block.timestamp;
        lastLPDepositTime = block.timestamp;
        lastClaimedFeePerShare[lpCommitment] = 0;
        lpCommitmentShares[lpCommitment] = ownerShares;

        leafIndex = lpPool.insert(lpCommitment);
        emit NewLPCommitment(lpCommitment, leafIndex, ownerShares, lpNote);
        emit LiquidityBootstrapped(msg.value, ownerShares, burnedShares);
    }

    /// @notice Announce epoch increment
    function announceEpochIncrement() external onlyRouterOrAdmin {
        if (block.timestamp < lastEpochIncrementTime + MIN_EPOCH_DURATION) revert EpochTooSoon();
        if (block.timestamp < lastLPDepositTime + MIN_CLAIM_WINDOW) revert RecentLPDeposit();
        if (epochIncrementPending) revert("Epoch increment already pending");

        epochIncrementPending = true;
        epochIncrementAnnouncedAt = block.timestamp;

        emit EpochIncrementAnnounced(currentFeeEpoch + 1, block.timestamp + MIN_CLAIM_WINDOW);
    }

    /// @notice Execute epoch increment
    function executeEpochIncrement() external onlyRouterOrAdmin {
        if (!epochIncrementPending) revert EpochIncrementNotAnnounced();
        if (block.timestamp < epochIncrementAnnouncedAt + MIN_CLAIM_WINDOW) revert ClaimWindowNotPassed();

        epochIncrementPending = false;
        epochIncrementAnnouncedAt = 0;

        currentFeeEpoch++;
        lastEpochIncrementTime = block.timestamp;
        feePerShareAtEpochStart[currentFeeEpoch] = feePerShare;

        emit FeeEpochIncremented(currentFeeEpoch, accumulatedLPFees);
    }

    /// @notice Cancel epoch increment
    function cancelEpochIncrement() external onlyRouterOrAdmin {
        if (!epochIncrementPending) revert EpochIncrementNotAnnounced();

        uint256 cancelledEpoch = currentFeeEpoch + 1;
        epochIncrementPending = false;
        epochIncrementAnnouncedAt = 0;

        emit EpochIncrementCancelled(cancelledEpoch);
    }

    /// @notice Collect protocol fees
    function collectProtocolFees(address treasury) external onlyRouterOrAdmin returns (uint256 fees) {
        fees = accumulatedProtocolFees;
        if (fees == 0) revert NoFeesToCollect();
        accumulatedProtocolFees = 0;

        (bool success, ) = treasury.call{value: fees}("");
        if (!success) revert TransferFailed();
    }

    /// @notice Sweep LP fees attributable to burned shares (send to treasury)
    function sweepBurnedShareFees(address treasury) external onlyRouterOrAdmin returns (uint256 fees) {
        if (burnedLPShares == 0) revert NoFeesToCollect();

        uint256 feeGrowth = feePerShare - lastSweptFeePerShare;
        fees = (burnedLPShares * feeGrowth) / FEE_PRECISION;
        if (fees == 0) revert NoFeesToCollect();
        if (fees > accumulatedLPFees) fees = accumulatedLPFees;

        lastSweptFeePerShare = feePerShare;
        accumulatedLPFees -= fees;

        (bool success, ) = treasury.call{value: fees}("");
        if (!success) revert TransferFailed();
    }

    /// @notice Emergency withdraw ETH
    function emergencyWithdrawETH(uint256 amount, address recipient) external onlyRouterOrAdmin {
        if (amount > ethReserve) revert InsufficientETH();
        ethReserve -= amount;

        (bool success, ) = payable(recipient).call{value: amount}("");
        if (!success) revert TransferFailed();
    }

    /// @notice Send ETH to recipient (for LP withdrawal, sell, etc.)
    /// SECURITY FIX (Vuln 10): Added balance validation as defense-in-depth
    /// @dev SECURITY FIX (Vuln 2): Added nonReentrant to prevent CRE callback reentrancy.
    ///      Without this, a malicious recipient's receive() could call insertCommitmentFromCRE()
    ///      (which uses the Pair's reentrancy lock) during ETH transfer, allowing commitment
    ///      insertion in an inconsistent state.
    function sendETH(address recipient, uint256 amount) external onlyRouter nonReentrant {
        if (amount > address(this).balance) revert InsufficientETH();
        (bool success, ) = payable(recipient).call{value: amount}("");
        if (!success) revert TransferFailed();
    }

    /// @notice Add ETH to reserves (for owner bootstrap)
    function addETHReserve() external payable onlyRouterOrAdmin {
        if (bootstrapped) revert AlreadyBootstrapped();
        ethReserve += msg.value;
    }

    /// @notice Sync ETH accounting for force-sent ETH
    function syncETHAccounting() external onlyRouterOrAdmin returns (uint256 surplus) {
        uint256 actualBalance = address(this).balance;
        if (actualBalance <= ethReserve) return 0;

        surplus = actualBalance - ethReserve;
        uint256 previousReserve = ethReserve;

        accumulatedProtocolFees += surplus;
        ethReserve = actualBalance;

        emit ETHAccountingSynced(previousReserve, actualBalance, surplus);
    }

    // ============ Shorts Contract Functions ============

    /// @notice Update reserves for short position operations
    /// @dev Called by shorts contract to affect pool reserves when opening/closing shorts
    /// @param ethDelta ETH amount to change
    /// @param tokenDelta Token amount to change
    /// @param isEthIn True if ETH is coming IN (closing short), false if ETH going OUT (opening short)
    function updateReservesForShorts(
        uint256 ethDelta,
        uint256 tokenDelta,
        bool isEthIn
    ) external onlyShorts {
        if (isEthIn) {
            // Closing short: ETH comes in, tokens go out
            ethReserve += ethDelta;
            if (tokenDelta > tokenReserve) revert InsufficientLiquidity();
            tokenReserve -= tokenDelta;
        } else {
            // Opening short: ETH goes out, tokens come in
            if (ethDelta > ethReserve - MIN_LIQUIDITY) revert InsufficientLiquidity();
            ethReserve -= ethDelta;
            tokenReserve += tokenDelta;
        }
    }

    /// @notice Send ETH to shorts contract (for opening shorts)
    /// @param recipient Address to receive ETH (shorts contract)
    /// @param amount Amount of ETH to send
    /// @dev SECURITY FIX (Vuln 2): Added nonReentrant for defense-in-depth on ETH transfers.
    function sendETHForShorts(address recipient, uint256 amount) external onlyShorts nonReentrant {
        if (amount > ethReserve - MIN_LIQUIDITY) revert InsufficientLiquidity();
        ethReserve -= amount;

        (bool success, ) = payable(recipient).call{value: amount}("");
        if (!success) revert TransferFailed();
    }

    /// @notice Shorts contract sells ROOT tokens for ETH (real swap)
    /// @dev Shorts contract must have approved this contract to spend ROOT tokens
    /// @param tokenAmount Amount of ROOT tokens to sell
    /// @return ethOut Amount of ETH received
    function sellTokensForShorts(uint256 tokenAmount) external onlyShorts nonReentrant returns (uint256 ethOut) {
        if (tokenAmount == 0) revert ZeroAmount();

        // Transfer ROOT from shorts contract to this contract
        rootToken.safeTransferFrom(msg.sender, address(this), tokenAmount);

        // Calculate ETH out using AMM formula (no embedded fee - fees extracted explicitly)
        // SECURITY FIX (Vuln 18): Extract fees explicitly and distribute to protocol/LPs
        uint256 ethOutRaw = (tokenAmount * ethReserve) / (tokenReserve + tokenAmount);

        // Extract protocol and LP fees (same split as regular sells)
        uint256 protocolFee = (ethOutRaw * 30) / 10000; // 30bps protocol fee
        uint256 lpFee = (ethOutRaw * 70) / 10000;       // 70bps LP fee
        ethOut = ethOutRaw - protocolFee - lpFee;

        // Check minimum liquidity
        if (ethOut > ethReserve - MIN_LIQUIDITY) revert InsufficientLiquidity();

        // Update reserves - only decrement by ethOut (fees stay in pool accounting)
        tokenReserve += tokenAmount;
        ethReserve -= ethOut;

        // SECURITY FIX (Vuln 18): Distribute fees to protocol and LPs
        accumulatedProtocolFees += protocolFee;
        if (totalLPShares > 0) {
            feePerShare += (lpFee * FEE_PRECISION) / totalLPShares;
            accumulatedLPFees += lpFee;
        } else {
            accumulatedProtocolFees += lpFee;
        }

        // Send ETH to shorts contract
        (bool success, ) = payable(msg.sender).call{value: ethOut}("");
        if (!success) revert TransferFailed();

        emit TokensSold(tokenAmount, ethOut);
    }

    /// @notice Emitted when shorts contract sells tokens (for indexer visibility)
    event TokensSold(uint256 tokensIn, uint256 ethOut);
    /// @notice Emitted when shorts contract buys tokens back (for indexer visibility)
    event TokensPurchased(uint256 ethIn, uint256 tokensOut);

    /// @notice Shorts contract buys ROOT tokens with ETH (real swap)
    /// @dev If msg.value is insufficient, buys as many tokens as affordable (for liquidation)
    /// @param tokenAmount Amount of ROOT tokens to buy (may receive less if underfunded)
    /// @return ethUsed Amount of ETH spent
    function buyTokensForShorts(uint256 tokenAmount) external payable onlyShorts nonReentrant returns (uint256 ethUsed) {
        if (tokenAmount == 0) revert ZeroAmount();
        if (tokenAmount >= tokenReserve) revert InsufficientLiquidity();

        // SECURITY FIX (Vuln 18): Calculate ETH needed using raw AMM formula (no embedded fee)
        // Then extract fees explicitly and distribute to protocol/LPs
        uint256 ethRequiredRaw = (ethReserve * tokenAmount) / (tokenReserve - tokenAmount) + 1;

        // Add protocol + LP fees on top (same split as sells: 30bps protocol, 70bps LP)
        uint256 protocolFee = (ethRequiredRaw * 30) / 10000;
        uint256 lpFee = (ethRequiredRaw * 70) / 10000;
        uint256 ethRequired = ethRequiredRaw + protocolFee + lpFee;

        uint256 actualTokenAmount = tokenAmount;

        // If insufficient ETH, calculate how many tokens we can actually buy
        // This allows liquidation when position is severely underwater
        if (msg.value < ethRequired) {
            // Reverse AMM: given msg.value ETH, how many tokens can we get (after fees)?
            // Deduct 1% fee from input to get effective ETH for AMM
            uint256 effectiveEth = (msg.value * 10000) / 10100;
            uint256 num = effectiveEth * tokenReserve;
            uint256 denom = ethReserve + effectiveEth;
            actualTokenAmount = num / denom;

            // If we can't afford any tokens, just accept the ETH as protocol fee
            if (actualTokenAmount == 0) {
                accumulatedProtocolFees += msg.value;
                ethReserve += msg.value;
                return msg.value;
            }

            // Recalculate fees for the tokens we can actually afford
            ethRequiredRaw = (ethReserve * actualTokenAmount) / (tokenReserve - actualTokenAmount) + 1;
            protocolFee = (ethRequiredRaw * 30) / 10000;
            lpFee = (ethRequiredRaw * 70) / 10000;
            ethUsed = msg.value;
        } else {
            ethUsed = ethRequired;
        }

        // Update reserves (only raw ETH amount affects AMM curve)
        ethReserve += (ethUsed - protocolFee - lpFee);
        tokenReserve -= actualTokenAmount;

        // SECURITY FIX (Vuln 18): Distribute fees to protocol and LPs
        accumulatedProtocolFees += protocolFee;
        if (totalLPShares > 0) {
            feePerShare += (lpFee * FEE_PRECISION) / totalLPShares;
            accumulatedLPFees += lpFee;
        } else {
            accumulatedProtocolFees += lpFee;
        }

        // Transfer ROOT tokens to shorts contract
        rootToken.safeTransfer(msg.sender, actualTokenAmount);

        // Refund excess ETH
        if (msg.value > ethUsed) {
            (bool refundSuccess, ) = payable(msg.sender).call{value: msg.value - ethUsed}("");
            if (!refundSuccess) revert TransferFailed();
        }

        emit TokensPurchased(ethUsed, actualTokenAmount);
    }

    /// @notice Authorize a caller in tokenPool (for project pools)
    /// @notice Adjust the LP lock period (bounded 1 min .. 30 days). Ship short, harden later.
    function setLpLockPeriod(uint256 v) external onlyAdmin {
        require(v >= 1 minutes && v <= 30 days, "range");
        LP_LOCK_PERIOD = v;
    }

    function setTokenPoolAuthorizedCaller(address caller, bool authorized) external onlyRouterOrAdmin {
        tokenPool.setAuthorizedCaller(caller, authorized);
    }

    /// @notice Withdraw ROOT tokens to recipient (for withdrawPublic)
    function withdrawROOT(address recipient, uint256 amount) external onlyRouter {
        if (rootToken.balanceOf(address(this)) < amount) revert InsufficientLiquidity();
        rootToken.safeTransfer(recipient, amount);
    }

    /// @notice Deposit public ROOT tokens into a private commitment
    /// @dev SECURITY: Uses depositorBinding to prevent front-running attacks.
    ///      The depositorBinding is a hash of (commitment, depositor, amount) that ensures
    ///      only the intended depositor can make this deposit. Even if an attacker sees
    ///      the commitment in a pending transaction, they cannot use it because their
    ///      depositorBinding would be different (different msg.sender via router).
    /// @param amount Amount of ROOT tokens to deposit
    /// @param commitment The commitment hash = hash(nullifier, secret, amount)
    /// @param depositorBinding Hash binding commitment to depositor: keccak256(commitment, depositor, amount)
    /// @param depositor The address depositing tokens (for binding verification)
    /// @param encryptedNote Encrypted note containing nullifier, secret, amount
    /// @return leafIndex The index where commitment was inserted in merkle tree
    function depositPublic(
        uint256 amount,
        uint256 commitment,
        bytes32 depositorBinding,
        address depositor,
        bytes calldata encryptedNote
    ) external onlyRouter nonReentrant returns (uint256 leafIndex) {
        // Input validation
        if (amount == 0) revert ZeroAmount();
        if (commitment == 0) revert ZeroAmount();
        // SECURITY: Validate commitment is within SNARK scalar field
        // Commitments >= SNARK_SCALAR_FIELD cannot be spent via ZK proofs
        // This prevents users from accidentally locking their tokens forever
        if (commitment >= SNARK_SCALAR_FIELD) revert InvalidScalarField();

        // SECURITY: Verify depositor binding to prevent front-running
        // This ensures only the intended depositor can make this deposit with this commitment
        bytes32 expectedBinding = keccak256(abi.encodePacked(commitment, depositor, amount));
        if (depositorBinding != expectedBinding) revert InvalidDepositorBinding();

        // SECURITY: Transfer tokens FIRST (checks-effects-interactions)
        // safeTransferFrom will revert if depositor hasn't approved or has insufficient balance
        rootToken.safeTransferFrom(depositor, address(this), amount);

        // Insert commitment into merkle tree
        leafIndex = tokenPool.insert(commitment);

        // Emit events for indexing
        emit NewCommitment(commitment, leafIndex, encryptedNote);
        emit PublicDeposit(commitment, depositor, amount);
    }

    // ============ CRE Integration ============

    /// @notice Insert a commitment from an authorized CRE callback contract
    /// @dev Only callable by addresses authorized via ZkAMMAdmin.authorizedCRECallback
    /// @param commitment The commitment hash to insert
    /// @param encryptedNote Encrypted note data
    /// @return leafIndex The merkle tree leaf index
    function insertCommitmentFromCRE(
        uint256 commitment,
        bytes calldata encryptedNote
    ) external nonReentrant returns (uint256 leafIndex) {
        // Validate caller is an authorized CRE callback via the admin contract
        // We read directly from admin's authorizedCRECallback mapping
        (bool success, bytes memory result) = admin.staticcall(
            abi.encodeWithSignature("authorizedCRECallback(address)", msg.sender)
        );
        require(success && abi.decode(result, (bool)), "Unauthorized CRE callback");

        // Validate commitment
        if (commitment == 0) revert ZeroAmount();
        if (commitment >= SNARK_SCALAR_FIELD) revert InvalidScalarField();

        leafIndex = tokenPool.insert(commitment);
        emit NewCommitment(commitment, leafIndex, encryptedNote);
    }

    /// @notice Get ROOT token balance
    function getRootBalance() external view returns (uint256) {
        return rootToken.balanceOf(address(this));
    }

    // ============ View Functions ============

    /// @notice Get reserves
    function getReserves() external view returns (uint256 _ethReserve, uint256 _tokenReserve) {
        return (ethReserve, tokenReserve);
    }

    /// @notice Check if root is known in token pool
    function isKnownRoot(uint256 root) external view returns (bool) {
        return tokenPool.isKnownRoot(root);
    }

    /// @notice Check if root is known in LP pool
    function isKnownLPRoot(uint256 root) external view returns (bool) {
        return lpPool.isKnownRoot(root);
    }

    /// @notice Check if nullifier is spent
    function isNullifierSpent(uint256 nullifier) external view returns (bool) {
        return nullifiers[nullifier];
    }

    /// @notice Check if LP nullifier is spent
    function isLPNullifierSpent(uint256 nullifier) external view returns (bool) {
        return lpNullifiers[nullifier];
    }

    /// @notice Check if claim nullifier is spent
    function isClaimNullifierSpent(uint256 nullifier) external view returns (bool) {
        return spentClaimNullifiers[nullifier];
    }

    /// @notice Get LP commitment info
    function getLPCommitmentInfo(uint256 commitment) external view returns (
        uint256 shares,
        uint256 depositTime,
        uint256 lastClaimed,
        bool isWithdrawn,
        bool isLocked
    ) {
        shares = lpCommitmentShares[commitment];
        depositTime = lpDepositTime[commitment];
        lastClaimed = lastClaimedFeePerShare[commitment];
        isWithdrawn = lpCommitmentWithdrawn[commitment];
        isLocked = block.timestamp < depositTime + LP_LOCK_PERIOD;
    }

    /// @notice Get LP info
    function getLPInfo() external view returns (uint256 _totalShares, uint256 _feePerShare, uint256 _accumulatedFees) {
        return (totalLPShares, feePerShare, accumulatedLPFees);
    }

    /// @notice Get token pool address
    function getTokenPool() external view returns (address) {
        return address(tokenPool);
    }

    /// @notice Get LP pool address
    function getLPPool() external view returns (address) {
        return address(lpPool);
    }

    /// @notice Get circulating supply
    function getCirculatingSupply() external view returns (uint256) {
        return TOTAL_SUPPLY - tokenReserve;
    }

    /// @notice Get ETH surplus from force-sent transactions
    function getETHSurplus() public view returns (uint256 surplus) {
        uint256 actualBalance = address(this).balance;
        surplus = actualBalance > ethReserve ? actualBalance - ethReserve : 0;
    }

    /// @notice Get claimable fees for current epoch
    function getClaimableFees(uint256 lpShares) external view returns (uint256 claimable) {
        uint256 epochStartFee = feePerShareAtEpochStart[currentFeeEpoch];
        uint256 feeGrowthThisEpoch = feePerShare - epochStartFee;
        claimable = (lpShares * feeGrowthThisEpoch) / FEE_PRECISION;
        if (claimable > accumulatedLPFees) claimable = accumulatedLPFees;
    }

    /// @notice Babylonian method for integer square root
    function sqrt(uint256 x) external pure returns (uint256 y) {
        if (x == 0) return 0;
        uint256 z = (x + 1) / 2;
        y = x;
        while (z < y) {
            y = z;
            z = (x / z + z) / 2;
        }
    }

    /// @notice Receive ETH - only from router, admin, or shorts contract
    receive() external payable {
        if (msg.sender != router && msg.sender != admin && msg.sender != shortsContract) revert Unauthorized();
    }
}
