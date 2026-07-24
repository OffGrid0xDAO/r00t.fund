// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IPrivatePool} from "./interfaces/IPrivatePool.sol";

/// @title RegenPrivatePool  (ETHGlobal Lisbon 2026 — HACKATHON WORKSPACE)
/// @notice The "private pool" side of a regen market: a real constant-product AMM over
///         (currency0, currency1) that exposes EXACTLY the surface the RegenArbHook touches —
///         `getReserves()` (public) + `rebalanceSwap()` (public). In production this is the
///         ZK-shielded ZkAMMPair (same reserve/rebalance surface; only trade AMOUNTS are hidden, and
///         only the hook/registry may call `rebalanceSwap`). The privacy is orthogonal to the price
///         surface the arb reads, so the hook is identical either way. Deployed + seeded by the
///         RegenLaunchpad when a parcel clears its CCA.
contract RegenPrivatePool is IPrivatePool {
    using SafeERC20 for IERC20;

    IERC20 public immutable token0; // currency0 (lower address)
    IERC20 public immutable token1; // currency1
    address public immutable creator;

    uint256 public reserve0;
    uint256 public reserve1;
    address public rebalancer; // the authorized arb caller (the hook)
    bool public seeded;

    error NotCreator();
    error NotRebalancer();
    error AlreadySeeded();

    constructor(IERC20 _t0, IERC20 _t1) {
        token0 = _t0;
        token1 = _t1;
        creator = msg.sender;
    }

    function setRebalancer(address r) external {
        if (msg.sender != creator) revert NotCreator();
        rebalancer = r;
    }

    /// @notice One-shot seed at the launch price (creator pulls both sides in).
    function seed(uint256 amount0, uint256 amount1) external {
        if (msg.sender != creator) revert NotCreator();
        if (seeded) revert AlreadySeeded();
        seeded = true;
        token0.safeTransferFrom(msg.sender, address(this), amount0);
        token1.safeTransferFrom(msg.sender, address(this), amount1);
        reserve0 += amount0;
        reserve1 += amount1;
    }

    function getReserves() external view returns (uint256 r0, uint256 r1) {
        return (reserve0, reserve1);
    }

    /// @notice Real x*y=k swap. Only the rebalancer (hook) may call it. Input token must be approved.
    function rebalanceSwap(bool zeroForOne, uint256 amountIn) external payable returns (uint256 amountOut) {
        if (msg.sender != rebalancer) revert NotRebalancer();
        require(amountIn > 0, "zero in");
        if (zeroForOne) {
            token0.safeTransferFrom(msg.sender, address(this), amountIn);
            amountOut = reserve1 - (reserve0 * reserve1) / (reserve0 + amountIn);
            reserve0 += amountIn;
            reserve1 -= amountOut;
            token1.safeTransfer(msg.sender, amountOut);
        } else {
            token1.safeTransferFrom(msg.sender, address(this), amountIn);
            amountOut = reserve0 - (reserve0 * reserve1) / (reserve1 + amountIn);
            reserve1 += amountIn;
            reserve0 -= amountOut;
            token0.safeTransfer(msg.sender, amountOut);
        }
    }
}
