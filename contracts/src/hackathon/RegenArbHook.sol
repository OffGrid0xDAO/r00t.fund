// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IHooks} from "v4-core/interfaces/IHooks.sol";
import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {PoolKey} from "v4-core/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "v4-core/types/PoolId.sol";
import {BalanceDelta} from "v4-core/types/BalanceDelta.sol";
import {BeforeSwapDelta} from "v4-core/types/BeforeSwapDelta.sol";
import {Currency, CurrencyLibrary} from "v4-core/types/Currency.sol";
import {CurrencySettler} from "v4-core-test/utils/CurrencySettler.sol";
import {StateLibrary} from "v4-core/libraries/StateLibrary.sol";
import {TickMath} from "v4-core/libraries/TickMath.sol";
import {FullMath} from "v4-core/libraries/FullMath.sol";
import {FixedPoint96} from "v4-core/libraries/FixedPoint96.sol";
import {IERC20Minimal} from "v4-core/interfaces/external/IERC20Minimal.sol";

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
    using StateLibrary for IPoolManager;
    using CurrencyLibrary for Currency;   // native-ETH-aware transfer
    using CurrencySettler for Currency;   // native-ETH-aware settle

    uint256 private _locked = 1;
    modifier nonReentrant() { require(_locked == 1, "reentrant"); _locked = 2; _; _locked = 1; }

    struct MarketConfig {
        IPrivatePool privatePool; // the shielded pool for the SAME pair (R00T/ETH or parcel/R00T)
        address regenTreasury;    // where the captured spread goes
        Currency treasuryCurrency;// the numeraire the treasury accrues (WETH for base, R00T for parcels)
        bytes32 marketId;         // parcelId, or a sentinel for the base R00T market
        bool registered;
    }

    IPoolManager public immutable poolManager;
    address public immutable deployer;  // may (re)point the launchpad registrar
    address public launchpad;           // the only registrar (settable once wiring is known)

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
        deployer = msg.sender;
    }

    /// @notice Point the registrar at the RegenLaunchpad (resolves the launchpad↔hook deploy cycle).
    /// @dev Callable by the deployer OR the current launchpad (one-way hand-off): when deployed via a
    ///      CREATE2 factory the `deployer` is the factory, so the bootstrapper sets itself as the
    ///      initial launchpad in the constructor and then hands off to the real RegenLaunchpad here.
    function setLaunchpad(address l) external {
        if (msg.sender != deployer && msg.sender != launchpad) revert NotLaunchpad();
        launchpad = l;
    }

    /// @notice Wire a market's Uniswap pool to its private pool + regen treasury. onlyLaunchpad.
    /// @param treasuryCurrency the numeraire the treasury should accrue (must be one of the pair's
    ///        currencies) — WETH for the base R00T/ETH market, R00T for parcel/R00T markets. When an
    ///        arb naturally yields the OTHER currency, the hook converts it so the treasury only ever
    ///        grows in this asset.
    function register(
        PoolKey calldata key, IPrivatePool privatePool, address regenTreasury, Currency treasuryCurrency, bytes32 marketId
    ) external {
        if (msg.sender != launchpad) revert NotLaunchpad();
        require(
            Currency.unwrap(treasuryCurrency) == Currency.unwrap(key.currency0) ||
            Currency.unwrap(treasuryCurrency) == Currency.unwrap(key.currency1),
            "treasuryCurrency not in pair"
        );
        configs[key.toId()] = MarketConfig(privatePool, regenTreasury, treasuryCurrency, marketId, true);
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
    ) external onlyPoolManager nonReentrant returns (bytes4, int128) {
        MarketConfig memory cfg = configs[key.toId()];
        if (!cfg.registered) return (IHooks.afterSwap.selector, int128(0));

        uint256 uniPriceE18 = _uniPriceE18(key);
        (uint256 r0, uint256 r1) = cfg.privatePool.getReserves();
        (bool doArb, bool privZeroForOne, uint256 amountIn) = computeArb(uniPriceE18, r0, r1);
        if (!doArb) { emit SyncSkipped(cfg.marketId, uniPriceE18, r0 == 0 ? 0 : (r1 * WAD) / r0); return (IHooks.afterSwap.selector, int128(0)); }

        _executeArb(key, cfg, privZeroForOne, amountIn, uniPriceE18, (r1 * WAD) / r0);
        return (IHooks.afterSwap.selector, int128(0));
    }

    /// @dev The real two-leg arb. Uses the hook's small inventory for the private leg; the Uniswap
    ///      leg replenishes it + the spread. Both directions. Never reverts the user swap: if the
    ///      round-trip nets <= 0 (shouldn't past the threshold+cap), it just skips the treasury sweep.
    function _executeArb(
        PoolKey calldata key, MarketConfig memory cfg, bool privZeroForOne, uint256 amountIn,
        uint256 uniPriceE18, uint256 privPriceE18
    ) internal {
        Currency c0 = key.currency0;
        Currency c1 = key.currency1;

        if (!privZeroForOne) {
            // uni prices currency0 DEARER → buy currency0 cheap on private (sell currency1 in),
            // then sell that currency0 on uni for currency1. profit in currency1.
            uint256 out0 = _privateLeg(cfg.privatePool, false, amountIn, c1); // -amountIn c1, +out0 c0
            BalanceDelta d = poolManager.swap(
                key,
                IPoolManager.SwapParams({ zeroForOne: true, amountSpecified: -int256(out0), sqrtPriceLimitX96: TickMath.MIN_SQRT_PRICE + 1 }),
                ""
            );
            _settle(c0, out0);                                            // pay the currency0 we owe
            uint256 uniOut1 = uint256(int256(d.amount1()));               // currency1 we're owed
            poolManager.take(c1, address(this), uniOut1);
            if (uniOut1 > amountIn) {
                uint256 profit = uniOut1 - amountIn;                      // surplus, held in c1
                _payTreasury(key, cfg, c1, profit, uniPriceE18, privPriceE18);
            }
        } else {
            // uni prices currency0 CHEAPER → sell currency0 into private, buy currency0 on uni. profit in currency0.
            uint256 out1 = _privateLeg(cfg.privatePool, true, amountIn, c0); // -amountIn c0, +out1 c1
            BalanceDelta d = poolManager.swap(
                key,
                IPoolManager.SwapParams({ zeroForOne: false, amountSpecified: -int256(out1), sqrtPriceLimitX96: TickMath.MAX_SQRT_PRICE - 1 }),
                ""
            );
            _settle(c1, out1);
            uint256 uniOut0 = uint256(int256(d.amount0()));
            poolManager.take(c0, address(this), uniOut0);
            if (uniOut0 > amountIn) {
                uint256 profit = uniOut0 - amountIn;                      // surplus, held in c0
                _payTreasury(key, cfg, c0, profit, uniPriceE18, privPriceE18);
            }
        }
    }

    /// @dev Run the private-pool leg. If the input currency is native ETH, forward it as msg.value;
    ///      otherwise approve the pool to pull the ERC20. Works for both RegenPrivatePool and the real
    ///      ZkAMMPair adapter.
    function _privateLeg(IPrivatePool pool, bool zeroForOne, uint256 amountIn, Currency inputCcy)
        internal returns (uint256 amountOut)
    {
        if (inputCcy.isAddressZero()) {
            amountOut = pool.rebalanceSwap{value: amountIn}(zeroForOne, amountIn);
        } else {
            IERC20Minimal(Currency.unwrap(inputCcy)).approve(address(pool), amountIn);
            amountOut = pool.rebalanceSwap(zeroForOne, amountIn);
        }
    }

    /// @dev Deliver the captured `profit` (held by the hook in `profitCcy`) to the regen treasury,
    ///      denominated in `cfg.treasuryCurrency`. If they already match, transfer directly; otherwise
    ///      convert via one small swap on the same Uniswap pool so the treasury only ever grows in its
    ///      chosen numeraire (e.g. always WETH for the base R00T/ETH market).
    function _payTreasury(
        PoolKey calldata key, MarketConfig memory cfg, Currency profitCcy, uint256 profit,
        uint256 uniPriceE18, uint256 privPriceE18
    ) internal {
        if (Currency.unwrap(profitCcy) == Currency.unwrap(cfg.treasuryCurrency)) {
            profitCcy.transfer(cfg.regenTreasury, profit); // native-ETH-aware
            emit SpreadCaptured(cfg.marketId, profit, uniPriceE18, privPriceE18);
            return;
        }
        // convert profit -> treasuryCurrency on the same pool, sending the output straight to treasury
        bool zeroForOne = Currency.unwrap(profitCcy) == Currency.unwrap(key.currency0); // selling currency0?
        BalanceDelta d = poolManager.swap(
            key,
            IPoolManager.SwapParams({
                zeroForOne: zeroForOne,
                amountSpecified: -int256(profit),
                sqrtPriceLimitX96: zeroForOne ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1
            }),
            ""
        );
        _settle(profitCcy, profit);
        uint256 outT = zeroForOne ? uint256(int256(d.amount1())) : uint256(int256(d.amount0()));
        poolManager.take(cfg.treasuryCurrency, cfg.regenTreasury, outT);
        emit SpreadCaptured(cfg.marketId, outT, uniPriceE18, privPriceE18);
    }

    /// @dev Pay `amount` of `c` we owe the pool. Native-ETH-aware (settle{value} vs sync/transfer).
    function _settle(Currency c, uint256 amount) internal {
        c.settle(poolManager, address(this), amount, false);
    }

    /// @dev Uniswap price = currency1 per currency0, 1e18, from slot0 sqrtPriceX96.
    function _uniPriceE18(PoolKey calldata key) internal view returns (uint256) {
        (uint160 sqrtPriceX96,,,) = poolManager.getSlot0(key.toId());
        // price1/0 = (sqrtP/2^96)^2. Do it in two mulDivs to hold precision without overflow.
        uint256 p = FullMath.mulDiv(uint256(sqrtPriceX96), uint256(sqrtPriceX96), FixedPoint96.Q96);
        return FullMath.mulDiv(p, WAD, FixedPoint96.Q96);
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
