// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import {IPrivatePool} from "./interfaces/IPrivatePool.sol";
import {IZkAMMRebalance} from "./interfaces/IZkAMMRebalance.sol";

/// @title ZkAMMRebalanceAdapter  (ETHGlobal Lisbon 2026 — HACKATHON WORKSPACE)
/// @notice Presents the REAL shielded ZkAMMPair (native ETH / R00T, with fees) to the RegenArbHook as
///         a generic `IPrivatePool`. It IS the pool's `shortsContract`, so it may drive the two public
///         rebalance swaps (`buyTokensForShorts` / `sellTokensForShorts`) — the non-shielded price-sync
///         surface. The v4 pool is native-ETH: currency0 = ETH = ethReserve, currency1 = R00T =
///         tokenReserve, so `getReserves()` maps 1:1 and the hook's arb math is unchanged. The zkAMM's
///         fee simply shrinks the captured spread; the hook's profit>0 guard means it can never lose.
/// @dev The shielding (hidden trade amounts) is orthogonal to this reserve/rebalance surface — which is
///      exactly why the same hook arbs the real private pool.
contract ZkAMMRebalanceAdapter is IPrivatePool {
    using SafeERC20 for IERC20;

    IZkAMMRebalance public immutable zkAMM;
    IERC20 public immutable root;
    address public immutable creator;
    address public rebalancer; // the hook

    error NotCreator();
    error NotRebalancer();
    error BadValue();

    constructor(IZkAMMRebalance _zkAMM, IERC20 _root) {
        zkAMM = _zkAMM;
        root = _root;
        creator = msg.sender;
    }

    function setRebalancer(address r) external {
        if (msg.sender != creator) revert NotCreator();
        rebalancer = r;
    }

    /// @notice (reserve0, reserve1) = (ethReserve, tokenReserve) — matches a native-ETH/R00T v4 pool.
    function getReserves() external view returns (uint256 reserve0, uint256 reserve1) {
        return zkAMM.getReserves();
    }

    /// @notice Drive one rebalance leg on the real zkAMM.
    ///         zeroForOne = true : ETH in (msg.value), R00T out  → buyTokensForShorts (reverse AMM)
    ///         zeroForOne = false: R00T in, ETH out              → sellTokensForShorts
    function rebalanceSwap(bool zeroForOne, uint256 amountIn) external payable returns (uint256 amountOut) {
        if (msg.sender != rebalancer) revert NotRebalancer();
        require(amountIn > 0, "zero in");

        if (zeroForOne) {
            if (msg.value != amountIn) revert BadValue();
            (uint256 ethR, uint256 tokR) = zkAMM.getReserves();
            // affordable R00T for `amountIn` ETH after the pool's ~1% fee (reverse-AMM estimate)
            uint256 effEth = (amountIn * 10000) / 10100;
            uint256 est = (effEth * tokR) / (ethR + effEth);
            if (est == 0) est = 1;
            if (est >= tokR) est = tokR - 1;

            uint256 rBefore = root.balanceOf(address(this));
            zkAMM.buyTokensForShorts{value: amountIn}(est); // pool sends R00T here, refunds excess ETH
            amountOut = root.balanceOf(address(this)) - rBefore;

            root.safeTransfer(msg.sender, amountOut);            // R00T out → hook
            uint256 refund = address(this).balance;              // any ETH the pool refunded
            if (refund > 0) { (bool ok, ) = payable(msg.sender).call{value: refund}(""); require(ok, "refund"); }
        } else {
            if (msg.value != 0) revert BadValue();
            root.safeTransferFrom(msg.sender, address(this), amountIn); // hook approved us for R00T
            root.forceApprove(address(zkAMM), amountIn);
            amountOut = zkAMM.sellTokensForShorts(amountIn);      // pool sends ETH here
            (bool ok, ) = payable(msg.sender).call{value: amountOut}(""); // ETH out → hook
            require(ok, "eth out");
        }
    }

    receive() external payable {}
}
