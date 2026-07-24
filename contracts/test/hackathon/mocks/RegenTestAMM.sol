// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IPrivatePool} from "../../../src/hackathon/interfaces/IPrivatePool.sol";

/// @notice A REAL constant-product AMM (currency0/currency1 ERC20s) that implements the same public
///         surface (`getReserves` + `rebalanceSwap`) the shielded ZkAMMPair exposes to the hook. Used
///         in the RegenArbHook integration test as the "private pool" — real swaps, real reserves;
///         the ZK shielding is orthogonal to the reserve/rebalance surface the hook actually touches.
contract RegenTestAMM is IPrivatePool {
    using SafeERC20 for IERC20;

    IERC20 public immutable token0;
    IERC20 public immutable token1;
    uint256 public reserve0;
    uint256 public reserve1;
    address public rebalancer; // authorized caller (the hook)

    constructor(IERC20 _t0, IERC20 _t1) { token0 = _t0; token1 = _t1; }

    function setRebalancer(address r) external { rebalancer = r; }

    /// @notice Seed reserves (caller must approve both tokens).
    function seed(uint256 a0, uint256 a1) external {
        token0.safeTransferFrom(msg.sender, address(this), a0);
        token1.safeTransferFrom(msg.sender, address(this), a1);
        reserve0 += a0; reserve1 += a1;
    }

    function getReserves() external view returns (uint256 r0, uint256 r1) { return (reserve0, reserve1); }

    /// @notice Real constant-product swap. Sell `amountIn` of the input currency, receive the other.
    ///         The rebalancer (hook) must have approved the input token to this pool.
    function rebalanceSwap(bool zeroForOne, uint256 amountIn) external payable returns (uint256 amountOut) {
        require(msg.sender == rebalancer, "not rebalancer");
        require(amountIn > 0, "zero in");
        if (zeroForOne) {
            token0.safeTransferFrom(msg.sender, address(this), amountIn);
            amountOut = reserve1 - (reserve0 * reserve1) / (reserve0 + amountIn); // x*y=k
            reserve0 += amountIn; reserve1 -= amountOut;
            token1.safeTransfer(msg.sender, amountOut);
        } else {
            token1.safeTransferFrom(msg.sender, address(this), amountIn);
            amountOut = reserve0 - (reserve0 * reserve1) / (reserve1 + amountIn);
            reserve1 += amountIn; reserve0 -= amountOut;
            token0.safeTransfer(msg.sender, amountOut);
        }
    }
}
