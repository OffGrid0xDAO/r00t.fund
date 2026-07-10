// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../src/ParcelLaunchpad.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockUSDC is ERC20 {
    constructor() ERC20("USD Coin", "USDC") { _mint(msg.sender, 1_000_000e6); }
    function decimals() public pure override returns (uint8) { return 6; }
    function mint(address to, uint256 amt) external { _mint(to, amt); }
}

contract ParcelLaunchpadTest is Test {
    ParcelLaunchpad lp;
    MockUSDC usdc;
    address treasury = address(0x7EA5);
    address backer = address(0xB0B);
    bytes32 constant PARCEL = keccak256("oak-field");

    function setUp() public {
        usdc = new MockUSDC();
        lp = new ParcelLaunchpad(treasury, address(usdc), 3000_000000); // $3,000/ETH
    }

    function test_pledgeETH_forwardsToTreasury_andRecords() public {
        vm.deal(backer, 1 ether);
        vm.prank(backer);
        lp.pledgeETH{value: 1 ether}(PARCEL);

        assertEq(treasury.balance, 1 ether, "treasury got ETH");
        assertEq(address(lp).balance, 0, "launchpad holds nothing");
        // 1 ETH * $3,000 = 3,000e6 usd; points = usd * 1.5 (bonus 15000bps)
        assertEq(lp.raised(PARCEL), 3000e6, "usd recorded");
        assertEq(lp.allocationPoints(backer), 4500e6, "early-bird points");
        assertEq(lp.totalRaisedUsd6(), 3000e6);
    }

    function test_pledgeUSDC_forwardsToTreasury_andRecords() public {
        usdc.mint(backer, 500e6);
        vm.startPrank(backer);
        usdc.approve(address(lp), 500e6);
        lp.pledgeUSDC(PARCEL, 500e6);
        vm.stopPrank();

        assertEq(usdc.balanceOf(treasury), 500e6, "treasury got USDC");
        assertEq(usdc.balanceOf(address(lp)), 0, "launchpad holds nothing");
        assertEq(lp.raised(PARCEL), 500e6);
        assertEq(lp.allocationPoints(backer), 750e6, "500 * 1.5x");
    }

    function test_advanceRound_lowersBonus_soLaterPledgersGetFewerPoints() public {
        // round 0 @ 1.5x
        usdc.mint(backer, 200e6);
        vm.startPrank(backer);
        usdc.approve(address(lp), 200e6);
        lp.pledgeUSDC(PARCEL, 100e6);          // 150e6 points
        vm.stopPrank();

        lp.advanceRound(12000);                 // 1.2x
        assertEq(lp.round(), 1);

        vm.startPrank(backer);
        usdc.approve(address(lp), 100e6);
        lp.pledgeUSDC(PARCEL, 100e6);          // 120e6 points
        vm.stopPrank();

        assertEq(lp.allocationPoints(backer), 270e6, "150 + 120: early was worth more");
    }

    function test_advanceRound_cannotRaiseBonusOrGoBelow1x() public {
        vm.expectRevert(bytes("bonus range"));
        lp.advanceRound(16000); // above current
        vm.expectRevert(bytes("bonus range"));
        lp.advanceRound(9000);  // below 1x
    }

    function test_createParcel_thenPledge_mintsCultureTokenToPledger() public {
        address tokenAddr = lp.createParcel(PARCEL, "Oak Field", "OAK");
        ParcelToken oak = ParcelToken(tokenAddr);
        assertEq(oak.symbol(), "OAK");

        usdc.mint(backer, 100e6);
        vm.startPrank(backer);
        usdc.approve(address(lp), 100e6);
        lp.pledgeUSDC(PARCEL, 100e6);          // 150e6 points → 150e18 tokens
        vm.stopPrank();

        assertEq(oak.balanceOf(backer), 150e18, "minted culture token to pledger");
        assertEq(usdc.balanceOf(treasury), 100e6, "funds still went to treasury");
    }

    function test_createParcel_onlyOwner_andNoDuplicate() public {
        lp.createParcel(PARCEL, "Oak Field", "OAK");
        vm.expectRevert(bytes("exists"));
        lp.createParcel(PARCEL, "Oak Field", "OAK");
        vm.prank(backer);
        vm.expectRevert();
        lp.createParcel(keccak256("other"), "X", "X");
    }

    function test_pause_blocksPledges() public {
        lp.pause();
        vm.deal(backer, 1 ether);
        vm.prank(backer);
        vm.expectRevert();
        lp.pledgeETH{value: 1 ether}(PARCEL);
    }
}
