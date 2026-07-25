// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {PoolSwapTest} from "v4-core/test/PoolSwapTest.sol";
import {PoolModifyLiquidityTest} from "v4-core/test/PoolModifyLiquidityTest.sol";
import {PoolKey} from "v4-core/types/PoolKey.sol";
import {PoolId} from "v4-core/types/PoolId.sol";
import {Currency, CurrencyLibrary} from "v4-core/types/Currency.sol";
import {IHooks} from "v4-core/interfaces/IHooks.sol";
import {TickMath} from "v4-core/libraries/TickMath.sol";
import {StateLibrary} from "v4-core/libraries/StateLibrary.sol";
import {PoolIdLibrary} from "v4-core/types/PoolId.sol";
import {LiquidityAmounts} from "v4-core-test/utils/LiquidityAmounts.sol";

import {RegenArbHook} from "../../src/hackathon/RegenArbHook.sol";
import {ZkAMMRebalanceAdapter} from "../../src/hackathon/ZkAMMRebalanceAdapter.sol";
import {IZkAMMRebalance} from "../../src/hackathon/interfaces/IZkAMMRebalance.sol";
import {IPrivatePool} from "../../src/hackathon/interfaces/IPrivatePool.sol";
import {ZkAMMPair} from "../../src/ZkAMMPair.sol";
import {TestToken} from "../../test/hackathon/mocks/TestToken.sol";

contract AdminStub {
    address public owner;
    constructor() { owner = msg.sender; }
    function setShorts(address pair, address shorts) external { ZkAMMPair(payable(pair)).setShortsContract(shorts); }
}

/// @notice Fresh R00T/ETH BASE market registered on the SHARED V2 hook (one hook for base + parcels),
///         seeded IN-SYNC (public v4 == private zkAMM), so the arb starts converged and is triggerable
///         via the hook's permissionless rebalance() poke. Uses the shared ROOT. Env: POOL_MANAGER,
///         ROOT_ADDRESS (shared R00T), SHARED_HOOK (the V2 hook, whose deployer = this signer).
contract DeployBaseMarketV2 is Script {
    using StateLibrary for IPoolManager;
    using PoolIdLibrary for PoolKey;

    function run() external {
        IPoolManager manager = IPoolManager(vm.envAddress("POOL_MANAGER"));
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address me = vm.addr(pk);
        TestToken root = TestToken(vm.envAddress("ROOT_ADDRESS"));
        RegenArbHook hook = RegenArbHook(payable(vm.envAddress("SHARED_HOOK")));
        address treasury = address(uint160(uint256(keccak256("r00t.regen.treasury.base.v2"))));
        Currency ETH = CurrencyLibrary.ADDRESS_ZERO;
        uint160 sqrt2000 = _sqrtPriceX96(2000e18); // R00T per ETH

        vm.startBroadcast(pk);
        // real shielded zkAMM (native ETH / shared R00T), seed 10 ETH / 20,000 R00T → 2000 R00T/ETH
        AdminStub admin = new AdminStub();
        ZkAMMPair pair = new ZkAMMPair(address(admin), address(root), "zkROOT", "zROOT");
        root.mint(me, 1_000_000e18);
        root.approve(address(pair), type(uint256).max);
        pair.setReserves{value: 1 ether}(1 ether, 2_000e18); // 2000 R00T/ETH — IN SYNC with the public pool

        ZkAMMRebalanceAdapter adapter = new ZkAMMRebalanceAdapter(IZkAMMRebalance(address(pair)), root);
        adapter.setRebalancer(address(hook));
        admin.setShorts(address(pair), address(adapter));

        // public native-ETH v4 pool on the SHARED hook, seeded at the SAME 2000 R00T/ETH
        PoolKey memory key = PoolKey({currency0: ETH, currency1: Currency.wrap(address(root)), fee: 3000, tickSpacing: 60, hooks: IHooks(address(hook))});
        manager.initialize(key, sqrt2000);
        PoolModifyLiquidityTest lp = new PoolModifyLiquidityTest(manager);
        root.approve(address(lp), type(uint256).max);
        uint128 liq = LiquidityAmounts.getLiquidityForAmounts(sqrt2000, TickMath.getSqrtPriceAtTick(-887220), TickMath.getSqrtPriceAtTick(887220), 5 ether, 10_000e18);
        lp.modifyLiquidity{value: 6 ether}(key, IPoolManager.ModifyLiquidityParams({tickLower: -887220, tickUpper: 887220, liquidityDelta: int256(uint256(liq)), salt: 0}), "");

        // register on the shared hook (deployer-gated) + fund hook inventory
        hook.register(key, IPrivatePool(address(adapter)), treasury, ETH, bytes32("R00T-ETH"));
        root.transfer(address(hook), 5_000e18);
        (bool ok,) = payable(address(hook)).call{value: 0.2 ether}(""); require(ok, "seed eth");
        vm.stopBroadcast();

        console2.log("== R00T/ETH BASE market V2 (shared hook, in-sync) ==");
        console2.log("zkAMMPair ", address(pair));
        console2.log("adapter   ", address(adapter));
        console2.log("hook      ", address(hook));
        console2.log("treasury  ", treasury);
        console2.log("poolId    ", uint256(PoolId.unwrap(key.toId())));
    }

    function _sqrtPriceX96(uint256 price1e18) internal pure returns (uint160) { return uint160(_sqrt(price1e18) * (2 ** 96) / 1e9); }
    function _sqrt(uint256 y) internal pure returns (uint256 z) { if (y > 3) { z = y; uint256 x = y / 2 + 1; while (x < z) { z = x; x = (y / x + x) / 2; } } else if (y != 0) { z = 1; } }
}

