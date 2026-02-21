// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "../interfaces/IVerifier.sol";
import "./MergeVerifier.sol";

/// @title RealMergeVerifier
/// @notice Wrapper that adapts the snarkjs-generated verifier to match IMergeVerifier interface
/// @dev Deploy after running: snarkjs groth16 setup merge.circom
contract RealMergeVerifier is IMergeVerifier {
    MergeGroth16Verifier public immutable verifier;

    constructor() {
        verifier = new MergeGroth16Verifier();
    }

    /// @notice Verifies a merge proof
    /// @param proof The proof array [a[0], a[1], b[0][0], b[0][1], b[1][0], b[1][1], c[0], c[1]]
    /// @param pubSignals [merkleRoot, nullifierHash1, nullifierHash2, outputCommitment, publicInputsBinding]
    function verifyProof(
        uint256[8] calldata proof,
        uint256[5] calldata pubSignals
    ) external view override returns (bool) {
        // Unpack proof into snarkjs format
        uint[2] memory pA = [proof[0], proof[1]];
        uint[2][2] memory pB = [[proof[2], proof[3]], [proof[4], proof[5]]];
        uint[2] memory pC = [proof[6], proof[7]];

        // Reorder: Router sends [merkleRoot, nH1, nH2, outputCommitment, publicInputsBinding]
        // snarkjs verifier expects [publicInputsBinding, merkleRoot, nH1, nH2, outputCommitment]
        // (circuit outputs come first in the R1CS signal ordering)
        uint[5] memory reordered = [
            pubSignals[4], // publicInputsBinding (output signal → IC[1])
            pubSignals[0], // merkleRoot           (public input → IC[2])
            pubSignals[1], // nullifierHash1       (public input → IC[3])
            pubSignals[2], // nullifierHash2       (public input → IC[4])
            pubSignals[3]  // outputCommitment     (public input → IC[5])
        ];

        return verifier.verifyProof(pA, pB, pC, reordered);
    }
}
