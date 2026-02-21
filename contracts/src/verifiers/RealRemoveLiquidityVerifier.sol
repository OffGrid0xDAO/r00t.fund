// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "../interfaces/IVerifier.sol";
import "./RemoveLiquidityVerifier.sol";

/// @title RealRemoveLiquidityVerifier
/// @notice Wrapper that adapts the snarkjs-generated verifier to match IRemoveLiquidityVerifier interface
/// @dev SECURITY FIX: Uses 10 pubSignals including commitment, tokenCommitment, and tokensOut
///
/// Public signals order (must match circuit output order):
///   [0] publicInputsBinding - Hash binding all inputs to prevent malleability (output signal comes first)
///   [1] lpMerkleRoot - Merkle root of LP commitment tree
///   [2] nullifierHash - Hash to prevent double-spending
///   [3] commitment - LP commitment being spent (SECURITY: binds proof to specific position)
///   [4] withdrawShares - Number of LP shares to withdraw
///   [5] minEthOut - Minimum ETH to receive (slippage protection)
///   [6] recipient - Address to receive ETH
///   [7] changeCommitment - New LP commitment for remaining shares (or 0)
///   [8] tokenCommitment - Token commitment for returned tokens (SECURITY: verified in circuit)
///   [9] tokensOut - Amount of tokens returned (SECURITY: verified in commitment)
contract RealRemoveLiquidityVerifier is IRemoveLiquidityVerifier {
    RemoveLiquidityGroth16Verifier public immutable verifier;

    constructor() {
        verifier = new RemoveLiquidityGroth16Verifier();
    }

    /// @notice Verifies a remove liquidity proof
    /// @param proof The proof array [a[0], a[1], b[0][0], b[0][1], b[1][0], b[1][1], c[0], c[1]]
    /// @param pubSignals [publicInputsBinding, lpMerkleRoot, nullifierHash, commitment, withdrawShares, minEthOut, recipient, changeCommitment, tokenCommitment, tokensOut]
    function verifyProof(
        uint256[8] calldata proof,
        uint256[10] calldata pubSignals
    ) external view override returns (bool) {
        // Unpack proof into snarkjs format
        uint[2] memory pA = [proof[0], proof[1]];
        uint[2][2] memory pB = [[proof[2], proof[3]], [proof[4], proof[5]]];
        uint[2] memory pC = [proof[6], proof[7]];

        return verifier.verifyProof(pA, pB, pC, pubSignals);
    }
}
