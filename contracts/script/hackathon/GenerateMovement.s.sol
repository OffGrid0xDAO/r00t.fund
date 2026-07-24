// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {PoolSwapTest} from "v4-core/test/PoolSwapTest.sol";
import {PoolKey} from "v4-core/types/PoolKey.sol";
import {Currency} from "v4-core/types/Currency.sol";
import {IHooks} from "v4-core/interfaces/IHooks.sol";
import {TickMath} from "v4-core/libraries/TickMath.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface IMintable { function mint(address to, uint256 a) external; }

/// @notice Generates ORGANIC movement on the LIVE OAK/R00T v4 pool — a long interleaved sequence of
///         varied buys/sells so the public price wiggles up and down. Every swap fires the hook, so
///         the private pool visibly rebalances behind it (watch the two lines converge in the chart).
///         currency0 = R00T (lower addr), currency1 = OAK.
contract GenerateMovement is Script {
    IPoolManager constant PM = IPoolManager(0xE03A1074c86CFeDd5C142C4F04F1a1536e203543);
    address constant HOOK = 0x259083118770202EF1eC4d36Db321F6aBd24C040;
    address constant ROOT = 0x3d47002Cbe4e1d1a0640fc20aD1a75eB6559D73B;
    address constant OAK  = 0x48B1Ccf919A676f3108106D0Ef7dB767821258D0;

    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address me = vm.addr(pk);
        PoolKey memory key = PoolKey({currency0: Currency.wrap(ROOT), currency1: Currency.wrap(OAK), fee: 3000, tickSpacing: 60, hooks: IHooks(HOOK)});

        vm.startBroadcast(pk);
        PoolSwapTest router = new PoolSwapTest(PM);
        // top up + approve so the whole sequence can run
        IMintable(ROOT).mint(me, 200_000e18);
        IMintable(OAK).mint(me, 2_000_000e18);
        IERC20(ROOT).approve(address(router), type(uint256).max);
        IERC20(OAK).approve(address(router), type(uint256).max);

        // interleaved buys (R00T in) / sells (OAK in), varied sizes → an organic wiggle
        _buy(router, key, 120e18);
        _sell(router, key, 2_500e18);
        _buy(router, key, 260e18);
        _buy(router, key, 90e18);
        _sell(router, key, 4_000e18);
        _sell(router, key, 1_200e18);
        _buy(router, key, 380e18);
        _sell(router, key, 2_000e18);
        _buy(router, key, 150e18);
        _buy(router, key, 300e18);
        _sell(router, key, 5_500e18);
        _sell(router, key, 1_800e18);
        _buy(router, key, 210e18);
        _buy(router, key, 440e18);
        _sell(router, key, 3_200e18);
        _buy(router, key, 100e18);
        vm.stopBroadcast();

        console2.log("generated 16 organic trades on OAK/R00T (hook auto-rebalanced each)");
    }

    function _buy(PoolSwapTest router, PoolKey memory key, uint256 rootIn) internal {
        router.swap(
            key,
            IPoolManager.SwapParams({zeroForOne: true, amountSpecified: -int256(rootIn), sqrtPriceLimitX96: TickMath.MIN_SQRT_PRICE + 1}),
            PoolSwapTest.TestSettings({takeClaims: false, settleUsingBurn: false}), ""
        );
    }

    function _sell(PoolSwapTest router, PoolKey memory key, uint256 oakIn) internal {
        router.swap(
            key,
            IPoolManager.SwapParams({zeroForOne: false, amountSpecified: -int256(oakIn), sqrtPriceLimitX96: TickMath.MAX_SQRT_PRICE - 1}),
            PoolSwapTest.TestSettings({takeClaims: false, settleUsingBurn: false}), ""
        );
    }
}
