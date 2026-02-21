// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Interface for ZkProjectPool
interface IZkProjectPool {
    function atomicSwapFromR00T(
        uint256 r00tAmount,
        uint256 r00tNullifier,
        uint256 minTokensOut,
        uint256 outputCommitment,
        bytes calldata encryptedNote
    ) external returns (uint256 tokensOut);

    function setAuthorizedAtomicSwapper(address swapper) external;
}
