// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./ParcelCoin.sol";

/// @title ParcelRegistry
/// @author r00t.fund
/// @notice A metaverse of real land. Each parcel grows something with its own MEME token
///         ($RICE, $ROCK, whatever…) — a community meme coin tied to a real plot, NOT a
///         financial instrument, commodity, or security. Each name has ONE global token: the
///         first grower bonds $R00T and receives the entire fixed genesis supply — they own
///         that meme's coin. Any later land that wants the same meme CANNOT mint it; they must
///         ACQUIRE it from an existing holder, who sets the $R00T price they'll sell to the
///         next land. More real land adopts a meme → more demand → early growers rewarded.
///
/// Uniqueness is by symbol (uppercased-insensitive via keccak of the raw symbol string):
/// there can only ever be one $CARROT.
contract ParcelRegistry is ReentrancyGuard {
    using SafeERC20 for IERC20;

    IERC20 public immutable root;        // $R00T — the base currency + genesis bond
    address public immutable treasury;   // receives creation bonds (protocol revenue)
    uint256 public immutable minBond;    // minimum $R00T bond to launch a parcel

    // ── registry: symbolHash → parcel token ──
    mapping(bytes32 => address) public parcelBySymbol;
    mapping(address => bool) public isParcel; // only registry-created tokens can be OTC-listed
    address[] public parcels;

    // ── inter-land OTC: seller escrows parcel + names their R00T price ──
    struct Offer {
        address seller;
        address parcel;
        uint256 amount;          // parcel units still for sale (escrowed here)
        uint256 priceRootPerUnitE18; // $R00T (18dp) per 1 parcel unit (18dp)
    }
    Offer[] public offers;

    event ParcelCreated(address indexed parcel, address indexed grower, string name, string symbol, uint256 genesisSupply, uint256 bond);
    event Listed(uint256 indexed offerId, address indexed seller, address indexed parcel, uint256 amount, uint256 priceRootPerUnitE18);
    event Repriced(uint256 indexed offerId, uint256 priceRootPerUnitE18);
    event Bought(uint256 indexed offerId, address indexed buyer, uint256 amount, uint256 rootPaid);
    event Cancelled(uint256 indexed offerId, uint256 amountReturned);

    error SymbolTaken();
    error BelowMinBond();
    error ZeroAmount();
    error ZeroAddress();
    error EmptySymbol();
    error NotSeller();
    error InsufficientOffer();
    error BadOffer();
    error NotAParcel();
    error ExceedsMaxCost(); // AUDIT FIX (M-02): buyer slippage / reprice front-run guard

    constructor(address _root, address _treasury, uint256 _minBond) {
        if (_root == address(0) || _treasury == address(0)) revert ZeroAddress();
        root = IERC20(_root);
        treasury = _treasury;
        minBond = _minBond;
    }

    function _symbolKey(string calldata symbol) internal pure returns (bytes32) {
        return keccak256(bytes(symbol));
    }

    // ── first grower tokenizes a parcel ──

    /// @notice Launch a new parcel coin. Unique by symbol. The caller bonds `bond` $R00T
    ///         (≥ minBond, → treasury) and receives the entire `genesisSupply` — they are the
    ///         crop's genesis grower. Requires prior approve() of `bond` $R00T.
    function createParcel(
        string calldata name,
        string calldata symbol,
        uint256 genesisSupply,
        uint256 bond
    ) external nonReentrant returns (address parcel) {
        if (bytes(symbol).length == 0) revert EmptySymbol();
        if (genesisSupply == 0) revert ZeroAmount();
        if (bond < minBond) revert BelowMinBond();
        bytes32 key = _symbolKey(symbol);
        if (parcelBySymbol[key] != address(0)) revert SymbolTaken();

        // bond first (CEI): pull R00T → treasury
        root.safeTransferFrom(msg.sender, treasury, bond);

        ParcelCoin token = new ParcelCoin(name, symbol, genesisSupply, msg.sender);
        parcel = address(token);
        parcelBySymbol[key] = parcel;
        isParcel[parcel] = true;
        parcels.push(parcel);

        emit ParcelCreated(parcel, msg.sender, name, symbol, genesisSupply, bond);
    }

    // ── inter-land OTC: land owners sell their parcel to the next land ──

    /// @notice List parcel for sale at your chosen $R00T price. Escrows `amount` here.
    ///         Requires prior approve() of `amount` parcel to this registry.
    function listForSale(address parcel, uint256 amount, uint256 priceRootPerUnitE18)
        external nonReentrant returns (uint256 offerId)
    {
        if (!isParcel[parcel]) revert NotAParcel();
        if (amount == 0 || priceRootPerUnitE18 == 0) revert ZeroAmount();
        IERC20(parcel).safeTransferFrom(msg.sender, address(this), amount);
        offerId = offers.length;
        offers.push(Offer({ seller: msg.sender, parcel: parcel, amount: amount, priceRootPerUnitE18: priceRootPerUnitE18 }));
        emit Listed(offerId, msg.sender, parcel, amount, priceRootPerUnitE18);
    }

    /// @notice Reprice your own live offer.
    function reprice(uint256 offerId, uint256 priceRootPerUnitE18) external {
        Offer storage o = offers[offerId];
        if (o.seller != msg.sender) revert NotSeller();
        if (priceRootPerUnitE18 == 0) revert ZeroAmount();
        o.priceRootPerUnitE18 = priceRootPerUnitE18;
        emit Repriced(offerId, priceRootPerUnitE18);
    }

    /// @notice Cancel your offer and reclaim the unsold parcel.
    function cancel(uint256 offerId) external nonReentrant {
        Offer storage o = offers[offerId];
        if (o.seller != msg.sender) revert NotSeller();
        uint256 remaining = o.amount;
        o.amount = 0;
        if (remaining > 0) IERC20(o.parcel).safeTransfer(msg.sender, remaining);
        emit Cancelled(offerId, remaining);
    }

    /// @notice Buy `amount` of a listed parcel from a specific offer. Pays the seller's
    ///         R00T price; the parcel is released from escrow to the buyer.
    ///         Requires prior approve() of the R00T cost to this registry.
    /// @param maxRootCost AUDIT FIX (M-02): maximum R00T the buyer will pay. Without this a
    ///        seller could front-run the buy with reprice() and, against a non-exact (e.g.
    ///        unlimited) allowance, drain far more R00T than quoted. Pass the quoted cost.
    function buy(uint256 offerId, uint256 amount, uint256 maxRootCost) external nonReentrant {
        Offer storage o = offers[offerId];
        if (o.seller == address(0) || o.parcel == address(0)) revert BadOffer();
        if (amount == 0) revert ZeroAmount();
        if (amount > o.amount) revert InsufficientOffer();

        // R00T cost = amount * price / 1e18, rounded up (favor the seller).
        uint256 cost = (amount * o.priceRootPerUnitE18 + 1e18 - 1) / 1e18;
        if (cost > maxRootCost) revert ExceedsMaxCost();

        // Effects
        o.amount -= amount;
        address seller = o.seller;
        address parcel = o.parcel;

        // Interactions: buyer pays R00T → seller; parcel → buyer
        root.safeTransferFrom(msg.sender, seller, cost);
        IERC20(parcel).safeTransfer(msg.sender, amount);

        emit Bought(offerId, msg.sender, amount, cost);
    }

    // ── views ──
    function parcelCount() external view returns (uint256) { return parcels.length; }
    function offerCount() external view returns (uint256) { return offers.length; }
    function getParcel(string calldata symbol) external view returns (address) {
        return parcelBySymbol[_symbolKey(symbol)];
    }
}
