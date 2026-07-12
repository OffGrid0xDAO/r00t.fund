// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title IR00TShorts
/// @notice Interface for R00T token short selling contract
interface IR00TShorts {
    // ============ Structs ============

    struct ShortPosition {
        uint256 ethCollateral;        // User's ETH after fee
        uint256 ethFromSale;          // Virtual ETH from "selling" tokens
        uint256 tokenAmountShorted;   // Tokens being shorted
        uint256 entryPrice;           // Entry price (scaled 1e18)
        uint256 openedAt;             // Timestamp
        bool isOpen;
    }

    // ============ Events ============

    event ShortOpened(
        uint256 indexed positionId,
        address indexed user,
        uint256 collateral,
        uint256 tokensShorted,
        uint256 entryPrice
    );

    event ShortClosed(
        uint256 indexed positionId,
        address indexed user,
        int256 pnl,
        uint256 payout
    );

    event PositionLiquidated(
        uint256 indexed positionId,
        address indexed owner,
        address indexed liquidator,
        uint256 bonus
    );

    event FeesCollected(address indexed treasury, uint256 amount);

    // ============ Errors ============

    error PositionTooSmall();
    error PositionTooLarge();
    error OpenInterestLimitExceeded();
    error SlippageExceeded();
    error PositionNotOpen();
    error NotPositionOwner();
    error CooldownNotMet();
    error PositionNotLiquidatable();
    error TransferFailed();
    error NoFeesToCollect();
    error ZeroAddress();
    error InsufficientReserves();
    error Unauthorized();

    // ============ External Functions ============

    /// @notice Open a short position against R00T token
    /// @param minTokensShorted Minimum tokens to short (slippage protection)
    /// @return positionId The unique identifier for this position
    function openShort(uint256 minTokensShorted) external payable returns (uint256 positionId);

    /// @notice Close a short position and claim profits/losses
    /// @param positionId The position to close
    /// @param maxRepurchaseCost Maximum ETH willing to pay to close (slippage protection)
    function closeShort(uint256 positionId, uint256 maxRepurchaseCost) external;

    /// @notice Liquidate an underwater position
    /// @param positionId The position to liquidate
    /// @param maxRepurchaseCost Maximum ETH to spend buying back tokens (0 = no limit)
    function liquidate(uint256 positionId, uint256 maxRepurchaseCost) external;

    /// @notice Collect accumulated protocol fees
    function collectFees() external;

    // ============ View Functions ============

    /// @notice Calculate profit/loss for a position
    /// @param positionId The position to calculate PnL for
    /// @return pnl Positive = profit, Negative = loss (in ETH)
    /// @return repurchaseCost Current ETH cost to buy back shorted tokens
    function calculatePnL(uint256 positionId) external view returns (int256 pnl, uint256 repurchaseCost);

    /// @notice Check if a position is liquidatable
    /// @param positionId The position to check
    /// @return True if position can be liquidated
    function isLiquidatable(uint256 positionId) external view returns (bool);

    /// @notice Get position details
    /// @param positionId The position ID
    /// @return position The position struct
    function getPosition(uint256 positionId) external view returns (ShortPosition memory position);

    /// @notice Get all position IDs for a user
    /// @param user The user address
    /// @return positionIds Array of position IDs
    function getUserPositions(address user) external view returns (uint256[] memory positionIds);

    /// @notice Get current token price from pool
    /// @return tokensPerEth How many tokens 1 ETH would buy
    function getCurrentPrice() external view returns (uint256 tokensPerEth);
}
