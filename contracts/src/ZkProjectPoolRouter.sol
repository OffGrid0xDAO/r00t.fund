// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./interfaces/IZkProjectPoolCore.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title ZkProjectPoolRouter
/// @author r00t.fund
/// @notice Stateless router for ZkProjectPool user-facing operations
/// @dev This router is deployed ONCE and works with ALL ZkProjectPoolCore instances.
///      It handles:
///      - Public bridge: depositPublic, withdrawPublic, claimDevAllocation
///      - Fee collection: collectPlatformFees, collectCreatorFees, claimLPFees
///      - Atomic swaps: atomicSwapFromR00T
///      - Claim processing: processR00tClaim, emergencyProcessR00tClaim
///
/// Split Architecture:
/// - ZkProjectPoolCore: Core AMM logic, state, view functions (~12KB)
/// - ZkProjectPoolRouter (this): User-facing ops, deployed once, shared (~8KB)
contract ZkProjectPoolRouter is ReentrancyGuard {
    // ============ Events ============

    event RouterWithdrawPublic(address indexed pool, uint256 indexed nullifierHash, address indexed recipient, uint256 amount);
    event RouterDepositPublic(address indexed pool, uint256 indexed commitment, address indexed depositor, uint256 amount);
    event RouterDevAllocationClaimed(address indexed pool, uint256 indexed commitment, address indexed creator, uint256 amount);
    event RouterPlatformFeesCollected(address indexed pool, uint256 claimId, uint256 amount);
    event RouterCreatorFeesCollected(address indexed pool, uint256 claimId, uint256 amount);
    event RouterLPFeesClaimed(address indexed pool, uint256 indexed commitment, uint256 claimId, uint256 amount);
    event RouterR00tClaimProcessed(address indexed pool, uint256 indexed claimId);
    event RouterAtomicSwap(address indexed pool, uint256 r00tAmount, uint256 tokensOut);

    // ============ Errors ============

    error ZeroAddress();
    error InvalidPool();
    error Unauthorized();

    // ============ Public Bridge Functions ============

    /// @notice Withdraw project tokens from privacy pool to public ERC20
    /// @param pool The ZkProjectPoolCore address
    /// @param proof ZK proof of commitment ownership
    /// @param merkleRoot Merkle root of project token pool
    /// @param nullifierHash Nullifier to prevent double-spending
    /// @param amount Amount of tokens to withdraw
    /// @param recipient Public address to receive ERC20 tokens
    /// @param recipientBinding Circuit-computed binding hash for front-running protection
    function withdrawPublic(
        address pool,
        uint256[8] calldata proof,
        uint256 merkleRoot,
        uint256 nullifierHash,
        uint256 amount,
        address recipient,
        uint256 recipientBinding
    ) external nonReentrant {
        if (pool == address(0)) revert ZeroAddress();

        IZkProjectPoolCore(pool).routerWithdrawPublic(
            proof,
            merkleRoot,
            nullifierHash,
            amount,
            recipient,
            recipientBinding
        );

        emit RouterWithdrawPublic(pool, nullifierHash, recipient, amount);
    }

    /// @notice Deposit ERC20 tokens into the privacy pool
    /// @param pool The ZkProjectPoolCore address
    /// @param amount Amount of tokens to deposit
    /// @param commitment New commitment for the deposited tokens
    /// @param depositorBinding Hash binding commitment to depositor
    /// @param encryptedNote Encrypted note for commitment recovery
    function depositPublic(
        address pool,
        uint256 amount,
        uint256 commitment,
        bytes32 depositorBinding,
        bytes calldata encryptedNote
    ) external nonReentrant {
        if (pool == address(0)) revert ZeroAddress();

        IZkProjectPoolCore(pool).routerDepositPublic(
            amount,
            commitment,
            depositorBinding,
            msg.sender,
            encryptedNote
        );

        emit RouterDepositPublic(pool, commitment, msg.sender, amount);
    }

    /// @notice Claim dev allocation as a private commitment
    /// @param pool The ZkProjectPoolCore address
    /// @param commitment Commitment for dev allocation
    /// @param amount Amount to claim (must not exceed vested amount)
    /// @param encryptedNote Encrypted note for commitment recovery
    function claimDevAllocation(
        address pool,
        uint256 commitment,
        uint256 amount,
        bytes calldata encryptedNote
    ) external nonReentrant {
        if (pool == address(0)) revert ZeroAddress();

        IZkProjectPoolCore(pool).routerClaimDevAllocation(
            commitment,
            amount,
            msg.sender,
            encryptedNote
        );

        emit RouterDevAllocationClaimed(pool, commitment, msg.sender, amount);
    }

    // ============ Fee Collection Functions ============

    /// @notice Collect accumulated platform fees as a pending R00T claim
    /// @param pool The ZkProjectPoolCore address
    /// @param outputCommitment Commitment for receiving R00T
    /// @param encryptedNote Encrypted note for commitment recovery
    /// @return claimId The ID of the registered claim
    function collectPlatformFees(
        address pool,
        uint256 outputCommitment,
        bytes calldata encryptedNote
    ) external nonReentrant returns (uint256 claimId) {
        if (pool == address(0)) revert ZeroAddress();

        claimId = IZkProjectPoolCore(pool).routerCollectPlatformFees(
            outputCommitment,
            msg.sender,
            encryptedNote
        );

        emit RouterPlatformFeesCollected(pool, claimId, IZkProjectPoolCore(pool).accumulatedPlatformFees());
    }

    /// @notice Collect accumulated creator fees as a pending R00T claim
    /// @param pool The ZkProjectPoolCore address
    /// @param outputCommitment Commitment for receiving R00T
    /// @param encryptedNote Encrypted note for commitment recovery
    /// @return claimId The ID of the registered claim
    function collectCreatorFees(
        address pool,
        uint256 outputCommitment,
        bytes calldata encryptedNote
    ) external nonReentrant returns (uint256 claimId) {
        if (pool == address(0)) revert ZeroAddress();

        claimId = IZkProjectPoolCore(pool).routerCollectCreatorFees(
            outputCommitment,
            msg.sender,
            encryptedNote
        );

        emit RouterCreatorFeesCollected(pool, claimId, IZkProjectPoolCore(pool).accumulatedCreatorFees());
    }

    /// @notice Claim accumulated LP fees for a commitment
    /// @param pool The ZkProjectPoolCore address
    /// @param proof ZK proof of LP commitment ownership
    /// @param lpMerkleRoot LP merkle root for proof verification
    /// @param claimNullifier Nullifier to prevent double-claiming
    /// @param feeEpoch The fee epoch for this claim
    /// @param lpShares Amount of LP shares in the commitment
    /// @param commitment The LP commitment claiming fees
    /// @param outputCommitment Commitment for receiving R00T fees
    /// @param publicInputsBinding Circuit-computed binding hash
    /// @param encryptedNote Encrypted note for commitment recovery
    /// @return claimId The ID of the registered claim
    function claimLPFees(
        address pool,
        uint256[8] calldata proof,
        uint256 lpMerkleRoot,
        uint256 claimNullifier,
        uint256 feeEpoch,
        uint256 lpShares,
        uint256 commitment,
        uint256 outputCommitment,
        uint256 publicInputsBinding,
        bytes calldata encryptedNote
    ) external nonReentrant returns (uint256 claimId) {
        if (pool == address(0)) revert ZeroAddress();

        claimId = IZkProjectPoolCore(pool).routerClaimLPFees(
            proof,
            lpMerkleRoot,
            claimNullifier,
            feeEpoch,
            lpShares,
            commitment,
            outputCommitment,
            msg.sender,
            publicInputsBinding,
            encryptedNote
        );

        emit RouterLPFeesClaimed(pool, commitment, claimId, 0);
    }

    // ============ R00T Claim Processing ============

    /// @notice Process a pending R00T claim (governance only)
    /// @param pool The ZkProjectPoolCore address
    /// @param claimId The claim ID to process
    function processR00tClaim(
        address pool,
        uint256 claimId
    ) external nonReentrant {
        if (pool == address(0)) revert ZeroAddress();

        IZkProjectPoolCore(pool).routerProcessR00tClaim(claimId, msg.sender);

        emit RouterR00tClaimProcessed(pool, claimId);
    }

    /// @notice Emergency process a pending R00T claim after delay (anyone)
    /// @param pool The ZkProjectPoolCore address
    /// @param claimId The claim ID to process
    function emergencyProcessR00tClaim(
        address pool,
        uint256 claimId
    ) external nonReentrant {
        if (pool == address(0)) revert ZeroAddress();

        IZkProjectPoolCore(pool).routerEmergencyProcessR00tClaim(claimId);

        emit RouterR00tClaimProcessed(pool, claimId);
    }

    // ============ Atomic Swap Functions ============

    /// @notice Perform atomic swap from R00T to project token
    /// @dev Only callable by the authorized atomic swapper (ZkAMMv3)
    /// @param pool The ZkProjectPoolCore address
    /// @param r00tAmount Amount of R00T being swapped
    /// @param r00tNullifier Nullifier for the R00T commitment
    /// @param minTokensOut Minimum project tokens to receive
    /// @param outputCommitment Commitment for the project tokens received
    /// @param encryptedNote Encrypted note for commitment recovery
    /// @return tokensOut Amount of project tokens received
    function atomicSwapFromR00T(
        address pool,
        uint256 r00tAmount,
        uint256 r00tNullifier,
        uint256 minTokensOut,
        uint256 outputCommitment,
        bytes calldata encryptedNote
    ) external nonReentrant returns (uint256 tokensOut) {
        if (pool == address(0)) revert ZeroAddress();

        tokensOut = IZkProjectPoolCore(pool).routerAtomicSwapFromR00T(
            r00tAmount,
            r00tNullifier,
            minTokensOut,
            outputCommitment,
            msg.sender,
            encryptedNote
        );

        emit RouterAtomicSwap(pool, r00tAmount, tokensOut);
    }

    // ============ Governance Functions (via Router) ============

    /// @notice Set swap verifier on a pool (governance only)
    /// @param pool The ZkProjectPoolCore address
    /// @param verifier The verifier address
    function setSwapVerifier(address pool, address verifier) external {
        if (pool == address(0)) revert ZeroAddress();
        // SECURITY FIX: Verify caller is the pool's governance
        if (msg.sender != IZkProjectPoolCore(pool).governance()) revert Unauthorized();
        IZkProjectPoolCore(pool).setSwapVerifier(verifier);
    }

    /// @notice Set LP withdraw verifier on a pool (governance only)
    /// @param pool The ZkProjectPoolCore address
    /// @param verifier The verifier address
    function setLPWithdrawVerifier(address pool, address verifier) external {
        if (pool == address(0)) revert ZeroAddress();
        if (msg.sender != IZkProjectPoolCore(pool).governance()) revert Unauthorized();
        IZkProjectPoolCore(pool).setLPWithdrawVerifier(verifier);
    }

    /// @notice Set withdraw verifier on a pool (governance only)
    /// @param pool The ZkProjectPoolCore address
    /// @param verifier The verifier address
    function setWithdrawVerifier(address pool, address verifier) external {
        if (pool == address(0)) revert ZeroAddress();
        if (msg.sender != IZkProjectPoolCore(pool).governance()) revert Unauthorized();
        IZkProjectPoolCore(pool).setWithdrawVerifier(verifier);
    }

    /// @notice Set claim LP fees verifier on a pool (governance only)
    /// @param pool The ZkProjectPoolCore address
    /// @param verifier The verifier address
    function setClaimLPFeesVerifier(address pool, address verifier) external {
        if (pool == address(0)) revert ZeroAddress();
        if (msg.sender != IZkProjectPoolCore(pool).governance()) revert Unauthorized();
        IZkProjectPoolCore(pool).setClaimLPFeesVerifier(verifier);
    }

    /// @notice Set authorized atomic swapper on a pool (governance only)
    /// @param pool The ZkProjectPoolCore address
    /// @param swapper The authorized swapper address (ZkAMMv3)
    function setAuthorizedAtomicSwapper(address pool, address swapper) external {
        if (pool == address(0)) revert ZeroAddress();
        if (msg.sender != IZkProjectPoolCore(pool).governance()) revert Unauthorized();
        IZkProjectPoolCore(pool).setAuthorizedAtomicSwapper(swapper);
    }

    // ============ View Functions (Convenience) ============

    /// @notice Get pool reserves
    function getReserves(address pool) external view returns (uint256 r00tReserve, uint256 tokenReserve) {
        return IZkProjectPoolCore(pool).getReserves();
    }

    /// @notice Get token price in R00T
    function getTokenPrice(address pool) external view returns (uint256) {
        return IZkProjectPoolCore(pool).getTokenPrice();
    }

    /// @notice Get LP info
    function getLPInfo(address pool) external view returns (uint256 totalShares, uint256 feePerShare, uint256 accumulatedFees) {
        return IZkProjectPoolCore(pool).getLPInfo();
    }

    /// @notice Get pending claim details
    function getPendingClaim(address pool, uint256 claimId) external view returns (
        uint256 amount,
        uint256 outputCommitment,
        bool claimed,
        uint256 createdAt
    ) {
        return IZkProjectPoolCore(pool).getPendingClaim(claimId);
    }

    /// @notice Get vested dev allocation
    function getVestedDevAllocation(address pool) external view returns (uint256 vestedAmount, uint256 claimableNow) {
        return IZkProjectPoolCore(pool).getVestedDevAllocation();
    }

    /// @notice Check reserve health
    function checkReserveHealth(address pool) external view returns (bool healthy, uint256 totalObligations, uint256 surplus) {
        return IZkProjectPoolCore(pool).checkReserveHealth();
    }
}
