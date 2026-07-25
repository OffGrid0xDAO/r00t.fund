// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {PoolKey} from "v4-core/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "v4-core/types/PoolId.sol";
import {Currency} from "v4-core/types/Currency.sol";
import {StateLibrary} from "v4-core/libraries/StateLibrary.sol";
import {FullMath} from "v4-core/libraries/FullMath.sol";
import {FixedPoint96} from "v4-core/libraries/FixedPoint96.sol";

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import {IPrivatePool} from "./interfaces/IPrivatePool.sol";
import {RegenPrivatePool} from "./RegenPrivatePool.sol";

interface IRegenArbHook {
    function register(PoolKey calldata key, IPrivatePool privatePool, address regenTreasury, Currency treasuryCurrency, bytes32 marketId) external;
}

/// @title RegenCCAWiring  (ETHGlobal Lisbon 2026 — HACKATHON WORKSPACE)
/// @notice Completes a Uniswap Continuous Clearing Auction launch into r00t.fund's DOUBLE POOL. The
///         real Uniswap CCA runs the auction + seeds the PUBLIC v4 pool (with OUR RegenArbHook as its
///         hook, price >= the floor = OTC R00T floor). This contract then does the r00t side: it takes
///         the parcel supply RESERVED for the private pool, deploys + seeds the shielded-surface
///         private pool AT THE CLEARED PRICE (read from the live v4 pool), and registers the market on
///         the hook — so the arb between the two pools is live the moment the CCA finishes.
/// @dev The hook's `launchpad` must be set to this contract (so it may `register`). The private pool
///      here is RegenPrivatePool (constant-product, same surface as the shielded ZkParcelPool).
contract RegenCCAWiring {
    using SafeERC20 for IERC20;
    using StateLibrary for IPoolManager;
    using PoolIdLibrary for PoolKey;

    IPoolManager public immutable poolManager;
    IRegenArbHook public immutable hook;
    uint256 private constant WAD = 1e18;

    event MarketWired(bytes32 indexed marketId, address privatePool, uint256 clearedPriceE18, uint256 parcelSeed, uint256 r00tSeed);

    constructor(IPoolManager _pm, IRegenArbHook _hook) {
        poolManager = _pm;
        hook = _hook;
    }

    /// @notice Read the cleared price the CCA seeded the public pool at (currency1 per currency0, WAD).
    function clearedPriceE18(PoolKey calldata key) public view returns (uint256) {
        (uint160 sqrtP,,,) = poolManager.getSlot0(key.toId());
        uint256 p = FullMath.mulDiv(uint256(sqrtP), uint256(sqrtP), FixedPoint96.Q96);
        return FullMath.mulDiv(p, WAD, FixedPoint96.Q96);
    }

    /// @notice Seed the private pool at the CCA-cleared price with the RESERVED parcel supply + matching
    ///         R00T, then register the market on the hook. Caller pre-approves `parcelReserve` parcel +
    ///         enough R00T; the R00T needed = parcelReserve * clearedPrice (parcel priced in R00T).
    /// @param key         the CCA-created public v4 pool (currency0/currency1 sorted, hooks = our hook).
    /// @param root        $R00T (the pool's quote currency).
    /// @param parcelReserve parcel tokens saved for the private pool (NOT auctioned / NOT public LP).
    /// @param treasury    the parcel's regen treasury.
    function wire(PoolKey calldata key, IERC20 root, uint256 parcelReserve, address treasury, bytes32 marketId)
        external returns (address privatePool, uint256 r00tSeed)
    {
        require(parcelReserve > 0, "no reserve");
        // parcel = the non-R00T currency of the pair
        address a0 = Currency.unwrap(key.currency0);
        address a1 = Currency.unwrap(key.currency1);
        address parcelAddr = a0 == address(root) ? a1 : a0;
        IERC20 parcel = IERC20(parcelAddr);

        // R00T to pair with the reserved parcel at the cleared price
        uint256 P = clearedPriceE18(key); // currency1 per currency0
        // price of parcel in R00T (R00T per parcel):
        //   if R00T is currency0 → P = parcel/R00T → R00T per parcel = 1/P
        //   if R00T is currency1 → P = R00T/parcel → R00T per parcel = P
        uint256 rootPerParcelE18 = a0 == address(root) ? (WAD * WAD) / P : P;
        r00tSeed = (parcelReserve * rootPerParcelE18) / WAD;
        require(r00tSeed > 0, "bad price");

        parcel.safeTransferFrom(msg.sender, address(this), parcelReserve);
        root.safeTransferFrom(msg.sender, address(this), r00tSeed);

        // deploy + seed the private pool in the SAME currency ordering as the public pool
        (Currency c0, Currency c1) = (key.currency0, key.currency1);
        RegenPrivatePool priv = new RegenPrivatePool(IERC20(Currency.unwrap(c0)), IERC20(Currency.unwrap(c1)));
        (uint256 s0, uint256 s1) = a0 == address(root) ? (r00tSeed, parcelReserve) : (parcelReserve, r00tSeed);
        IERC20(Currency.unwrap(c0)).forceApprove(address(priv), s0);
        IERC20(Currency.unwrap(c1)).forceApprove(address(priv), s1);
        priv.seed(s0, s1);
        priv.setRebalancer(address(hook));

        // wire the arb: treasury accrues R00T
        hook.register(key, IPrivatePool(address(priv)), treasury, Currency.wrap(address(root)), marketId);

        privatePool = address(priv);
        emit MarketWired(marketId, privatePool, P, parcelReserve, r00tSeed);
    }
}
