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

/// @notice REAL test trades at the LIVE R00T/ETH v4 pool on Sepolia — the BASE market whose private
///         pool is the actual ZK-SHIELDED ZkAMMPair (native ETH/R00T, with fees). Each user swap fires
///         the RegenArbHook, which drives the zkAMM's public rebalance surface via the adapter
///         (buy/sellTokensForShorts). Proves the REAL shielded pool's reserves re-sync toward the
///         public price and the captured spread accrues to the base regen treasury IN ETH.
contract TestTradeRoot is Script {
    using StateLibrary for IPoolManager;
    using PoolIdLibrary for PoolKey;

    IPoolManager constant PM = IPoolManager(0xE03A1074c86CFeDd5C142C4F04F1a1536e203543);
    address constant HOOK = 0x075211F56D5349bC9da2331D3738BE4bFd568040;
    address constant ROOT = 0x4Dc3c11150682B6f6F3D1b1a32bA397Fd6200709;
    address constant ZKAMM = 0x6Db6AF0D6fAD4352D0c72930C81cC91EFB0b3E50;
    address constant TREASURY = 0xAD9aC7e45B26ff7A24b6b34C309Ce66915733745;

    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        // native-ETH pool: currency0 = ETH (address 0), currency1 = R00T
        PoolKey memory key = PoolKey({
            currency0: CurrencyLibrary.ADDRESS_ZERO, currency1: Currency.wrap(ROOT),
            fee: 3000, tickSpacing: 60, hooks: IHooks(HOOK)
        });

        vm.startBroadcast(pk);
        PoolSwapTest router = new PoolSwapTest(PM);
        IERC20(ROOT).approve(address(router), type(uint256).max);

        _log("BEFORE ANY TRADE", key);
        _buyRoot(router, key, 0.01 ether);  _log("after buy R00T with 0.01 ETH", key);
        _sellRoot(router, key, 3_000e18);   _log("after sell 3000 R00T for ETH", key);
        _buyRoot(router, key, 0.02 ether);  _log("after buy R00T with 0.02 ETH", key);
        vm.stopBroadcast();
    }

    // sell ETH (currency0) for R00T — zeroForOne = true, pay via msg.value
    function _buyRoot(PoolSwapTest router, PoolKey memory key, uint256 ethIn) internal {
        router.swap{value: ethIn}(
            key,
            IPoolManager.SwapParams({zeroForOne: true, amountSpecified: -int256(ethIn), sqrtPriceLimitX96: TickMath.MIN_SQRT_PRICE + 1}),
            PoolSwapTest.TestSettings({takeClaims: false, settleUsingBurn: false}),
            ""
        );
    }

    // sell R00T (currency1) for ETH — zeroForOne = false
    function _sellRoot(PoolSwapTest router, PoolKey memory key, uint256 rootIn) internal {
        router.swap(
            key,
            IPoolManager.SwapParams({zeroForOne: false, amountSpecified: -int256(rootIn), sqrtPriceLimitX96: TickMath.MAX_SQRT_PRICE - 1}),
            PoolSwapTest.TestSettings({takeClaims: false, settleUsingBurn: false}),
            ""
        );
    }

    function _log(string memory tag, PoolKey memory key) internal view {
        (uint160 s,,,) = PM.getSlot0(key.toId());
        // R00T per ETH (WAD) via two mulDivs to avoid s*s overflow at large sqrtPrice
        uint256 p = FullMath.mulDiv(uint256(s), uint256(s), FixedPoint96.Q96);
        uint256 pubRootPerEth = FullMath.mulDiv(p, 1e18, FixedPoint96.Q96);
        (uint256 ethR, uint256 rootR) = IReserves(ZKAMM).getReserves(); // (ETH, R00T)
        uint256 zkRootPerEth = ethR == 0 ? 0 : (rootR * 1e18) / ethR;
        console2.log("== %s", tag);
        console2.log("   public  R00T/ETH (e18):", pubRootPerEth);
        console2.log("   zkAMM   R00T/ETH (e18):", zkRootPerEth);
        console2.log("   zkAMM ETH reserve:", ethR);
        console2.log("   zkAMM R00T reserve:", rootR);
        console2.log("   treasury ETH (wei):", TREASURY.balance);
    }
}
