// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {TickerRegistry} from "../src/TickerRegistry.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockRoot is ERC20 {
    constructor() ERC20("Root", "R00T") {}
    function mint(address to, uint256 a) external { _mint(to, a); }
}

contract TickerRegistryTest is Test {
    TickerRegistry reg;
    MockRoot root;
    address admin = address(this);
    address og = address(0x06);      // original creator of "OAK"
    address buyer = address(0xB0B);  // wants "OAK"
    address launcher = address(0x1A0); // a Land contract

    function setUp() public {
        root = new MockRoot();
        reg = new TickerRegistry(address(root), 1000); // 10% OG royalty
        reg.setLauncher(launcher, true);
        root.mint(buyer, 100_000e18);
        vm.prank(og);
        reg.reserve("OAK");
    }

    function test_reserve_setsOgAndHolder() public {
        (address ogC, address holder,, bool launched,) = reg.tickerInfo("OAK");
        assertEq(ogC, og); assertEq(holder, og); assertFalse(launched);
        assertFalse(reg.isAvailable("OAK"));
    }

    function test_duplicateReserve_REJECTED() public {
        vm.prank(buyer);
        vm.expectRevert(TickerRegistry.TickerTaken.selector);
        reg.reserve("OAK");
    }

    function test_buyout_splitsRoyaltyToOG_restToHolder() public {
        vm.prank(og);
        reg.setBuyoutPrice("OAK", 1000e18);
        vm.startPrank(buyer);
        root.approve(address(reg), 1000e18);
        reg.buy("OAK");
        vm.stopPrank();
        // OG gets 10% royalty AND is the previous holder (gets the other 90%) → full 1000 here
        assertEq(root.balanceOf(og), 1000e18, "OG (also prev holder) received full price");
        (, address holder,, ,) = reg.tickerInfo("OAK");
        assertEq(holder, buyer, "buyer now holds the ticker");
    }

    function test_buyout_royaltyToOG_afterResale() public {
        // og lists, buyer buys → buyer holds; buyer lists, a third party buys → OG still gets royalty
        vm.prank(og); reg.setBuyoutPrice("OAK", 1000e18);
        vm.startPrank(buyer); root.approve(address(reg), 1000e18); reg.buy("OAK"); vm.stopPrank();

        address third = address(0xC3); root.mint(third, 100_000e18);
        vm.prank(buyer); reg.setBuyoutPrice("OAK", 2000e18);
        uint256 ogBefore = root.balanceOf(og);
        uint256 buyerBefore = root.balanceOf(buyer);
        vm.startPrank(third); root.approve(address(reg), 2000e18); reg.buy("OAK"); vm.stopPrank();

        assertEq(root.balanceOf(og) - ogBefore, 200e18, "OG royalty 10% of 2000 on resale");
        assertEq(root.balanceOf(buyer) - buyerBefore, 1800e18, "prev holder gets 90%");
        (, address holder,,,) = reg.tickerInfo("OAK");
        assertEq(holder, third);
    }

    function test_buy_notForSale_REJECTED() public {
        vm.startPrank(buyer);
        root.approve(address(reg), 1000e18);
        vm.expectRevert(TickerRegistry.NotForSale.selector);
        reg.buy("OAK");
        vm.stopPrank();
    }

    function test_setBuyoutPrice_onlyHolder_REJECTED() public {
        vm.prank(buyer);
        vm.expectRevert(TickerRegistry.NotHolder.selector);
        reg.setBuyoutPrice("OAK", 1e18);
    }

    function test_launch_locksTicker_noMoreBuyout() public {
        vm.prank(launcher);
        reg.markLaunched("OAK", og, address(0xDEAD));
        (,,, bool launched, address token) = reg.tickerInfo("OAK");
        assertTrue(launched); assertEq(token, address(0xDEAD));
        // once launched, can't set a price or be bought — vamp-proof
        vm.prank(og);
        vm.expectRevert(TickerRegistry.Launched_.selector);
        reg.setBuyoutPrice("OAK", 1e18);
    }

    function test_markLaunched_onlyLauncher_REJECTED() public {
        vm.prank(buyer);
        vm.expectRevert(TickerRegistry.NotLauncher.selector);
        reg.markLaunched("OAK", og, address(0xDEAD));
    }

    function test_markLaunched_wrongHolder_REJECTED() public {
        vm.prank(launcher);
        vm.expectRevert(TickerRegistry.NotHolder.selector);
        reg.markLaunched("OAK", buyer, address(0xDEAD)); // buyer isn't the holder
    }

    function test_buy_launchedTicker_REJECTED() public {
        vm.prank(og); reg.setBuyoutPrice("OAK", 1000e18);
        vm.prank(launcher); reg.markLaunched("OAK", og, address(0xDEAD));
        vm.startPrank(buyer); root.approve(address(reg), 1000e18);
        vm.expectRevert(TickerRegistry.Launched_.selector);
        reg.buy("OAK");
        vm.stopPrank();
    }
}
