// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {RegenArbHook} from "../../src/hackathon/RegenArbHook.sol";

/// @notice Phase-1 tests for the RegenArbHook CORE arb decision (`computeArb`). Pure logic, so no
///         live PoolManager needed. Proves: correct direction, capped size, the private-pool leg
///         CONVERGES toward the Uniswap price, and the round-trip is PROFITABLE (buy cheap, sell
///         dear) -> captured spread. Runs at both R00T/ETH scale and parcel/R00T scale to prove the
///         hook is currency-agnostic (works for the base token AND parcel tokens).
contract RegenArbHookTest is Test {
    RegenArbHook hook;
    uint256 constant WAD = 1e18;

    function setUp() public {
        hook = new RegenArbHook(IPoolManager(address(0)), address(this));
    }

    // ── helpers: constant-product simulation of the two legs ──

    /// simulate selling `amtIn` into a constant-product pool (rIn, rOut) -> amountOut + new reserves.
    function _cpOut(uint256 amtIn, uint256 rIn, uint256 rOut) internal pure returns (uint256 out) {
        out = rOut - (rIn * rOut) / (rIn + amtIn);
    }

    /// after the private leg, what's the new private price (currency1 per currency0, WAD)?
    function _privPriceAfter(bool zeroForOne, uint256 amtIn, uint256 r0, uint256 r1)
        internal pure returns (uint256 newP)
    {
        if (zeroForOne) { // sold currency0 in, currency1 out
            uint256 out1 = _cpOut(amtIn, r0, r1);
            newP = ((r1 - out1) * WAD) / (r0 + amtIn);
        } else {          // sold currency1 in, currency0 out
            uint256 out0 = _cpOut(amtIn, r1, r0);
            newP = ((r1 + amtIn) * WAD) / (r0 - out0);
        }
    }

    function _absDiff(uint256 a, uint256 b) internal pure returns (uint256) { return a > b ? a - b : b - a; }

    // ── tests ──

    function test_noArb_whenAligned() public view {
        // uni price == private price (r1/r0) -> nothing to do
        (bool doArb,,) = hook.computeArb((100e18 * WAD) / 5000e18, 5000e18, 100e18);
        assertFalse(doArb, "aligned pools must not arb");
    }

    function test_noArb_belowThreshold() public view {
        // private price = 100/5000 = 0.02; nudge uni by 0.1% (< 0.30% gate)
        uint256 priv = (100e18 * WAD) / 5000e18;
        (bool doArb,,) = hook.computeArb(priv + (priv / 1000), 5000e18, 100e18);
        assertFalse(doArb, "sub-threshold divergence must skip");
    }

    /// uni prices currency0 HIGHER than the private pool -> buy currency0 cheap on private (sell
    /// currency1 in), then sell it dear on uni. Assert direction, convergence, and profit.
    function test_uniDearer_converges_andProfits() public view {
        _runScale(5000e18, 100e18, 200e18); // R00T/ETH-ish scale, uni ~2x dearer for currency0
    }

    function test_parcelScale_converges_andProfits() public view {
        _runScale(300_000e18, 6_000e18, 12_000e18); // parcel/R00T scale
    }

    /// uni prices currency0 LOWER than private -> sell currency0 into private (dir = true).
    function test_uniCheaper_direction() public view {
        uint256 r0 = 5000e18; uint256 r1 = 100e18;
        uint256 privP = (r1 * WAD) / r0;
        (bool doArb, bool zeroForOne, uint256 amtIn) = hook.computeArb(privP / 2, r0, r1);
        assertTrue(doArb);
        assertTrue(zeroForOne, "uni cheaper -> sell currency0 into private");
        assertGt(amtIn, 0);
    }

    function test_capsLargeDivergence() public view {
        uint256 r0 = 5000e18; uint256 r1 = 100e18;
        // 100x uni price -> huge arb; input must be capped by MAX_REBALANCE_BPS (5%) of a reserve
        (bool doArb, bool zeroForOne, uint256 amtIn) = hook.computeArb(((r1 * WAD) / r0) * 100, r0, r1);
        assertTrue(doArb);
        assertFalse(zeroForOne);
        // currency1-in that pulls out at most 5% of r0 => amtIn bounded well under r1 itself here
        assertLt(amtIn, r1, "capped: cannot sink more currency1 than a bounded move");
    }

    /// shared body: private pool (r0,r1), uni prices currency0 at `uniNum/uniDen` of a token1 ratio.
    function _runScale(uint256 r0, uint256 r1, uint256 uniR1PerR0Num) internal view {
        // build a uni price that's ~2x the private price for currency0
        uint256 privP = (r1 * WAD) / r0;
        uint256 uniP = (uniR1PerR0Num * WAD) / r0; // e.g. 200/5000 vs 100/5000 -> 2x dearer

        (bool doArb, bool zeroForOne, uint256 amtIn) = hook.computeArb(uniP, r0, r1);
        assertTrue(doArb, "should arb a 2x gap");
        assertFalse(zeroForOne, "uni dearer for currency0 -> buy it on private (sell currency1 in)");

        // 1) convergence: the private price after the leg is closer to uni than before
        uint256 newPriv = _privPriceAfter(zeroForOne, amtIn, r0, r1);
        assertLt(_absDiff(newPriv, uniP), _absDiff(privP, uniP), "private price must move toward uni");

        // 2) profit: buy currency0 cheap on private (out0 for amtIn currency1), sell it on a DEEP uni
        //    pool at ~uniP -> currency1 back. profit = uni_out - amtIn > 0.
        uint256 out0 = _cpOut(amtIn, r1, r0);            // currency0 received from private
        // deep uni reserves at price uniP: u1/u0 = uniP; pick u0 large for low slippage
        uint256 u0 = r0 * 1000;
        uint256 u1 = (u0 * uniP) / WAD;
        uint256 uniOut1 = _cpOut(out0, u0, u1);          // currency1 from selling out0 on uni
        assertGt(uniOut1, amtIn, "round-trip must be profitable (spread captured)");
    }
}
