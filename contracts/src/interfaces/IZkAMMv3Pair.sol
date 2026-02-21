// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title IZkAMMv3Pair
/// @notice Interface for ZkAMMv3Pair contract
interface IZkAMMv3Pair {
    // ============ State Modification Functions (Router Only) ============

    function updateReserves(uint256 ethDelta, uint256 tokenDelta, bool isEthIn) external;
    function markNullifierSpent(uint256 nullifierHash) external;
    function markLPNullifierSpent(uint256 nullifierHash) external;
    function markClaimNullifierSpent(uint256 claimNullifier) external;
    function insertCommitment(uint256 commitment, bytes calldata encryptedNote) external returns (uint256 leafIndex);
    function insertLPCommitment(uint256 commitment, uint256 lpShares, bytes calldata encryptedNote) external returns (uint256 leafIndex);
    function recordLPCommitment(uint256 commitment, uint256 shares, bool isReuse) external;
    function clearLPCommitment(uint256 commitment) external returns (uint256 shares);
    function addLPShares(uint256 shares) external;
    function removeLPShares(uint256 shares) external;
    function addProtocolFees(uint256 amount) external;
    function distributeLPFees(uint256 lpFee) external;
    function deductLPFees(uint256 amount) external;
    function useCommitmentBinding(bytes32 binding) external;
    function useAtomicSwapNonce() external returns (uint256 nonce);
    function bootstrap(uint256 lpCommitment, uint256 ownerShares, uint256 burnedShares, bytes calldata lpNote) external payable returns (uint256 leafIndex);
    function announceEpochIncrement() external;
    function executeEpochIncrement() external;
    function cancelEpochIncrement() external;
    function collectProtocolFees(address treasury) external returns (uint256 fees);
    function sweepBurnedShareFees(address treasury) external returns (uint256 fees);
    function emergencyWithdrawETH(uint256 amount, address recipient) external;
    function sendETH(address recipient, uint256 amount) external;
    function addETHReserve() external payable;
    function syncETHAccounting() external returns (uint256 surplus);
    function setTokenPoolAuthorizedCaller(address caller, bool authorized) external;
    function withdrawROOT(address recipient, uint256 amount) external;
    function depositPublic(
        uint256 amount,
        uint256 commitment,
        bytes32 depositorBinding,
        address depositor,
        bytes calldata encryptedNote
    ) external returns (uint256 leafIndex);
    function getRootBalance() external view returns (uint256);
    function setRouter(address _router) external;
    function upgradeRouter(address _newRouter) external;
    function setShortsContract(address _shortsContract) external;
    function allocateTokensForShorts(uint256 amount) external;

    // ============ View Functions ============

    function TOTAL_SUPPLY() external view returns (uint256);
    function FEE_DENOMINATOR() external view returns (uint256);
    function MIN_LIQUIDITY() external view returns (uint256);
    function SNARK_SCALAR_FIELD() external view returns (uint256);
    function LP_LOCK_PERIOD() external view returns (uint256);
    function FEE_PRECISION() external view returns (uint256);
    function MIN_LP_FEE_FOR_DISTRIBUTION() external view returns (uint256);
    function MIN_EPOCH_DURATION() external view returns (uint256);
    function MIN_CLAIM_WINDOW() external view returns (uint256);

    function router() external view returns (address);
    function shortsContract() external view returns (address);
    function rootToken() external view returns (address);
    function tokenPool() external view returns (address);
    function lpPool() external view returns (address);
    function name() external view returns (string memory);
    function symbol() external view returns (string memory);

    function ethReserve() external view returns (uint256);
    function tokenReserve() external view returns (uint256);
    function totalLPShares() external view returns (uint256);
    function feePerShare() external view returns (uint256);
    function accumulatedProtocolFees() external view returns (uint256);
    function accumulatedLPFees() external view returns (uint256);

    function nullifiers(uint256) external view returns (bool);
    function lpNullifiers(uint256) external view returns (bool);
    function spentClaimNullifiers(uint256) external view returns (bool);
    function lpCommitmentShares(uint256) external view returns (uint256);
    function lpDepositTime(uint256) external view returns (uint256);
    function lastClaimedFeePerShare(uint256) external view returns (uint256);
    function lpCommitmentWithdrawn(uint256) external view returns (bool);
    function usedCommitmentBindings(bytes32) external view returns (bool);

    function currentFeeEpoch() external view returns (uint256);
    function feePerShareAtEpochStart(uint256) external view returns (uint256);
    function lastEpochIncrementTime() external view returns (uint256);
    function epochIncrementPending() external view returns (bool);
    function epochIncrementAnnouncedAt() external view returns (uint256);
    function lastLPDepositTime() external view returns (uint256);
    function bootstrapped() external view returns (bool);
    function atomicSwapNonce() external view returns (uint256);

    function getReserves() external view returns (uint256 _ethReserve, uint256 _tokenReserve);
    function isKnownRoot(uint256 root) external view returns (bool);
    function isKnownLPRoot(uint256 root) external view returns (bool);
    function isNullifierSpent(uint256 nullifier) external view returns (bool);
    function isLPNullifierSpent(uint256 nullifier) external view returns (bool);
    function isClaimNullifierSpent(uint256 nullifier) external view returns (bool);
    function getLPCommitmentInfo(uint256 commitment) external view returns (
        uint256 shares,
        uint256 depositTime,
        uint256 lastClaimed,
        bool isWithdrawn,
        bool isLocked
    );
    function getLPInfo() external view returns (uint256 _totalShares, uint256 _feePerShare, uint256 _accumulatedFees);
    function getTokenPool() external view returns (address);
    function getLPPool() external view returns (address);
    function getCirculatingSupply() external view returns (uint256);
    function getETHSurplus() external view returns (uint256 surplus);
    function getClaimableFees(uint256 lpShares) external view returns (uint256 claimable);
    function sqrt(uint256 x) external pure returns (uint256 y);
}
