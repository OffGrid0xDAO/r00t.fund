// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {CommodityRegistry} from "../src/CommodityRegistry.sol";
import {CommodityToken} from "../src/CommodityToken.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockRoot is ERC20 {
    constructor() ERC20("Root", "R00T") {}
    function mint(address to, uint256 a) external { _mint(to, a); }
}

contract CommodityRegistryTest is Test {
    CommodityRegistry reg;
    MockRoot root;
    address treasury = address(0x7EA);
    address alice = address(0xA11CE); // first grower
    address bob = address(0xB0B);     // next land

    function setUp() public {
        root = new MockRoot();
        reg = new CommodityRegistry(address(root), treasury, 100e18); // minBond 100 R00T
        root.mint(alice, 10_000e18);
        root.mint(bob, 10_000e18);
    }

    function _createCarrot(address who, uint256 supply, uint256 bond) internal returns (address) {
        vm.startPrank(who);
        root.approve(address(reg), bond);
        address c = reg.createCommodity("Carrot", "CARROT", supply, bond);
        vm.stopPrank();
        return c;
    }

    // ── happy paths ──
    function test_create_mintsGenesis_bondsToTreasury() public {
        address carrot = _createCarrot(alice, 1_000_000e18, 100e18);
        assertEq(CommodityToken(carrot).balanceOf(alice), 1_000_000e18, "genesis to first grower");
        assertEq(root.balanceOf(treasury), 100e18, "bond to treasury");
        assertEq(reg.getCommodity("CARROT"), carrot, "registered by symbol");
        assertEq(CommodityToken(carrot).genesisGrower(), alice, "genesis grower recorded");
    }

    function test_interLandOTC_buyAtSellerPrice() public {
        address carrot = _createCarrot(alice, 1_000_000e18, 100e18);
        // Alice lists 10,000 CARROT at 2 R00T each
        vm.startPrank(alice);
        CommodityToken(carrot).approve(address(reg), 10_000e18);
        uint256 offerId = reg.listForSale(carrot, 10_000e18, 2e18);
        vm.stopPrank();

        // Bob (next land) buys 5,000 CARROT → pays 10,000 R00T to Alice
        uint256 aliceRootBefore = root.balanceOf(alice);
        vm.startPrank(bob);
        root.approve(address(reg), 10_000e18);
        reg.buy(offerId, 5_000e18);
        vm.stopPrank();

        assertEq(CommodityToken(carrot).balanceOf(bob), 5_000e18, "bob got carrot");
        assertEq(root.balanceOf(alice) - aliceRootBefore, 10_000e18, "alice got 5000*2 R00T");
    }

    function test_reprice_thenBuyAtNewPrice() public {
        address carrot = _createCarrot(alice, 1_000_000e18, 100e18);
        vm.startPrank(alice);
        CommodityToken(carrot).approve(address(reg), 1000e18);
        uint256 id = reg.listForSale(carrot, 1000e18, 1e18);
        reg.reprice(id, 3e18); // alice decides a new price for the next land
        vm.stopPrank();
        vm.startPrank(bob);
        root.approve(address(reg), 3000e18);
        reg.buy(id, 1000e18);
        vm.stopPrank();
        assertEq(root.balanceOf(alice), 10_000e18 - 100e18 + 3000e18, "sold at repriced 3 R00T");
    }

    function test_cancel_returnsEscrow() public {
        address carrot = _createCarrot(alice, 1_000_000e18, 100e18);
        vm.startPrank(alice);
        CommodityToken(carrot).approve(address(reg), 1000e18);
        uint256 id = reg.listForSale(carrot, 1000e18, 1e18);
        uint256 balAfterList = CommodityToken(carrot).balanceOf(alice);
        reg.cancel(id);
        vm.stopPrank();
        assertEq(CommodityToken(carrot).balanceOf(alice) - balAfterList, 1000e18, "escrow returned");
    }

    // ── attack / guard cases ──
    function test_duplicateSymbol_REJECTED() public {
        _createCarrot(alice, 1_000_000e18, 100e18);
        // Bob cannot create a second CARROT
        vm.startPrank(bob);
        root.approve(address(reg), 100e18);
        vm.expectRevert(CommodityRegistry.SymbolTaken.selector);
        reg.createCommodity("Carrot", "CARROT", 500e18, 100e18);
        vm.stopPrank();
    }

    function test_belowMinBond_REJECTED() public {
        vm.startPrank(alice);
        root.approve(address(reg), 50e18);
        vm.expectRevert(CommodityRegistry.BelowMinBond.selector);
        reg.createCommodity("Rice", "RICE", 1000e18, 50e18);
        vm.stopPrank();
    }

    function test_buyMoreThanOffered_REJECTED() public {
        address carrot = _createCarrot(alice, 1_000_000e18, 100e18);
        vm.startPrank(alice);
        CommodityToken(carrot).approve(address(reg), 1000e18);
        uint256 id = reg.listForSale(carrot, 1000e18, 1e18);
        vm.stopPrank();
        vm.startPrank(bob);
        root.approve(address(reg), 5000e18);
        vm.expectRevert(CommodityRegistry.InsufficientOffer.selector);
        reg.buy(id, 2000e18);
        vm.stopPrank();
    }

    function test_reprice_onlySeller_REJECTED() public {
        address carrot = _createCarrot(alice, 1_000_000e18, 100e18);
        vm.startPrank(alice);
        CommodityToken(carrot).approve(address(reg), 1000e18);
        uint256 id = reg.listForSale(carrot, 1000e18, 1e18);
        vm.stopPrank();
        vm.prank(bob);
        vm.expectRevert(CommodityRegistry.NotSeller.selector);
        reg.reprice(id, 99e18);
    }

    function test_cancel_onlySeller_REJECTED() public {
        address carrot = _createCarrot(alice, 1_000_000e18, 100e18);
        vm.startPrank(alice);
        CommodityToken(carrot).approve(address(reg), 1000e18);
        uint256 id = reg.listForSale(carrot, 1000e18, 1e18);
        vm.stopPrank();
        vm.prank(bob);
        vm.expectRevert(CommodityRegistry.NotSeller.selector);
        reg.cancel(id);
    }

    function test_commodityToken_isFixedSupply_noMint() public {
        address carrot = _createCarrot(alice, 1_000_000e18, 100e18);
        // no mint function exists on CommodityToken beyond the constructor genesis
        assertEq(CommodityToken(carrot).totalSupply(), 1_000_000e18, "fixed supply");
    }

    function test_partialFills_drainOffer() public {
        address carrot = _createCarrot(alice, 1_000_000e18, 100e18);
        vm.startPrank(alice);
        CommodityToken(carrot).approve(address(reg), 1000e18);
        uint256 id = reg.listForSale(carrot, 1000e18, 1e18);
        vm.stopPrank();
        vm.startPrank(bob);
        root.approve(address(reg), 1000e18);
        reg.buy(id, 600e18);
        reg.buy(id, 400e18);
        vm.expectRevert(CommodityRegistry.ZeroAmount.selector);
        reg.buy(id, 0);
        vm.stopPrank();
        assertEq(CommodityToken(carrot).balanceOf(bob), 1000e18, "fully drained across fills");
    }
}
