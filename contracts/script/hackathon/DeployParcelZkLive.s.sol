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
import {LiquidityAmounts} from "v4-core-test/utils/LiquidityAmounts.sol";

import {RegenArbHook} from "../../src/hackathon/RegenArbHook.sol";
import {ZkParcelRebalanceAdapter, IZkParcelPool} from "../../src/hackathon/ZkParcelRebalanceAdapter.sol";
import {IPrivatePool} from "../../src/hackathon/interfaces/IPrivatePool.sol";
import {ZkParcelPool} from "../../src/ZkParcelPool.sol";
import {PoseidonT3Deployer} from "../../src/PoseidonT3.sol";
import {NullifierRegistry} from "../../src/NullifierRegistry.sol";
import {RealSwapVerifier} from "../../src/verifiers/RealSwapVerifier.sol";
import {RealDepositVerifier} from "../../src/verifiers/RealDepositVerifier.sol";
import {RealWithdrawVerifier} from "../../src/verifiers/RealWithdrawVerifier.sol";
import {TestToken} from "../../test/hackathon/mocks/TestToken.sol";
import {HookMiner} from "./HookMiner.sol";

/// @notice LIVE deploy of a GENUINELY ZK-SHIELDED parcel market (OAK/R00T) on a v4 chain: the real
///         ZkParcelPool (shielded user trades via real Groth16 verifiers) as the private pool, wired
///         to the RegenArbHook through ZkParcelRebalanceAdapter, against a REAL Uniswap v4 pool.
///         Seeds the two pools DIVERGENT, then a user swap back-runs the arb — the SHIELDED pool's real
///         reserves rebalance toward the public price and the spread funds the parcel regen treasury.
contract DeployParcelZkLive is Script {
    using StateLibrary for IPoolManager;
    using PoolIdLibrary for PoolKey;

    uint160 constant SQRT_1 = 79228162514264337593543950336; // price 1.0

    function run() external {
        IPoolManager manager = IPoolManager(vm.envAddress("POOL_MANAGER"));
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address me = vm.addr(pk);
        address treasury = address(uint160(uint256(keccak256("r00t.regen.treasury.oakzk"))));

        vm.startBroadcast(pk);

        // tokens
        TestToken root = new TestToken("r00t.fund", "ROOT");
        TestToken parcel = new TestToken("Oak Parcel", "OAK");

        // real ZK stack: Groth16 verifiers + shared nullifier registry + poseidon
        RealSwapVerifier swapV = new RealSwapVerifier();
        RealDepositVerifier depV = new RealDepositVerifier();
        RealWithdrawVerifier wdV = new RealWithdrawVerifier();
        NullifierRegistry registry = new NullifierRegistry(me);
        address poseidon = PoseidonT3Deployer.deploy();

        // the REAL shielded parcel pool (creator = me)
        ZkParcelPool pool = new ZkParcelPool(
            bytes32("OAK-ZK"), address(root), address(parcel),
            address(swapV), address(depV), address(wdV), address(registry), me, poseidon
        );
        registry.setPoolAuthorization(address(pool), true); // authorize for shielded trades

        // seed the shielded pool DIVERGENT vs the public pool
        root.mint(me, 5_000_000e18);
        parcel.mint(me, 5_000_000e18);
        root.transfer(address(pool), 2_000e18);
        parcel.transfer(address(pool), 4_000e18);
        pool.seed(); // private reserves 2000 R00T / 4000 OAK

        // adapter presents the shielded pool as IPrivatePool + is its rebalancer
        ZkParcelRebalanceAdapter adapter = new ZkParcelRebalanceAdapter(IZkParcelPool(address(pool)));
        pool.setRebalancer(address(adapter));

        // mine + deploy the hook; launchpad = me (so we can register)
        bytes memory args = abi.encode(manager, me);
        uint256 startSalt = uint256(keccak256(abi.encodePacked(me, block.timestamp)));
        (address hookAddr, bytes32 salt) = HookMiner.find(uint160(Hooks.AFTER_SWAP_FLAG), type(RegenArbHook).creationCode, args, startSalt);
        RegenArbHook hook = new RegenArbHook{salt: salt}(manager, me);
        require(address(hook) == hookAddr, "hook addr mismatch");
        adapter.setRebalancer(hookAddr);

        // public v4 pool at price 1.0 (currency-sorted)
        PoolSwapTest swapRouter = new PoolSwapTest(manager);
        PoolModifyLiquidityTest lpRouter = new PoolModifyLiquidityTest(manager);
        (Currency c0, Currency c1) = address(root) < address(parcel)
            ? (Currency.wrap(address(root)), Currency.wrap(address(parcel)))
            : (Currency.wrap(address(parcel)), Currency.wrap(address(root)));
        PoolKey memory key = PoolKey({currency0: c0, currency1: c1, fee: 3000, tickSpacing: 60, hooks: IHooks(hookAddr)});
        manager.initialize(key, SQRT_1);

        root.approve(address(lpRouter), type(uint256).max);
        parcel.approve(address(lpRouter), type(uint256).max);
        uint128 liq = LiquidityAmounts.getLiquidityForAmounts(
            SQRT_1, TickMath.getSqrtPriceAtTick(-887220), TickMath.getSqrtPriceAtTick(887220), 5_000e18, 5_000e18
        );
        lpRouter.modifyLiquidity(
            key, IPoolManager.ModifyLiquidityParams({tickLower: -887220, tickUpper: 887220, liquidityDelta: int256(uint256(liq)), salt: 0}), ""
        );

        // wire the market (treasury numeraire = R00T) + hook working inventory
        hook.register(key, IPrivatePool(address(adapter)), treasury, Currency.wrap(address(root)), bytes32("OAK-ZK"));
        root.transfer(address(hook), 2_000e18);
        parcel.transfer(address(hook), 2_000e18);

        // a real user swap back-runs the arb against the SHIELDED pool
        root.approve(address(swapRouter), type(uint256).max);
        parcel.approve(address(swapRouter), type(uint256).max);
        (uint256 pr0, uint256 pp0) = pool.getReserves();
        bool zeroForOne = address(root) < address(parcel); // sell R00T in → push parcel dearer on Uni
        swapRouter.swap(
            key,
            IPoolManager.SwapParams({zeroForOne: zeroForOne, amountSpecified: -1_000e18,
                sqrtPriceLimitX96: zeroForOne ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1}),
            PoolSwapTest.TestSettings({takeClaims: false, settleUsingBurn: false}),
            ""
        );

        vm.stopBroadcast();

        (uint256 pr1, uint256 pp1) = pool.getReserves();
        console2.log("== SHIELDED PARCEL (ZkParcelPool) LIVE ==");
        console2.log("PoolManager    ", address(manager));
        console2.log("hook           ", address(hook));
        console2.log("ROOT           ", address(root));
        console2.log("OAK parcel     ", address(parcel));
        console2.log("ZkParcelPool   ", address(pool));
        console2.log("adapter        ", address(adapter));
        console2.log("swapVerifier   ", address(swapV));
        console2.log("nullifierReg   ", address(registry));
        console2.log("treasury       ", treasury);
        console2.log("shielded r00t before/after:", pr0, pr1);
        console2.log("shielded parcel before/after:", pp0, pp1);
        console2.log("treasury R00T:", root.balanceOf(treasury));
    }
}
