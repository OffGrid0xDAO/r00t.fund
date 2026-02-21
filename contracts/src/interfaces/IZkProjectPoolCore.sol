// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title IZkProjectPoolCore
/// @notice Interface for ZkProjectPoolCore - minimal AMM pool deployed by factory
/// @dev Router calls these functions to perform user-facing operations
interface IZkProjectPoolCore {
    // ============ Structs ============

    struct PendingR00tClaim {
        uint256 amount;
        uint256 outputCommitment;
        bytes encryptedNote;
        bool claimed;
        uint256 createdAt;
    }

    // ============ View Functions ============

    function name() external view returns (string memory);
    function symbol() external view returns (string memory);
    function totalSupply() external view returns (uint256);
    function r00tReserve() external view returns (uint256);
    function tokenReserve() external view returns (uint256);
    function totalLPShares() external view returns (uint256);
    function feePerShare() external view returns (uint256);
    function accumulatedPlatformFees() external view returns (uint256);
    function accumulatedCreatorFees() external view returns (uint256);
    function accumulatedLPFees() external view returns (uint256);
    function totalPendingClaims() external view returns (uint256);
    function nextClaimId() external view returns (uint256);
    function creator() external view returns (address);
    function platform() external view returns (address);
    function governance() external view returns (address);
    function router() external view returns (address);
    function proposalId() external view returns (uint256);
    function maxDevAllocation() external view returns (uint256);
    function devAllocationClaimed() external view returns (uint256);
    function poolCreatedAt() external view returns (uint256);
    function authorizedAtomicSwapper() external view returns (address);

    // Verifiers
    function swapVerifier() external view returns (address);
    function lpWithdrawVerifier() external view returns (address);
    function withdrawVerifier() external view returns (address);
    function claimLPFeesVerifier() external view returns (address);

    // Pools
    function projectTokenPool() external view returns (address);
    function lpPool() external view returns (address);
    function r00tPool() external view returns (address);
    function nullifierRegistry() external view returns (address);
    function token() external view returns (address);

    // Nullifier checks
    function nullifiers(uint256) external view returns (bool);
    function r00tNullifiers(uint256) external view returns (bool);
    function lpNullifiers(uint256) external view returns (bool);

    // LP tracking
    function lpDepositTime(uint256) external view returns (uint256);
    function lastClaimedFeePerShare(uint256) external view returns (uint256);
    function lpCommitmentShares(uint256) external view returns (uint256);
    function lpCommitmentWithdrawn(uint256) external view returns (bool);
    function claimedInBlock(uint256, uint256) external view returns (bool);

    // Pending claims
    function pendingR00tClaims(uint256) external view returns (
        uint256 amount,
        uint256 outputCommitment,
        bytes memory encryptedNote,
        bool claimed,
        uint256 createdAt
    );

    // View helpers
    function getAmountOut(uint256 amountIn, uint256 reserveIn, uint256 reserveOut) external pure returns (uint256);
    function getTokenPrice() external view returns (uint256);
    function getR00tPrice() external view returns (uint256);
    function getReserves() external view returns (uint256 _r00tReserve, uint256 _tokenReserve);
    function getProjectTokenPool() external view returns (address);
    function getLPPool() external view returns (address);
    function getLPInfo() external view returns (uint256 _totalShares, uint256 _feePerShare, uint256 _accumulatedFees);
    function getLPCommitmentInfo(uint256 commitment) external view returns (
        uint256 shares, uint256 depositTime, uint256 lastClaimed, bool isWithdrawn
    );
    function getCirculatingSupply() external view returns (uint256);
    function getPrivateHoldings() external view returns (uint256);
    function getPublicWithdrawn() external view returns (uint256);
    function getSupplyBreakdown() external view returns (uint256 inReserve, uint256 privateCommitments, uint256 publicCirculating);
    function checkReserveHealth() external view returns (bool healthy, uint256 totalObligations, uint256 surplus);
    function getVestedDevAllocation() external view returns (uint256 vestedAmount, uint256 claimableNow);
    function getPendingClaim(uint256 claimId) external view returns (uint256 amount, uint256 outputCommitment, bool claimed, uint256 createdAt);
    function getPendingClaimsInfo() external view returns (uint256 nextId, uint256 totalPending);

    // ============ Core AMM Functions (called by users directly) ============

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
    ) external;

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
    ) external;

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
    ) external;

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
    ) external;

    // ============ Router-Only Functions ============

    /// @notice Withdraw project tokens to public ERC20 (router-only)
    function routerWithdrawPublic(
        uint256[8] calldata proof,
        uint256 merkleRoot,
        uint256 nullifierHash,
        uint256 amount,
        address recipient,
        uint256 recipientBinding
    ) external;

    /// @notice Deposit ERC20 tokens into privacy pool (router-only)
    function routerDepositPublic(
        uint256 amount,
        uint256 commitment,
        bytes32 depositorBinding,
        address depositor,
        bytes calldata encryptedNote
    ) external;

    /// @notice Claim dev allocation (router-only)
    function routerClaimDevAllocation(
        uint256 commitment,
        uint256 amount,
        address caller,
        bytes calldata encryptedNote
    ) external;

    /// @notice Collect platform fees (router-only)
    function routerCollectPlatformFees(
        uint256 outputCommitment,
        address caller,
        bytes calldata encryptedNote
    ) external returns (uint256 claimId);

    /// @notice Collect creator fees (router-only)
    function routerCollectCreatorFees(
        uint256 outputCommitment,
        address caller,
        bytes calldata encryptedNote
    ) external returns (uint256 claimId);

    /// @notice Claim LP fees (router-only)
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
    ) external returns (uint256 claimId);

    /// @notice Process pending R00T claim (router-only)
    function routerProcessR00tClaim(uint256 claimId, address caller) external;

    /// @notice Emergency process R00T claim (router-only)
    function routerEmergencyProcessR00tClaim(uint256 claimId) external;

    /// @notice Atomic swap from R00T (router-only)
    function routerAtomicSwapFromR00T(
        uint256 r00tAmount,
        uint256 r00tNullifier,
        uint256 minTokensOut,
        uint256 outputCommitment,
        address swapper,
        bytes calldata encryptedNote
    ) external returns (uint256 tokensOut);

    // ============ Governance-Only Functions ============

    function setSwapVerifier(address _newVerifier) external;
    function setLPWithdrawVerifier(address _newVerifier) external;
    function setWithdrawVerifier(address _newVerifier) external;
    function setClaimLPFeesVerifier(address _newVerifier) external;
    function setAuthorizedAtomicSwapper(address _swapper) external;
}
