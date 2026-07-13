// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "./ParcelToken.sol";
import "./vendor/LiquidityAmounts.sol";

import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "v4-core/interfaces/callback/IUnlockCallback.sol";
import {PoolKey} from "v4-core/types/PoolKey.sol";
import {Currency} from "v4-core/types/Currency.sol";
import {IHooks} from "v4-core/interfaces/IHooks.sol";
import {BalanceDelta, BalanceDeltaLibrary} from "v4-core/types/BalanceDelta.sol";
import {StateLibrary} from "v4-core/libraries/StateLibrary.sol";
import {TickMath} from "v4-core/libraries/TickMath.sol";
import {FullMath} from "v4-core/libraries/FullMath.sol";

/// @notice Minimal Chainlink AggregatorV3 read surface (ETH/USD + L2 sequencer uptime).
interface IAggregatorV3 {
    function decimals() external view returns (uint8);
    function latestRoundData() external view returns (
        uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound
    );
}

/// @title Land
/// @notice One steward's land. It is, economically, an OTC sale of the steward's
///         $R00T to the crowd: the steward locks $R00T at creation as the seed
///         liquidity for real Uniswap v4 parcel/$R00T pools; backers pledge
///         ETH/USDC (100% to the treasury — the ground) and mint the parcel's
///         culture token AT THE LIVE POOL PRICE (no fixed rate = no free arb).
///         Their exit is against the steward's $R00T float, so the crowd's demand
///         sets the effective price the steward realizes: premium or discount.
///
/// Geo files (KMZ boundary + topography) are validated OFF-CHAIN; their hashes +
/// an IPFS CID are committed, and a `validator` flips `validated`. Trading fees on
/// each parcel pool are split 70/30 steward/protocol.
contract Land is ReentrancyGuard, Pausable, IUnlockCallback {
    using SafeERC20 for IERC20;
    using StateLibrary for IPoolManager;
    using BalanceDeltaLibrary for BalanceDelta;

    uint256 private constant Q96 = 0x1000000000000000000000000; // 2**96
    uint16 public constant STEWARD_FEE_BPS = 7000;              // 70% of pool fees to steward

    // ── immutable wiring ──
    address public immutable factory;
    IPoolManager public immutable poolManager;
    IERC20 public immutable root;   // $R00T (base pair for every parcel)
    IERC20 public immutable usdc;
    uint24 public immutable poolFee;
    int24 public immutable tickSpacing;

    // ── mutable config ──
    address public steward;
    address public validator;
    address public treasury;          // receives pledges (regeneration capital)
    address public landVault;       // LandVault: private fund + dual-claim rail (mints parcel tokens on claim)
    address public protocolTreasury;  // receives the protocol's 30% of pool fees
    uint256 public ethPriceE6Manual;  // USD/ETH, 6dp — fallback used only when no oracle is set
    uint256 public rootPriceE6;       // USD/$R00T, 6dp (steward-set OTC price; R00T has no oracle)

    // ── ETH/USD oracle (Chainlink Data Feed on Robinhood Chain). When set, ethPriceE6() reads
    //    it LIVE per tx — no keeper. Unset (address 0) → falls back to ethPriceE6Manual (testnet).
    IAggregatorV3 public ethUsdFeed;          // Chainlink ETH/USD proxy
    IAggregatorV3 public sequencerUptimeFeed; // L2 sequencer uptime feed (0 = skip the check)
    uint256 public ethFeedHeartbeat = 3600;   // max staleness of the ETH/USD answer, seconds
    uint256 public constant SEQ_GRACE = 3600; // wait after a sequencer restart before trusting prices
    uint256 public mintRateE18 = 1e18; // parcel tokens minted per 1 R00T-equivalent (18dp). Steward-set OTC rate.
    uint256 public bonusBps = 15000;  // early-bird multiplier — applies to reward POINTS only, never token mint
    uint256 public round;

    // ── metadata + validation (firewall: region fuzzy; only hashes/CID on-chain) ──
    string public name;
    string public region;
    bytes32 public boundaryHash;
    bytes32 public topoHash;
    string public cid;
    bool public validated;

    // ── $R00T seed reserve (pledged at creation) ──
    uint256 public r00tLiquidityReserve;
    bool private _liqInit;

    struct Parcel {
        ParcelToken token;
        PoolKey key;
        bool poolInit;
        bool rootIsCurrency0;
    }
    mapping(bytes32 => Parcel) internal _parcels;
    mapping(bytes32 => uint256) public raisedByParcelUsd6;
    mapping(address => uint256) public allocationPoints;
    uint256 public totalRaisedUsd6;

    enum Action { SEED, COLLECT }

    struct InitParams {
        address steward;
        address root;
        address usdc;
        address treasury;
        address validator;
        address poolManager;
        address protocolTreasury;
        uint24 poolFee;
        int24 tickSpacing;
        uint256 ethPriceE6;
        uint256 rootPriceE6;
        string name;
        string region;
        bytes32 boundaryHash;
        bytes32 topoHash;
        string cid;
    }

    event Validated();
    event LiquidityInitialized(uint256 r00tReserve);
    event ParcelCreated(bytes32 indexed parcelId, address token, string name, string symbol);
    event PoolSeeded(bytes32 indexed parcelId, uint160 sqrtPriceX96, uint256 r00tUsed, uint256 parcelMinted, uint128 liquidity);
    event Pledged(address indexed backer, bytes32 indexed parcelId, address token, uint256 amount, uint256 usd6, uint256 parcelOut, uint256 points, uint256 round);
    event FeesCollected(bytes32 indexed parcelId, uint256 amount0, uint256 amount1);
    event RoundAdvanced(uint256 indexed round, uint256 bonusBps);

    error NotSteward();
    error NotValidator();
    error NotFactory();
    error NotValidated();
    error NotPoolManager();
    error ZeroAmount();
    error Expired();
    error Slippage();
    error EthTransferFailed();
    error Exists();
    error NotSeeded();
    error InsufficientReserve();
    error NoParcel();
    error NotVault();
    error SequencerDown();
    error SequencerGracePeriod();
    error StaleOraclePrice();
    error BadOraclePrice();

    event LandVaultSet(address indexed vault);
    event EthFeedSet(address indexed feed, address indexed sequencer, uint256 heartbeat);

    modifier onlySteward() { if (msg.sender != steward) revert NotSteward(); _; }
    modifier onlyValidated() { if (!validated) revert NotValidated(); _; }

    constructor(InitParams memory p) {
        factory = msg.sender;
        steward = p.steward;
        root = IERC20(p.root);
        usdc = IERC20(p.usdc);
        treasury = p.treasury;
        validator = p.validator;
        poolManager = IPoolManager(p.poolManager);
        protocolTreasury = p.protocolTreasury;
        poolFee = p.poolFee;
        tickSpacing = p.tickSpacing;
        ethPriceE6Manual = p.ethPriceE6;
        rootPriceE6 = p.rootPriceE6;
        name = p.name; region = p.region;
        boundaryHash = p.boundaryHash; topoHash = p.topoHash; cid = p.cid;
    }

    // ── factory / validator lifecycle ──
    function initLiquidity(uint256 amount) external {
        if (msg.sender != factory) revert NotFactory();
        require(!_liqInit, "init");
        _liqInit = true;
        r00tLiquidityReserve = amount;
        emit LiquidityInitialized(amount);
    }

    function validate() external {
        if (msg.sender != validator) revert NotValidator();
        validated = true;
        emit Validated();
    }

    function createParcel(bytes32 parcelId, string calldata n, string calldata sym)
        external onlySteward onlyValidated returns (address)
    {
        if (address(_parcels[parcelId].token) != address(0)) revert Exists();
        ParcelToken pt = new ParcelToken(n, sym, address(this));
        _parcels[parcelId].token = pt;
        emit ParcelCreated(parcelId, address(pt), n, sym);
        return address(pt);
    }

    // ── LandVault: private fund + dual-claim rail ──
    /// @notice Wire the anonymous-pledge vault. One-time (immutable-after-set) so the vault's
    ///         mint authority can never be silently repointed. Set by the steward after the
    ///         vault is deployed against this Land.
    function setLandVault(address v) external onlySteward {
        require(landVault == address(0), "set");
        require(v != address(0), "0");
        landVault = v;
        emit LandVaultSet(v);
    }

    /// @notice Mint parcel tokens on an anonymous claim. Only the wired vault may call this;
    ///         the vault mints EXACTLY the cryptographically-committed amount to `to`.
    function mintParcel(bytes32 parcelId, address to, uint256 amount) external {
        if (msg.sender != landVault) revert NotVault();
        Parcel storage p = _parcels[parcelId];
        if (address(p.token) == address(0)) revert NoParcel();
        p.token.mint(to, amount);
    }

    // ── seed the real Uniswap v4 parcel/$R00T pool from the reserve + minted tokens ──
    /// @param sqrtPriceX96 opening price of the pool (steward sets the initial valuation)
    /// @param rootAmount   $R00T from the reserve to commit to the pool
    /// @param parcelAmount parcel tokens to mint into the pool
    function seedParcelLiquidity(bytes32 parcelId, uint160 sqrtPriceX96, uint256 rootAmount, uint256 parcelAmount)
        external onlySteward onlyValidated nonReentrant
    {
        Parcel storage p = _parcels[parcelId];
        if (address(p.token) == address(0)) revert NoParcel();
        if (p.poolInit) revert Exists();
        if (rootAmount > r00tLiquidityReserve) revert InsufficientReserve();

        bool rootIsC0 = address(root) < address(p.token);
        (Currency c0, Currency c1) = rootIsC0
            ? (Currency.wrap(address(root)), Currency.wrap(address(p.token)))
            : (Currency.wrap(address(p.token)), Currency.wrap(address(root)));
        PoolKey memory key = PoolKey(c0, c1, poolFee, tickSpacing, IHooks(address(0)));

        poolManager.initialize(key, sqrtPriceX96);

        int24 tl = TickMath.minUsableTick(tickSpacing);
        int24 tu = TickMath.maxUsableTick(tickSpacing);
        (uint256 amt0, uint256 amt1) = rootIsC0 ? (rootAmount, parcelAmount) : (parcelAmount, rootAmount);
        uint128 liquidity = LiquidityAmounts.getLiquidityForAmounts(
            sqrtPriceX96, TickMath.getSqrtPriceAtTick(tl), TickMath.getSqrtPriceAtTick(tu), amt0, amt1
        );

        p.key = key;
        p.rootIsCurrency0 = rootIsC0;
        p.poolInit = true;

        // callback settles what the pool actually needs; reserve is debited there
        bytes memory res = poolManager.unlock(
            abi.encode(Action.SEED, abi.encode(key, tl, tu, liquidity, address(p.token), rootIsC0))
        );
        (uint256 rootUsed, uint256 parcelMinted) = abi.decode(res, (uint256, uint256));
        emit PoolSeeded(parcelId, sqrtPriceX96, rootUsed, parcelMinted, liquidity);
    }

    // ── pledging: 100% to treasury, mint parcel token at the steward's OTC rate ──
    /// @dev No live pool price is read — parcelOut is fixed by rootPriceE6 + mintRateE18
    ///      (steward OTC terms), so it cannot be manipulated by moving the pool. Patrons
    ///      realize the OTC $R00T deal later by SELLING the parcel token into its pool.
    ///      `minParcelOut`/`deadline` protect the patron against a steward rate change
    ///      landing between quote and execution.
    function pledgeETH(bytes32 parcelId, uint256 minParcelOut, uint256 deadline)
        external payable nonReentrant whenNotPaused onlyValidated
    {
        if (block.timestamp > deadline) revert Expired();
        if (msg.value == 0) revert ZeroAmount();
        uint256 usd6 = (msg.value * ethPriceE6()) / 1e18;
        _record(parcelId, address(0), msg.value, usd6, minParcelOut);
        (bool ok, ) = treasury.call{value: msg.value}("");
        if (!ok) revert EthTransferFailed();
    }

    function pledgeUSDC(bytes32 parcelId, uint256 amount, uint256 minParcelOut, uint256 deadline)
        external nonReentrant whenNotPaused onlyValidated
    {
        if (block.timestamp > deadline) revert Expired();
        if (amount == 0) revert ZeroAmount();
        usdc.safeTransferFrom(msg.sender, treasury, amount);
        _record(parcelId, address(usdc), amount, amount, minParcelOut);
    }

    function _record(bytes32 parcelId, address token, uint256 amount, uint256 usd6, uint256 minParcelOut) internal {
        Parcel storage p = _parcels[parcelId];
        if (!p.poolInit) revert NotSeeded();

        // value the pledge in $R00T at the steward OTC price, then in parcel tokens at
        // the steward OTC mint rate. Deterministic — not a function of live pool state.
        uint256 rootEq = FullMath.mulDiv(usd6, 1e18, rootPriceE6);
        uint256 parcelOut = FullMath.mulDiv(rootEq, mintRateE18, 1e18);
        if (parcelOut < minParcelOut) revert Slippage();

        uint256 points = (usd6 * bonusBps) / 10000; // reward ledger only (future $R00T airdrop)
        totalRaisedUsd6 += usd6;
        raisedByParcelUsd6[parcelId] += usd6;
        allocationPoints[msg.sender] += points;

        p.token.mint(msg.sender, parcelOut);
        emit Pledged(msg.sender, parcelId, token, amount, usd6, parcelOut, points, round);
    }

    // ── collect pool trading fees, split 70/30 steward/protocol ──
    function collectParcelFees(bytes32 parcelId) external nonReentrant {
        Parcel storage p = _parcels[parcelId];
        if (!p.poolInit) revert NotSeeded();
        int24 tl = TickMath.minUsableTick(tickSpacing);
        int24 tu = TickMath.maxUsableTick(tickSpacing);
        bytes memory res = poolManager.unlock(abi.encode(Action.COLLECT, abi.encode(p.key, tl, tu)));
        (uint256 amt0, uint256 amt1) = abi.decode(res, (uint256, uint256));
        _splitFee(p.key.currency0, amt0);
        _splitFee(p.key.currency1, amt1);
        emit FeesCollected(parcelId, amt0, amt1);
    }

    function _splitFee(Currency currency, uint256 amount) internal {
        if (amount == 0) return;
        uint256 toSteward = (amount * STEWARD_FEE_BPS) / 10000;
        currency.transfer(steward, toSteward);
        currency.transfer(protocolTreasury, amount - toSteward);
    }

    // ── Uniswap v4 unlock callback ──
    function unlockCallback(bytes calldata data) external override returns (bytes memory) {
        if (msg.sender != address(poolManager)) revert NotPoolManager();
        (Action action, bytes memory payload) = abi.decode(data, (Action, bytes));
        if (action == Action.SEED) return _seedCallback(payload);
        return _collectCallback(payload);
    }

    function _seedCallback(bytes memory payload) internal returns (bytes memory) {
        (PoolKey memory key, int24 tl, int24 tu, uint128 liquidity, address parcelAddr, bool rootIsC0) =
            abi.decode(payload, (PoolKey, int24, int24, uint128, address, bool));

        (BalanceDelta delta, ) = poolManager.modifyLiquidity(
            key,
            IPoolManager.ModifyLiquidityParams({
                tickLower: tl, tickUpper: tu, liquidityDelta: int256(uint256(liquidity)), salt: bytes32(0)
            }),
            ""
        );

        uint256 owed0 = _pay(key.currency0, delta.amount0(), parcelAddr);
        uint256 owed1 = _pay(key.currency1, delta.amount1(), parcelAddr);
        (uint256 rootUsed, uint256 parcelMinted) = rootIsC0 ? (owed0, owed1) : (owed1, owed0);
        r00tLiquidityReserve -= rootUsed;
        return abi.encode(rootUsed, parcelMinted);
    }

    /// @dev settle one side of the liquidity add. Parcel side is minted; $R00T side
    ///      is transferred from the reserve. Returns the amount paid.
    function _pay(Currency currency, int128 amt, address parcelAddr) internal returns (uint256 owed) {
        if (amt >= 0) return 0; // pool owes us nothing extra to add liquidity
        owed = uint256(uint128(-amt));
        poolManager.sync(currency);
        if (Currency.unwrap(currency) == parcelAddr) {
            ParcelToken(parcelAddr).mint(address(poolManager), owed);
        } else {
            currency.transfer(address(poolManager), owed);
        }
        poolManager.settle();
    }

    function _collectCallback(bytes memory payload) internal returns (bytes memory) {
        (PoolKey memory key, int24 tl, int24 tu) = abi.decode(payload, (PoolKey, int24, int24));
        (BalanceDelta delta, ) = poolManager.modifyLiquidity(
            key,
            IPoolManager.ModifyLiquidityParams({ tickLower: tl, tickUpper: tu, liquidityDelta: 0, salt: bytes32(0) }),
            ""
        );
        uint256 amt0 = _takeIfOwed(key.currency0, delta.amount0());
        uint256 amt1 = _takeIfOwed(key.currency1, delta.amount1());
        return abi.encode(amt0, amt1);
    }

    function _takeIfOwed(Currency currency, int128 amt) internal returns (uint256 owed) {
        if (amt <= 0) return 0;
        owed = uint256(uint128(amt));
        poolManager.take(currency, address(this), owed);
    }

    // ── views ──
    function parcelToken(bytes32 parcelId) external view returns (address) { return address(_parcels[parcelId].token); }
    function parcelPoolInitialized(bytes32 parcelId) external view returns (bool) { return _parcels[parcelId].poolInit; }
    function parcelPoolKey(bytes32 parcelId) external view returns (PoolKey memory) { return _parcels[parcelId].key; }

    // ── steward admin ──
    function advanceRound(uint256 newBonusBps) external onlySteward {
        require(newBonusBps <= bonusBps && newBonusBps >= 10000, "range");
        bonusBps = newBonusBps; unchecked { round++; }
        emit RoundAdvanced(round, newBonusBps);
    }
    function setTreasury(address t) external onlySteward { require(t != address(0), "0"); treasury = t; }
    /// @notice Sets the MANUAL ETH price — only used when no oracle feed is configured (testnet).
    function setEthPrice(uint256 pE6) external onlySteward { ethPriceE6Manual = pE6; }
    function setRootPrice(uint256 pE6) external onlySteward { require(pE6 > 0, "0"); rootPriceE6 = pE6; }

    /// @notice Wire the Chainlink ETH/USD feed (+ optional L2 sequencer uptime feed). Once set,
    ///         ethPriceE6() reads the live market every tx — the price keeper becomes unnecessary.
    function setEthFeed(address feed, address sequencer, uint256 heartbeat) external onlySteward {
        require(heartbeat > 0, "hb");
        ethUsdFeed = IAggregatorV3(feed);
        sequencerUptimeFeed = IAggregatorV3(sequencer);
        ethFeedHeartbeat = heartbeat;
        emit EthFeedSet(feed, sequencer, heartbeat);
    }

    /// @notice Live USD/ETH price, 6dp. Reads Chainlink when a feed is set (with L2 sequencer +
    ///         staleness guards so a down/stale oracle fails safe rather than mispricing); else
    ///         returns the steward's manual fallback. Consumed by pledgeETH + LandVault.otcFundETH.
    function ethPriceE6() public view returns (uint256) {
        IAggregatorV3 feed = ethUsdFeed;
        if (address(feed) == address(0)) return ethPriceE6Manual; // no oracle → manual fallback

        IAggregatorV3 seq = sequencerUptimeFeed;
        if (address(seq) != address(0)) {
            (, int256 up, uint256 seqStarted, , ) = seq.latestRoundData();
            if (up != 0) revert SequencerDown();                       // 0 = up, 1 = down
            if (block.timestamp - seqStarted <= SEQ_GRACE) revert SequencerGracePeriod();
        }
        (, int256 answer, , uint256 updatedAt, ) = feed.latestRoundData();
        if (answer <= 0) revert BadOraclePrice();
        if (block.timestamp - updatedAt > ethFeedHeartbeat) revert StaleOraclePrice();

        uint256 a = uint256(answer);
        uint8 dec = feed.decimals();                                    // scale feed dp → 6dp
        if (dec > 6) return a / (10 ** (dec - 6));
        if (dec < 6) return a * (10 ** (6 - dec));
        return a;
    }
    /// @notice OTC mint rate: parcel tokens minted per 1 R00T-equivalent of pledge (18dp).
    function setMintRate(uint256 rateE18) external onlySteward { require(rateE18 > 0, "0"); mintRateE18 = rateE18; }
    function pause() external onlySteward { _pause(); }
    function unpause() external onlySteward { _unpause(); }
}
