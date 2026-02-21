// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./interfaces/IZkAMMv3Pair.sol";
import "./interfaces/IZkProjectPool.sol";
import {ISellVerifier, ITransferVerifier, IWithdrawVerifier, IAddLiquidityVerifier, IRemoveLiquidityVerifier, IClaimLPFeesVerifier, ISwapVerifier, IMergeVerifier} from "./interfaces/IVerifier.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @notice Interface for ZkAMMPair (project token pools)
interface IZkAMMPair {
    function r00tReserve() external view returns (uint256);
    function tokenReserve() external view returns (uint256);
    function getAmountOut(uint256 amountIn, uint256 reserveIn, uint256 reserveOut) external view returns (uint256);
    function name() external view returns (string memory);
    function symbol() external view returns (string memory);
}

/// @notice Interface for Railgun proxy
interface IRailgunProxy {
    struct ShieldRequest {
        bytes32 npk;
        uint256 value;
        bytes encryptedRandom;
    }
    function shield(ShieldRequest[] calldata shieldRequests) external payable;
}

/// @notice Interface for Admin contract
interface IZkAMMv3Admin {
    function owner() external view returns (address);
    function treasury() external view returns (address);
    function launchpad() external view returns (address);
    function railgunProxy() external view returns (address);
    function sellVerifier() external view returns (ISellVerifier);
    function transferVerifier() external view returns (ITransferVerifier);
    function withdrawVerifier() external view returns (IWithdrawVerifier);
    function addLiquidityVerifier() external view returns (IAddLiquidityVerifier);
    function removeLiquidityVerifier() external view returns (IRemoveLiquidityVerifier);
    function claimLPFeesVerifier() external view returns (IClaimLPFeesVerifier);
    function swapVerifier() external view returns (ISwapVerifier);
    function mergeVerifier() external view returns (IMergeVerifier);
}

/// @title ZkAMMv3Router
/// @author r00t.fund
/// @notice Router contract for ZkAMMv3 - handles proof verification and user interactions
/// @dev Uses ZkAMMv3Pair for state, ZkAMMv3Admin for admin functions. This separation reduces contract size.
contract ZkAMMv3Router is ReentrancyGuard {
    // ============ Constants ============

    uint256 public constant FEE_BPS = 100;
    uint256 public constant PROTOCOL_FEE_BPS = 30;
    uint256 public constant LP_FEE_BPS = 70;
    uint256 public constant LP_ADD_PROTOCOL_FEE_BPS = 10;
    uint256 public constant FEE_DENOMINATOR = 10000;
    uint256 public constant SNARK_SCALAR_FIELD = 21888242871839275222246405745257275088548364400416034343698204186575808495617;
    uint256 public constant POOL_REGISTRATION_COOLDOWN = 1 minutes; // TESTNET: Changed from 24 hours for testing

    // ============ Immutables ============

    IZkAMMv3Pair public immutable pair;
    IZkAMMv3Admin public immutable admin;

    // ============ Project Pool Registry ============

    address[] public projectPools;
    mapping(address => bool) public isProjectPool;
    mapping(address => uint256) public poolRegistrationTime;

    // ============ Events ============

    event TokensPurchased(uint256 ethIn, uint256 tokensOut, uint256 protocolFee, uint256 lpFee);
    event TokensSold(uint256 tokensIn, uint256 ethOut, uint256 protocolFee, uint256 lpFee);
    event PrivateTransfer(uint256 transferAmount);
    event CommitmentsMerged(uint256 indexed nullifierHash1, uint256 indexed nullifierHash2, uint256 indexed outputCommitment);
    event PublicWithdrawal(uint256 indexed nullifierHash, address indexed recipient, uint256 amount);
    event PublicDeposit(uint256 indexed commitment, address indexed depositor, uint256 amount, uint256 leafIndex);
    event LiquidityAddedPrivate(uint256 indexed commitment, uint256 ethAmount, uint256 tokenAmount, uint256 lpShares);
    event LiquidityRemovedPrivate(uint256 indexed nullifierHash, uint256 ethOut, uint256 tokensOut);
    event LPFeesClaimed(uint256 indexed claimNullifier, address indexed recipient, uint256 amount, uint256 feeEpoch);
    event ProjectPoolRegistered(address indexed pool, string name, string symbol);
    event SwapETHForProjectToken(address indexed pool, uint256 ethIn, uint256 hiddenIntermediate, uint256 tokensOut);
    event SoldToRailgun(uint256 indexed nullifierHash, uint256 tokensIn, uint256 ethOut, bytes32 railgunNpk);
    event EmergencyLPWithdrawal(uint256 indexed commitment, address indexed recipient, uint256 ethOut, uint256 tokensOut);
    event ETHSwept(address indexed treasury, uint256 amount);

    // ============ Errors ============

    error NoETH();
    error SlippageExceeded();
    error InvalidProof();
    error NullifierAlreadySpent();
    error UnknownMerkleRoot();
    error InsufficientLiquidity();
    error TransferFailed();
    error Unauthorized();
    error ZeroAddress();
    error NoFeesToCollect();
    error ExcessiveFee();
    error TransactionExpired();
    error LPLocked();
    error ZeroAmount();
    error InvalidLPShares();
    error PoolNotRegistered();
    error PoolAlreadyRegistered();
    error NotLaunchpad();
    error NotImplemented();
    error AlreadyBootstrapped();
    error RailgunNotConfigured();
    error CommitmentAlreadyExists();
    error ClaimNullifierAlreadySpent();
    error PoolCooldownNotMet();
    error NothingToSweep();

    // ============ Modifiers ============

    modifier onlyOwner() {
        if (msg.sender != admin.owner()) revert Unauthorized();
        _;
    }

    modifier onlyLaunchpad() {
        if (msg.sender != admin.launchpad() && msg.sender != admin.owner()) revert NotLaunchpad();
        _;
    }

    modifier notExpired(uint256 deadline) {
        if (block.timestamp > deadline) revert TransactionExpired();
        _;
    }

    // ============ Constructor ============

    constructor(address _pair, address _admin) {
        if (_pair == address(0) || _admin == address(0)) revert ZeroAddress();
        pair = IZkAMMv3Pair(_pair);
        admin = IZkAMMv3Admin(_admin);
    }

    // ============ Buy Functions ============

    function buyPrivate(
        uint256 newCommitment,
        uint256 minTokensOut,
        uint256 deadline,
        bytes calldata encryptedNote
    ) external payable nonReentrant notExpired(deadline) {
        if (newCommitment == 0) revert ZeroAmount();
        if (newCommitment >= SNARK_SCALAR_FIELD) revert InvalidProof();
        if (msg.value == 0) revert NoETH();

        bytes32 commitmentBinding = keccak256(abi.encodePacked(newCommitment, msg.sender, msg.value));
        pair.useCommitmentBinding(commitmentBinding);

        uint256 protocolFee = (msg.value * PROTOCOL_FEE_BPS) / FEE_DENOMINATOR;
        uint256 lpFee = (msg.value * LP_FEE_BPS) / FEE_DENOMINATOR;
        uint256 amountAfterFees = msg.value - protocolFee - lpFee;

        (uint256 ethReserve, uint256 tokenReserve) = pair.getReserves();
        uint256 tokensOut = _getAmountOutRaw(amountAfterFees, ethReserve, tokenReserve);
        if (tokensOut < minTokensOut) revert SlippageExceeded();

        pair.updateReserves(amountAfterFees, tokensOut, true);
        pair.addProtocolFees(protocolFee);
        pair.distributeLPFees(lpFee);
        pair.insertCommitment(newCommitment, encryptedNote);

        (bool success, ) = address(pair).call{value: msg.value}("");
        if (!success) revert TransferFailed();

        emit TokensPurchased(msg.value, tokensOut, protocolFee, lpFee);
    }

    // ============ Sell Functions ============

    function sellPrivate(
        uint256[8] calldata proof,
        uint256 merkleRoot,
        uint256 nullifierHash,
        uint256 tokenAmount,
        uint256 minEthOut,
        address payable recipient,
        address payable relayer,
        uint256 fee,
        uint256 changeCommitment,
        uint256 publicInputsBinding, // Circuit-computed binding hash (9th public signal)
        uint256 deadline,
        bytes calldata changeNote
    ) external nonReentrant notExpired(deadline) {
        if (merkleRoot >= SNARK_SCALAR_FIELD || nullifierHash >= SNARK_SCALAR_FIELD || changeCommitment >= SNARK_SCALAR_FIELD) revert InvalidProof();
        if (publicInputsBinding >= SNARK_SCALAR_FIELD) revert InvalidProof();
        if (!pair.isKnownRoot(merkleRoot)) revert UnknownMerkleRoot();
        if (pair.isNullifierSpent(nullifierHash)) revert NullifierAlreadySpent();

        // CRITICAL FIX: pubSignals order must match circuit output order
        // Circuit outputs: [publicInputsBinding, merkleRoot, nullifierHash, tokenAmount, minEthOut, recipient, relayer, fee, changeCommitment]
        uint256[9] memory pubSignals = [publicInputsBinding, merkleRoot, nullifierHash, tokenAmount, minEthOut, uint256(uint160(address(recipient))), uint256(uint160(address(relayer))), fee, changeCommitment];
        if (!admin.sellVerifier().verifyProof(proof, pubSignals)) revert InvalidProof();

        (uint256 ethReserve, uint256 tokenReserve) = pair.getReserves();
        uint256 ethOutRaw = _getAmountOutRaw(tokenAmount, tokenReserve, ethReserve);
        if (ethOutRaw > ethReserve - pair.MIN_LIQUIDITY()) revert InsufficientLiquidity();

        uint256 protocolFee = (ethOutRaw * PROTOCOL_FEE_BPS) / FEE_DENOMINATOR;
        uint256 lpFee = (ethOutRaw * LP_FEE_BPS) / FEE_DENOMINATOR;
        uint256 ethAfterFees = ethOutRaw - protocolFee - lpFee;
        // SECURITY FIX (Vuln 17): Check slippage against actual user receipts (post-relayer-fee)
        if (fee > ethAfterFees) revert ExcessiveFee();
        if (ethAfterFees - fee < minEthOut) revert SlippageExceeded();

        pair.markNullifierSpent(nullifierHash);
        // SECURITY FIX (Vuln 11): Only decrement ethReserve by ethAfterFees (amount leaving pool)
        // Protocol/LP fees stay in the pool and are tracked separately
        pair.updateReserves(ethAfterFees, tokenAmount, false);
        pair.addProtocolFees(protocolFee);
        pair.distributeLPFees(lpFee);

        if (changeCommitment != 0) {
            pair.insertCommitment(changeCommitment, changeNote);
        }

        emit TokensSold(tokenAmount, ethOutRaw, protocolFee, lpFee);

        pair.sendETH(recipient, ethAfterFees - fee);
        if (fee > 0) {
            pair.sendETH(relayer, fee);
        }
    }

    function sellPrivateToRailgun(
        uint256[8] calldata proof,
        uint256 merkleRoot,
        uint256 nullifierHash,
        uint256 tokenAmount,
        uint256 minEthOut,
        bytes32 railgunNpk,
        bytes calldata encryptedRandom,
        uint256 changeCommitment,
        uint256 publicInputsBinding, // Circuit-computed binding hash (9th public signal)
        uint256 deadline,
        bytes calldata changeNote
    ) external nonReentrant notExpired(deadline) {
        if (merkleRoot >= SNARK_SCALAR_FIELD || nullifierHash >= SNARK_SCALAR_FIELD || changeCommitment >= SNARK_SCALAR_FIELD) revert InvalidProof();
        if (publicInputsBinding >= SNARK_SCALAR_FIELD) revert InvalidProof();

        address railgunProxyAddr = admin.railgunProxy();
        if (railgunProxyAddr == address(0)) revert RailgunNotConfigured();
        if (!pair.isKnownRoot(merkleRoot)) revert UnknownMerkleRoot();
        if (pair.isNullifierSpent(nullifierHash)) revert NullifierAlreadySpent();

        // CRITICAL FIX: pubSignals order must match circuit output order
        // Circuit outputs: [publicInputsBinding, merkleRoot, nullifierHash, tokenAmount, minEthOut, recipient(0), relayer(0), fee(0), changeCommitment]
        uint256[9] memory pubSignals = [publicInputsBinding, merkleRoot, nullifierHash, tokenAmount, minEthOut, 0, 0, 0, changeCommitment];
        if (!admin.sellVerifier().verifyProof(proof, pubSignals)) revert InvalidProof();

        (uint256 ethReserve, uint256 tokenReserve) = pair.getReserves();
        uint256 ethOutRaw = _getAmountOutRaw(tokenAmount, tokenReserve, ethReserve);
        if (ethOutRaw > ethReserve - pair.MIN_LIQUIDITY()) revert InsufficientLiquidity();

        uint256 protocolFee = (ethOutRaw * PROTOCOL_FEE_BPS) / FEE_DENOMINATOR;
        uint256 lpFee = (ethOutRaw * LP_FEE_BPS) / FEE_DENOMINATOR;
        uint256 ethAfterFees = ethOutRaw - protocolFee - lpFee;
        if (ethAfterFees < minEthOut) revert SlippageExceeded();

        pair.markNullifierSpent(nullifierHash);
        // SECURITY FIX (Vuln 11): Only decrement ethReserve by ethAfterFees
        pair.updateReserves(ethAfterFees, tokenAmount, false);
        pair.addProtocolFees(protocolFee);
        pair.distributeLPFees(lpFee);

        if (changeCommitment != 0) {
            pair.insertCommitment(changeCommitment, changeNote);
        }

        emit SoldToRailgun(nullifierHash, tokenAmount, ethAfterFees, railgunNpk);

        pair.sendETH(address(this), ethAfterFees);

        IRailgunProxy.ShieldRequest[] memory shieldRequests = new IRailgunProxy.ShieldRequest[](1);
        shieldRequests[0] = IRailgunProxy.ShieldRequest({npk: railgunNpk, value: ethAfterFees, encryptedRandom: encryptedRandom});

        // SECURITY FIX: Revert if Railgun shield fails.
        // User should use sellPrivate() instead if Railgun is unavailable.
        // Sending to msg.sender (relayer) would misdirect funds.
        IRailgunProxy(railgunProxyAddr).shield{value: ethAfterFees}(shieldRequests);
    }

    // ============ Transfer Functions ============

    function transferPrivate(
        uint256[8] calldata proof,
        uint256 merkleRoot,
        uint256 nullifierHash,
        uint256 recipientCommitment,
        uint256 changeCommitment,
        uint256 deadline,
        bytes calldata recipientNote,
        bytes calldata changeNote
    ) external nonReentrant notExpired(deadline) {
        if (merkleRoot >= SNARK_SCALAR_FIELD || nullifierHash >= SNARK_SCALAR_FIELD || recipientCommitment >= SNARK_SCALAR_FIELD || changeCommitment >= SNARK_SCALAR_FIELD) revert InvalidProof();
        if (!pair.isKnownRoot(merkleRoot)) revert UnknownMerkleRoot();
        if (pair.isNullifierSpent(nullifierHash)) revert NullifierAlreadySpent();

        uint256[4] memory pubSignals = [merkleRoot, nullifierHash, recipientCommitment, changeCommitment];
        if (!admin.transferVerifier().verifyProof(proof, pubSignals)) revert InvalidProof();

        pair.markNullifierSpent(nullifierHash);
        pair.insertCommitment(recipientCommitment, recipientNote);

        if (changeCommitment != 0) {
            pair.insertCommitment(changeCommitment, changeNote);
        }

        emit PrivateTransfer(0);
    }

    // ============ Merge Functions ============

    /// @notice Merge two commitments into one (privacy-preserving consolidation)
    /// @dev Proves ownership of 2 commitments and combines them into a single output commitment
    ///      Both input nullifiers are spent, and a new commitment with the sum of amounts is created
    /// @param proof The ZK proof [a[0], a[1], b[0][0], b[0][1], b[1][0], b[1][1], c[0], c[1]]
    /// @param merkleRoot The merkle root for both input commitments
    /// @param nullifierHash1 The nullifier hash for the first input commitment
    /// @param nullifierHash2 The nullifier hash for the second input commitment
    /// @param outputCommitment The new commitment containing the sum of both input amounts
    /// @param publicInputsBinding Circuit-computed binding hash to prevent proof malleability
    /// @param encryptedNote Encrypted note for the output commitment (contains new nullifier, secret, amount)
    function mergeCommitments(
        uint256[8] calldata proof,
        uint256 merkleRoot,
        uint256 nullifierHash1,
        uint256 nullifierHash2,
        uint256 outputCommitment,
        uint256 publicInputsBinding,
        uint256 deadline,
        bytes calldata encryptedNote
    ) external nonReentrant notExpired(deadline) {
        // Validate all public inputs are within SNARK scalar field
        if (merkleRoot >= SNARK_SCALAR_FIELD) revert InvalidProof();
        if (nullifierHash1 >= SNARK_SCALAR_FIELD) revert InvalidProof();
        if (nullifierHash2 >= SNARK_SCALAR_FIELD) revert InvalidProof();
        if (outputCommitment >= SNARK_SCALAR_FIELD) revert InvalidProof();
        if (publicInputsBinding >= SNARK_SCALAR_FIELD) revert InvalidProof();

        // Ensure nullifiers are distinct (prevents double-counting the same commitment)
        if (nullifierHash1 == nullifierHash2) revert InvalidProof();

        // Verify merkle root is known
        if (!pair.isKnownRoot(merkleRoot)) revert UnknownMerkleRoot();

        // Check neither nullifier has been spent
        if (pair.isNullifierSpent(nullifierHash1)) revert NullifierAlreadySpent();
        if (pair.isNullifierSpent(nullifierHash2)) revert NullifierAlreadySpent();

        // Get the merge verifier
        IMergeVerifier verifier = admin.mergeVerifier();
        if (address(verifier) == address(0)) revert Unauthorized();

        // Verify the ZK proof
        // Circuit outputs: [merkleRoot, nullifierHash1, nullifierHash2, outputCommitment, publicInputsBinding]
        uint256[5] memory pubSignals = [merkleRoot, nullifierHash1, nullifierHash2, outputCommitment, publicInputsBinding];
        if (!verifier.verifyProof(proof, pubSignals)) revert InvalidProof();

        // Mark both nullifiers as spent
        pair.markNullifierSpent(nullifierHash1);
        pair.markNullifierSpent(nullifierHash2);

        // Insert the new merged commitment
        pair.insertCommitment(outputCommitment, encryptedNote);

        emit CommitmentsMerged(nullifierHash1, nullifierHash2, outputCommitment);
    }

    // ============ Withdraw Functions ============

    function withdrawPublic(
        uint256[8] calldata proof,
        uint256 merkleRoot,
        uint256 nullifierHash,
        uint256 amount,
        address recipient,
        uint256 recipientBinding, // Circuit-computed binding hash
        uint256 deadline
    ) external nonReentrant notExpired(deadline) {
        if (merkleRoot >= SNARK_SCALAR_FIELD || nullifierHash >= SNARK_SCALAR_FIELD) revert InvalidProof();
        if (!pair.isKnownRoot(merkleRoot)) revert UnknownMerkleRoot();
        if (pair.isNullifierSpent(nullifierHash)) revert NullifierAlreadySpent();
        if (recipient == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();

        // CRITICAL FIX: pubSignals order must match circuit output order
        // Circuit outputs: [recipientBinding, merkleRoot, nullifierHash, amount, recipient]
        uint256[5] memory pubSignals = [recipientBinding, merkleRoot, nullifierHash, amount, uint256(uint160(recipient))];
        if (!admin.withdrawVerifier().verifyProof(proof, pubSignals)) revert InvalidProof();

        pair.markNullifierSpent(nullifierHash);
        pair.withdrawROOT(recipient, amount);

        emit PublicWithdrawal(nullifierHash, recipient, amount);
    }

    // ============ Deposit Functions ============

    /// @notice Deposit public ROOT tokens into a private commitment (shield)
    /// @dev Users must approve the pair contract to spend their ROOT tokens before calling.
    ///      The depositorBinding prevents front-running attacks by binding the commitment
    ///      to a specific depositor address. Users compute:
    ///      depositorBinding = keccak256(abi.encodePacked(commitment, msg.sender, amount))
    /// @param amount Amount of ROOT tokens to deposit
    /// @param commitment The commitment hash (created client-side with nullifier, secret, amount)
    /// @param depositorBinding Hash binding commitment to depositor for front-running protection
    /// @param encryptedNote Encrypted note for commitment recovery (contains nullifier, secret, amount)
    function depositPublic(
        uint256 amount,
        uint256 commitment,
        bytes32 depositorBinding,
        bytes calldata encryptedNote
    ) external nonReentrant {
        // Input validation
        if (amount == 0) revert ZeroAmount();
        if (commitment == 0) revert ZeroAmount();
        // SECURITY: Validate commitment is within SNARK scalar field
        // Commitments >= SNARK_SCALAR_FIELD cannot be spent via ZK proofs
        // This prevents users from accidentally locking their tokens forever
        if (commitment >= SNARK_SCALAR_FIELD) revert InvalidProof();

        // Call pair's depositPublic - it will verify depositorBinding and transfer tokens
        uint256 leafIndex = pair.depositPublic(
            amount,
            commitment,
            depositorBinding,
            msg.sender,
            encryptedNote
        );

        emit PublicDeposit(commitment, msg.sender, amount, leafIndex);
    }

    // ============ LP Functions ============

    function addLiquidityPrivate(
        uint256[8] calldata proof,
        uint256 merkleRoot,
        uint256 nullifierHash,
        uint256 tokenAmount,
        uint256 lpCommitment,
        uint256 changeCommitment,
        uint256 userLpShares, // LP shares the user used when creating their commitment
        uint256 publicInputsBinding, // Circuit-computed binding hash
        uint256 deadline,
        bytes calldata lpNote,
        bytes calldata changeNote
    ) external payable nonReentrant notExpired(deadline) {
        IAddLiquidityVerifier verifier = admin.addLiquidityVerifier();
        if (address(verifier) == address(0)) revert Unauthorized();

        if (merkleRoot >= SNARK_SCALAR_FIELD || nullifierHash >= SNARK_SCALAR_FIELD || lpCommitment >= SNARK_SCALAR_FIELD || changeCommitment >= SNARK_SCALAR_FIELD) revert InvalidProof();
        if (publicInputsBinding >= SNARK_SCALAR_FIELD) revert InvalidProof();
        if (msg.value == 0) revert NoETH();
        if (tokenAmount == 0) revert ZeroAmount();
        if (userLpShares == 0) revert InvalidLPShares();
        if (!pair.isKnownRoot(merkleRoot)) revert UnknownMerkleRoot();
        if (pair.isNullifierSpent(nullifierHash)) revert NullifierAlreadySpent();

        uint256 protocolFee = (msg.value * LP_ADD_PROTOCOL_FEE_BPS) / FEE_DENOMINATOR;
        uint256 ethAfterFee = msg.value - protocolFee;

        (uint256 ethReserve, uint256 tokenReserve) = pair.getReserves();
        uint256 totalLPShares = pair.totalLPShares();

        if (totalLPShares > 0) {
            uint256 expectedTokens = (ethAfterFee * tokenReserve) / ethReserve;
            if (tokenAmount < (expectedTokens * 99) / 100 || tokenAmount > (expectedTokens * 101) / 100) revert SlippageExceeded();
        }

        // CRITICAL FIX: pubSignals order must match circuit output order
        // Circuit outputs: [publicInputsBinding, merkleRoot, nullifierHash, tokenAmount, lpCommitment, changeCommitment]
        uint256[6] memory pubSignals = [publicInputsBinding, merkleRoot, nullifierHash, tokenAmount, lpCommitment, changeCommitment];
        if (!verifier.verifyProof(proof, pubSignals)) revert InvalidProof();

        // Calculate expected LP shares based on current reserves
        uint256 calculatedLpShares;
        if (totalLPShares == 0) {
            calculatedLpShares = pair.sqrt(ethAfterFee * tokenAmount);
        } else {
            uint256 ethRatio = (ethAfterFee * totalLPShares) / ethReserve;
            uint256 tokenRatio = (tokenAmount * totalLPShares) / tokenReserve;
            calculatedLpShares = ethRatio < tokenRatio ? ethRatio : tokenRatio;
        }

        if (calculatedLpShares == 0) revert InvalidLPShares();

        // SECURITY: Only enforce upper bound - user cannot claim MORE than calculated (prevents inflation)
        // No minimum tolerance needed: if user commits to fewer shares due to race condition between
        // proof generation and tx execution, they only hurt themselves (get less withdrawal + fewer fees)
        // This eliminates the race condition issue without any tolerance requirement
        if (userLpShares > calculatedLpShares) revert InvalidLPShares();

        (, , , bool isWithdrawn, ) = pair.getLPCommitmentInfo(lpCommitment);

        pair.markNullifierSpent(nullifierHash);
        pair.addProtocolFees(protocolFee);
        pair.updateReserves(ethAfterFee, 0, true);    // ETH goes into pool
        pair.updateReserves(0, tokenAmount, false);   // Tokens go into pool (from user's commitment)
        pair.addLPShares(userLpShares); // Use user's value, not calculated
        pair.recordLPCommitment(lpCommitment, userLpShares, isWithdrawn); // Store user's value
        pair.insertLPCommitment(lpCommitment, userLpShares, lpNote); // Store user's value

        if (changeCommitment != 0) {
            pair.insertCommitment(changeCommitment, changeNote);
        }

        (bool success, ) = address(pair).call{value: msg.value}("");
        if (!success) revert TransferFailed();

        emit LiquidityAddedPrivate(lpCommitment, msg.value, tokenAmount, userLpShares);
    }

    function bootstrapLiquidity(
        uint256 lpCommitment,
        uint256 minLPShares,
        uint256 deadline,
        bytes calldata lpNote
    ) external payable onlyOwner nonReentrant notExpired(deadline) {
        if (pair.bootstrapped()) revert AlreadyBootstrapped();
        if (msg.value < pair.MIN_LIQUIDITY()) revert NoETH();
        if (lpCommitment == 0 || lpCommitment >= SNARK_SCALAR_FIELD) revert InvalidProof();

        (uint256 depositTime, , , , ) = pair.getLPCommitmentInfo(lpCommitment);
        if (depositTime != 0) revert CommitmentAlreadyExists();

        uint256 lpShares = msg.value;
        uint256 burnedShares = lpShares / 10;
        uint256 ownerShares = lpShares - burnedShares;

        if (ownerShares < minLPShares) revert SlippageExceeded();

        pair.bootstrap{value: msg.value}(lpCommitment, ownerShares, burnedShares, lpNote);
    }

    function removeLiquidityPrivate(
        uint256[8] calldata proof,
        uint256 merkleRoot,
        uint256 nullifierHash,
        uint256 commitment,
        uint256 lpShares,
        uint256 minEthOut,
        address payable recipient,
        uint256 tokenCommitment,
        uint256 changeLPCommitment,
        uint256 tokensOut, // Tokens out claimed by user (validated against calculated)
        uint256 publicInputsBinding, // Circuit-computed binding hash
        uint256 deadline,
        bytes calldata tokenNote,
        bytes calldata changeNote
    ) external nonReentrant notExpired(deadline) {
        if (merkleRoot >= SNARK_SCALAR_FIELD || nullifierHash >= SNARK_SCALAR_FIELD || commitment >= SNARK_SCALAR_FIELD || tokenCommitment >= SNARK_SCALAR_FIELD) revert InvalidProof();
        if (changeLPCommitment != 0 && changeLPCommitment >= SNARK_SCALAR_FIELD) revert InvalidProof();
        if (publicInputsBinding >= SNARK_SCALAR_FIELD) revert InvalidProof();

        if (!pair.isKnownLPRoot(merkleRoot)) revert UnknownMerkleRoot();
        if (pair.isLPNullifierSpent(nullifierHash)) revert NullifierAlreadySpent();
        if (lpShares == 0 || tokenCommitment == 0) revert ZeroAmount();
        if (recipient == address(0)) revert ZeroAddress();

        (uint256 storedShares, , , , bool isLocked) = pair.getLPCommitmentInfo(commitment);
        // Allow partial withdrawals: lpShares must be > 0 and <= storedShares
        if (storedShares == 0 || lpShares > storedShares) revert InvalidLPShares();
        // If partial withdrawal, must provide change commitment for remaining shares
        if (lpShares < storedShares && changeLPCommitment == 0) revert InvalidLPShares();
        if (isLocked) revert LPLocked();

        IRemoveLiquidityVerifier verifier = admin.removeLiquidityVerifier();
        if (address(verifier) == address(0)) revert NotImplemented();

        // Calculate fair share of tokens based on current reserves
        (uint256 ethReserve, uint256 tokenReserve) = pair.getReserves();
        uint256 totalLPShares = pair.totalLPShares();
        uint256 ethOut = (lpShares * ethReserve) / totalLPShares;
        uint256 calculatedTokensOut = (lpShares * tokenReserve) / totalLPShares;

        // SECURITY: User's tokensOut must not exceed their fair share
        // This prevents inflation attacks while allowing proofs generated with slightly stale reserves
        if (tokensOut > calculatedTokensOut) revert SlippageExceeded();

        // CRITICAL FIX: pubSignals order must match circuit output order
        // Circuit outputs: [publicInputsBinding, lpMerkleRoot, nullifierHash, commitment, withdrawShares, minEthOut, recipient, changeCommitment, tokenCommitment, tokensOut]
        // SECURITY FIX: Now includes tokenCommitment and tokensOut to verify token commitment integrity
        // Uses user's tokensOut (validated above) so proof verifies with the value used during proof generation
        uint256[10] memory pubSignals = [publicInputsBinding, merkleRoot, nullifierHash, commitment, lpShares, minEthOut, uint256(uint160(address(recipient))), changeLPCommitment, tokenCommitment, tokensOut];
        if (!verifier.verifyProof(proof, pubSignals)) revert InvalidProof();

        if (ethOut < minEthOut) revert SlippageExceeded();
        if (ethOut > ethReserve - pair.MIN_LIQUIDITY()) revert InsufficientLiquidity();

        pair.markLPNullifierSpent(nullifierHash);
        // BUGFIX: Must use two calls - both ETH and tokens LEAVE the pool
        // Previously used single call with isEthIn=false which INCREASED tokenReserve
        pair.updateReserves(ethOut, 0, false);      // ETH leaves pool: ethReserve -= ethOut
        pair.updateReserves(0, tokensOut, true);     // Tokens leave pool: tokenReserve -= tokensOut
        pair.removeLPShares(lpShares);

        uint256 originalShares = pair.clearLPCommitment(commitment);

        pair.insertCommitment(tokenCommitment, tokenNote);

        if (changeLPCommitment != 0) {
            (uint256 changeDepositTime, , , , ) = pair.getLPCommitmentInfo(changeLPCommitment);
            if (changeDepositTime != 0) revert CommitmentAlreadyExists();

            uint256 changeShares = originalShares - lpShares;
            // Prevent zero-share LP commitments from being created
            if (changeShares == 0) revert InvalidLPShares();

            pair.addLPShares(changeShares);
            pair.recordLPCommitment(changeLPCommitment, changeShares, false);
            pair.insertLPCommitment(changeLPCommitment, changeShares, changeNote);
        }

        emit LiquidityRemovedPrivate(nullifierHash, ethOut, tokensOut);
        pair.sendETH(recipient, ethOut);
    }

    function claimLPFees(
        uint256[8] calldata proof,
        uint256 lpMerkleRoot,
        uint256 claimNullifier,
        uint256 lpShares,
        address payable recipient,
        uint256 publicInputsBinding, // Circuit-computed binding hash
        uint256 deadline // SECURITY FIX (Vuln 10): Add deadline to prevent stale claims
    ) external nonReentrant {
        // SECURITY FIX (Vuln 10): Enforce deadline to prevent fee claims at stale prices
        if (block.timestamp > deadline) revert TransactionExpired();
        if (recipient == address(0)) revert ZeroAddress();
        if (lpShares == 0) revert ZeroAmount();
        if (lpMerkleRoot >= SNARK_SCALAR_FIELD || claimNullifier >= SNARK_SCALAR_FIELD) revert InvalidProof();
        if (publicInputsBinding >= SNARK_SCALAR_FIELD) revert InvalidProof();

        // Defense-in-depth: lpShares cannot exceed total LP shares in the system
        // This prevents potential circuit bugs from draining fees
        if (lpShares > pair.totalLPShares()) revert InvalidLPShares();

        if (pair.isClaimNullifierSpent(claimNullifier)) revert ClaimNullifierAlreadySpent();

        IClaimLPFeesVerifier verifier = admin.claimLPFeesVerifier();
        if (address(verifier) == address(0)) revert NotImplemented();
        if (!pair.isKnownLPRoot(lpMerkleRoot)) revert UnknownMerkleRoot();

        uint256 currentEpoch = pair.currentFeeEpoch();

        // CRITICAL FIX: pubSignals order must match circuit output order
        // Circuit outputs: [publicInputsBinding, lpMerkleRoot, claimNullifier, feeEpoch, lpShares, recipient]
        uint256[6] memory pubSignals = [publicInputsBinding, lpMerkleRoot, claimNullifier, currentEpoch, lpShares, uint256(uint160(address(recipient)))];
        if (!verifier.verifyProof(proof, pubSignals)) revert InvalidProof();

        uint256 claimable = pair.getClaimableFees(lpShares);
        if (claimable == 0) revert NoFeesToCollect();

        pair.markClaimNullifierSpent(claimNullifier);
        pair.deductLPFees(claimable);

        emit LPFeesClaimed(claimNullifier, recipient, claimable, currentEpoch);
        pair.sendETH(recipient, claimable);
    }

    // NOTE: Emergency LP withdrawal commented out - with userLpShares fix, new positions should work correctly
    // Uncomment if needed for legacy broken positions
    //
    // /// @notice Emergency LP withdrawal for broken positions (commitment/stored value mismatch)
    // /// @dev Admin-only, bypasses circuit verification, uses on-chain stored values
    // /// @param commitment The LP commitment to withdraw
    // /// @param recipient Where to send ETH
    // /// @param tokenCommitment New commitment for tokens (user provides with their secret)
    // /// @param tokenNote Encrypted note for token commitment
    // function emergencyRemoveLiquidityAdmin(
    //     uint256 commitment,
    //     address payable recipient,
    //     uint256 tokenCommitment,
    //     bytes calldata tokenNote
    // ) external onlyOwner nonReentrant {
    //     // Validate inputs
    //     if (commitment == 0 || commitment >= SNARK_SCALAR_FIELD) revert InvalidProof();
    //     if (tokenCommitment == 0 || tokenCommitment >= SNARK_SCALAR_FIELD) revert InvalidProof();
    //     if (recipient == address(0)) revert ZeroAddress();
    //
    //     // Get LP commitment info from on-chain storage
    //     (uint256 storedShares, , , bool isWithdrawn, ) = pair.getLPCommitmentInfo(commitment);
    //     if (storedShares == 0) revert InvalidLPShares();
    //     if (isWithdrawn) revert InvalidLPShares(); // Already withdrawn
    //
    //     // Calculate outputs based on stored shares
    //     (uint256 ethReserve, uint256 tokenReserve) = pair.getReserves();
    //     uint256 totalLPShares = pair.totalLPShares();
    //     uint256 ethOut = (storedShares * ethReserve) / totalLPShares;
    //     uint256 tokensOut = (storedShares * tokenReserve) / totalLPShares;
    //
    //     // Ensure minimum liquidity is maintained
    //     if (ethOut > ethReserve - pair.MIN_LIQUIDITY()) revert InsufficientLiquidity();
    //
    //     // Update state - no nullifier to mark (admin bypass)
    //     pair.updateReserves(ethOut, tokensOut, false);
    //     pair.removeLPShares(storedShares);
    //     pair.clearLPCommitment(commitment);
    //
    //     // Create token commitment for user (they keep their tokens as a new UTXO)
    //     pair.insertCommitment(tokenCommitment, tokenNote);
    //
    //     // Send ETH directly to recipient
    //     emit EmergencyLPWithdrawal(commitment, recipient, ethOut, tokensOut);
    //     pair.sendETH(recipient, ethOut);
    // }

    // ============ Sweep Functions ============

    /// @notice Sweep any ETH accidentally sent to this contract to treasury
    /// @dev SECURITY FIX: Prevents ETH from being permanently stuck in router
    function sweepETH() external onlyOwner nonReentrant {
        uint256 balance = address(this).balance;
        if (balance == 0) revert NothingToSweep();

        address treasury = admin.treasury();
        if (treasury == address(0)) revert ZeroAddress();

        (bool success, ) = treasury.call{value: balance}("");
        if (!success) revert TransferFailed();

        emit ETHSwept(treasury, balance);
    }

    // ============ Project Pool Functions ============

    function registerProjectPool(address pool) external onlyLaunchpad {
        if (pool == address(0)) revert ZeroAddress();
        if (isProjectPool[pool]) revert PoolAlreadyRegistered();

        projectPools.push(pool);
        isProjectPool[pool] = true;
        poolRegistrationTime[pool] = block.timestamp;

        pair.setTokenPoolAuthorizedCaller(pool, true);

        emit ProjectPoolRegistered(pool, IZkAMMPair(pool).name(), IZkAMMPair(pool).symbol());
    }

    /// @notice Execute atomic swap ETH -> R00T -> Project Token in a single transaction
    /// @dev Creates ephemeral R00T commitment that is immediately spent in the project pool
    /// @param pool The project pool to swap into
    /// @param minR00TOut Minimum R00T tokens from ETH->R00T leg (slippage protection)
    /// @param minTokensOut Minimum project tokens to receive (slippage protection)
    /// @param projectTokenCommitment The output commitment for project tokens
    /// @param deadline Transaction deadline
    /// @param encryptedNote Encrypted note for the commitment
    /// @param userEntropy User-provided entropy for commitment generation
    function swapETHForProjectToken(
        address pool,
        uint256 minR00TOut,
        uint256 minTokensOut,
        uint256 projectTokenCommitment,
        uint256 deadline,
        bytes calldata encryptedNote,
        bytes32 userEntropy
    ) external payable nonReentrant notExpired(deadline) {
        if (projectTokenCommitment >= SNARK_SCALAR_FIELD) revert InvalidProof();
        if (msg.value == 0) revert NoETH();
        if (!isProjectPool[pool]) revert PoolNotRegistered();
        if (projectTokenCommitment == 0) revert ZeroAmount();
        if (block.timestamp < poolRegistrationTime[pool] + POOL_REGISTRATION_COOLDOWN) revert PoolCooldownNotMet();

        uint256 protocolFee = (msg.value * PROTOCOL_FEE_BPS) / FEE_DENOMINATOR;
        uint256 lpFee = (msg.value * LP_FEE_BPS) / FEE_DENOMINATOR;
        uint256 ethAfterFees = msg.value - protocolFee - lpFee;

        (uint256 ethReserve, uint256 tokenReserve) = pair.getReserves();
        uint256 r00tAmount = _getAmountOutRaw(ethAfterFees, ethReserve, tokenReserve);
        if (r00tAmount == 0) revert ZeroAmount();
        if (r00tAmount < minR00TOut) revert SlippageExceeded();

        // Generate ephemeral R00T commitment (created and spent atomically in same tx)
        // Uses multiple entropy sources for uniqueness, but security comes from:
        // 1. User's projectTokenCommitment secret (attacker can't steal value without knowing it)
        // 2. minTokensOut slippage protection (prevents sandwich attacks)
        // 3. Atomic execution (commitment never exists in mempool)
        uint256 currentNonce = pair.useAtomicSwapNonce();
        uint256 r00tCommitment = uint256(keccak256(abi.encodePacked(
            blockhash(block.number - 1),
            block.prevrandao,
            msg.sender,
            r00tAmount,
            projectTokenCommitment,
            userEntropy,
            currentNonce
        ))) % SNARK_SCALAR_FIELD;
        uint256 r00tNullifier = uint256(keccak256(abi.encodePacked(r00tCommitment, "nullifier"))) % SNARK_SCALAR_FIELD;

        pair.updateReserves(ethAfterFees, r00tAmount, true);
        pair.addProtocolFees(protocolFee);
        pair.distributeLPFees(lpFee);
        pair.markNullifierSpent(r00tNullifier);

        (bool success, ) = address(pair).call{value: msg.value}("");
        if (!success) revert TransferFailed();

        uint256 tokensOut = IZkProjectPool(pool).atomicSwapFromR00T(r00tAmount, r00tNullifier, minTokensOut, projectTokenCommitment, encryptedNote);

        bytes memory placeholderNote = abi.encodePacked(keccak256(abi.encodePacked("atomic_swap_placeholder", r00tCommitment, block.timestamp)));
        pair.insertCommitment(r00tCommitment, placeholderNote);

        emit SwapETHForProjectToken(pool, msg.value, r00tAmount, tokensOut);
    }

    // ============ View Functions ============
    // Note: getProjectPools(), getProjectPoolCount(), getETHToProjectTokenQuote() removed
    // to fit within EIP-170 size limit. Use projectPools(i) public getter + pair.getAmountOut() directly.

    /// @notice AMM output with built-in fee (for external price queries only)
    function getAmountOut(uint256 amountIn, uint256 reserveIn, uint256 reserveOut) public pure returns (uint256 amountOut) {
        uint256 amountInWithFee = amountIn * (FEE_DENOMINATOR - FEE_BPS);
        uint256 numerator = amountInWithFee * reserveOut;
        uint256 denominator = reserveIn * FEE_DENOMINATOR + amountInWithFee;
        amountOut = numerator / denominator;
    }

    /// @notice Raw AMM output without fee (used internally when fees are applied explicitly)
    function _getAmountOutRaw(uint256 amountIn, uint256 reserveIn, uint256 reserveOut) internal pure returns (uint256) {
        return (amountIn * reserveOut) / (reserveIn + amountIn);
    }

    /// @notice Only accept ETH from pair contract (not arbitrary senders)
    receive() external payable {
        if (msg.sender != address(pair)) revert Unauthorized();
    }
}
