// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "../interfaces/IVerifier.sol";
import "./PledgeVerifier.sol";

/// @title RealPledgeVerifier
/// @notice Wrapper that adapts the snarkjs-generated verifier to match IPledgeVerifier interface
contract RealPledgeVerifier is IPledgeVerifier {
    PledgeGroth16Verifier public immutable verifier;

    constructor() {
        verifier = new PledgeGroth16Verifier();
    }

    /// @notice Verifies a pledge proof
    /// @param proof The proof array [a[0], a[1], b[0][0], b[0][1], b[1][0], b[1][1], c[0], c[1]]
    /// @param pubSignals [pledgeCommitment, publicInputsBinding, merkleRoot, nullifierHash, pledgeAmount, parcelId, creator] (Circom outputs first)
    function verifyProof(
        uint256[8] calldata proof,
        uint256[7] calldata pubSignals
    ) external view override returns (bool) {
        // Unpack proof into snarkjs format
        uint[2] memory pA = [proof[0], proof[1]];
        uint[2][2] memory pB = [[proof[2], proof[3]], [proof[4], proof[5]]];
        uint[2] memory pC = [proof[6], proof[7]];

        return verifier.verifyProof(pA, pB, pC, pubSignals);
    }
}
