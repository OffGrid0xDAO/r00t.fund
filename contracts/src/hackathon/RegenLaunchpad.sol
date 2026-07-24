// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "v4-core/interfaces/callback/IUnlockCallback.sol";
import {PoolKey} from "v4-core/types/PoolKey.sol";
import {Currency} from "v4-core/types/Currency.sol";
import {IHooks} from "v4-core/interfaces/IHooks.sol";
import {BalanceDelta} from "v4-core/types/BalanceDelta.sol";
import {TickMath} from "v4-core/libraries/TickMath.sol";
import {IERC20Minimal} from "v4-core/interfaces/external/IERC20Minimal.sol";
import {LiquidityAmounts} from "v4-core-test/utils/LiquidityAmounts.sol";

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import {IPrivatePool} from "./interfaces/IPrivatePool.sol";
import {RegenPrivatePool} from "./RegenPrivatePool.sol";

interface IRegenArbHook {
    function register(
        PoolKey calldata key, IPrivatePool privatePool, address regenTreasury, Currency treasuryCurrency, bytes32 marketId
    ) external;
}

/// @title RegenLaunchpad  (ETHGlobal Lisbon 2026 — HACKATHON WORKSPACE)
/// @notice Steward-facing orchestrator for launching a parcel token against $R00T. A steward escrows
///         the parcel supply and opens a Continuous Clearing Auction (CCA); backers bid R00T. Then
///         `clearAndLaunch` does EVERYTHING in one tx:
///           1. clear the CCA at a uniform price P (never below the reserve = R00T OTC floor),
///           2. route the R00T raise to the parcel's regeneration treasury,
///           3. deploy + seed the PRIVATE pool (RegenPrivatePool) at P,
///           4. open + seed the PUBLIC Uniswap v4 pool (hooked) at the same P,
///           5. register the market with the shared RegenArbHook so every future public swap
///              back-runs a cross-pool arb whose spread funds the land.
///         Backers then `claim` their parcel tokens at the uniform price.
/// @dev The private pool here is RegenPrivatePool (constant-product, same surface as the shielded
///      ZkAMMPair). Real v4: liquidity is added through the PoolManager unlock/settle flow below.
contract RegenLaunchpad is IUnlockCallback {
    using SafeERC20 for IERC20;

    IPoolManager public immutable poolManager;
    IRegenArbHook public immutable hook;      // the ONE shared hook
    IERC20 public immutable root;             // $R00T — the numeraire every parcel trades against
    address public immutable protocolReserve; // supplies the R00T side of the seeded pool liquidity

    uint24 public constant FEE = 3000;
    int24 public constant TICK_SPACING = 60;
    int24 internal constant MIN_TICK = -887220; // full range for tickSpacing 60
    int24 internal constant MAX_TICK = 887220;
    uint256 internal constant WAD = 1e18;

    enum Phase { None, Auction, Live }

    struct Parcel {
        IERC20 token;             // parcel ERC20
        address steward;
        address regenTreasury;    // the plot's regen fund (raise lands here)
        RegenPrivatePool privatePool;
        PoolKey uniKey;           // public Uni v4 pool (hooked)
        Phase phase;
        uint64 auctionEnd;
        uint256 saleTokens;       // parcel tokens auctioned to backers
        uint256 poolTokens;       // parcel tokens seeded across both pools
        uint256 reservePriceR00T; // min R00T per parcel token (WAD) = OTC floor
        uint256 raisedR00T;
        uint256 clearedPriceR00T; // WAD
    }

    mapping(bytes32 => Parcel) public parcels;
    mapping(bytes32 => mapping(address => uint256)) public bidsR00T; // parcelId → bidder → escrowed R00T
    mapping(bytes32 => mapping(address => bool)) public claimed;

    event ParcelCreated(bytes32 indexed parcelId, address indexed steward, address token, uint256 saleTokens, uint256 poolTokens);
    event AuctionStarted(bytes32 indexed parcelId, uint64 end, uint256 reservePriceR00T);
    event BidPlaced(bytes32 indexed parcelId, address indexed bidder, uint256 r00tAmount);
    event Launched(bytes32 indexed parcelId, uint256 clearedPriceR00T, uint256 raisedR00T, address privatePool);
    event Claimed(bytes32 indexed parcelId, address indexed bidder, uint256 parcelTokens);

    error NotAuction();
    error AuctionNotEnded();
    error AuctionStillOpen();
    error AlreadyExists();
    error NotLive();
    error NothingToClaim();
    error NotPoolManager();

    constructor(IPoolManager _pm, IRegenArbHook _hook, IERC20 _root, address _protocolReserve) {
        poolManager = _pm;
        hook = _hook;
        root = _root;
        protocolReserve = _protocolReserve;
    }

    // ─────────────────────────────────────────────────────────────────────────────────────────────
    // steward lifecycle (the frontend Steward Console calls these)
    // ─────────────────────────────────────────────────────────────────────────────────────────────

    /// @notice Create a parcel + open its CCA. Steward escrows (saleTokens + poolTokens) parcel tokens.
    function createParcel(
        bytes32 parcelId,
        IERC20 parcelToken,
        address regenTreasury,
        uint256 saleTokens,
        uint256 poolTokens,
        uint256 reservePriceR00T,
        uint64 window
    ) external {
        Parcel storage p = parcels[parcelId];
        if (p.phase != Phase.None) revert AlreadyExists();
        require(saleTokens > 0 && poolTokens > 0 && reservePriceR00T > 0 && window > 0, "bad params");

        parcelToken.safeTransferFrom(msg.sender, address(this), saleTokens + poolTokens);

        p.token = parcelToken;
        p.steward = msg.sender;
        p.regenTreasury = regenTreasury;
        p.saleTokens = saleTokens;
        p.poolTokens = poolTokens;
        p.reservePriceR00T = reservePriceR00T;
        p.auctionEnd = uint64(block.timestamp) + window;
        p.phase = Phase.Auction;

        emit ParcelCreated(parcelId, msg.sender, address(parcelToken), saleTokens, poolTokens);
        emit AuctionStarted(parcelId, p.auctionEnd, reservePriceR00T);
    }

    /// @notice Place a CCA bid — escrow `r00tAmount` of R00T. Uniform-price: allocation is settled at
    ///         the single clearing price, so more R00T simply buys pro-rata more parcel tokens.
    function bid(bytes32 parcelId, uint256 r00tAmount) external {
        Parcel storage p = parcels[parcelId];
        if (p.phase != Phase.Auction) revert NotAuction();
        if (block.timestamp >= p.auctionEnd) revert AuctionNotEnded(); // window closed
        require(r00tAmount > 0, "zero bid");

        root.safeTransferFrom(msg.sender, address(this), r00tAmount);
        bidsR00T[parcelId][msg.sender] += r00tAmount;
        p.raisedR00T += r00tAmount;
        emit BidPlaced(parcelId, msg.sender, r00tAmount);
    }

    /// @notice THE automatic step. Clears the CCA and launches BOTH pools + the hook in one tx.
    function clearAndLaunch(bytes32 parcelId) external {
        Parcel storage p = parcels[parcelId];
        if (p.phase != Phase.Auction) revert NotAuction();
        if (block.timestamp < p.auctionEnd) revert AuctionStillOpen();

        // 1) uniform clearing price P = max(reserve, raised/saleTokens) — never below the OTC floor.
        uint256 P = (p.raisedR00T * WAD) / p.saleTokens;
        if (P < p.reservePriceR00T) P = p.reservePriceR00T;
        p.clearedPriceR00T = P;

        // 2) the R00T raise funds the land's regen treasury.
        if (p.raisedR00T > 0) root.safeTransfer(p.regenTreasury, p.raisedR00T);

        // carve a small working inventory for the shared hook (it fronts the private leg of each arb
        // and is made whole + profit by the public leg), then split the rest across the two pools.
        // R00T side pulled from the protocol reserve at price P.
        uint256 hookParcel = p.poolTokens / 10;
        uint256 seedParcel = p.poolTokens - hookParcel;
        uint256 privParcel = seedParcel / 2;
        uint256 pubParcel = seedParcel - privParcel;
        uint256 privR00T = (privParcel * P) / WAD;
        uint256 pubR00T = (pubParcel * P) / WAD;
        uint256 hookR00T = (hookParcel * P) / WAD;
        root.safeTransferFrom(protocolReserve, address(this), privR00T + pubR00T + hookR00T);

        // 3) deploy + seed the PRIVATE pool at P (currency-sorted).
        (Currency c0, Currency c1) = _sorted(address(p.token), address(root));
        RegenPrivatePool priv = new RegenPrivatePool(IERC20(Currency.unwrap(c0)), IERC20(Currency.unwrap(c1)));
        (uint256 s0, uint256 s1) = _amountsByOrder(address(p.token), privParcel, privR00T);
        IERC20(Currency.unwrap(c0)).forceApprove(address(priv), s0);
        IERC20(Currency.unwrap(c1)).forceApprove(address(priv), s1);
        priv.seed(s0, s1);
        priv.setRebalancer(address(hook));
        p.privatePool = priv;

        // 4) open + seed the PUBLIC Uniswap v4 pool at the same P.
        PoolKey memory key = PoolKey({currency0: c0, currency1: c1, fee: FEE, tickSpacing: TICK_SPACING, hooks: IHooks(address(hook))});
        p.uniKey = key;
        uint160 sqrtP = _sqrtPriceX96(address(p.token), P);
        poolManager.initialize(key, sqrtP);
        (uint256 a0, uint256 a1) = _amountsByOrder(address(p.token), pubParcel, pubR00T);
        poolManager.unlock(abi.encode(key, a0, a1, sqrtP));

        // seed the shared hook's working inventory (both sides, so it can front either arb direction).
        p.token.safeTransfer(address(hook), hookParcel);
        root.safeTransfer(address(hook), hookR00T);

        // 5) wire the shared hook: the parcel's treasury accrues R00T (its numeraire).
        hook.register(key, IPrivatePool(address(priv)), p.regenTreasury, Currency.wrap(address(root)), parcelId);

        p.phase = Phase.Live;
        emit Launched(parcelId, P, p.raisedR00T, address(priv));
    }

    /// @notice Backers claim their parcel tokens at the uniform clearing price after launch.
    function claim(bytes32 parcelId) external returns (uint256 out) {
        Parcel storage p = parcels[parcelId];
        if (p.phase != Phase.Live) revert NotLive();
        uint256 spent = bidsR00T[parcelId][msg.sender];
        if (spent == 0 || claimed[parcelId][msg.sender]) revert NothingToClaim();
        claimed[parcelId][msg.sender] = true;
        out = (spent * WAD) / p.clearedPriceR00T; // uniform-price allocation
        p.token.safeTransfer(msg.sender, out);
        emit Claimed(parcelId, msg.sender, out);
    }

    // ── views ──
    function clearedPriceOf(bytes32 id) external view returns (uint256) { return parcels[id].clearedPriceR00T; }
    function privatePoolOf(bytes32 id) external view returns (address) { return address(parcels[id].privatePool); }
    function parcelTokenOf(bytes32 id) external view returns (address) { return address(parcels[id].token); }
    function phaseOf(bytes32 id) external view returns (uint8) { return uint8(parcels[id].phase); }
    function raisedOf(bytes32 id) external view returns (uint256) { return parcels[id].raisedR00T; }

    // ─────────────────────────────────────────────────────────────────────────────────────────────
    // v4 liquidity seeding (unlock → modifyLiquidity → settle)
    // ─────────────────────────────────────────────────────────────────────────────────────────────

    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        if (msg.sender != address(poolManager)) revert NotPoolManager();
        (PoolKey memory key, uint256 amt0, uint256 amt1, uint160 sqrtP) =
            abi.decode(data, (PoolKey, uint256, uint256, uint160));

        uint128 liq = LiquidityAmounts.getLiquidityForAmounts(
            sqrtP, TickMath.getSqrtPriceAtTick(MIN_TICK), TickMath.getSqrtPriceAtTick(MAX_TICK), amt0, amt1
        );
        (BalanceDelta delta,) = poolManager.modifyLiquidity(
            key,
            IPoolManager.ModifyLiquidityParams({tickLower: MIN_TICK, tickUpper: MAX_TICK, liquidityDelta: int256(uint256(liq)), salt: 0}),
            ""
        );
        if (delta.amount0() < 0) _settle(key.currency0, uint256(uint256(int256(-delta.amount0()))));
        if (delta.amount1() < 0) _settle(key.currency1, uint256(uint256(int256(-delta.amount1()))));
        return "";
    }

    function _settle(Currency c, uint256 amount) internal {
        poolManager.sync(c);
        IERC20Minimal(Currency.unwrap(c)).transfer(address(poolManager), amount);
        poolManager.settle();
    }

    // ── helpers ──

    function _sorted(address a, address b) internal pure returns (Currency c0, Currency c1) {
        return a < b ? (Currency.wrap(a), Currency.wrap(b)) : (Currency.wrap(b), Currency.wrap(a));
    }

    /// map (parcelAmount, r00tAmount) onto (amount0, amount1) given the token/root address ordering.
    function _amountsByOrder(address parcel, uint256 parcelAmt, uint256 r00tAmt)
        internal view returns (uint256 amt0, uint256 amt1)
    {
        return parcel < address(root) ? (parcelAmt, r00tAmt) : (r00tAmt, parcelAmt);
    }

    /// sqrtPriceX96 for the pool where P = R00T per parcel token (WAD). price1/0 depends on ordering.
    function _sqrtPriceX96(address parcel, uint256 P) internal view returns (uint160) {
        // price1/0 (WAD): if parcel is currency0, it's R00T/parcel = P; else parcel/R00T = WAD^2/P.
        uint256 price1e18 = parcel < address(root) ? P : (WAD * WAD) / P;
        // sqrtPriceX96 = sqrt(price) * 2^96 = sqrt(price1e18/1e18) * 2^96 = sqrt(price1e18)*2^96/1e9
        uint256 s = _sqrt(price1e18) * (2 ** 96) / 1e9;
        return uint160(s);
    }

    function _sqrt(uint256 y) internal pure returns (uint256 z) {
        if (y > 3) { z = y; uint256 x = y / 2 + 1; while (x < z) { z = x; x = (y / x + x) / 2; } }
        else if (y != 0) { z = 1; }
    }
}
