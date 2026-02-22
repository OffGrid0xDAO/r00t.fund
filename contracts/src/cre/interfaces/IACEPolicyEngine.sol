// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title IACEPolicyEngine
/// @notice Minimal interface for the official Chainlink ACE PolicyEngine
/// @dev From @chainlink/policy-management/core/PolicyEngine.sol
///      The ACE PolicyEngine uses a modular policy system (SanctionsPolicy,
///      VolumePolicy, etc.) and returns a PolicyResult for each check.
interface IACEPolicyEngine {
    enum PolicyResult {
        None,
        Allowed,
        Continue
    }

    struct Payload {
        bytes4 selector;
        address sender;
        bytes data;
        bytes context;
    }

    /// @notice Check compliance without state changes (view)
    /// @param payload The encoded transfer payload to check
    /// @return result PolicyResult indicating compliance status
    function check(Payload calldata payload) external view returns (PolicyResult result);

    /// @notice Execute compliance check with state changes
    /// @param payload The encoded transfer payload to run
    /// @return result PolicyResult indicating compliance status
    function run(Payload calldata payload) external returns (PolicyResult result);
}
