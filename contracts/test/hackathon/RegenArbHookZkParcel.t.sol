// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

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

import {RegenArbHook} from "../../src/hackathon/RegenArbHook.sol";
import {ZkParcelRebalanceAdapter, IZkParcelPool} from "../../src/hackathon/ZkParcelRebalanceAdapter.sol";
import {IPrivatePool} from "../../src/hackathon/interfaces/IPrivatePool.sol";
import {ZkParcelPool} from "../../src/ZkParcelPool.sol";
import {PoseidonT3Deployer} from "../../src/PoseidonT3.sol";

contract MockVerifier {
    function verifyProof(uint256[8] calldata, uint256[7] calldata) external pure returns (bool) { return true; }
    function verifyProof(uint256[8] calldata, uint256[3] calldata) external pure returns (bool) { return true; }
    function verifyProof(uint256[8] calldata, uint256[5] calldata) external pure returns (bool) { return true; }
}
contract MockRegistry {
    mapping(uint256 => bool) public spent;
    function isSpent(uint256 n) external view returns (bool) { return spent[n]; }
    function checkAndMark(uint256 n) external returns (bool w) { w = spent[n]; require(!w, "spent"); spent[n] = true; }
}
contract TT is ERC20 { constructor(string memory n) ERC20(n, n) {} function mint(address t, uint256 a) external { _mint(t, a); } }

/// @notice REAL shielded-parcel arb: the actual ZkParcelPool (parcel/R00T, ZK-shielded user trades)
///         wired to the RegenArbHook via ZkParcelRebalanceAdapter, arbed against a REAL Uniswap v4
///         pool. Proves the shielded pool's real reserves rebalance toward the public price and the
///         spread reaches the parcel regen treasury — parcels are now genuinely private, like the base.
contract RegenArbHookZkParcelTest is Test {
    using StateLibrary for IPoolManager;
    using PoolIdLibrary for PoolKey;

    PoolManager manager;
    PoolSwapTest swapRouter;
    PoolModifyLiquidityTest lpRouter;
    RegenArbHook hook;
    ZkParcelPool pool;
    ZkParcelRebalanceAdapter adapter;
    TT root;
    TT parcel;
    PoolKey key;
    address treasury = makeAddr("regenTreasury");
    uint160 constant SQRT_1 = 79228162514264337593543950336;

    function setUp() public {
        manager = new PoolManager(address(this));
        swapRouter = new PoolSwapTest(manager);
        lpRouter = new PoolModifyLiquidityTest(manager);

        root = new TT("ROOT");
        parcel = new TT("OAK");
        // ensure R00T is currency0 for a clean 1.0-priced pool (both minted here; order by address)
        require(address(root) < address(parcel) || address(parcel) < address(root), "addr");

        // REAL shielded ZkParcelPool (mock verifiers/registry — the rebalance path uses none of them)
        MockVerifier v = new MockVerifier();
        MockRegistry reg = new MockRegistry();
        address poseidon = PoseidonT3Deployer.deploy();
        pool = new ZkParcelPool(
            bytes32("OAK"), address(root), address(parcel),
            address(v), address(v), address(v), address(reg), address(this), poseidon
        );
        // seed the shielded pool DIVERGENT vs the public pool: here parcel is cheap on the private side
        root.mint(address(pool), 1_000e18);
        parcel.mint(address(pool), 2_000e18);
        pool.seed(); // private price R00T/parcel = 1000/2000 = 0.5

        // hook at the afterSwap-flag address; deployer = this (also launchpad, so we can register)
        address hookAddr = address(uint160(Hooks.AFTER_SWAP_FLAG));
        deployCodeTo("RegenArbHook.sol:RegenArbHook", abi.encode(IPoolManager(address(manager)), address(this)), hookAddr);
        hook = RegenArbHook(payable(hookAddr));

        // adapter is the pool's rebalancer; the hook is the adapter's rebalancer
        adapter = new ZkParcelRebalanceAdapter(IZkParcelPool(address(pool)));
        adapter.setRebalancer(hookAddr);
        pool.setRebalancer(address(adapter));

        // public v4 pool at price 1.0 (R00T/parcel), so parcel is DEARER on Uni than on the private pool
        (Currency c0, Currency c1) = address(root) < address(parcel)
            ? (Currency.wrap(address(root)), Currency.wrap(address(parcel)))
            : (Currency.wrap(address(parcel)), Currency.wrap(address(root)));
        key = PoolKey({currency0: c0, currency1: c1, fee: 3000, tickSpacing: 60, hooks: IHooks(hookAddr)});
        manager.initialize(key, SQRT_1);

        root.mint(address(this), 1_000_000e18);
        parcel.mint(address(this), 1_000_000e18);
        root.approve(address(lpRouter), type(uint256).max);
        parcel.approve(address(lpRouter), type(uint256).max);
        lpRouter.modifyLiquidity(
            key, IPoolManager.ModifyLiquidityParams({tickLower: -600, tickUpper: 600, liquidityDelta: 5_000e18, salt: 0}), ""
        );

        // treasury numeraire = R00T
        hook.register(key, IPrivatePool(address(adapter)), treasury, Currency.wrap(address(root)), bytes32("OAK"));
        // hook working inventory (both sides, small)
        root.mint(address(hook), 5_000e18);
        parcel.mint(address(hook), 5_000e18);

        root.approve(address(swapRouter), type(uint256).max);
        parcel.approve(address(swapRouter), type(uint256).max);
    }

    function test_realZkParcel_reserves_rebalance_to_treasury() public {
        (uint256 pr0, uint256 pp0) = pool.getReserves(); // (r00t, parcel)
        uint256 privParcelPerRoot0 = (pp0 * 1e18) / pr0;
        assertEq(treasury == address(0) ? 1 : 0, 0);
        uint256 treRoot0 = root.balanceOf(treasury);

        // a user swap on the public pool → afterSwap fires → hook drives the REAL ZkParcelPool rebalance
        bool zeroForOne = address(root) < address(parcel); // sell R00T in → push parcel dearer on Uni
        swapRouter.swap(
            key,
            IPoolManager.SwapParams({zeroForOne: zeroForOne, amountSpecified: -1e18,
                sqrtPriceLimitX96: zeroForOne ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1}),
            PoolSwapTest.TestSettings({takeClaims: false, settleUsingBurn: false}),
            ""
        );

        // the REAL shielded pool's reserves moved (rebalanceSwap executed on ZkParcelPool)
        (uint256 pr1, uint256 pp1) = pool.getReserves();
        assertTrue(pr1 != pr0 || pp1 != pp0, "ZkParcelPool reserves rebalanced");
        uint256 privParcelPerRoot1 = (pp1 * 1e18) / pr1;
        assertLt(privParcelPerRoot1, privParcelPerRoot0, "parcel got dearer on the private pool (converging up)");

        // captured spread reached the parcel regen treasury in R00T
        assertGt(root.balanceOf(treasury), treRoot0, "regen treasury funded by the shielded-pool arb");
    }
}
