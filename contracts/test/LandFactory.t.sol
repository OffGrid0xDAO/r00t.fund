// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../src/LandFactory.sol";
import "../src/Land.sol";
import "../src/ParcelToken.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

import {PoolManager} from "v4-core/PoolManager.sol";
import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {PoolSwapTest} from "v4-core/test/PoolSwapTest.sol";
import {PoolKey} from "v4-core/types/PoolKey.sol";
import {TickMath} from "v4-core/libraries/TickMath.sol";

contract MockUSDC is ERC20 {
    constructor() ERC20("USD Coin", "USDC") { _mint(msg.sender, 1_000_000e6); }
    function decimals() public pure override returns (uint8) { return 6; }
    function mint(address to, uint256 amt) external { _mint(to, amt); }
}

contract MockRoot is ERC20 {
    constructor() ERC20("Root", "ROOT") {}
    function mint(address to, uint256 amt) external { _mint(to, amt); }
}

contract LandFactoryTest is Test {
    LandFactory factory;
    MockUSDC usdc;
    MockRoot root;
    PoolManager manager;
    PoolSwapTest swapRouter;

    address validator = address(0x7A11);
    address steward = address(0x57EE);
    address backer = address(0xB0B);
    address trader = address(0x77AD);
    address treasury = address(0x7EA5);
    address protocolTreasury = address(0x9701);

    bytes32 constant PARCEL = keccak256("oak-field");
    uint256 constant PLEDGE = 100_000e18;
    uint160 constant SQRT_1_1 = 79228162514264337593543950336; // price = 1 (1 parcel = 1 R00T)
    uint256 constant ROOT_PRICE_E6 = 100000; // $0.10 per R00T

    function setUp() public {
        usdc = new MockUSDC();
        root = new MockRoot();
        manager = new PoolManager(address(this));
        swapRouter = new PoolSwapTest(IPoolManager(address(manager)));
        factory = new LandFactory(
            address(root), address(usdc), validator, address(manager), protocolTreasury,
            1000e18, 3000, 60, ROOT_PRICE_E6
        );
    }

    function _createValidatedLandWithParcel() internal returns (Land land, ParcelToken oak) {
        root.mint(steward, PLEDGE);
        vm.startPrank(steward);
        root.approve(address(factory), PLEDGE);
        address la = factory.createLand(LandFactory.CreateArgs({
            name: "Pilot Project", region: "highlands",
            boundaryHash: keccak256("kmz"), topoHash: keccak256("topo"), cid: "ipfs://cid",
            treasury: treasury, ethPriceE6: 3000_000000, r00tPledge: PLEDGE
        }));
        vm.stopPrank();
        land = Land(payable(la));

        vm.prank(validator);
        land.validate();
        vm.prank(steward);
        oak = ParcelToken(land.createParcel(PARCEL, "Oak Field", "OAK"));
    }

    function test_createLand_pullsR00tPledge_intoReserve() public {
        (Land land, ) = _createValidatedLandWithParcel();
        assertEq(factory.landCount(), 1);
        assertEq(land.r00tLiquidityReserve(), PLEDGE, "reserve earmarked");
        assertEq(land.steward(), steward);
        assertTrue(land.validated());
    }

    function test_seed_createsRealV4Pool_andDebitsReserve() public {
        (Land land, ) = _createValidatedLandWithParcel();
        uint256 rootSeed = 40_000e18;
        vm.prank(steward);
        land.seedParcelLiquidity(PARCEL, SQRT_1_1, rootSeed, 40_000e18);

        assertTrue(land.parcelPoolInitialized(PARCEL), "pool live");
        // real R00T left the reserve into the pool (manager custodies it)
        assertLt(land.r00tLiquidityReserve(), PLEDGE, "reserve debited");
        assertGt(root.balanceOf(address(manager)), 0, "pool holds R00T");
    }

    function test_pledge_mintsParcelToken_atLivePoolPrice() public {
        (Land land, ParcelToken oak) = _createValidatedLandWithParcel();
        vm.prank(steward);
        land.seedParcelLiquidity(PARCEL, SQRT_1_1, 40_000e18, 40_000e18);

        usdc.mint(backer, 100e6);
        vm.startPrank(backer);
        usdc.approve(address(land), 100e6);
        land.pledgeUSDC(PARCEL, 100e6); // $100 → 1000 R00T @ $0.10 → 1000 OAK @ price 1
        vm.stopPrank();

        assertEq(usdc.balanceOf(treasury), 100e6, "100% to treasury");
        assertApproxEqRel(oak.balanceOf(backer), 1000e18, 1e15, "minted at pool price (~1000 OAK)");
    }

    function test_pledge_beforeSeed_reverts() public {
        (Land land, ) = _createValidatedLandWithParcel();
        usdc.mint(backer, 100e6);
        vm.startPrank(backer);
        usdc.approve(address(land), 100e6);
        vm.expectRevert(Land.NotSeeded.selector);
        land.pledgeUSDC(PARCEL, 100e6);
        vm.stopPrank();
    }

    function test_swap_generatesFees_collectSplits70_30() public {
        (Land land, ParcelToken oak) = _createValidatedLandWithParcel();
        vm.prank(steward);
        land.seedParcelLiquidity(PARCEL, SQRT_1_1, 50_000e18, 50_000e18);

        // give the trader R00T + OAK and let them swap to generate LP fees
        root.mint(trader, 10_000e18);
        PoolKey memory key = land.parcelPoolKey(PARCEL);
        vm.startPrank(trader);
        root.approve(address(swapRouter), type(uint256).max);
        oak.approve(address(swapRouter), type(uint256).max);
        bool zeroForOne = Currency.unwrap(key.currency0) == address(root);
        swapRouter.swap(
            key,
            IPoolManager.SwapParams({
                zeroForOne: zeroForOne,
                amountSpecified: -1000e18, // exact-in 1000 R00T
                sqrtPriceLimitX96: zeroForOne ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1
            }),
            PoolSwapTest.TestSettings({ takeClaims: false, settleUsingBurn: false }),
            ""
        );
        vm.stopPrank();

        uint256 stewardBefore = root.balanceOf(steward);
        uint256 protoBefore = root.balanceOf(protocolTreasury);
        land.collectParcelFees(PARCEL);
        uint256 stewardFee = root.balanceOf(steward) - stewardBefore;
        uint256 protoFee = root.balanceOf(protocolTreasury) - protoBefore;

        assertGt(stewardFee + protoFee, 0, "fees collected from the R00T-in swap");
        // 70/30 split (allow rounding)
        assertApproxEqRel(stewardFee, ((stewardFee + protoFee) * 7000) / 10000, 1e15, "steward ~70%");
    }
}
