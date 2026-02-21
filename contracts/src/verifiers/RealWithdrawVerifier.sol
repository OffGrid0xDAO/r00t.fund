// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "../interfaces/IVerifier.sol";
import "./WithdrawVerifier.sol";

/// @title RealWithdrawVerifier
/// @notice Wrapper that adapts the snarkjs-generated verifier to match IWithdrawVerifier interface
contract RealWithdrawVerifier is IWithdrawVerifier {
    WithdrawGroth16Verifier public immutable verifier;

    constructor() {
        verifier = new WithdrawGroth16Verifier();
    }

    /// @notice Verifies a withdraw proof
    /// @param proof The proof array [a[0], a[1], b[0][0], b[0][1], b[1][0], b[1][1], c[0], c[1]]
    /// @param pubSignals [merkleRoot, nullifierHash, amount, recipient, recipientBinding]
    function verifyProof(
        uint256[8] calldata proof,
        uint256[5] calldata pubSignals
    ) external view override returns (bool) {
        // Unpack proof into snarkjs format
        uint[2] memory pA = [proof[0], proof[1]];
        uint[2][2] memory pB = [[proof[2], proof[3]], [proof[4], proof[5]]];
        uint[2] memory pC = [proof[6], proof[7]];

        return verifier.verifyProof(pA, pB, pC, pubSignals);
    }
}
