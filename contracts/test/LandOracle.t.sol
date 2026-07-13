// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {Land, IAggregatorV3} from "../src/Land.sol";

/// Configurable Chainlink AggregatorV3 mock (ETH/USD feed + L2 sequencer uptime).
contract MockAggregator is IAggregatorV3 {
    uint8 public decimals;
    int256 public answer;
    uint256 public startedAt;
    uint256 public updatedAt;
    constructor(uint8 _dec) { decimals = _dec; }
    function set(int256 a, uint256 started, uint256 updated) external {
        answer = a; startedAt = started; updatedAt = updated;
    }
    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80) {
        return (1, answer, startedAt, updatedAt, 1);
    }
}

/// Tests Land.ethPriceE6() oracle path via a minimal Land created with the factory as this test.
contract LandOracleTest is Test {
    Land land;
    MockAggregator ethFeed;   // 8-decimal ETH/USD (Chainlink standard)
    MockAggregator seqFeed;   // sequencer uptime
    address steward = address(0x57ED);

    function setUp() public {
        Land.InitParams memory p;
        p.steward = steward;
        p.root = address(0x1); p.usdc = address(0x2); p.treasury = address(0x3);
        p.validator = address(0x4); p.poolManager = address(0x5); p.protocolTreasury = address(0x6);
        p.poolFee = 3000; p.tickSpacing = 60;
        p.ethPriceE6 = 3000_000000; // manual fallback = $3000
        p.rootPriceE6 = 100000;     // $0.10
        p.name = "L"; p.region = "R"; p.cid = "cid";
        land = new Land(p); // msg.sender = factory = this

        ethFeed = new MockAggregator(8);
        seqFeed = new MockAggregator(0);
    }

    function test_fallback_whenNoFeed() public view {
        // no oracle set → manual fallback
        assertEq(land.ethPriceE6(), 3000_000000);
    }

    function test_liveRead_scales8dpTo6dp() public {
        // $1780.12345678 at 8dp → 1780_123456 at 6dp
        ethFeed.set(int256(178012345678), block.timestamp, block.timestamp);
        vm.prank(steward);
        land.setEthFeed(address(ethFeed), address(0), 3600);
        assertEq(land.ethPriceE6(), 1780_123456);
    }

    function test_revert_staleAnswer() public {
        vm.warp(100000);
        ethFeed.set(int256(1780e8), block.timestamp, block.timestamp - 3601); // older than heartbeat
        vm.prank(steward);
        land.setEthFeed(address(ethFeed), address(0), 3600);
        vm.expectRevert(Land.StaleOraclePrice.selector);
        land.ethPriceE6();
    }

    function test_revert_badPrice() public {
        ethFeed.set(0, block.timestamp, block.timestamp);
        vm.prank(steward);
        land.setEthFeed(address(ethFeed), address(0), 3600);
        vm.expectRevert(Land.BadOraclePrice.selector);
        land.ethPriceE6();
    }

    function test_revert_sequencerDown() public {
        vm.warp(100000);
        ethFeed.set(int256(1780e8), block.timestamp, block.timestamp);
        seqFeed.set(1, block.timestamp - 10000, block.timestamp); // 1 = down
        vm.prank(steward);
        land.setEthFeed(address(ethFeed), address(seqFeed), 3600);
        vm.expectRevert(Land.SequencerDown.selector);
        land.ethPriceE6();
    }

    function test_revert_sequencerGracePeriod() public {
        vm.warp(100000);
        ethFeed.set(int256(1780e8), block.timestamp, block.timestamp);
        seqFeed.set(0, block.timestamp - 100, block.timestamp); // up, but restarted 100s ago < GRACE
        vm.prank(steward);
        land.setEthFeed(address(ethFeed), address(seqFeed), 3600);
        vm.expectRevert(Land.SequencerGracePeriod.selector);
        land.ethPriceE6();
    }

    function test_liveRead_afterGracePasses() public {
        vm.warp(100000);
        ethFeed.set(int256(1780e8), block.timestamp, block.timestamp);
        seqFeed.set(0, block.timestamp - 3601, block.timestamp); // up, restarted long ago
        vm.prank(steward);
        land.setEthFeed(address(ethFeed), address(seqFeed), 3600);
        assertEq(land.ethPriceE6(), 1780_000000);
    }

    function test_onlySteward_setEthFeed() public {
        vm.expectRevert(Land.NotSteward.selector);
        land.setEthFeed(address(ethFeed), address(0), 3600);
    }
}
