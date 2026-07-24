// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title IPrivatePool
/// @notice Currency-agnostic PUBLIC surface of a r00t.fund private (shielded) AMM, used by the
///         RegenArbHook to read the fair price and execute REAL corrective arb swaps. Works for BOTH
///         markets: the main R00T/ETH pool AND parcel/R00T pools — the hook never cares which pair.
///         Shielded USER trades (proof-gated, amounts hidden) are NOT here; only public price + a
///         hook-authorized rebalance swap on the public reserves.
/// @dev For the deployed ZkAMMPair (R00T/ETH), a thin adapter maps rebalanceSwap → buy/sellTokensForShorts
///      and the hook takes the pool's `shortsContract` slot. Parcel pools expose this natively.
interface IPrivatePool {
    /// @notice Public reserves of (currency0, currency1) in the SAME ordering as the paired Uniswap
    ///         v4 pool (currency0 < currency1). Price(1 in 0) = reserve0 / reserve1.
    function getReserves() external view returns (uint256 reserve0, uint256 reserve1);

    /// @notice REAL constant-product swap on the public reserves. Sell `amountIn` of the input
    ///         currency (currency0 if zeroForOne else currency1), receive the other. Moves the price.
    ///         Only callable by the authorized rebalancer (the hook).
    /// @param zeroForOne  true = sell currency0 for currency1 (price of 1-in-0 rises), false = opposite.
    /// @param amountIn    amount of the input currency being sold in.
    /// @return amountOut  amount of the output currency received.
    function rebalanceSwap(bool zeroForOne, uint256 amountIn) external payable returns (uint256 amountOut);
}
