// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {PoolSwapTest} from "v4-core/test/PoolSwapTest.sol";
import {PoolKey} from "v4-core/types/PoolKey.sol";
import {Currency} from "v4-core/types/Currency.sol";
import {IHooks} from "v4-core/interfaces/IHooks.sol";
import {TickMath} from "v4-core/libraries/TickMath.sol";
import {StateLibrary} from "v4-core/libraries/StateLibrary.sol";
import {PoolIdLibrary} from "v4-core/types/PoolId.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface IReserves { function getReserves() external view returns (uint256, uint256); }

/// @notice Fires REAL test trades at the LIVE OAK/R00T v4 pool on Sepolia. Each user swap triggers the
///         RegenArbHook afterSwap, which back-runs a cross-pool arb: the private pool re-syncs toward
///         the public price and the captured spread accrues to the parcel's regen treasury (in R00T).
///         Logs treasury + both pools before and after each trade so the rebalancing is visible.
contract TestTradeOak is Script {
    using StateLibrary for IPoolManager;
    using PoolIdLibrary for PoolKey;

    IPoolManager constant PM = IPoolManager(0xE03A1074c86CFeDd5C142C4F04F1a1536e203543);
    address constant HOOK = 0x259083118770202EF1eC4d36Db321F6aBd24C040;
    address constant ROOT = 0x3d47002Cbe4e1d1a0640fc20aD1a75eB6559D73B;
    address constant OAK  = 0x48B1Ccf919A676f3108106D0Ef7dB767821258D0;
    address constant PRIV = 0xA9e2e97168d49b73B55a6df058e15F83082B7213;
    address constant TREASURY = 0x30165243a74A823DC3E15Fd4039157e7bf53bf20;

    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        // currency0 = R00T (lower address), currency1 = OAK
        PoolKey memory key = PoolKey({
            currency0: Currency.wrap(ROOT), currency1: Currency.wrap(OAK),
            fee: 3000, tickSpacing: 60, hooks: IHooks(HOOK)
        });

        vm.startBroadcast(pk);
        PoolSwapTest router = new PoolSwapTest(PM);
        IERC20(ROOT).approve(address(router), type(uint256).max);
        IERC20(OAK).approve(address(router), type(uint256).max);

        _log("BEFORE ANY TRADE", key);
        _trade(router, key, true,  2_000e18); _log("after buy OAK with 2000 R00T", key);
        _trade(router, key, false, 1_000e18); _log("after sell 1000 OAK for R00T", key);
        _trade(router, key, true,  3_000e18); _log("after buy OAK with 3000 R00T", key);
        vm.stopBroadcast();
    }

    function _trade(PoolSwapTest router, PoolKey memory key, bool zeroForOne, uint256 amtIn) internal {
        router.swap(
            key,
            IPoolManager.SwapParams({
                zeroForOne: zeroForOne,
                amountSpecified: -int256(amtIn),
                sqrtPriceLimitX96: zeroForOne ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1
            }),
            PoolSwapTest.TestSettings({takeClaims: false, settleUsingBurn: false}),
            ""
        );
    }

    function _log(string memory tag, PoolKey memory key) internal view {
        (uint160 s,,,) = PM.getSlot0(key.toId());
        // public price = R00T per OAK. currency1(OAK) per currency0(R00T) = (s/2^96)^2; invert for R00T/OAK.
        uint256 oakPerRoot = (uint256(s) * uint256(s) * 1e18) >> 192;
        uint256 rootPerOak = oakPerRoot == 0 ? 0 : (1e18 * 1e18) / oakPerRoot;
        (uint256 r0, uint256 r1) = IReserves(PRIV).getReserves(); // (R00T, OAK)
        uint256 privRootPerOak = r1 == 0 ? 0 : (r0 * 1e18) / r1;
        console2.log("== %s", tag);
        console2.log("   public  R00T/OAK (e18):", rootPerOak);
        console2.log("   private R00T/OAK (e18):", privRootPerOak);
        console2.log("   treasury R00T:", IERC20(ROOT).balanceOf(TREASURY));
    }
}
