// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {PoolSwapTest} from "v4-core/test/PoolSwapTest.sol";
import {PoolKey} from "v4-core/types/PoolKey.sol";
import {Currency, CurrencyLibrary} from "v4-core/types/Currency.sol";
import {IHooks} from "v4-core/interfaces/IHooks.sol";
import {TickMath} from "v4-core/libraries/TickMath.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @notice ORGANIC volume on BOTH markets so you can watch the shared RegenArbHook fire on each swap:
///         the base ETH/R00T pool (private = shielded zkAMM) AND a parcel/R00T pool (private = zkParcel/
///         RegenPrivatePool). Each run does a small RANDOMIZED batch of interleaved buys/sells sized off
///         a block-derived seed — run it on a loop (see organic-volume.sh) to trickle volume for hours.
///
/// env: PRIVATE_KEY; optional overrides POOL_MANAGER, HOOK, ROOT, PARCEL, ROUTER, DO_ETH(1/0), DO_PARCEL(1/0),
///      SWAPS(default 8). Defaults target the current Sepolia hackathon stack (config.ts HACKATHON).
contract OrganicVolume is Script {
    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address me = vm.addr(pk);
        IPoolManager PM = IPoolManager(vm.envOr("POOL_MANAGER", address(0xE03A1074c86CFeDd5C142C4F04F1a1536e203543)));
        address HOOK = vm.envOr("HOOK", address(0x2B019cC4D35CeB177fe41a4A8b4D873494C20040));
        address ROOT = vm.envOr("ROOT", address(0x70E3432B83a83Caa818a98010DF87AF6daa6AbC9));
        address PARCEL = vm.envOr("PARCEL", address(0)); // e.g. your launched $HAY token
        bool doEth = vm.envOr("DO_ETH", true);
        bool doParcel = vm.envOr("DO_PARCEL", true) && PARCEL != address(0);
        uint256 swaps = vm.envOr("SWAPS", uint256(8));
        uint256 seed = uint256(keccak256(abi.encode(block.timestamp, block.prevrandao, me, block.number)));

        vm.startBroadcast(pk);
        // reuse a router across loop runs (pass ROUTER) or deploy a fresh one
        address routerEnv = vm.envOr("ROUTER", address(0));
        PoolSwapTest router = routerEnv == address(0) ? new PoolSwapTest(PM) : PoolSwapTest(payable(routerEnv));
        if (routerEnv == address(0)) console2.log("ROUTER (reuse next runs):", address(router));

        // top up + approve R00T (always mintable TestToken); best-effort mint PARCEL (skips if not mintable)
        _tryMint(ROOT, me, 200_000e18);
        IERC20(ROOT).approve(address(router), type(uint256).max);
        if (doParcel) { _tryMint(PARCEL, me, 2_000_000e18); IERC20(PARCEL).approve(address(router), type(uint256).max); }

        PoolKey memory ethKey = PoolKey({ currency0: CurrencyLibrary.ADDRESS_ZERO, currency1: Currency.wrap(ROOT), fee: 3000, tickSpacing: 60, hooks: IHooks(HOOK) });
        (Currency c0, Currency c1) = ROOT < PARCEL ? (Currency.wrap(ROOT), Currency.wrap(PARCEL)) : (Currency.wrap(PARCEL), Currency.wrap(ROOT));
        PoolKey memory pKey = PoolKey({ currency0: c0, currency1: c1, fee: 3000, tickSpacing: 60, hooks: IHooks(HOOK) });
        bool rootIs0 = ROOT < PARCEL;

        // seed some parcel inventory first so later "sells" have tokens (in case PARCEL wasn't mintable)
        if (doParcel) _buyParcel(router, pKey, rootIs0, 300e18 + (seed % 200e18));

        uint256 done;
        for (uint256 i = 0; i < swaps; i++) {
            seed = uint256(keccak256(abi.encode(seed, i)));
            bool onEth = doEth && (!doParcel || (seed & 1) == 0);
            bool buy = (seed >> 1 & 1) == 0;
            if (onEth) {
                // sized to cross the 0.30% divergence gate so the hook reliably arbs the shielded zkAMM
                if (buy) _buyRoot(router, ethKey, 0.02 ether + (seed % 0.05 ether));
                else     _sellRoot(router, ethKey, 3_000e18 + (seed % 6_000e18));
            } else if (doParcel) {
                if (buy) _buyParcel(router, pKey, rootIs0, 120e18 + (seed % 400e18));
                else     _sellParcel(router, pKey, rootIs0, 1_500e18 + (seed % 4_000e18));
            }
            done++;
        }
        vm.stopBroadcast();
        console2.log("organic volume: swaps this run =", done);
    }

    // ── ETH/R00T (currency0 = native ETH) ──
    function _buyRoot(PoolSwapTest r, PoolKey memory k, uint256 ethIn) internal {
        try r.swap{value: ethIn}(k, IPoolManager.SwapParams({zeroForOne: true, amountSpecified: -int256(ethIn), sqrtPriceLimitX96: TickMath.MIN_SQRT_PRICE + 1}), PoolSwapTest.TestSettings({takeClaims: false, settleUsingBurn: false}), "") {} catch {}
    }
    function _sellRoot(PoolSwapTest r, PoolKey memory k, uint256 rootIn) internal {
        try r.swap(k, IPoolManager.SwapParams({zeroForOne: false, amountSpecified: -int256(rootIn), sqrtPriceLimitX96: TickMath.MAX_SQRT_PRICE - 1}), PoolSwapTest.TestSettings({takeClaims: false, settleUsingBurn: false}), "") {} catch {}
    }
    // ── PARCEL/R00T ── buy parcel = R00T in; sell parcel = parcel in. direction depends on token ordering.
    function _buyParcel(PoolSwapTest r, PoolKey memory k, bool rootIs0, uint256 rootIn) internal {
        bool z4o = rootIs0; // selling currency0 when R00T is currency0
        try r.swap(k, IPoolManager.SwapParams({zeroForOne: z4o, amountSpecified: -int256(rootIn), sqrtPriceLimitX96: z4o ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1}), PoolSwapTest.TestSettings({takeClaims: false, settleUsingBurn: false}), "") {} catch {}
    }
    function _sellParcel(PoolSwapTest r, PoolKey memory k, bool rootIs0, uint256 parcelIn) internal {
        bool z4o = !rootIs0; // parcel is currency0 when R00T is currency1
        try r.swap(k, IPoolManager.SwapParams({zeroForOne: z4o, amountSpecified: -int256(parcelIn), sqrtPriceLimitX96: z4o ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1}), PoolSwapTest.TestSettings({takeClaims: false, settleUsingBurn: false}), "") {} catch {}
    }

    function _tryMint(address token, address to, uint256 amt) internal {
        (bool ok, ) = token.call(abi.encodeWithSignature("mint(address,uint256)", to, amt));
        ok; // ignore — non-mintable tokens (ParcelToken) just skip; we acquire inventory by buying
    }
}
