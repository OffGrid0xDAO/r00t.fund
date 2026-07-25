// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {TestToken as MockERC20} from "./mocks/TestToken.sol";
import {RegenTestAMM} from "./mocks/RegenTestAMM.sol";

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

import {RegenArbHook} from "../../src/hackathon/RegenArbHook.sol";
import {IPrivatePool} from "../../src/hackathon/interfaces/IPrivatePool.sol";

/// @notice BIDIRECTIONAL + edge-case coverage for the auto-rebalance against a REAL v4 pool:
///         the private pool must converge toward the public price whether it starts BELOW (public
///         swap/arb pushes it UP) or ABOVE (pushes it DOWN), never overshoot, respect the 5% cap
///         (many small steps for a big gap), skip sub-threshold noise, and never force a loss.
contract RegenArbHookDirectionsTest is Test {
    using StateLibrary for IPoolManager;
    using PoolIdLibrary for PoolKey;

    PoolManager manager;
    PoolSwapTest swapRouter;
    PoolModifyLiquidityTest lpRouter;
    RegenArbHook hook;
    MockERC20 t0;
    MockERC20 t1;
    PoolKey key;
    address treasury = makeAddr("treasury");
    uint160 constant SQRT_1 = 79228162514264337593543950336; // public price 1.0

    function setUp() public {
        MockERC20 a = new MockERC20("A", "A");
        MockERC20 b = new MockERC20("B", "B");
        (t0, t1) = address(a) < address(b) ? (a, b) : (b, a);

        manager = new PoolManager(address(this));
        swapRouter = new PoolSwapTest(manager);
        lpRouter = new PoolModifyLiquidityTest(manager);

        address hookAddr = address(uint160(Hooks.AFTER_SWAP_FLAG));
        deployCodeTo("RegenArbHook.sol:RegenArbHook", abi.encode(IPoolManager(address(manager)), address(this)), hookAddr);
        hook = RegenArbHook(payable(hookAddr));

        key = PoolKey({currency0: Currency.wrap(address(t0)), currency1: Currency.wrap(address(t1)), fee: 3000, tickSpacing: 60, hooks: IHooks(hookAddr)});
        manager.initialize(key, SQRT_1);

        // deep liquidity so the small user swaps barely move the public price (target stays ~1.0)
        t0.mint(address(this), 100_000_000e18);
        t1.mint(address(this), 100_000_000e18);
        t0.approve(address(lpRouter), type(uint256).max);
        t1.approve(address(lpRouter), type(uint256).max);
        lpRouter.modifyLiquidity(key, IPoolManager.ModifyLiquidityParams({tickLower: -6000, tickUpper: 6000, liquidityDelta: 2_000_000e18, salt: 0}), "");

        // fat hook inventory in BOTH currencies so either direction's private leg can be fronted
        t0.mint(address(hook), 1_000_000e18);
        t1.mint(address(hook), 1_000_000e18);

        t0.approve(address(swapRouter), type(uint256).max);
        t1.approve(address(swapRouter), type(uint256).max);
    }

    /// deploy a private pool at price p1_0 (currency1 per currency0, WAD) and register it
    function _privateAt(uint256 p1_0) internal returns (RegenTestAMM priv) {
        priv = new RegenTestAMM(t0, t1);
        uint256 r0 = 100_000e18;
        uint256 r1 = (r0 * p1_0) / 1e18;
        t0.mint(address(this), r0);
        t1.mint(address(this), r1);
        t0.approve(address(priv), type(uint256).max);
        t1.approve(address(priv), type(uint256).max);
        priv.seed(r0, r1);
        priv.setRebalancer(address(hook));
        hook.register(key, IPrivatePool(address(priv)), treasury, Currency.wrap(address(t0)), bytes32("M"));
    }

    function _privPrice(RegenTestAMM priv) internal view returns (uint256) {
        (uint256 r0, uint256 r1) = priv.getReserves();
        return (r1 * 1e18) / r0;
    }

    function _nudge() internal {
        // tiny user swap just to fire afterSwap; negligible impact on the deep public pool
        swapRouter.swap(
            key,
            IPoolManager.SwapParams({zeroForOne: true, amountSpecified: -0.01e18, sqrtPriceLimitX96: TickMath.MIN_SQRT_PRICE + 1}),
            PoolSwapTest.TestSettings({takeClaims: false, settleUsingBurn: false}),
            ""
        );
    }

    // ── the private pool starts BELOW public → must rebalance UP ──
    function test_converge_up() public {
        RegenTestAMM priv = _privateAt(0.5e18); // below public 1.0
        uint256 before = _privPrice(priv);
        uint256 treBefore = t0.balanceOf(treasury);
        _nudge();
        uint256 aft = _privPrice(priv);
        assertGt(aft, before, "private moved UP toward public");
        assertLe(aft, 1.01e18, "did not overshoot above public");
        assertGt(t0.balanceOf(treasury), treBefore, "spread to treasury");
    }

    // ── the private pool starts ABOVE public → must rebalance DOWN ──
    function test_converge_down() public {
        RegenTestAMM priv = _privateAt(2e18); // above public 1.0
        uint256 before = _privPrice(priv);
        uint256 treBefore = t0.balanceOf(treasury);
        _nudge();
        uint256 aft = _privPrice(priv);
        assertLt(aft, before, "private moved DOWN toward public");
        assertGe(aft, 0.99e18, "did not overshoot below public");
        assertGt(t0.balanceOf(treasury), treBefore, "spread to treasury");
    }

    // ── a big gap closes over MANY capped steps, monotonically, without overshoot ──
    function test_repeated_converges_monotonically() public {
        RegenTestAMM priv = _privateAt(0.4e18); // far below
        uint256 prev = _privPrice(priv);
        for (uint256 i = 0; i < 15; i++) {
            _nudge();
            uint256 now_ = _privPrice(priv);
            assertGe(now_, prev, "monotonic non-decreasing toward public");
            assertLe(now_, 1.02e18, "never overshoots public");
            prev = now_;
        }
        // after 15 capped steps it should have closed most of the gap
        assertGt(prev, 0.7e18, "meaningfully converged toward 1.0");
    }

    // ── sub-threshold divergence (<0.30%) is ignored (no churn, no treasury change) ──
    function test_subthreshold_skipped() public {
        RegenTestAMM priv = _privateAt(1.001e18); // 0.1% off — below the 0.30% gate
        uint256 before = _privPrice(priv);
        uint256 treBefore = t0.balanceOf(treasury);
        _nudge();
        assertEq(_privPrice(priv), before, "no rebalance below threshold");
        assertEq(t0.balanceOf(treasury), treBefore, "no treasury change below threshold");
    }

    // ── one arb step never moves the private pool more than the 5% cap implies ──
    function test_cap_limits_single_step() public {
        RegenTestAMM priv = _privateAt(0.5e18);
        (uint256 r0Before,) = priv.getReserves();
        _nudge();
        (uint256 r0After,) = priv.getReserves();
        // currency0 reserve change on one step is bounded by MAX_REBALANCE_BPS (5%) of the reserve
        uint256 delta = r0Before > r0After ? r0Before - r0After : r0After - r0Before;
        assertLe(delta, (r0Before * hook.maxRebalanceBps()) / 10_000 + 1, "single-step move within the configured cap");
    }
}
