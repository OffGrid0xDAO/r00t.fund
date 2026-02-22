// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "../interfaces/IVerifier.sol";

/// @title TestVoteVerifier
/// @notice Test verifier that accepts any vote proof (for testnet only!)
/// @dev DO NOT USE IN PRODUCTION - accepts all proofs
contract TestVoteVerifier is IVoteVerifier {
    /// @notice Always returns true for testing
    function verifyProof(
        uint256[8] calldata,
        uint256[6] calldata
    ) external pure returns (bool) {
        return true;
    }
}
