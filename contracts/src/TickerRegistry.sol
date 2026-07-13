// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title TickerRegistry
/// @author r00t.fund
/// @notice Global, scarce ticker namespace for per-parcel meme stonks. Two parcels can never
///         share a ticker ($OAK is one name). Economic model (anti-vamp by design):
///           • reserve    — first steward to claim a free ticker becomes its OG (permanent)
///                          and owner. Only the owner can launch a parcel stonk under it.
///           • buyout      — the owner names a SELF-ASSESSED $R00T price (Harberger). Anyone
///                          can take an UNLAUNCHED ticker by paying it: a permanent royalty
///                          goes to the OG creator, the rest to the current owner. Squatting a
///                          hot name cheaply invites a buyout; that's the vamp deterrent.
///           • launch-lock — once a ticker is bound to a LIVE parcel token it is permanently
///                          locked: nobody can vamp the identity of a real, trading stonk.
///         Every buyout routes $R00T to the OG who coined the name — reward for naming early.
contract TickerRegistry is ReentrancyGuard {
    using SafeERC20 for IERC20;

    IERC20 public immutable root;          // $R00T — buyout currency
    uint16 public immutable ogRoyaltyBps;  // % of each buyout to the original OG creator (e.g. 1000 = 10%)
    uint16 public constant BPS = 10000;

    /// @notice Authorized launchers (Land contracts / factory) that may bind a ticker to a token.
    mapping(address => bool) public isLauncher;
    address public owner; // protocol admin: manages launchers

    struct Ticker {
        address ogCreator;     // permanent — earns royalty on every buyout
        address holder;        // current owner of the (unlaunched) ticker right
        uint256 buyoutPrice;   // self-assessed $R00T price to take it; 0 = not for sale
        bool launched;         // once true, permanently locked to `token`
        address token;         // the deployed parcel stonk this ticker belongs to (once launched)
    }
    mapping(bytes32 => Ticker) internal _tickers; // key = keccak(symbol)
    string[] public allSymbols;

    event Reserved(string symbol, address indexed ogCreator);
    event BuyoutPriceSet(string symbol, uint256 priceR00T);
    event TickerBought(string symbol, address indexed from, address indexed to, uint256 paid, uint256 ogRoyalty);
    event Launched(string symbol, address indexed holder, address indexed token);
    event LauncherSet(address indexed launcher, bool allowed);

    error NotOwner();
    error EmptySymbol();
    error TickerTaken();
    error NotHolder();
    error NotForSale();
    error Launched_();
    error NotLauncher();
    error NotReserved();
    error ZeroAddress();
    error ExceedsMaxPrice(); // AUDIT FIX (M-02): buyer slippage / setBuyoutPrice front-run guard

    modifier onlyOwner() { if (msg.sender != owner) revert NotOwner(); _; }

    constructor(address _root, uint16 _ogRoyaltyBps) {
        if (_root == address(0)) revert ZeroAddress();
        require(_ogRoyaltyBps <= 5000, "royalty>50%");
        root = IERC20(_root);
        ogRoyaltyBps = _ogRoyaltyBps;
        owner = msg.sender;
    }

    function _key(string memory symbol) internal pure returns (bytes32) {
        return keccak256(bytes(symbol));
    }

    // ── admin ──
    function setLauncher(address launcher, bool allowed) external onlyOwner {
        if (launcher == address(0)) revert ZeroAddress();
        isLauncher[launcher] = allowed;
        emit LauncherSet(launcher, allowed);
    }
    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        owner = newOwner;
    }

    // ── reserve / price / buyout ──

    /// @notice Claim a free ticker. Caller becomes its permanent OG + current holder.
    function reserve(string calldata symbol) external {
        if (bytes(symbol).length == 0) revert EmptySymbol();
        bytes32 k = _key(symbol);
        if (_tickers[k].ogCreator != address(0)) revert TickerTaken();
        _tickers[k] = Ticker({ ogCreator: msg.sender, holder: msg.sender, buyoutPrice: 0, launched: false, token: address(0) });
        allSymbols.push(symbol);
        emit Reserved(symbol, msg.sender);
    }

    /// @notice Holder names the self-assessed $R00T price to cede this (unlaunched) ticker.
    ///         0 = not for sale. This is the Harberger anti-squat lever.
    function setBuyoutPrice(string calldata symbol, uint256 priceR00T) external {
        Ticker storage t = _tickers[_key(symbol)];
        if (t.holder != msg.sender) revert NotHolder();
        if (t.launched) revert Launched_();
        t.buyoutPrice = priceR00T;
        emit BuyoutPriceSet(symbol, priceR00T);
    }

    /// @notice Buy an unlaunched ticker at the holder's self-assessed price. A permanent
    ///         royalty goes to the OG creator; the rest to the current holder. Requires prior
    ///         approve() of `buyoutPrice` $R00T. "Gives it back to the OG."
    /// @param maxPrice AUDIT FIX (M-02): max R00T the buyer will pay. Blocks a holder from
    ///        front-running the buy with setBuyoutPrice() to drain a non-exact allowance.
    function buy(string calldata symbol, uint256 maxPrice) external nonReentrant {
        bytes32 k = _key(symbol);
        Ticker storage t = _tickers[k];
        if (t.ogCreator == address(0)) revert NotReserved();
        if (t.launched) revert Launched_();
        uint256 price = t.buyoutPrice;
        if (price == 0) revert NotForSale();
        if (price > maxPrice) revert ExceedsMaxPrice();

        address prevHolder = t.holder;
        address og = t.ogCreator;
        uint256 royalty = (price * ogRoyaltyBps) / BPS;

        // Effects: transfer the right + reset price
        t.holder = msg.sender;
        t.buyoutPrice = 0;

        // Interactions: pay OG royalty + remainder to previous holder
        root.safeTransferFrom(msg.sender, og, royalty);
        root.safeTransferFrom(msg.sender, prevHolder, price - royalty);

        emit TickerBought(symbol, prevHolder, msg.sender, price, royalty);
    }

    /// @notice Bind a ticker to a deployed parcel token and lock it permanently. Called by an
    ///         authorized launcher (Land) on behalf of the ticker holder when the stonk goes live.
    /// @param holder the ticker holder launching (must currently hold it, unlaunched)
    function markLaunched(string calldata symbol, address holder, address token) external {
        if (!isLauncher[msg.sender]) revert NotLauncher();
        if (token == address(0)) revert ZeroAddress();
        Ticker storage t = _tickers[_key(symbol)];
        if (t.holder != holder) revert NotHolder();
        if (t.launched) revert Launched_();
        t.launched = true;
        t.token = token;
        emit Launched(symbol, holder, token);
    }

    // ── views ──
    function tickerInfo(string calldata symbol)
        external view returns (address ogCreator, address holder, uint256 buyoutPrice, bool launched, address token)
    {
        Ticker storage t = _tickers[_key(symbol)];
        return (t.ogCreator, t.holder, t.buyoutPrice, t.launched, t.token);
    }
    function isAvailable(string calldata symbol) external view returns (bool) {
        return _tickers[_key(symbol)].ogCreator == address(0);
    }
    function symbolCount() external view returns (uint256) { return allSymbols.length; }
}
