// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";

import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {PoolSwapTest} from "v4-core/test/PoolSwapTest.sol";
import {PoolModifyLiquidityTest} from "v4-core/test/PoolModifyLiquidityTest.sol";
import {PoolKey} from "v4-core/types/PoolKey.sol";
import {Currency} from "v4-core/types/Currency.sol";
import {IHooks} from "v4-core/interfaces/IHooks.sol";
import {Hooks} from "v4-core/libraries/Hooks.sol";
import {TickMath} from "v4-core/libraries/TickMath.sol";
import {StateLibrary} from "v4-core/libraries/StateLibrary.sol";
import {PoolIdLibrary} from "v4-core/types/PoolId.sol";

import {RegenArbHook} from "../../src/hackathon/RegenArbHook.sol";
import {IPrivatePool} from "../../src/hackathon/interfaces/IPrivatePool.sol";
import {RegenTestAMM} from "../../test/hackathon/mocks/RegenTestAMM.sol";
import {TestToken} from "../../test/hackathon/mocks/TestToken.sol";
import {HookMiner} from "./HookMiner.sol";

/// @notice LIVE deploy + one real cross-pool arb against a REAL Uniswap v4 PoolManager.
///         Deploys R00T + WETH mocks, mines & CREATE2-deploys the RegenArbHook (afterSwap flag),
///         opens the public pool, adds liquidity, stands up a DIVERGENT private AMM, registers the
///         market (treasury numeraire = WETH), then a user swap back-runs into the arb — proving the
///         regen treasury accrues WETH on-chain. Run with --broadcast against the target v4 chain.
///
///   POOL_MANAGER env selects the chain's PoolManager:
///     Ethereum Sepolia 0xE03A1074c86CFeDd5C142C4F04F1a1536e203543
///     Base Sepolia     0x05E73354cFDd6745C338b50BcFDfA3Aa6fA03408
///     Unichain Sepolia 0x00b036b58a818b1bc34d502d3fe730db729e62ac
contract DeployRegenArbLive is Script {
    using StateLibrary for IPoolManager;
    using PoolIdLibrary for PoolKey;

    uint160 constant SQRT_1 = 79228162514264337593543950336; // price 1.0

    function run() external {
        IPoolManager manager = IPoolManager(vm.envAddress("POOL_MANAGER"));
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address me = vm.addr(pk);
        address treasury = address(uint160(uint256(keccak256("r00t.regen.treasury"))));

        vm.startBroadcast(pk);

        // 1) tokens: R00T + WETH (WETH is the treasury numeraire = "aim for ETH")
        TestToken root = new TestToken("r00t.fund", "ROOT");
        TestToken weth = new TestToken("Wrapped Ether", "WETH");
        (Currency c0, Currency c1) = address(root) < address(weth)
            ? (Currency.wrap(address(root)), Currency.wrap(address(weth)))
            : (Currency.wrap(address(weth)), Currency.wrap(address(root)));

        // 2) test routers bound to the REAL manager
        PoolSwapTest swapRouter = new PoolSwapTest(manager);
        PoolModifyLiquidityTest lpRouter = new PoolModifyLiquidityTest(manager);

        // 3) mine + CREATE2-deploy the hook (only afterSwap bit set); launchpad = me
        bytes memory args = abi.encode(manager, me);
        (address hookAddr, bytes32 salt) =
            HookMiner.find(uint160(Hooks.AFTER_SWAP_FLAG), type(RegenArbHook).creationCode, args);
        RegenArbHook hook = new RegenArbHook{salt: salt}(manager, me);
        require(address(hook) == hookAddr, "hook addr mismatch");

        PoolKey memory key = PoolKey({currency0: c0, currency1: c1, fee: 3000, tickSpacing: 60, hooks: IHooks(hookAddr)});
        manager.initialize(key, SQRT_1);

        // 4) deep full-range liquidity on the public pool
        root.mint(me, 2_000_000e18);
        weth.mint(me, 2_000_000e18);
        root.approve(address(lpRouter), type(uint256).max);
        weth.approve(address(lpRouter), type(uint256).max);
        lpRouter.modifyLiquidity(
            key, IPoolManager.ModifyLiquidityParams({tickLower: -600, tickUpper: 600, liquidityDelta: 5_000e18, salt: 0}), ""
        );

        // 5) DIVERGENT private pool: currency0 priced 0.5 there vs 1.0 on Uni
        RegenTestAMM priv = new RegenTestAMM(TestToken(Currency.unwrap(c0)), TestToken(Currency.unwrap(c1)));
        TestToken(Currency.unwrap(c0)).mint(me, 2_000e18);
        TestToken(Currency.unwrap(c1)).mint(me, 1_000e18);
        TestToken(Currency.unwrap(c0)).approve(address(priv), type(uint256).max);
        TestToken(Currency.unwrap(c1)).approve(address(priv), type(uint256).max);
        priv.seed(2_000e18, 1_000e18);
        priv.setRebalancer(address(hook));

        // 6) wire the market: treasury accrues WETH regardless of arb direction
        hook.register(key, IPrivatePool(address(priv)), treasury, Currency.wrap(address(weth)), bytes32("DEMO-PARCEL"));
        // hook working inventory for the private leg (currency1)
        TestToken(Currency.unwrap(c1)).mint(address(hook), 500e18);

        // 7) a real user swap -> afterSwap back-runs the cross-pool arb
        root.approve(address(swapRouter), type(uint256).max);
        weth.approve(address(swapRouter), type(uint256).max);
        swapRouter.swap(
            key,
            IPoolManager.SwapParams({zeroForOne: true, amountSpecified: -1e18, sqrtPriceLimitX96: TickMath.MIN_SQRT_PRICE + 1}),
            PoolSwapTest.TestSettings({takeClaims: false, settleUsingBurn: false}),
            ""
        );

        vm.stopBroadcast();

        (uint256 pr0, uint256 pr1) = priv.getReserves();
        console2.log("== RegenArbHook LIVE ==");
        console2.log("PoolManager   ", address(manager));
        console2.log("hook          ", address(hook));
        console2.log("salt          ", uint256(salt));
        console2.log("ROOT          ", address(root));
        console2.log("WETH          ", address(weth));
        console2.log("privateAMM    ", address(priv));
        console2.log("treasury      ", treasury);
        console2.log("treasury WETH ", weth.balanceOf(treasury));
        console2.log("priv reserve0 ", pr0);
        console2.log("priv reserve1 ", pr1);
    }
}
