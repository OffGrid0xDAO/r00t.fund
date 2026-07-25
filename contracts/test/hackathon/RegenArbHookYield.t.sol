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
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

import {RegenArbHook} from "../../src/hackathon/RegenArbHook.sol";
import {RegenTestAMM} from "./mocks/RegenTestAMM.sol";
import {IPrivatePool} from "../../src/hackathon/interfaces/IPrivatePool.sol";

/// Minimal ERC-4626-ish vault: 1 share == 1 asset at deposit (yield accrues separately in a real vault).
contract MockVault is ERC20 {
    IERC20 public immutable underlying;
    constructor(IERC20 a) ERC20("yv", "yv") { underlying = a; }
    function asset() external view returns (address) { return address(underlying); }
    function deposit(uint256 assets, address receiver) external returns (uint256 shares) {
        underlying.transferFrom(msg.sender, address(this), assets);
        shares = assets; _mint(receiver, shares);
    }
}

/// @notice DualPool-style yield: captured arb spread is DEPOSITED into an ERC-4626 vault, so the regen
///         treasury holds yield-bearing shares (not idle tokens). Proves the hook routes the spread to
///         the vault and mints shares to the treasury.
contract RegenArbHookYieldTest is Test {
    PoolManager manager;
    PoolSwapTest swapRouter;
    PoolModifyLiquidityTest lpRouter;
    RegenArbHook hook;
    MockERC20 t0;
    MockERC20 t1;
    MockVault vault;
    PoolKey key;
    address treasury = makeAddr("treasury");
    uint160 constant SQRT_1 = 79228162514264337593543950336;

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
        t0.mint(address(this), 1_000_000e18); t1.mint(address(this), 1_000_000e18);
        t0.approve(address(lpRouter), type(uint256).max); t1.approve(address(lpRouter), type(uint256).max);
        lpRouter.modifyLiquidity(key, IPoolManager.ModifyLiquidityParams({tickLower: -600, tickUpper: 600, liquidityDelta: 5_000e18, salt: 0}), "");

        // private pool DIVERGENT (currency0 cheap on private)
        RegenTestAMM priv = new RegenTestAMM(t0, t1);
        t0.mint(address(this), 2_000e18); t1.mint(address(this), 1_000e18);
        t0.approve(address(priv), type(uint256).max); t1.approve(address(priv), type(uint256).max);
        priv.seed(2_000e18, 1_000e18);
        priv.setRebalancer(address(hook));

        // treasury numeraire = currency0; set a yield vault for it (DualPool idle-yield)
        hook.register(key, IPrivatePool(address(priv)), treasury, Currency.wrap(address(t0)), bytes32("M"));
        vault = new MockVault(IERC20(address(t0)));
        hook.setYieldVault(address(t0), address(vault));

        t1.mint(address(hook), 500e18); // hook working inventory
        t0.approve(address(swapRouter), type(uint256).max); t1.approve(address(swapRouter), type(uint256).max);
    }

    function test_spread_is_deposited_to_yield_vault() public {
        assertEq(t0.balanceOf(treasury), 0, "treasury holds no raw token");
        assertEq(vault.balanceOf(treasury), 0, "no shares yet");

        // user swap → arb → captured spread routed to the vault
        swapRouter.swap(
            key,
            IPoolManager.SwapParams({zeroForOne: true, amountSpecified: -1e18, sqrtPriceLimitX96: TickMath.MIN_SQRT_PRICE + 1}),
            PoolSwapTest.TestSettings({takeClaims: false, settleUsingBurn: false}), ""
        );

        // treasury got YIELD-BEARING SHARES, not raw tokens
        assertGt(vault.balanceOf(treasury), 0, "treasury holds yield vault shares");
        assertEq(t0.balanceOf(treasury), 0, "raw token went into the vault, not the treasury");
        assertGt(t0.balanceOf(address(vault)), 0, "vault holds the deposited spread");
    }

    function test_unset_vault_pays_raw() public {
        hook.setYieldVault(address(t0), address(0)); // disable yield → raw payout
        swapRouter.swap(
            key,
            IPoolManager.SwapParams({zeroForOne: true, amountSpecified: -1e18, sqrtPriceLimitX96: TickMath.MIN_SQRT_PRICE + 1}),
            PoolSwapTest.TestSettings({takeClaims: false, settleUsingBurn: false}), ""
        );
        assertGt(t0.balanceOf(treasury), 0, "raw token to treasury when no vault");
        assertEq(vault.balanceOf(treasury), 0, "no shares when vault disabled");
    }
}
