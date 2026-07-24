// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {TestToken} from "./mocks/TestToken.sol";

import {PoolManager} from "v4-core/PoolManager.sol";
import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {PoolSwapTest} from "v4-core/test/PoolSwapTest.sol";
import {PoolModifyLiquidityTest} from "v4-core/test/PoolModifyLiquidityTest.sol";
import {PoolKey} from "v4-core/types/PoolKey.sol";
import {Currency, CurrencyLibrary} from "v4-core/types/Currency.sol";
import {IHooks} from "v4-core/interfaces/IHooks.sol";
import {Hooks} from "v4-core/libraries/Hooks.sol";
import {TickMath} from "v4-core/libraries/TickMath.sol";
import {StateLibrary} from "v4-core/libraries/StateLibrary.sol";
import {PoolIdLibrary} from "v4-core/types/PoolId.sol";
import {LiquidityAmounts} from "v4-core-test/utils/LiquidityAmounts.sol";

import {RegenArbHook} from "../../src/hackathon/RegenArbHook.sol";
import {ZkAMMRebalanceAdapter} from "../../src/hackathon/ZkAMMRebalanceAdapter.sol";
import {IZkAMMRebalance} from "../../src/hackathon/interfaces/IZkAMMRebalance.sol";
import {IPrivatePool} from "../../src/hackathon/interfaces/IPrivatePool.sol";
import {ZkAMMPair} from "../../src/ZkAMMPair.sol";

/// admin stub: owns the pair (for setReserves' onlyAdminOwner) and relays setShortsContract (onlyAdmin).
contract AdminStub {
    address public owner;
    constructor() { owner = msg.sender; }
    function setShorts(address pair, address shorts) external { ZkAMMPair(payable(pair)).setShortsContract(shorts); }
}

/// @notice REAL infrastructure arb: the actual shielded ZkAMMPair (native ETH / R00T, WITH fees) wired
///         to the RegenArbHook through ZkAMMRebalanceAdapter, arbed against a REAL native-ETH Uniswap
///         v4 pool. Proves the shielded pool's real reserves rebalance toward the public price and the
///         captured spread reaches the regen treasury IN ETH — the base R00T/ETH market, end to end.
contract RegenArbHookZkAMMTest is Test {
    using StateLibrary for IPoolManager;
    using PoolIdLibrary for PoolKey;

    PoolManager manager;
    PoolSwapTest swapRouter;
    PoolModifyLiquidityTest lpRouter;
    RegenArbHook hook;
    ZkAMMPair pair;
    ZkAMMRebalanceAdapter adapter;
    AdminStub admin;
    TestToken root;
    PoolKey key;

    address treasury = makeAddr("regenTreasury");
    Currency constant ETH = CurrencyLibrary.ADDRESS_ZERO;

    function setUp() public {
        vm.deal(address(this), 10_000 ether);
        manager = new PoolManager(address(this));
        swapRouter = new PoolSwapTest(manager);
        lpRouter = new PoolModifyLiquidityTest(manager);

        root = new TestToken("r00t.fund", "ROOT");
        admin = new AdminStub();
        pair = new ZkAMMPair(address(admin), address(root), "zkROOT", "zROOT");

        // seed the REAL zkAMM: 10 ETH / 10,000 R00T → private price 1000 R00T per ETH
        root.mint(address(this), 5_000_000e18);
        root.approve(address(pair), type(uint256).max);
        pair.setReserves{value: 10 ether}(10 ether, 10_000e18);

        // hook at the afterSwap-flag address; deployer = this (also the launchpad, so we can register)
        address hookAddr = address(uint160(Hooks.AFTER_SWAP_FLAG));
        deployCodeTo("RegenArbHook.sol:RegenArbHook", abi.encode(IPoolManager(address(manager)), address(this)), hookAddr);
        hook = RegenArbHook(payable(hookAddr));

        // adapter presents the real zkAMM as an IPrivatePool and becomes its shortsContract
        adapter = new ZkAMMRebalanceAdapter(IZkAMMRebalance(address(pair)), root);
        adapter.setRebalancer(hookAddr);
        admin.setShorts(address(pair), address(adapter));

        // REAL native-ETH v4 pool ETH(c0)/R00T(c1), opened DIVERGENT at 2000 R00T/ETH (ETH dearer)
        key = PoolKey({currency0: ETH, currency1: Currency.wrap(address(root)), fee: 3000, tickSpacing: 60, hooks: IHooks(hookAddr)});
        uint160 sqrtP = _sqrtPriceX96(2000e18);
        manager.initialize(key, sqrtP);

        // deep liquidity: ~50 ETH + ~100k R00T full range
        root.approve(address(lpRouter), type(uint256).max);
        uint128 liq = LiquidityAmounts.getLiquidityForAmounts(
            sqrtP, TickMath.getSqrtPriceAtTick(-887220), TickMath.getSqrtPriceAtTick(887220), 50 ether, 100_000e18
        );
        lpRouter.modifyLiquidity{value: 60 ether}(
            key, IPoolManager.ModifyLiquidityParams({tickLower: -887220, tickUpper: 887220, liquidityDelta: int256(uint256(liq)), salt: 0}), ""
        );

        // wire the market: treasury accrues ETH (the base-market numeraire)
        hook.register(key, IPrivatePool(address(adapter)), treasury, ETH, bytes32("R00T-ETH"));

        // hook working inventory for the private leg (R00T in this direction) + a little ETH headroom
        root.mint(address(hook), 20_000e18);
        vm.deal(address(hook), 5 ether);
    }

    function test_realZkAMM_reserves_rebalance_spread_to_treasury_in_ETH() public {
        (uint256 ethR0, uint256 tokR0) = pair.getReserves();
        uint256 privP0 = (tokR0 * 1e18) / ethR0; // R00T per ETH
        assertEq(privP0, 1000e18, "private starts at 1000 R00T/ETH");
        assertEq(treasury.balance, 0, "treasury starts with 0 ETH");

        // a small user swap (buy some R00T with ETH) fires afterSwap → the hook arbs the divergence
        swapRouter.swap{value: 0.2 ether}(
            key,
            IPoolManager.SwapParams({zeroForOne: true, amountSpecified: -0.2 ether, sqrtPriceLimitX96: TickMath.MIN_SQRT_PRICE + 1}),
            PoolSwapTest.TestSettings({takeClaims: false, settleUsingBurn: false}),
            ""
        );

        // 1) the REAL shielded pool's reserves moved: R00T sold in, ETH taken out → price rises toward Uni
        (uint256 ethR1, uint256 tokR1) = pair.getReserves();
        uint256 privP1 = (tokR1 * 1e18) / ethR1;
        assertGt(privP1, privP0, "zkAMM price rebalanced UP toward the public price");
        assertLt(ethR1, ethR0, "zkAMM ETH reserve decreased (hook bought ETH cheap)");
        assertGt(tokR1, tokR0, "zkAMM R00T reserve increased (hook sold R00T in)");

        // 2) the captured spread reached the regen treasury IN ETH (converted from the R00T leg)
        assertGt(treasury.balance, 0, "regen treasury funded in ETH by the cross-pool arb");
    }

    // sqrtPriceX96 for price1/0 = R00T per ETH (WAD)
    function _sqrtPriceX96(uint256 price1e18) internal pure returns (uint160) {
        uint256 s = _sqrt(price1e18) * (2 ** 96) / 1e9;
        return uint160(s);
    }

    function _sqrt(uint256 y) internal pure returns (uint256 z) {
        if (y > 3) { z = y; uint256 x = y / 2 + 1; while (x < z) { z = x; x = (y / x + x) / 2; } }
        else if (y != 0) { z = 1; }
    }

    receive() external payable {}
}
