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

import {RegenArbHook} from "../../src/hackathon/RegenArbHook.sol";
import {RegenTestAMM} from "./mocks/RegenTestAMM.sol";
import {IPrivatePool} from "../../src/hackathon/interfaces/IPrivatePool.sol";

/// @notice REAL v4 integration for the RegenArbHook: real PoolManager + real routers + a real
///         constant-product private AMM. Proves the hook back-runs a user swap with a genuine
///         cross-pool arb — the private pool CONVERGES toward the Uniswap price and the captured
///         spread lands in the regen TREASURY — with no forced loss.
contract RegenArbHookIntegrationTest is Test {
    using StateLibrary for IPoolManager;
    using PoolIdLibrary for PoolKey;

    PoolManager manager;
    PoolSwapTest swapRouter;
    PoolModifyLiquidityTest lpRouter;
    RegenArbHook hook;
    RegenTestAMM priv;
    MockERC20 t0;
    MockERC20 t1;
    PoolKey key;
    address treasury = makeAddr("regenTreasury");

    uint160 constant SQRT_1 = 79228162514264337593543950336; // price 1.0

    function setUp() public {
        // tokens (sorted so currency0 < currency1)
        MockERC20 a = new MockERC20("A", "A");
        MockERC20 b = new MockERC20("B", "B");
        (t0, t1) = address(a) < address(b) ? (a, b) : (b, a);

        manager = new PoolManager(address(this));
        swapRouter = new PoolSwapTest(manager);
        lpRouter = new PoolModifyLiquidityTest(manager);

        // deploy the shared hook at an address whose bits declare ONLY afterSwap
        address hookAddr = address(uint160(Hooks.AFTER_SWAP_FLAG));
        deployCodeTo("RegenArbHook.sol:RegenArbHook", abi.encode(IPoolManager(address(manager)), address(this)), hookAddr);
        hook = RegenArbHook(payable(hookAddr));

        key = PoolKey({
            currency0: Currency.wrap(address(t0)),
            currency1: Currency.wrap(address(t1)),
            fee: 3000,
            tickSpacing: 60,
            hooks: IHooks(hookAddr)
        });
        manager.initialize(key, SQRT_1); // public pool opens at price 1.0

        // seed the public Uniswap pool with deep, full-range liquidity
        t0.mint(address(this), 1_000_000e18);
        t1.mint(address(this), 1_000_000e18);
        t0.approve(address(lpRouter), type(uint256).max);
        t1.approve(address(lpRouter), type(uint256).max);
        lpRouter.modifyLiquidity(
            key,
            IPoolManager.ModifyLiquidityParams({tickLower: -600, tickUpper: 600, liquidityDelta: 5_000e18, salt: 0}),
            ""
        );

        // the PRIVATE pool, DIVERGENT: currency0 cheaper on private (price1/0 = 0.5 vs uni 1.0)
        priv = new RegenTestAMM(t0, t1);
        t0.mint(address(this), 2_000e18);
        t1.mint(address(this), 1_000e18);
        t0.approve(address(priv), type(uint256).max);
        t1.approve(address(priv), type(uint256).max);
        priv.seed(2_000e18, 1_000e18);   // r0=2000, r1=1000 → private price 0.5
        priv.setRebalancer(address(hook));

        // wire the market to the hook + give the hook working inventory (currency1 for this direction)
        hook.register(key, IPrivatePool(address(priv)), treasury, bytes32("CACTUS"));
        t1.mint(address(hook), 500e18);

        // approvals for the user swap
        t0.approve(address(swapRouter), type(uint256).max);
        t1.approve(address(swapRouter), type(uint256).max);
    }

    function test_hook_backruns_arb_capturesSpread_toTreasury() public {
        uint256 privP0 = _privPrice();
        uint256 uniP0 = _uniPrice();
        assertLt(privP0, uniP0, "setup: private cheaper for currency0");
        assertEq(t1.balanceOf(treasury), 0, "treasury starts empty");

        // a small user swap on the public pool → fires afterSwap → the hook arbs
        swapRouter.swap(
            key,
            IPoolManager.SwapParams({zeroForOne: true, amountSpecified: -1e18, sqrtPriceLimitX96: TickMath.MIN_SQRT_PRICE + 1}),
            PoolSwapTest.TestSettings({takeClaims: false, settleUsingBurn: false}),
            ""
        );

        // 1) spread captured → treasury grew
        assertGt(t1.balanceOf(treasury), 0, "regen treasury must receive the captured spread");
        // 2) private pool converged toward the uni price
        uint256 privP1 = _privPrice();
        assertGt(privP1, privP0, "private price must rise toward uni");
        assertLe(privP1, _uniPrice() + 1, "private must not overshoot past uni");
    }

    function _uniPrice() internal view returns (uint256) {
        (uint160 s,,,) = IPoolManager(address(manager)).getSlot0(key.toId());
        return (uint256(s) * uint256(s) * 1e18) >> 192;
    }

    function _privPrice() internal view returns (uint256) {
        (uint256 r0, uint256 r1) = priv.getReserves();
        return (r1 * 1e18) / r0;
    }
}
