// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {PoolModifyLiquidityTest} from "v4-core/test/PoolModifyLiquidityTest.sol";
import {PoolKey} from "v4-core/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "v4-core/types/PoolId.sol";
import {Currency, CurrencyLibrary} from "v4-core/types/Currency.sol";
import {IHooks} from "v4-core/interfaces/IHooks.sol";
import {Hooks} from "v4-core/libraries/Hooks.sol";
import {TickMath} from "v4-core/libraries/TickMath.sol";
import {LiquidityAmounts} from "v4-core-test/utils/LiquidityAmounts.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {RegenArbHook} from "../../src/hackathon/RegenArbHook.sol";
import {RegenLaunchpad, IRegenArbHook} from "../../src/hackathon/RegenLaunchpad.sol";
import {ZkAMMRebalanceAdapter} from "../../src/hackathon/ZkAMMRebalanceAdapter.sol";
import {IZkAMMRebalance} from "../../src/hackathon/interfaces/IZkAMMRebalance.sol";
import {IPrivatePool} from "../../src/hackathon/interfaces/IPrivatePool.sol";
import {ZkAMMPair} from "../../src/ZkAMMPair.sol";
import {TestToken} from "../../test/hackathon/mocks/TestToken.sol";
import {HookMiner} from "./HookMiner.sol";

contract AdminStub2 {
    address public owner;
    constructor() { owner = msg.sender; }
    function setShorts(address pair, address shorts) external { ZkAMMPair(payable(pair)).setShortsContract(shorts); }
}

/// @notice ONE clean coherent stack: fresh R00T, ONE shared RegenArbHook (10% cap for small-liq), the
///         R00T/ETH base market (real shielded ZkAMMPair, seeded IN-SYNC on the shared hook), and a
///         self-seed RegenLaunchpad (any steward launches parcels on the SAME hook). All wiring done
///         while the hook's launchpad is still the deployer, then handed off. Nothing hardcoded per parcel.
contract DeployCleanStack is Script {
    using PoolIdLibrary for PoolKey;

    function run() external {
        IPoolManager manager = IPoolManager(vm.envAddress("POOL_MANAGER"));
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address me = vm.addr(pk);
        Currency ETH = CurrencyLibrary.ADDRESS_ZERO;
        uint160 sqrt2000 = _sqrtPriceX96(2000e18);
        address baseTreasury = address(uint160(uint256(keccak256("r00t.regen.treasury.base.clean"))));

        vm.startBroadcast(pk);

        TestToken root = new TestToken("r00t.fund", "ROOT");

        // shared hook, mined; launchpad = me (so we can register + set cap before handing off)
        bytes memory args = abi.encode(manager, me);
        (address hookAddr, bytes32 salt) = HookMiner.find(uint160(Hooks.AFTER_SWAP_FLAG), type(RegenArbHook).creationCode, args, uint256(keccak256(abi.encodePacked(me, block.timestamp, "clean"))));
        RegenArbHook hook = new RegenArbHook{salt: salt}(manager, me);
        require(address(hook) == hookAddr, "hook mismatch");
        hook.setMaxRebalanceBps(1000); // 10% — bigger steps for small-liq pools (me == launchpad now)

        // ── R00T/ETH base market: real shielded zkAMM + public v4, IN SYNC at 2000 R00T/ETH ──
        AdminStub2 admin = new AdminStub2();
        ZkAMMPair pair = new ZkAMMPair(address(admin), address(root), "zkROOT", "zROOT");
        root.mint(me, 5_000_000e18);
        root.approve(address(pair), type(uint256).max);
        pair.setReserves{value: 1 ether}(1 ether, 2_000e18);
        ZkAMMRebalanceAdapter adapter = new ZkAMMRebalanceAdapter(IZkAMMRebalance(address(pair)), root);
        adapter.setRebalancer(address(hook));
        admin.setShorts(address(pair), address(adapter));

        PoolKey memory baseKey = PoolKey({currency0: ETH, currency1: Currency.wrap(address(root)), fee: 3000, tickSpacing: 60, hooks: IHooks(address(hook))});
        manager.initialize(baseKey, sqrt2000);
        PoolModifyLiquidityTest lp = new PoolModifyLiquidityTest(manager);
        root.approve(address(lp), type(uint256).max);
        uint128 liq = LiquidityAmounts.getLiquidityForAmounts(sqrt2000, TickMath.getSqrtPriceAtTick(-887220), TickMath.getSqrtPriceAtTick(887220), 5 ether, 10_000e18);
        lp.modifyLiquidity{value: 6 ether}(baseKey, IPoolManager.ModifyLiquidityParams({tickLower: -887220, tickUpper: 887220, liquidityDelta: int256(uint256(liq)), salt: 0}), "");
        hook.register(baseKey, IPrivatePool(address(adapter)), baseTreasury, ETH, bytes32("R00T-ETH")); // me == launchpad
        root.transfer(address(hook), 20_000e18);
        (bool ok,) = payable(address(hook)).call{value: 0.3 ether}(""); require(ok, "seed eth");

        // ── self-seed launchpad (protocolReserve=0 → steward self-seeds); hand the hook off to it ──
        RegenLaunchpad launchpad = new RegenLaunchpad(manager, IRegenArbHook(address(hook)), IERC20(address(root)), address(0), address(0));
        hook.setLaunchpad(address(launchpad)); // me == current launchpad → allowed

        vm.stopBroadcast();

        console2.log("== CLEAN STACK ==");
        console2.log("ROOT      ", address(root));
        console2.log("hook      ", address(hook));
        console2.log("launchpad ", address(launchpad));
        console2.log("base zkAMM", address(pair));
        console2.log("base adapt", address(adapter));
        console2.log("base treas", baseTreasury);
        console2.log("base poolId", uint256(PoolId.unwrap(baseKey.toId())));
    }

    function _sqrtPriceX96(uint256 p) internal pure returns (uint160) { return uint160(_sqrt(p) * (2 ** 96) / 1e9); }
    function _sqrt(uint256 y) internal pure returns (uint256 z) { if (y > 3) { z = y; uint256 x = y / 2 + 1; while (x < z) { z = x; x = (y / x + x) / 2; } } else if (y != 0) { z = 1; } }
}
