// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";

/// @notice Matches Uniswap's Liquidity-Launcher IInitializerHook: a v4 hook that gates pool
///         initialization to a single authorized address (the launcher/migrator). The launcher
///         requires `PoolParameters.hook` to support this (else it reverts InvalidHook), so a custom
///         hook must implement it to be the destination pool's hook for a Continuous Clearing Auction.
interface IInitializerHook is IERC165 {
    /// @notice The address authorized to initialize pools using this hook.
    function authorized() external view returns (address);
}
