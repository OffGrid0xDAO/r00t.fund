// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IHooks} from "v4-core/interfaces/IHooks.sol";
import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {PoolKey} from "v4-core/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "v4-core/types/PoolId.sol";
import {BalanceDelta} from "v4-core/types/BalanceDelta.sol";
import {BeforeSwapDelta} from "v4-core/types/BeforeSwapDelta.sol";

import {IPrivatePool} from "./interfaces/IPrivatePool.sol";

/// @title RegenArbHook  (ETHGlobal Lisbon 2026 — HACKATHON WORKSPACE, not production r00t.fund)
/// @notice ONE shared Uniswap v4 hook for ALL r00t.fund markets — the main R00T/ETH pool AND every
///         parcel/R00T pool. It back-runs each swap with a REAL cross-pool arbitrage between the
///         public Uniswap pool and the matching private (shielded) pool, re-syncing their prices and
///         sweeping the captured spread to that market's regeneration treasury.
/// @dev Currency-agnostic: the arb math (`computeArb`) works on generic reserves, so a new parcel or
///      the base R00T market just `register()`s its pool. Deployed once at a mined CREATE2 address
///      (afterSwap flag). See ../../../hackathon/DESIGN.md + INFRA.md.
contract RegenArbHook is IHooks {
    using PoolIdLibrary for PoolKey;

    struct MarketConfig {
        IPrivatePool privatePool; // the shielded pool for the SAME pair (R00T/ETH or parcel/R00T)
        address regenTreasury;    // where the captured spread goes
        bytes32 marketId;         // parcelId, or a sentinel for the base R00T market
        bool registered;
    }

    IPoolManager public immutable poolManager;
    address public immutable launchpad; // the only registrar

    mapping(PoolId => MarketConfig) public configs;

    uint256 public constant SYNC_THRESHOLD_BPS = 30;   // arb only when pools diverge > 0.30%
    uint256 public constant MAX_REBALANCE_BPS  = 500;  // cap one arb to 5% of the private reserve
    uint256 private constant BPS = 10_000;
    uint256 private constant WAD = 1e18;

    event MarketRegistered(PoolId indexed poolId, bytes32 indexed marketId, address privatePool, address treasury);
    event SpreadCaptured(bytes32 indexed marketId, uint256 profit, uint256 uniPriceE18, uint256 privPriceE18);
    event SyncSkipped(bytes32 indexed marketId, uint256 uniPriceE18, uint256 privPriceE18);

    error NotPoolManager();
    error NotLaunchpad();
    error HookNotImplemented();

    modifier onlyPoolManager() { if (msg.sender != address(poolManager)) revert NotPoolManager(); _; }

    constructor(IPoolManager _pm, address _launchpad) {
        poolManager = _pm;
        launchpad = _launchpad;
    }

    /// @notice Wire a market's Uniswap pool to its private pool + regen treasury. onlyLaunchpad.
    function register(PoolKey calldata key, IPrivatePool privatePool, address regenTreasury, bytes32 marketId) external {
        if (msg.sender != launchpad) revert NotLaunchpad();
        configs[key.toId()] = MarketConfig(privatePool, regenTreasury, marketId, true);
        emit MarketRegistered(key.toId(), marketId, address(privatePool), regenTreasury);
    }

    // ─────────────────────────────────────────────────────────────────────────────────────────────
    // CORE (pure, unit-tested): given the public price and the private reserves, decide the arb.
    // Works on generic reserves → identical for R00T/ETH and parcel/R00T.
    // ─────────────────────────────────────────────────────────────────────────────────────────────
    /// @param uniPriceE18 public price = currency1 per currency0, 1e18-scaled.
    /// @param r0 private reserve of currency0.  @param r1 private reserve of currency1.
    /// @return doArb        whether an above-threshold arb exists.
    /// @return privZeroForOne direction of the PRIVATE-pool leg: true = sell currency0 into private.
    /// @return amountIn     amount to sell into the private pool on that leg (capped).
    function computeArb(uint256 uniPriceE18, uint256 r0, uint256 r1)
        public pure returns (bool doArb, bool privZeroForOne, uint256 amountIn)
    {
        if (r0 == 0 || r1 == 0 || uniPriceE18 == 0) return (false, false, 0);
        uint256 privPriceE18 = (r1 * WAD) / r0;                 // currency1 per currency0 on the private pool

        uint256 hi = uniPriceE18 > privPriceE18 ? uniPriceE18 : privPriceE18;
        uint256 lo = uniPriceE18 > privPriceE18 ? privPriceE18 : uniPriceE18;
        if (((hi - lo) * BPS) / hi < SYNC_THRESHOLD_BPS) return (false, false, 0); // below divergence gate

        uint256 k = r0 * r1;
        uint256 r0target = _sqrt((k * WAD) / uniPriceE18);      // private r0 that makes P_priv == uniPrice
        uint256 cap;
        if (uniPriceE18 > privPriceE18) {
            // currency0 dearer on Uni → cheaper on private → BUY currency0 on private (sell currency1 in)
            if (r0target >= r0) return (false, false, 0);
            uint256 out0 = r0 - r0target;
            cap = (r0 * MAX_REBALANCE_BPS) / BPS;
            if (out0 > cap) { out0 = cap; r0target = r0 - out0; }
            amountIn = (k / r0target) - r1;                     // currency1 sold into private
            privZeroForOne = false;
            doArb = amountIn > 0;
        } else {
            // currency0 cheaper on Uni → dearer on private → SELL currency0 into private
            if (r0target <= r0) return (false, false, 0);
            uint256 in0 = r0target - r0;
            cap = (r0 * MAX_REBALANCE_BPS) / BPS;
            if (in0 > cap) in0 = cap;
            amountIn = in0;                                     // currency0 sold into private
            privZeroForOne = true;
            doArb = amountIn > 0;
        }
    }

    // ─────────────────────────────────────────────────────────────────────────────────────────────
    // the only active hook — back-run each swap with the real cross-pool arb
    // ─────────────────────────────────────────────────────────────────────────────────────────────
    function afterSwap(
        address, PoolKey calldata key, IPoolManager.SwapParams calldata, BalanceDelta, bytes calldata
    ) external onlyPoolManager returns (bytes4, int128) {
        MarketConfig memory cfg = configs[key.toId()];
        if (!cfg.registered) return (IHooks.afterSwap.selector, int128(0));

        uint256 uniPriceE18 = _uniPriceE18(key);
        (uint256 r0, uint256 r1) = cfg.privatePool.getReserves();
        (bool doArb, bool privZeroForOne, uint256 amountIn) = computeArb(uniPriceE18, r0, r1);
        if (!doArb) { emit SyncSkipped(cfg.marketId, uniPriceE18, r0 == 0 ? 0 : (r1 * WAD) / r0); return (IHooks.afterSwap.selector, int128(0)); }

        // TODO(Phase 1b): execute both legs + settle + take:
        //   privOut = cfg.privatePool.rebalanceSwap(privZeroForOne, amountIn);   // real private swap
        //   uniOut  = _uniSwap(key, !privZeroForOne, privOut);                   // nested poolManager.swap
        //   profit  = uniOut - amountIn; require(profit > 0);                     // no forced loss
        //   poolManager.take(<profit currency>, cfg.regenTreasury, profit);
        //   emit SpreadCaptured(cfg.marketId, profit, uniPriceE18, (r1*WAD)/r0);
        privZeroForOne; amountIn; // silence until leg wiring lands
        return (IHooks.afterSwap.selector, int128(0));
    }

    /// @dev Uniswap price (currency1 per currency0, 1e18) from slot0. Internal seam so `computeArb`
    ///      (the core) is fully testable without a live PoolManager; wired to StateLibrary.getSlot0
    ///      + sqrtPriceX96→price in Phase 1b.
    function _uniPriceE18(PoolKey calldata key) internal view returns (uint256) {
        key; // no-op in scaffold
        return 0;
    }

    /// @dev Babylonian integer sqrt.
    function _sqrt(uint256 y) internal pure returns (uint256 z) {
        if (y > 3) { z = y; uint256 x = y / 2 + 1; while (x < z) { z = x; x = (y / x + x) / 2; } }
        else if (y != 0) { z = 1; }
    }

    // ── unused hooks (address flag bits gate which are callable) ──
    function beforeInitialize(address, PoolKey calldata, uint160) external pure returns (bytes4) { revert HookNotImplemented(); }
    function afterInitialize(address, PoolKey calldata, uint160, int24) external pure returns (bytes4) { revert HookNotImplemented(); }
    function beforeAddLiquidity(address, PoolKey calldata, IPoolManager.ModifyLiquidityParams calldata, bytes calldata) external pure returns (bytes4) { revert HookNotImplemented(); }
    function afterAddLiquidity(address, PoolKey calldata, IPoolManager.ModifyLiquidityParams calldata, BalanceDelta, BalanceDelta, bytes calldata) external pure returns (bytes4, BalanceDelta) { revert HookNotImplemented(); }
    function beforeRemoveLiquidity(address, PoolKey calldata, IPoolManager.ModifyLiquidityParams calldata, bytes calldata) external pure returns (bytes4) { revert HookNotImplemented(); }
    function afterRemoveLiquidity(address, PoolKey calldata, IPoolManager.ModifyLiquidityParams calldata, BalanceDelta, BalanceDelta, bytes calldata) external pure returns (bytes4, BalanceDelta) { revert HookNotImplemented(); }
    function beforeSwap(address, PoolKey calldata, IPoolManager.SwapParams calldata, bytes calldata) external pure returns (bytes4, BeforeSwapDelta, uint24) { revert HookNotImplemented(); }
    function beforeDonate(address, PoolKey calldata, uint256, uint256, bytes calldata) external pure returns (bytes4) { revert HookNotImplemented(); }
    function afterDonate(address, PoolKey calldata, uint256, uint256, bytes calldata) external pure returns (bytes4) { revert HookNotImplemented(); }

    receive() external payable {}
}
