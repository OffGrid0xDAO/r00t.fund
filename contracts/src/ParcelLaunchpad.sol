// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "./ParcelToken.sol";

/// @title ParcelLaunchpad
/// @notice Phase-1 funding rail for the Project 001 parcel map. Backers pledge
///         ETH or USDC to a parcel; funds go STRAIGHT to the land treasury (never
///         LP). Each pledge accrues early-bird allocation points (earlier = more)
///         used later to distribute $R00T at TGE (phase 2 / off this contract).
/// @dev The contract never custodies pledged funds — it forwards them to the
///      treasury in the same call, minimising surface. Accounting unit is USD
///      with 6 decimals (same as USDC). ETH pledges convert via an owner-set
///      price (`ethPriceE6`), swappable for a Chainlink feed later.
contract ParcelLaunchpad is Ownable, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;

    /// @notice Land treasury that receives every pledge (real regeneration capital).
    address public treasury;
    /// @notice USDC (or any 6-decimals stable) accepted for pledges.
    IERC20 public immutable usdc;
    /// @notice USD price of 1 ETH, 6 decimals (e.g. 3000_000000 = $3,000). Owner-set.
    uint256 public ethPriceE6;
    /// @notice Early-bird bonus in bps applied to allocation points (10000 = 1x).
    uint256 public bonusBps = 15000; // starts at 1.5x, owner steps down per round
    /// @notice Current funding round index (for display / early-bird schedule).
    uint256 public round;

    // ── accounting (USD, 6 decimals) ──
    uint256 public totalRaisedUsd6;
    mapping(bytes32 => uint256) public raisedByParcelUsd6;
    mapping(address => uint256) public pledgedUsd6;       // per backer
    mapping(address => uint256) public allocationPoints;  // early-bird weighted
    uint256 public totalAllocationPoints;
    uint256 public pledgeCount;

    /// @notice Per-parcel culture token, minted to pledgers at pledge time.
    mapping(bytes32 => ParcelToken) public parcelToken;

    event Pledged(
        address indexed backer,
        bytes32 indexed parcelId,
        address token,        // address(0) = ETH, else USDC
        uint256 amount,       // raw token amount pledged
        uint256 usd6,         // USD value credited (6 decimals)
        uint256 points,       // early-bird allocation points earned
        uint256 round
    );
    event ParcelCreated(bytes32 indexed parcelId, address token, string name, string symbol);
    event TokensMinted(bytes32 indexed parcelId, address indexed to, uint256 amount);
    event TreasuryUpdated(address indexed treasury);
    event RoundAdvanced(uint256 indexed round, uint256 bonusBps);
    event EthPriceUpdated(uint256 ethPriceE6);

    error ZeroAddress();
    error ZeroAmount();
    error EthTransferFailed();

    constructor(address _treasury, address _usdc, uint256 _ethPriceE6) Ownable(msg.sender) {
        if (_treasury == address(0) || _usdc == address(0)) revert ZeroAddress();
        treasury = _treasury;
        usdc = IERC20(_usdc);
        ethPriceE6 = _ethPriceE6;
    }

    // ── pledging ──────────────────────────────────────────────────────────────

    /// @notice Pledge ETH to a parcel. Funds forward to the treasury immediately.
    function pledgeETH(bytes32 parcelId) external payable nonReentrant whenNotPaused {
        if (msg.value == 0) revert ZeroAmount();
        uint256 usd6 = (msg.value * ethPriceE6) / 1e18;
        _record(parcelId, address(0), msg.value, usd6);
        (bool ok, ) = treasury.call{value: msg.value}("");
        if (!ok) revert EthTransferFailed();
    }

    /// @notice Pledge USDC to a parcel. Requires prior approve() to this contract.
    function pledgeUSDC(bytes32 parcelId, uint256 amount) external nonReentrant whenNotPaused {
        if (amount == 0) revert ZeroAmount();
        // pull straight to the treasury — contract never custodies funds
        usdc.safeTransferFrom(msg.sender, treasury, amount);
        _record(parcelId, address(usdc), amount, amount);
    }

    function _record(bytes32 parcelId, address token, uint256 amount, uint256 usd6) internal {
        uint256 points = (usd6 * bonusBps) / 10000;   // early-bird weighted (6 decimals)
        totalRaisedUsd6 += usd6;
        raisedByParcelUsd6[parcelId] += usd6;
        pledgedUsd6[msg.sender] += usd6;
        allocationPoints[msg.sender] += points;
        totalAllocationPoints += points;
        unchecked { pledgeCount++; }
        emit Pledged(msg.sender, parcelId, token, amount, usd6, points, round);

        // mint the parcel's culture token straight to the pledger (if launched).
        // points are 6-decimals USD-weighted → scale to 18-decimals token units.
        ParcelToken pt = parcelToken[parcelId];
        if (address(pt) != address(0)) {
            uint256 mintAmount = points * 1e12;
            pt.mint(msg.sender, mintAmount);
            emit TokensMinted(parcelId, msg.sender, mintAmount);
        }
    }

    /// @notice Deploy a parcel's culture token so pledges to it mint that token.
    ///         name/symbol come from the parcel's culture (e.g. "Oak Field", "OAK").
    function createParcel(bytes32 parcelId, string calldata name, string calldata symbol)
        external onlyOwner returns (address)
    {
        require(address(parcelToken[parcelId]) == address(0), "exists");
        ParcelToken pt = new ParcelToken(name, symbol, address(this));
        parcelToken[parcelId] = pt;
        emit ParcelCreated(parcelId, address(pt), name, symbol);
        return address(pt);
    }

    // ── views ──────────────────────────────────────────────────────────────────

    /// @notice USD raised (6 decimals) for a parcel.
    function raised(bytes32 parcelId) external view returns (uint256) {
        return raisedByParcelUsd6[parcelId];
    }

    // ── admin ────────────────────────────────────────────────────────────────

    /// @notice Advance to the next early-bird round with a new (lower) bonus.
    function advanceRound(uint256 newBonusBps) external onlyOwner {
        require(newBonusBps <= bonusBps && newBonusBps >= 10000, "bonus range");
        bonusBps = newBonusBps;
        unchecked { round++; }
        emit RoundAdvanced(round, newBonusBps);
    }

    function setTreasury(address _treasury) external onlyOwner {
        if (_treasury == address(0)) revert ZeroAddress();
        treasury = _treasury;
        emit TreasuryUpdated(_treasury);
    }

    function setEthPrice(uint256 _ethPriceE6) external onlyOwner {
        ethPriceE6 = _ethPriceE6;
        emit EthPriceUpdated(_ethPriceE6);
    }

    function pause() external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }

    /// @notice Rescue tokens sent here by mistake (pledges never rest here).
    function rescueERC20(address token, address to, uint256 amount) external onlyOwner {
        IERC20(token).safeTransfer(to, amount);
    }
}
