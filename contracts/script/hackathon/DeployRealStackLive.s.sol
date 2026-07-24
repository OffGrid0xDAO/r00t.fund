// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";

import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {PoolSwapTest} from "v4-core/test/PoolSwapTest.sol";
import {PoolModifyLiquidityTest} from "v4-core/test/PoolModifyLiquidityTest.sol";
import {PoolKey} from "v4-core/types/PoolKey.sol";
import {Currency, CurrencyLibrary} from "v4-core/types/Currency.sol";
import {IHooks} from "v4-core/interfaces/IHooks.sol";
import {Hooks} from "v4-core/libraries/Hooks.sol";
import {TickMath} from "v4-core/libraries/TickMath.sol";
import {LiquidityAmounts} from "v4-core-test/utils/LiquidityAmounts.sol";

import {RegenArbHook} from "../../src/hackathon/RegenArbHook.sol";
import {ZkAMMRebalanceAdapter} from "../../src/hackathon/ZkAMMRebalanceAdapter.sol";
import {IZkAMMRebalance} from "../../src/hackathon/interfaces/IZkAMMRebalance.sol";
import {IPrivatePool} from "../../src/hackathon/interfaces/IPrivatePool.sol";
import {ZkAMMPair} from "../../src/ZkAMMPair.sol";
import {TestToken} from "../../test/hackathon/mocks/TestToken.sol";
import {HookMiner} from "./HookMiner.sol";

/// admin stub owning the pair (setReserves' onlyAdminOwner) + relaying setShortsContract (onlyAdmin).
contract AdminStub {
    address public owner;
    constructor() { owner = msg.sender; }
    function setShorts(address pair, address shorts) external { ZkAMMPair(payable(pair)).setShortsContract(shorts); }
}

/// @notice LIVE full-stack deploy of the BASE R00T/ETH market as the real protocol: the REAL shielded
///         ZkAMMPair (native ETH/R00T, with fees) + ZkAMMRebalanceAdapter + a REAL native-ETH Uniswap
///         v4 pool + the mined RegenArbHook. Seeds the two pools DIVERGENT, then a user swap back-runs
///         the cross-pool arb — the real zkAMM reserves rebalance and the spread reaches the regen
///         treasury IN ETH. Scaled to run under ~1 ETH. Run with --broadcast on a v4 chain.
contract DeployRealStackLive is Script {
    uint256 constant WAD = 1e18;

    function run() external {
        IPoolManager manager = IPoolManager(vm.envAddress("POOL_MANAGER"));
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address me = vm.addr(pk);
        address treasury = address(uint160(uint256(keccak256("r00t.regen.treasury.base"))));

        vm.startBroadcast(pk);

        // R00T + real shielded zkAMM (native ETH / R00T), seeded 0.1 ETH / 100 R00T → 1000 R00T/ETH
        TestToken root = new TestToken("r00t.fund", "ROOT");
        AdminStub admin = new AdminStub();
        ZkAMMPair pair = new ZkAMMPair(address(admin), address(root), "zkROOT", "zROOT");
        root.mint(me, 1_000_000e18);
        root.approve(address(pair), type(uint256).max);
        pair.setReserves{value: 0.1 ether}(0.1 ether, 100e18);

        // test routers against the REAL manager
        PoolSwapTest swapRouter = new PoolSwapTest(manager);
        PoolModifyLiquidityTest lpRouter = new PoolModifyLiquidityTest(manager);

        // mine + CREATE2-deploy the hook (afterSwap flag only); launchpad = me (so we can register)
        bytes memory args = abi.encode(manager, me);
        (address hookAddr,) = HookMiner.find(uint160(Hooks.AFTER_SWAP_FLAG), type(RegenArbHook).creationCode, args);
        RegenArbHook hook = new RegenArbHook{salt: _mine(args)}(manager, me);
        require(address(hook) == hookAddr, "hook addr mismatch");

        // adapter presents the real zkAMM as an IPrivatePool + becomes its shortsContract
        ZkAMMRebalanceAdapter adapter = new ZkAMMRebalanceAdapter(IZkAMMRebalance(address(pair)), root);
        adapter.setRebalancer(hookAddr);
        admin.setShorts(address(pair), address(adapter));

        // REAL native-ETH v4 pool ETH(c0)/R00T(c1), opened DIVERGENT at 2000 R00T/ETH (ETH dearer)
        Currency ETH = CurrencyLibrary.ADDRESS_ZERO;
        PoolKey memory key = PoolKey({currency0: ETH, currency1: Currency.wrap(address(root)), fee: 3000, tickSpacing: 60, hooks: IHooks(hookAddr)});
        uint160 sqrtP = _sqrtPriceX96(2000e18);
        manager.initialize(key, sqrtP);

        // deep-ish liquidity: 0.5 ETH + 1000 R00T full range
        root.approve(address(lpRouter), type(uint256).max);
        uint128 liq = LiquidityAmounts.getLiquidityForAmounts(
            sqrtP, TickMath.getSqrtPriceAtTick(-887220), TickMath.getSqrtPriceAtTick(887220), 0.5 ether, 1_000e18
        );
        lpRouter.modifyLiquidity{value: 0.6 ether}(
            key, IPoolManager.ModifyLiquidityParams({tickLower: -887220, tickUpper: 887220, liquidityDelta: int256(uint256(liq)), salt: 0}), ""
        );

        // wire the market: treasury accrues ETH (base-market numeraire)
        hook.register(key, IPrivatePool(address(adapter)), treasury, ETH, bytes32("R00T-ETH"));

        // hook working inventory (R00T for this arb direction) + a little ETH headroom
        root.transfer(address(hook), 500e18);
        (bool ok,) = payable(address(hook)).call{value: 0.05 ether}(""); require(ok, "seed eth");

        // snapshot, then a user swap back-runs the arb
        (uint256 e0, uint256 t0) = pair.getReserves();
        swapRouter.swap{value: 0.01 ether}(
            key,
            IPoolManager.SwapParams({zeroForOne: true, amountSpecified: -0.01 ether, sqrtPriceLimitX96: TickMath.MIN_SQRT_PRICE + 1}),
            PoolSwapTest.TestSettings({takeClaims: false, settleUsingBurn: false}),
            ""
        );

        vm.stopBroadcast();

        (uint256 e1, uint256 t1) = pair.getReserves();
        console2.log("== FULL REAL STACK LIVE (base R00T/ETH) ==");
        console2.log("PoolManager     ", address(manager));
        console2.log("hook            ", address(hook));
        console2.log("ROOT            ", address(root));
        console2.log("zkAMMPair       ", address(pair));
        console2.log("adapter         ", address(adapter));
        console2.log("treasury        ", treasury);
        console2.log("zkAMM eth before", e0);
        console2.log("zkAMM eth after ", e1);
        console2.log("zkAMM ROOT befor", t0);
        console2.log("zkAMM ROOT after", t1);
        console2.log("treasury ETH    ", treasury.balance);
    }

    function _mine(bytes memory args) internal pure returns (bytes32 salt) {
        (, salt) = HookMiner.find(uint160(Hooks.AFTER_SWAP_FLAG), type(RegenArbHook).creationCode, args);
    }

    function _sqrtPriceX96(uint256 price1e18) internal pure returns (uint160) {
        return uint160(_sqrt(price1e18) * (2 ** 96) / 1e9);
    }

    function _sqrt(uint256 y) internal pure returns (uint256 z) {
        if (y > 3) { z = y; uint256 x = y / 2 + 1; while (x < z) { z = x; x = (y / x + x) / 2; } }
        else if (y != 0) { z = 1; }
    }
}
