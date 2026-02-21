// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "../interfaces/IVerifier.sol";

/// @title TestMergeVerifier
/// @notice Test verifier that accepts any proof - FOR TESTNET ONLY
/// @dev Replace with RealMergeVerifier in production after circuit compilation
contract TestMergeVerifier is IMergeVerifier {
    /// @notice Verifies a merge proof (test version - always returns true)
    /// @param proof The proof array (ignored in test)
    /// @param pubSignals [merkleRoot, nullifierHash1, nullifierHash2, outputCommitment, publicInputsBinding]
    function verifyProof(
        uint256[8] calldata proof,
        uint256[5] calldata pubSignals
    ) external pure override returns (bool) {
        // Silence unused variable warnings
        proof;
        pubSignals;

        // WARNING: This verifier accepts ALL proofs
        // ONLY use on testnet for development
        return true;
    }
}
