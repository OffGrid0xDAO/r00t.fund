// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {PoolKey} from "v4-core/types/PoolKey.sol";
import {IPrivatePool} from "./interfaces/IPrivatePool.sol";

interface IZkParcelPool {
    function root() external view returns (address);
    function parcel() external view returns (address);
    function getReserves() external view returns (uint256 r00tReserve, uint256 parcelReserve);
    function rebalanceSwap(bool r00tIn, uint256 amountIn) external returns (uint256 amountOut);
}

interface IArbHook {
    function rebalance(PoolKey calldata key) external;
}

/// @title ZkParcelRebalanceAdapter  (ETHGlobal Lisbon 2026 — HACKATHON WORKSPACE)
/// @notice Presents the REAL ZK-shielded ZkParcelPool (parcel/R00T, hidden user trades via
///         buyParcel/sellParcel notes) to the RegenArbHook as a generic `IPrivatePool`. It IS the
///         pool's `rebalancer`, so it may drive the pool's PUBLIC rebalance leg (`rebalanceSwap`) to
///         re-sync the parcel's price with the public Uniswap pool. Only reserves/price — already
///         public — move through this path; the shielding of user trades is untouched. This is the
///         parcel-market analogue of ZkAMMRebalanceAdapter (which wraps the shielded ZkAMMPair).
/// @dev Maps the hook's currency0/currency1 ordering onto the pool's native (root, parcel) terms.
contract ZkParcelRebalanceAdapter is IPrivatePool {
    using SafeERC20 for IERC20;

    IZkParcelPool public immutable pool;
    IERC20 public immutable root;
    IERC20 public immutable parcel;
    bool public immutable rootIsCurrency0; // true when address(root) < address(parcel)
    address public immutable creator;
    address public rebalancer; // the hook
    PoolKey public arbKey;     // the market's v4 PoolKey (for poking the hook)
    bool public arbKeySet;

    error NotCreator();
    error NotRebalancer();
    error NoKey();

    constructor(IZkParcelPool _pool) {
        pool = _pool;
        root = IERC20(_pool.root());
        parcel = IERC20(_pool.parcel());
        rootIsCurrency0 = address(root) < address(parcel);
        creator = msg.sender;
    }

    function setRebalancer(address r) external {
        if (msg.sender != creator) revert NotCreator();
        rebalancer = r;
    }

    /// @notice Record the market's v4 PoolKey so `poke()` can trigger the hook for THIS market.
    function setArbKey(PoolKey calldata k) external {
        if (msg.sender != creator) revert NotCreator();
        arbKey = k;
        arbKeySet = true;
    }

    /// @notice Trigger the cross-pool arb for this market with NO public Uniswap swap — e.g. the
    ///         shielded ZkParcelPool calls this at the end of a buyParcel/sellParcel, or a keeper/router
    ///         calls it. The hook only trusts THIS adapter for THIS market, so it can't touch others.
    function poke() external {
        if (!arbKeySet) revert NoKey();
        IArbHook(rebalancer).rebalance(arbKey);
    }

    /// @notice (reserve0, reserve1) in the v4 pool's currency ordering.
    function getReserves() external view returns (uint256 reserve0, uint256 reserve1) {
        (uint256 rootR, uint256 parcelR) = pool.getReserves();
        return rootIsCurrency0 ? (rootR, parcelR) : (parcelR, rootR);
    }

    /// @notice zeroForOne is in currency0/currency1 terms; translate to the pool's r00tIn.
    function rebalanceSwap(bool zeroForOne, uint256 amountIn) external payable returns (uint256 amountOut) {
        if (msg.sender != rebalancer) revert NotRebalancer();
        require(amountIn > 0, "zero in");
        // selling currency0 == selling R00T exactly when R00T IS currency0
        bool r00tIn = zeroForOne == rootIsCurrency0;
        IERC20 inTok = r00tIn ? root : parcel;
        IERC20 outTok = r00tIn ? parcel : root;

        inTok.safeTransferFrom(msg.sender, address(this), amountIn); // hook approved us
        inTok.forceApprove(address(pool), amountIn);
        amountOut = pool.rebalanceSwap(r00tIn, amountIn);           // pool pulls input, sends output here
        outTok.safeTransfer(msg.sender, amountOut);                 // forward output to the hook
    }
}
