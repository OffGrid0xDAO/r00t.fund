// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "../interfaces/IVerifier.sol";
import "./LandDepositVerifier.sol";

/// @title RealLandDepositVerifier
/// @notice Wrapper adapting the snarkjs LandDeposit verifier to ILandDepositVerifier.
/// @dev Value+parcel binding for LandVault funding: proves the public (parcelId, amount)
///      equal the values baked into the public commitment, so a shielded fund can never
///      be claimed for more R00T than paid nor for a different parcel.
contract RealLandDepositVerifier is ILandDepositVerifier {
    LandDepositGroth16Verifier public immutable verifier;

    constructor() {
        verifier = new LandDepositGroth16Verifier();
    }

    /// @param proof      packed groth16 proof
    /// @param pubSignals [binding, parcelId, amount, commitment] (Circom output first)
    function verifyProof(
        uint256[8] calldata proof,
        uint256[4] calldata pubSignals
    ) external view override returns (bool) {
        uint[2] memory pA = [proof[0], proof[1]];
        uint[2][2] memory pB = [[proof[2], proof[3]], [proof[4], proof[5]]];
        uint[2] memory pC = [proof[6], proof[7]];
        return verifier.verifyProof(pA, pB, pC, pubSignals);
    }
}
