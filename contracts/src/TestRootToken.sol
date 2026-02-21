// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/// @title TestRootToken
/// @notice Simple mintable token for testing shorts on Sepolia
contract TestRootToken is ERC20, Ownable {
    constructor() ERC20("Test ROOT", "tROOT") Ownable(msg.sender) {
        // Mint initial supply to deployer
        _mint(msg.sender, 69_000_000 * 1e18);
    }

    /// @notice Mint tokens (owner only, for testing)
    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }
}
