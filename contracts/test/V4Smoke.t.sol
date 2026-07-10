// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import {PoolManager} from "v4-core/PoolManager.sol";
import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {StateLibrary} from "v4-core/libraries/StateLibrary.sol";
import {TickMath} from "v4-core/libraries/TickMath.sol";
import {LiquidityAmounts} from "../src/vendor/LiquidityAmounts.sol";

/// Smoke test: proves the real v4-core PoolManager deploys + libs compile.
contract V4SmokeTest is Test {
    using StateLibrary for IPoolManager;

    function test_deployPoolManager() public {
        PoolManager pm = new PoolManager(address(this));
        assertTrue(address(pm) != address(0));
        // sanity: TickMath + LiquidityAmounts link
        uint160 sp = TickMath.getSqrtPriceAtTick(0);
        assertGt(sp, 0);
    }
}
