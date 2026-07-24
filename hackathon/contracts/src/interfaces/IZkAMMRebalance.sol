// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title IZkAMMRebalance
/// @notice The PUBLIC (non-shielded) surface of r00t.fund's private zkAMM that the RegenArbHook
///         uses to read the fair price and execute REAL corrective arb trades on the pool reserves.
///         Shielded user trades (buyPrivate/sellPrivate) are NOT here — only public reserve ops.
/// @dev On the demo chain, the zkAMM authorizes the hook via `rebalanceFor(hook)` (twin of the
///      existing onlyShorts role) so these two swap functions accept the hook as caller.
interface IZkAMMRebalance {
    /// @notice Public reserves (ETH, R00T). Price = ethReserve / tokenReserve. Amounts of shielded
    ///         trades are hidden, but the reserves/price are public — this is what makes the sync work.
    function getReserves() external view returns (uint256 ethReserve, uint256 tokenReserve);

    /// @notice REAL swap: send ETH, receive `tokenAmount` R00T out of the pool. Moves zkAMM price UP.
    /// @return ethUsed ETH actually spent.
    function buyTokensForShorts(uint256 tokenAmount) external payable returns (uint256 ethUsed);

    /// @notice REAL swap: send `tokenAmount` R00T in, receive ETH. Moves zkAMM price DOWN.
    /// @return ethOut ETH received.
    function sellTokensForShorts(uint256 tokenAmount) external returns (uint256 ethOut);

    /// @notice Authorize an address (the hook) to call the rebalance swaps. Added for the hook
    ///         (mirrors setShortsContract). Owner-gated on the zkAMM.
    function rebalanceFor(address rebalancer) external;
}
