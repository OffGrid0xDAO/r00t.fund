// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./CommodityToken.sol";

/// @title CommodityRegistry
/// @author r00t.fund
/// @notice The metaverse-based-on-reality commodity layer. Each real crop is ONE global
///         token ($RICE, $CARROT…). The first grower to tokenize a commodity bonds $R00T
///         and receives the entire fixed genesis supply — they own that crop's coin. Any
///         later land that wants to grow the same crop CANNOT mint it; they must ACQUIRE it
///         from an existing holder, and the holder sets the price they'll sell to the next
///         land (priced in $R00T). Real-world adoption of a crop → R00T flows to its early
///         growers → the commodity appreciates. Pump.fun mechanics, real agriculture.
///
/// Uniqueness is by symbol (uppercased-insensitive via keccak of the raw symbol string):
/// there can only ever be one $CARROT.
contract CommodityRegistry is ReentrancyGuard {
    using SafeERC20 for IERC20;

    IERC20 public immutable root;        // $R00T — the base currency + genesis bond
    address public immutable treasury;   // receives creation bonds (protocol revenue)
    uint256 public immutable minBond;    // minimum $R00T bond to launch a commodity

    // ── registry: symbolHash → commodity token ──
    mapping(bytes32 => address) public commodityBySymbol;
    mapping(address => bool) public isCommodity; // only registry-created tokens can be OTC-listed
    address[] public commodities;

    // ── inter-land OTC: seller escrows commodity + names their R00T price ──
    struct Offer {
        address seller;
        address commodity;
        uint256 amount;          // commodity units still for sale (escrowed here)
        uint256 priceRootPerUnitE18; // $R00T (18dp) per 1 commodity unit (18dp)
    }
    Offer[] public offers;

    event CommodityCreated(address indexed commodity, address indexed grower, string name, string symbol, uint256 genesisSupply, uint256 bond);
    event Listed(uint256 indexed offerId, address indexed seller, address indexed commodity, uint256 amount, uint256 priceRootPerUnitE18);
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
    error NotACommodity();

    constructor(address _root, address _treasury, uint256 _minBond) {
        if (_root == address(0) || _treasury == address(0)) revert ZeroAddress();
        root = IERC20(_root);
        treasury = _treasury;
        minBond = _minBond;
    }

    function _symbolKey(string calldata symbol) internal pure returns (bytes32) {
        return keccak256(bytes(symbol));
    }

    // ── first grower tokenizes a commodity ──

    /// @notice Launch a new commodity coin. Unique by symbol. The caller bonds `bond` $R00T
    ///         (≥ minBond, → treasury) and receives the entire `genesisSupply` — they are the
    ///         crop's genesis grower. Requires prior approve() of `bond` $R00T.
    function createCommodity(
        string calldata name,
        string calldata symbol,
        uint256 genesisSupply,
        uint256 bond
    ) external nonReentrant returns (address commodity) {
        if (bytes(symbol).length == 0) revert EmptySymbol();
        if (genesisSupply == 0) revert ZeroAmount();
        if (bond < minBond) revert BelowMinBond();
        bytes32 key = _symbolKey(symbol);
        if (commodityBySymbol[key] != address(0)) revert SymbolTaken();

        // bond first (CEI): pull R00T → treasury
        root.safeTransferFrom(msg.sender, treasury, bond);

        CommodityToken token = new CommodityToken(name, symbol, genesisSupply, msg.sender);
        commodity = address(token);
        commodityBySymbol[key] = commodity;
        isCommodity[commodity] = true;
        commodities.push(commodity);

        emit CommodityCreated(commodity, msg.sender, name, symbol, genesisSupply, bond);
    }

    // ── inter-land OTC: land owners sell their commodity to the next land ──

    /// @notice List commodity for sale at your chosen $R00T price. Escrows `amount` here.
    ///         Requires prior approve() of `amount` commodity to this registry.
    function listForSale(address commodity, uint256 amount, uint256 priceRootPerUnitE18)
        external nonReentrant returns (uint256 offerId)
    {
        if (!isCommodity[commodity]) revert NotACommodity();
        if (amount == 0 || priceRootPerUnitE18 == 0) revert ZeroAmount();
        IERC20(commodity).safeTransferFrom(msg.sender, address(this), amount);
        offerId = offers.length;
        offers.push(Offer({ seller: msg.sender, commodity: commodity, amount: amount, priceRootPerUnitE18: priceRootPerUnitE18 }));
        emit Listed(offerId, msg.sender, commodity, amount, priceRootPerUnitE18);
    }

    /// @notice Reprice your own live offer.
    function reprice(uint256 offerId, uint256 priceRootPerUnitE18) external {
        Offer storage o = offers[offerId];
        if (o.seller != msg.sender) revert NotSeller();
        if (priceRootPerUnitE18 == 0) revert ZeroAmount();
        o.priceRootPerUnitE18 = priceRootPerUnitE18;
        emit Repriced(offerId, priceRootPerUnitE18);
    }

    /// @notice Cancel your offer and reclaim the unsold commodity.
    function cancel(uint256 offerId) external nonReentrant {
        Offer storage o = offers[offerId];
        if (o.seller != msg.sender) revert NotSeller();
        uint256 remaining = o.amount;
        o.amount = 0;
        if (remaining > 0) IERC20(o.commodity).safeTransfer(msg.sender, remaining);
        emit Cancelled(offerId, remaining);
    }

    /// @notice Buy `amount` of a listed commodity from a specific offer. Pays the seller's
    ///         R00T price; the commodity is released from escrow to the buyer.
    ///         Requires prior approve() of the R00T cost to this registry.
    function buy(uint256 offerId, uint256 amount) external nonReentrant {
        Offer storage o = offers[offerId];
        if (o.seller == address(0) || o.commodity == address(0)) revert BadOffer();
        if (amount == 0) revert ZeroAmount();
        if (amount > o.amount) revert InsufficientOffer();

        // R00T cost = amount * price / 1e18, rounded up (favor the seller).
        uint256 cost = (amount * o.priceRootPerUnitE18 + 1e18 - 1) / 1e18;

        // Effects
        o.amount -= amount;
        address seller = o.seller;
        address commodity = o.commodity;

        // Interactions: buyer pays R00T → seller; commodity → buyer
        root.safeTransferFrom(msg.sender, seller, cost);
        IERC20(commodity).safeTransfer(msg.sender, amount);

        emit Bought(offerId, msg.sender, amount, cost);
    }

    // ── views ──
    function commodityCount() external view returns (uint256) { return commodities.length; }
    function offerCount() external view returns (uint256) { return offers.length; }
    function getCommodity(string calldata symbol) external view returns (address) {
        return commodityBySymbol[_symbolKey(symbol)];
    }
}
