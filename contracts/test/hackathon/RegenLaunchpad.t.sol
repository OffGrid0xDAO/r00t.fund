// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {TestToken} from "./mocks/TestToken.sol";

import {PoolManager} from "v4-core/PoolManager.sol";
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
import {IPrivatePool} from "../../src/hackathon/interfaces/IPrivatePool.sol";

/// @notice Full steward launch flow against a REAL v4 PoolManager: createParcel → bid → clearAndLaunch
///         seeds BOTH pools at the cleared price and registers the hook; backers claim; then a public
///         swap that diverges the pools proves the hook back-runs the cross-pool arb into the regen
///         treasury. End-to-end, one test.
contract RegenLaunchpadTest is Test {
    using StateLibrary for IPoolManager;
    using PoolIdLibrary for PoolKey;

    PoolManager manager;
    PoolSwapTest swapRouter;
    RegenArbHook hook;
    RegenLaunchpad launchpad;
    TestToken root;
    TestToken parcel;

    address steward = makeAddr("steward");
    address treasury = makeAddr("regenTreasury");
    address reserve = makeAddr("protocolReserve");
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");

    bytes32 constant PID = bytes32("OAK-PARCEL");

    function setUp() public {
        manager = new PoolManager(address(this));
        swapRouter = new PoolSwapTest(manager);

        // hook at an afterSwap-flag address; deployer = this test (so we can setLaunchpad)
        address hookAddr = address(uint160(Hooks.AFTER_SWAP_FLAG));
        deployCodeTo("RegenArbHook.sol:RegenArbHook", abi.encode(IPoolManager(address(manager)), address(this)), hookAddr);
        hook = RegenArbHook(payable(hookAddr));

        root = new TestToken("r00t.fund", "ROOT");
        launchpad = new RegenLaunchpad(manager, IRegenArbHook(hookAddr), root, reserve);
        hook.setLaunchpad(address(launchpad)); // resolve the cycle

        parcel = new TestToken("Oak Parcel", "OAK");

        // protocol reserve holds R00T to seed the pools' R00T side, pre-approved to the launchpad
        root.mint(reserve, 10_000_000e18);
        vm.prank(reserve);
        root.approve(address(launchpad), type(uint256).max);
    }

    function test_full_launch_flow_then_arb_to_treasury() public {
        // steward escrows the parcel supply and opens the CCA
        uint256 saleTokens = 100_000e18;
        uint256 poolTokens = 100_000e18;
        parcel.mint(steward, saleTokens + poolTokens);
        vm.startPrank(steward);
        parcel.approve(address(launchpad), type(uint256).max);
        launchpad.createParcel(PID, parcel, treasury, saleTokens, poolTokens, 0.02e18 /*reserve floor R00T/OAK*/, 1 days);
        vm.stopPrank();

        // two backers bid R00T (uniform-price CCA)
        _bid(alice, 3_000e18);
        _bid(bob, 1_000e18);
        // raised 4000 R00T for 100k OAK → 0.04 R00T/OAK (above the 0.02 floor)

        vm.warp(block.timestamp + 1 days + 1);
        launchpad.clearAndLaunch(PID);

        // clearing price and treasury funded by the raise
        assertEq(launchpad.clearedPriceOf(PID), 0.04e18, "uniform clearing price = raised/saleTokens");
        assertEq(root.balanceOf(treasury), 4_000e18, "regen treasury received the full R00T raise");

        // both pools opened at P; public pool price ~= P
        address ptoken = launchpad.parcelTokenOf(PID);
        RegenPrivatePool priv = RegenPrivatePool(launchpad.privatePoolOf(PID));
        assertTrue(address(priv) != address(0), "private pool deployed");
        PoolKey memory key = _key(ptoken);
        assertApproxEqRel(_uniPrice(key, ptoken), 0.04e18, 0.02e18, "public pool seeded at cleared price");

        // backers claim at the uniform price
        vm.prank(alice);
        uint256 aOut = launchpad.claim(PID);
        assertEq(aOut, (3_000e18 * 1e18) / 0.04e18, "alice OAK at uniform price"); // 75k
        vm.prank(bob);
        uint256 bOut = launchpad.claim(PID);
        assertEq(bOut, (1_000e18 * 1e18) / 0.04e18, "bob OAK at uniform price");   // 25k

        // ── now diverge the pools and prove the hook arbs into the treasury ──
        // push the PUBLIC price up with a big buy of the parcel token, so it diverges from the private pool
        uint256 treRootBefore = root.balanceOf(treasury);
        (uint256 pr0Before, uint256 pr1Before) = priv.getReserves();

        bool parcelIsC0 = ptoken < address(root);
        // buy OAK on the public pool (spend R00T) → OAK price rises on Uni vs the private pool
        bool zeroForOne = parcelIsC0 ? false : true; // sell R00T (the non-parcel side) into the pool
        root.mint(address(this), 5_000e18);
        parcel.approve(address(swapRouter), type(uint256).max);
        root.approve(address(swapRouter), type(uint256).max);
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

        // hook back-ran the swap: treasury grew in R00T (its numeraire) and the private pool moved
        assertGt(root.balanceOf(treasury), treRootBefore, "arb spread funded the regen treasury in R00T");
        (uint256 pr0After, uint256 pr1After) = priv.getReserves();
        assertTrue(pr0After != pr0Before || pr1After != pr1Before, "private pool rebalanced toward the public price");
    }

    function _bid(address who, uint256 amt) internal {
        root.mint(who, amt);
        vm.startPrank(who);
        root.approve(address(launchpad), type(uint256).max);
        launchpad.bid(PID, amt);
        vm.stopPrank();
    }

    function _key(address ptoken) internal view returns (PoolKey memory) {
        (Currency c0, Currency c1) = ptoken < address(root)
            ? (Currency.wrap(ptoken), Currency.wrap(address(root)))
            : (Currency.wrap(address(root)), Currency.wrap(ptoken));
        return PoolKey({currency0: c0, currency1: c1, fee: 3000, tickSpacing: 60, hooks: IHooks(address(hook))});
    }

    /// public price expressed as R00T per parcel token (WAD)
    function _uniPrice(PoolKey memory key, address ptoken) internal view returns (uint256) {
        (uint160 s,,,) = IPoolManager(address(manager)).getSlot0(key.toId());
        uint256 p1_0 = (uint256(s) * uint256(s) * 1e18) >> 192; // currency1 per currency0 (WAD)
        return ptoken < address(root) ? p1_0 : (1e18 * 1e18) / p1_0; // normalize to R00T/parcel
    }
}
