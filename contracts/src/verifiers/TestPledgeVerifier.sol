// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "../interfaces/IVerifier.sol";

/// @title TestPledgeVerifier
/// @notice Test verifier that accepts any proof (for testnet only!)
/// @dev DO NOT USE IN PRODUCTION - accepts all proofs
contract TestPledgeVerifier is IPledgeVerifier {
    /// @notice Always returns true for testing
    function verifyProof(
        uint256[8] calldata,
        uint256[5] calldata
    ) external pure override returns (bool) {
        return true;
    }
}
