// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {ParcelRegistry} from "../src/ParcelRegistry.sol";
import {ParcelCoin} from "../src/ParcelCoin.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockRoot is ERC20 {
    constructor() ERC20("Root", "R00T") {}
    function mint(address to, uint256 a) external { _mint(to, a); }
}

contract ParcelRegistryTest is Test {
    ParcelRegistry reg;
    MockRoot root;
    address treasury = address(0x7EA);
    address alice = address(0xA11CE); // first grower
    address bob = address(0xB0B);     // next land

    function setUp() public {
        root = new MockRoot();
        reg = new ParcelRegistry(address(root), treasury, 100e18); // minBond 100 R00T
        root.mint(alice, 10_000e18);
        root.mint(bob, 10_000e18);
    }

    function _createCarrot(address who, uint256 supply, uint256 bond) internal returns (address) {
        vm.startPrank(who);
        root.approve(address(reg), bond);
        address c = reg.createParcel("Carrot", "CARROT", supply, bond);
        vm.stopPrank();
        return c;
    }

    // ── happy paths ──
    function test_create_mintsGenesis_bondsToTreasury() public {
        address carrot = _createCarrot(alice, 1_000_000e18, 100e18);
        assertEq(ParcelCoin(carrot).balanceOf(alice), 1_000_000e18, "genesis to first grower");
        assertEq(root.balanceOf(treasury), 100e18, "bond to treasury");
        assertEq(reg.getParcel("CARROT"), carrot, "registered by symbol");
        assertEq(ParcelCoin(carrot).genesisGrower(), alice, "genesis grower recorded");
    }

    function test_interLandOTC_buyAtSellerPrice() public {
        address carrot = _createCarrot(alice, 1_000_000e18, 100e18);
        // Alice lists 10,000 CARROT at 2 R00T each
        vm.startPrank(alice);
        ParcelCoin(carrot).approve(address(reg), 10_000e18);
        uint256 offerId = reg.listForSale(carrot, 10_000e18, 2e18);
        vm.stopPrank();

        // Bob (next land) buys 5,000 CARROT → pays 10,000 R00T to Alice
        uint256 aliceRootBefore = root.balanceOf(alice);
        vm.startPrank(bob);
        root.approve(address(reg), 10_000e18);
        reg.buy(offerId, 5_000e18, 10_000e18);
        vm.stopPrank();

        assertEq(ParcelCoin(carrot).balanceOf(bob), 5_000e18, "bob got carrot");
        assertEq(root.balanceOf(alice) - aliceRootBefore, 10_000e18, "alice got 5000*2 R00T");
    }

    function test_reprice_thenBuyAtNewPrice() public {
        address carrot = _createCarrot(alice, 1_000_000e18, 100e18);
        vm.startPrank(alice);
        ParcelCoin(carrot).approve(address(reg), 1000e18);
        uint256 id = reg.listForSale(carrot, 1000e18, 1e18);
        reg.reprice(id, 3e18); // alice decides a new price for the next land
        vm.stopPrank();
        vm.startPrank(bob);
        root.approve(address(reg), 3000e18);
        reg.buy(id, 1000e18, 3000e18);
        vm.stopPrank();
        assertEq(root.balanceOf(alice), 10_000e18 - 100e18 + 3000e18, "sold at repriced 3 R00T");
    }

    function test_cancel_returnsEscrow() public {
        address carrot = _createCarrot(alice, 1_000_000e18, 100e18);
        vm.startPrank(alice);
        ParcelCoin(carrot).approve(address(reg), 1000e18);
        uint256 id = reg.listForSale(carrot, 1000e18, 1e18);
        uint256 balAfterList = ParcelCoin(carrot).balanceOf(alice);
        reg.cancel(id);
        vm.stopPrank();
        assertEq(ParcelCoin(carrot).balanceOf(alice) - balAfterList, 1000e18, "escrow returned");
    }

    // ── attack / guard cases ──
    function test_duplicateSymbol_REJECTED() public {
        _createCarrot(alice, 1_000_000e18, 100e18);
        // Bob cannot create a second CARROT
        vm.startPrank(bob);
        root.approve(address(reg), 100e18);
        vm.expectRevert(ParcelRegistry.SymbolTaken.selector);
        reg.createParcel("Carrot", "CARROT", 500e18, 100e18);
        vm.stopPrank();
    }

    function test_belowMinBond_REJECTED() public {
        vm.startPrank(alice);
        root.approve(address(reg), 50e18);
        vm.expectRevert(ParcelRegistry.BelowMinBond.selector);
        reg.createParcel("Rice", "RICE", 1000e18, 50e18);
        vm.stopPrank();
    }

    function test_buyMoreThanOffered_REJECTED() public {
        address carrot = _createCarrot(alice, 1_000_000e18, 100e18);
        vm.startPrank(alice);
        ParcelCoin(carrot).approve(address(reg), 1000e18);
        uint256 id = reg.listForSale(carrot, 1000e18, 1e18);
        vm.stopPrank();
        vm.startPrank(bob);
        root.approve(address(reg), 5000e18);
        vm.expectRevert(ParcelRegistry.InsufficientOffer.selector);
        reg.buy(id, 2000e18, type(uint256).max);
        vm.stopPrank();
    }

    function test_reprice_onlySeller_REJECTED() public {
        address carrot = _createCarrot(alice, 1_000_000e18, 100e18);
        vm.startPrank(alice);
        ParcelCoin(carrot).approve(address(reg), 1000e18);
        uint256 id = reg.listForSale(carrot, 1000e18, 1e18);
        vm.stopPrank();
        vm.prank(bob);
        vm.expectRevert(ParcelRegistry.NotSeller.selector);
        reg.reprice(id, 99e18);
    }

    function test_cancel_onlySeller_REJECTED() public {
        address carrot = _createCarrot(alice, 1_000_000e18, 100e18);
        vm.startPrank(alice);
        ParcelCoin(carrot).approve(address(reg), 1000e18);
        uint256 id = reg.listForSale(carrot, 1000e18, 1e18);
        vm.stopPrank();
        vm.prank(bob);
        vm.expectRevert(ParcelRegistry.NotSeller.selector);
        reg.cancel(id);
    }

    // AUDIT FIX (M-02): buyer is protected from a reprice front-run via maxRootCost.
    function test_buy_repriceFrontRun_REJECTED() public {
        address carrot = _createCarrot(alice, 1_000_000e18, 100e18);
        vm.startPrank(alice);
        ParcelCoin(carrot).approve(address(reg), 1000e18);
        uint256 id = reg.listForSale(carrot, 1000e18, 1e18); // quoted 1 R00T/unit
        reg.reprice(id, 100e18); // malicious jump to 100 R00T/unit before buy lands
        vm.stopPrank();
        vm.startPrank(bob);
        root.approve(address(reg), type(uint256).max); // buyer gave a broad allowance
        vm.expectRevert(ParcelRegistry.ExceedsMaxCost.selector);
        reg.buy(id, 1000e18, 1000e18); // will only pay up to the 1000 R00T they quoted
        vm.stopPrank();
    }

    function test_parcelToken_isFixedSupply_noMint() public {
        address carrot = _createCarrot(alice, 1_000_000e18, 100e18);
        // no mint function exists on ParcelCoin beyond the constructor genesis
        assertEq(ParcelCoin(carrot).totalSupply(), 1_000_000e18, "fixed supply");
    }

    function test_partialFills_drainOffer() public {
        address carrot = _createCarrot(alice, 1_000_000e18, 100e18);
        vm.startPrank(alice);
        ParcelCoin(carrot).approve(address(reg), 1000e18);
        uint256 id = reg.listForSale(carrot, 1000e18, 1e18);
        vm.stopPrank();
        vm.startPrank(bob);
        root.approve(address(reg), 1000e18);
        reg.buy(id, 600e18, type(uint256).max);
        reg.buy(id, 400e18, type(uint256).max);
        vm.expectRevert(ParcelRegistry.ZeroAmount.selector);
        reg.buy(id, 0, type(uint256).max);
        vm.stopPrank();
        assertEq(ParcelCoin(carrot).balanceOf(bob), 1000e18, "fully drained across fills");
    }
}
