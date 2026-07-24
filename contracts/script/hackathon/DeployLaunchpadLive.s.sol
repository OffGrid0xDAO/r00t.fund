// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";

import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {PoolSwapTest} from "v4-core/test/PoolSwapTest.sol";
import {PoolKey} from "v4-core/types/PoolKey.sol";
import {Currency} from "v4-core/types/Currency.sol";
import {IHooks} from "v4-core/interfaces/IHooks.sol";
import {Hooks} from "v4-core/libraries/Hooks.sol";
import {TickMath} from "v4-core/libraries/TickMath.sol";
import {StateLibrary} from "v4-core/libraries/StateLibrary.sol";
import {PoolIdLibrary} from "v4-core/types/PoolId.sol";

import {RegenArbHook} from "../../src/hackathon/RegenArbHook.sol";
import {RegenLaunchpad, IRegenArbHook} from "../../src/hackathon/RegenLaunchpad.sol";
import {RegenPrivatePool} from "../../src/hackathon/RegenPrivatePool.sol";
import {TestToken} from "../../test/hackathon/mocks/TestToken.sol";
import {HookMiner} from "./HookMiner.sol";

/// @notice LIVE steward launch of a PARCEL token: deploy R00T + parcel + the mined RegenArbHook +
///         RegenLaunchpad, run createParcel → CCA bids → clearAndLaunch (seeds the PRIVATE pool +
///         the public v4 pool at the cleared price + wires the hook), then a divergence swap that
///         back-runs the cross-pool arb — proving the parcel DOUBLE POOL rebalances on-chain and the
///         spread funds the parcel's regen treasury in R00T. Run with --broadcast on a v4 chain.
contract DeployLaunchpadLive is Script {
    using StateLibrary for IPoolManager;
    using PoolIdLibrary for PoolKey;

    bytes32 constant PID = bytes32("OAK-PARCEL-LIVE");

    function run() external {
        IPoolManager manager = IPoolManager(vm.envAddress("POOL_MANAGER"));
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address me = vm.addr(pk);
        address treasury = address(uint160(uint256(keccak256("r00t.regen.treasury.oak"))));

        vm.startBroadcast(pk);

        TestToken root = new TestToken("r00t.fund", "ROOT");
        TestToken parcel = new TestToken("Oak Parcel", "OAK");
        PoolSwapTest swapRouter = new PoolSwapTest(manager);

        // mine + deploy the hook (launchpad set after, resolving the cycle); deployer = me
        bytes memory args = abi.encode(manager, me);
        // fresh per-run startSalt so retries/other deploys never CREATE2-collide on one chain
        uint256 startSalt = uint256(keccak256(abi.encodePacked(me, block.timestamp)));
        (address hookAddr, bytes32 salt) = HookMiner.find(uint160(Hooks.AFTER_SWAP_FLAG), type(RegenArbHook).creationCode, args, startSalt);
        RegenArbHook hook = new RegenArbHook{salt: salt}(manager, me);
        require(address(hook) == hookAddr, "hook addr mismatch");

        // launchpad (protocolReserve = me supplies the R00T side of pool liquidity)
        // gatekeeper = address(0) here (open); the World-gated deploy passes a real StewardGatekeeper.
        RegenLaunchpad launchpad = new RegenLaunchpad(manager, IRegenArbHook(hookAddr), root, me, vm.envOr("STEWARD_GATEKEEPER", address(0)));
        hook.setLaunchpad(address(launchpad));

        // fund + approvals
        root.mint(me, 5_000_000e18);
        root.approve(address(launchpad), type(uint256).max);      // protocolReserve pull + bids
        parcel.mint(me, 1_000_000e18);
        parcel.approve(address(launchpad), type(uint256).max);

        // steward opens the CCA: 100k OAK sold, 100k OAK for pools, floor 0.02 R00T/OAK, 1h window
        // (long window so bids land before it closes under --slow; steward closes early to launch).
        launchpad.createParcel(PID, parcel, treasury, 100_000e18, 100_000e18, 0.02e18, 3600);

        // a backer bids 4000 R00T (→ clears at 0.04 R00T/OAK, above the floor)
        launchpad.bid(PID, 4_000e18);

        vm.stopBroadcast();

        // (auction window is 1s; --slow puts the next tx in a later block so auctionEnd has passed)
        vm.startBroadcast(pk);
        launchpad.clearAndLaunch(PID);

        // read the launched pool + a divergence swap to trigger the arb
        address ptoken = launchpad.parcelTokenOf(PID);
        RegenPrivatePool priv = RegenPrivatePool(launchpad.privatePoolOf(PID));
        (Currency c0, Currency c1) = ptoken < address(root)
            ? (Currency.wrap(ptoken), Currency.wrap(address(root)))
            : (Currency.wrap(address(root)), Currency.wrap(ptoken));
        PoolKey memory key = PoolKey({currency0: c0, currency1: c1, fee: 3000, tickSpacing: 60, hooks: IHooks(hookAddr)});

        (uint256 pr0Before, uint256 pr1Before) = priv.getReserves();
        bool parcelIsC0 = ptoken < address(root);
        bool zeroForOne = parcelIsC0 ? false : true; // sell R00T in → push parcel dearer on the public pool
        root.approve(address(swapRouter), type(uint256).max);
        parcel.approve(address(swapRouter), type(uint256).max);
        swapRouter.swap(
            key,
            IPoolManager.SwapParams({
                zeroForOne: zeroForOne,
                amountSpecified: -2_000e18,
                sqrtPriceLimitX96: zeroForOne ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1
            }),
            PoolSwapTest.TestSettings({takeClaims: false, settleUsingBurn: false}),
            ""
        );
        vm.stopBroadcast();

        (uint256 pr0After, uint256 pr1After) = priv.getReserves();
        console2.log("== PARCEL LAUNCHPAD LIVE (double pool + arb) ==");
        console2.log("PoolManager   ", address(manager));
        console2.log("hook          ", address(hook));
        console2.log("launchpad     ", address(launchpad));
        console2.log("ROOT          ", address(root));
        console2.log("OAK parcel    ", address(parcel));
        console2.log("privatePool   ", address(priv));
        console2.log("treasury      ", treasury);
        console2.log("clearedPrice  ", launchpad.clearedPriceOf(PID));
        console2.log("treasury R00T ", root.balanceOf(treasury));
        console2.log("priv r0 before", pr0Before);
        console2.log("priv r0 after ", pr0After);
        console2.log("priv r1 before", pr1Before);
        console2.log("priv r1 after ", pr1After);
    }
}
