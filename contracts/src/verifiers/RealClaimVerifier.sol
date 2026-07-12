// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "../interfaces/IVerifier.sol";
import "./ClaimVerifier.sol";

/// @title RealClaimVerifier
/// @notice Wrapper that adapts the snarkjs-generated claim verifier to IClaimVerifier.
contract RealClaimVerifier is IClaimVerifier {
    ClaimGroth16Verifier public immutable verifier;

    constructor() {
        verifier = new ClaimGroth16Verifier();
    }

    /// @notice Verifies a claim proof
    /// @param proof The proof array [a[0], a[1], b[0][0], b[0][1], b[1][0], b[1][1], c[0], c[1]]
    /// @param pubSignals [recipientBinding, merkleRoot, nullifierHash, parcelId, amount, recipient] (Circom output first)
    function verifyProof(
        uint256[8] calldata proof,
        uint256[6] calldata pubSignals
    ) external view override returns (bool) {
        uint[2] memory pA = [proof[0], proof[1]];
        uint[2][2] memory pB = [[proof[2], proof[3]], [proof[4], proof[5]]];
        uint[2] memory pC = [proof[6], proof[7]];

        return verifier.verifyProof(pA, pB, pC, pubSignals);
    }
}
