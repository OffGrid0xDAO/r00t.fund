// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ProjectToken} from "../ProjectToken.sol";

/// @title ProjectTokenFactory
/// @notice Factory for deploying ProjectToken instances only
/// @dev Split from LaunchpadPoolFactory to stay under 24KB contract size limit
contract ProjectTokenFactory {
    address public immutable governance;
    address public owner;

    error Unauthorized();
    error ZeroAddress();

    modifier onlyGovernance() {
        if (msg.sender != governance) revert Unauthorized();
        _;
    }

    constructor(address _governance) {
        if (_governance == address(0)) revert ZeroAddress();
        governance = _governance;
        owner = msg.sender;
    }

    function deployToken(
        string calldata name,
        string calldata symbol,
        uint256 totalSupply,
        address recipient
    ) external onlyGovernance returns (address tokenAddress) {
        ProjectToken token = new ProjectToken(
            name,
            symbol,
            totalSupply,
            recipient,
            address(0),  // No direct deployer allocation
            0            // Zero deployer bps
        );
        return address(token);
    }
}
