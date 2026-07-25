// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {PoolSwapTest} from "v4-core/test/PoolSwapTest.sol";
import {PoolKey} from "v4-core/types/PoolKey.sol";
import {Currency, CurrencyLibrary} from "v4-core/types/Currency.sol";
import {IHooks} from "v4-core/interfaces/IHooks.sol";
import {TickMath} from "v4-core/libraries/TickMath.sol";
import {StateLibrary} from "v4-core/libraries/StateLibrary.sol";
import {PoolIdLibrary} from "v4-core/types/PoolId.sol";
import {FullMath} from "v4-core/libraries/FullMath.sol";
import {FixedPoint96} from "v4-core/libraries/FixedPoint96.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface IReserves { function getReserves() external view returns (uint256, uint256); }

/// @notice Real trades on the CLEAN R00T/ETH base market — proves the arb converges (10% cap, in-sync
///         start) and the treasury grows in ETH after each swap.
contract TestArbClean is Script {
    using StateLibrary for IPoolManager;
    using PoolIdLibrary for PoolKey;
    IPoolManager constant PM = IPoolManager(0xE03A1074c86CFeDd5C142C4F04F1a1536e203543);
    address constant HOOK = 0x2B019cC4D35CeB177fe41a4A8b4D873494C20040;
    address constant ROOT = 0x70E3432B83a83Caa818a98010DF87AF6daa6AbC9;
    address constant ZK   = 0xf597Edb2B8380177c42D2FAc45A2D9A4f191D549;
    address constant TRE  = 0xBe196EEfCD38593a681f906F11fa4832889e96F5;

    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        PoolKey memory key = PoolKey({currency0: CurrencyLibrary.ADDRESS_ZERO, currency1: Currency.wrap(ROOT), fee: 3000, tickSpacing: 60, hooks: IHooks(HOOK)});
        vm.startBroadcast(pk);
        PoolSwapTest r = new PoolSwapTest(PM);
        IERC20(ROOT).approve(address(r), type(uint256).max);
        _log("before", key);
        _buy(r, key, 0.03 ether); _log("after buy R00T /0.03 ETH", key);
        _sell(r, key, 8_000e18);  _log("after sell 8000 R00T", key);
        _buy(r, key, 0.05 ether); _log("after buy R00T /0.05 ETH", key);
        vm.stopBroadcast();
    }
    function _buy(PoolSwapTest r, PoolKey memory k, uint256 e) internal {
        r.swap{value: e}(k, IPoolManager.SwapParams({zeroForOne: true, amountSpecified: -int256(e), sqrtPriceLimitX96: TickMath.MIN_SQRT_PRICE + 1}), PoolSwapTest.TestSettings({takeClaims: false, settleUsingBurn: false}), "");
    }
    function _sell(PoolSwapTest r, PoolKey memory k, uint256 a) internal {
        r.swap(k, IPoolManager.SwapParams({zeroForOne: false, amountSpecified: -int256(a), sqrtPriceLimitX96: TickMath.MAX_SQRT_PRICE - 1}), PoolSwapTest.TestSettings({takeClaims: false, settleUsingBurn: false}), "");
    }
    function _log(string memory tag, PoolKey memory k) internal view {
        (uint160 s,,,) = PM.getSlot0(k.toId());
        uint256 p = FullMath.mulDiv(uint256(s), uint256(s), FixedPoint96.Q96);
        uint256 pub = FullMath.mulDiv(p, 1e18, FixedPoint96.Q96);
        (uint256 e, uint256 rt) = IReserves(ZK).getReserves();
        console2.log(tag);
        console2.log("  public R00T/ETH:", pub);
        console2.log("  zkAMM  R00T/ETH:", e == 0 ? 0 : rt * 1e18 / e);
        console2.log("  treasury ETH wei:", TRE.balance);
    }
}
