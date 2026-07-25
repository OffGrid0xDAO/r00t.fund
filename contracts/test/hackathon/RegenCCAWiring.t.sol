// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {TestToken as MockERC20} from "./mocks/TestToken.sol";

import {PoolManager} from "v4-core/PoolManager.sol";
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
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {RegenArbHook} from "../../src/hackathon/RegenArbHook.sol";
import {RegenCCAWiring, IRegenArbHook} from "../../src/hackathon/RegenCCAWiring.sol";
import {RegenPrivatePool} from "../../src/hackathon/RegenPrivatePool.sol";

/// @notice Proves the CCA completion: given a public v4 pool the (real) Uniswap CCA already created at
///         the cleared price with our hook, RegenCCAWiring.wire() seeds the private pool from the
///         RESERVED parcel supply at that same price + registers the market — then a user swap triggers
///         the cross-pool arb. (The real CCA runs the auction; this is our double-pool + hook side.)
contract RegenCCAWiringTest is Test {
    using StateLibrary for IPoolManager;
    using PoolIdLibrary for PoolKey;

    PoolManager manager;
    PoolSwapTest swapRouter;
    PoolModifyLiquidityTest lpRouter;
    RegenArbHook hook;
    RegenCCAWiring wiring;
    MockERC20 root;
    MockERC20 oak;
    PoolKey key;
    address treasury = makeAddr("treasury");

    function setUp() public {
        manager = new PoolManager(address(this));
        swapRouter = new PoolSwapTest(manager);
        lpRouter = new PoolModifyLiquidityTest(manager);

        root = new MockERC20("ROOT", "ROOT");
        oak = new MockERC20("OAK", "OAK");

        address hookAddr = address(uint160(Hooks.AFTER_SWAP_FLAG));
        deployCodeTo("RegenArbHook.sol:RegenArbHook", abi.encode(IPoolManager(address(manager)), address(this)), hookAddr);
        hook = RegenArbHook(payable(hookAddr));

        wiring = new RegenCCAWiring(manager, IRegenArbHook(hookAddr));
        hook.setLaunchpad(address(wiring)); // wiring may register markets

        // "the CCA already created + seeded the PUBLIC pool at the cleared price" — price1/0 = 2.0
        (Currency c0, Currency c1) = address(root) < address(oak)
            ? (Currency.wrap(address(root)), Currency.wrap(address(oak)))
            : (Currency.wrap(address(oak)), Currency.wrap(address(root)));
        key = PoolKey({currency0: c0, currency1: c1, fee: 3000, tickSpacing: 60, hooks: IHooks(hookAddr)});
        uint160 sqrtP = _sqrtPriceX96(2e18);
        manager.initialize(key, sqrtP);
        root.mint(address(this), 5_000_000e18); oak.mint(address(this), 5_000_000e18);
        root.approve(address(lpRouter), type(uint256).max); oak.approve(address(lpRouter), type(uint256).max);
        uint128 liq = LiquidityAmounts.getLiquidityForAmounts(sqrtP, TickMath.getSqrtPriceAtTick(-887220), TickMath.getSqrtPriceAtTick(887220), 100_000e18, 100_000e18);
        lpRouter.modifyLiquidity(key, IPoolManager.ModifyLiquidityParams({tickLower: -887220, tickUpper: 887220, liquidityDelta: int256(uint256(liq)), salt: 0}), "");
    }

    function test_wire_seeds_private_at_cleared_price_then_arbs() public {
        uint256 pubP = _uniPrice();

        // reserve 20k OAK for the private pool; approve the wiring (parcel + R00T)
        oak.approve(address(wiring), type(uint256).max);
        root.approve(address(wiring), type(uint256).max);
        (address privAddr, uint256 r00tSeed) = wiring.wire(key, IERC20(address(root)), 20_000e18, treasury, bytes32("OAK"));
        assertGt(r00tSeed, 0, "computed R00T seed");

        // private pool seeded at ~the cleared price (in sync with public)
        RegenPrivatePool priv = RegenPrivatePool(privAddr);
        (uint256 r0, uint256 r1) = priv.getReserves();
        uint256 privP = (r1 * 1e18) / r0;
        assertApproxEqRel(privP, pubP, 0.02e18, "private seeded at the cleared price");

        // seed the shared hook's working inventory, then a user swap triggers the cross-pool arb
        root.mint(address(hook), 20_000e18); oak.mint(address(hook), 20_000e18);
        root.approve(address(swapRouter), type(uint256).max); oak.approve(address(swapRouter), type(uint256).max);
        uint256 treBefore = root.balanceOf(treasury);
        bool zeroForOne = address(root) < address(oak); // sell R00T → push OAK dearer on the public pool
        swapRouter.swap(
            key,
            IPoolManager.SwapParams({zeroForOne: zeroForOne, amountSpecified: -2_000e18, sqrtPriceLimitX96: zeroForOne ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1}),
            PoolSwapTest.TestSettings({takeClaims: false, settleUsingBurn: false}), ""
        );

        (uint256 a0, uint256 a1) = priv.getReserves();
        assertTrue(a0 != r0 || a1 != r1, "private pool rebalanced from the arb");
        assertGt(root.balanceOf(treasury), treBefore, "spread to the regen treasury");
    }

    function _uniPrice() internal view returns (uint256) {
        (uint160 s,,,) = IPoolManager(address(manager)).getSlot0(key.toId());
        return (uint256(s) * uint256(s) * 1e18) >> 192;
    }
    function _sqrtPriceX96(uint256 price1e18) internal pure returns (uint160) {
        return uint160(_sqrt(price1e18) * (2 ** 96) / 1e9);
    }
    function _sqrt(uint256 y) internal pure returns (uint256 z) { if (y > 3) { z = y; uint256 x = y / 2 + 1; while (x < z) { z = x; x = (y / x + x) / 2; } } else if (y != 0) { z = 1; } }
}
