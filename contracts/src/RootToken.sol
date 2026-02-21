// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title RootToken
/// @notice The ROOT token - Simple ERC20 with fixed immutable supply
/// @dev Total supply is minted to deployer on deployment. No further minting possible.
///      Deployer sends tokens to ZkAMM, users can withdraw via ZK proof.
contract RootToken is ERC20 {
    /// @notice Total supply: 69 million tokens with 18 decimals
    uint256 public constant TOTAL_SUPPLY = 69_000_000 * 1e18;

    /// @notice Initialize the token - mint entire supply to deployer
    constructor() ERC20("Root Token", "ROOT") {
        _mint(msg.sender, TOTAL_SUPPLY);
    }
}
