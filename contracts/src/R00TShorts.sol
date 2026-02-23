// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "./interfaces/IR00TShorts.sol";

/// @title IZkAMMPairForShorts
/// @notice Extended interface for shorts integration with ZkAMMPair
interface IZkAMMPairForShorts {
    function getReserves() external view returns (uint256 ethReserve, uint256 tokenReserve);
    function MIN_LIQUIDITY() external view returns (uint256);

    // Real token swap functions
    function sellTokensForShorts(uint256 tokenAmount) external returns (uint256 ethOut);
    function buyTokensForShorts(uint256 tokenAmount) external payable returns (uint256 ethUsed);

    // Protocol fees
    function addProtocolFees(uint256 amount) external;
}

/// @title R00TShorts
/// @author r00t.fund
/// @notice Secure 1x leverage short selling contract for R00T token with REAL token swaps
/// @dev Holds ROOT tokens, sells them to pool on open, buys back on close
contract R00TShorts is IR00TShorts, ReentrancyGuard, Ownable {
    using SafeERC20 for IERC20;
    // ============ Constants ============

    /// @notice Opening fee in basis points (5%)
    uint256 public constant FEE_BPS = 500;

    /// @notice Fee denominator for basis point calculations
    uint256 public constant FEE_DENOMINATOR = 10000;

    /// @notice Liquidation threshold - liquidate when loss exceeds this % of collateral (90%)
    uint256 public constant LIQUIDATION_THRESHOLD_BPS = 9000;

    /// @notice Liquidation bonus for liquidators (5%)
    uint256 public constant LIQUIDATION_BONUS_BPS = 500;

    /// @notice Minimum position size
    uint256 public constant MIN_POSITION_ETH = 0.01 ether;

    /// @notice Maximum position size (anti-whale protection)
    uint256 public constant MAX_POSITION_ETH = 100 ether;

    /// @notice Cooldown period before position can be closed (anti-flash loan)
    uint256 public constant POSITION_COOLDOWN = 1 hours;

    /// @notice Maximum open interest as percentage of token reserve (default 50%)
    uint256 public constant DEFAULT_MAX_OPEN_INTEREST_BPS = 5000;

    /// @notice AMM fee for price calculations (1%)
    uint256 public constant AMM_FEE_BPS = 100;

    // ============ Immutables ============

    /// @notice ZkAMMPair contract for actual swaps
    IZkAMMPairForShorts public immutable pair;

    /// @notice ROOT token for shorting
    IERC20 public immutable rootToken;

    /// @notice Treasury address for fee collection
    address public immutable treasury;

    // ============ State Variables ============

    /// @notice Position ID counter
    uint256 public nextPositionId;

    /// @notice Total tokens currently shorted across all positions
    uint256 public totalOpenInterest;

    /// @notice Total ETH held by this contract for positions (collateral + sale proceeds)
    uint256 public totalCollateralLocked;

    /// @notice Accumulated protocol fees (in ETH)
    uint256 public accumulatedFees;

    /// @notice Count of currently open positions (avoids unbounded loop)
    uint256 public openPositionCount;

    /// @notice Configurable max open interest in basis points (owner can adjust)
    uint256 public maxOpenInterestBps;

    /// @notice Position ID => Position data
    mapping(uint256 => ShortPosition) private _positions;

    /// @notice Position ID => Owner address
    mapping(uint256 => address) public positionOwner;

    /// @notice User address => Array of position IDs
    mapping(address => uint256[]) private _userPositions;

    // ============ Constructor ============

    /// @notice Initialize the shorts contract
    /// @param _pair ZkAMMPair contract address
    /// @param _rootToken ROOT token address
    /// @param _treasury Treasury address for fee collection
    constructor(address _pair, address _rootToken, address _treasury) Ownable(msg.sender) {
        if (_pair == address(0)) revert ZeroAddress();
        if (_rootToken == address(0)) revert ZeroAddress();
        if (_treasury == address(0)) revert ZeroAddress();

        pair = IZkAMMPairForShorts(_pair);
        rootToken = IERC20(_rootToken);
        treasury = _treasury;
        maxOpenInterestBps = DEFAULT_MAX_OPEN_INTEREST_BPS;

        // Note: ROOT token approval to pair is done per-operation for safety
    }

    // ============ External Functions ============

    /// @inheritdoc IR00TShorts
    /// @notice Opens a short position with REAL token swap
    /// @dev Flow:
    ///   1. User deposits ETH (5% fee taken)
    ///   2. Contract calculates tokens to short based on current price
    ///   3. Contract SELLS ROOT tokens to pool (real swap)
    ///   4. Contract receives ETH from the sale
    ///   5. Contract now holds 2x ETH: user's collateral + ETH from selling tokens
    function openShort(uint256 minTokensShorted)
        external
        payable
        nonReentrant
        returns (uint256 positionId)
    {
        // ============ CHECKS ============

        if (msg.value < MIN_POSITION_ETH) revert PositionTooSmall();
        if (msg.value > MAX_POSITION_ETH) revert PositionTooLarge();

        // Calculate collateral after 5% fee
        uint256 fee = (msg.value * FEE_BPS) / FEE_DENOMINATOR;
        uint256 collateral = msg.value - fee;

        // Get current reserves for price calculation
        (uint256 ethReserve, uint256 tokenReserve) = pair.getReserves();
        if (ethReserve == 0 || tokenReserve == 0) revert InsufficientReserves();

        // Calculate tokens to short (what collateral would buy at current price)
        uint256 tokensToShort = _getAmountOut(collateral, ethReserve, tokenReserve);
        if (tokensToShort < minTokensShorted) revert SlippageExceeded();

        // Check we have enough ROOT tokens to sell
        uint256 availableTokens = rootToken.balanceOf(address(this));
        if (availableTokens < tokensToShort) revert InsufficientReserves();

        // Check open interest limit
        uint256 maxOI = (tokenReserve * maxOpenInterestBps) / FEE_DENOMINATOR;
        if (totalOpenInterest + tokensToShort > maxOI) revert OpenInterestLimitExceeded();

        // ============ INTERACTIONS (before state changes for reentrancy safety) ============

        // Execute REAL sell: ROOT tokens → Pool → ETH
        // SECURITY FIX (M-9): Approve only needed amount per operation instead of max
        rootToken.approve(address(pair), tokensToShort);
        uint256 balanceBefore = address(this).balance;
        uint256 ethFromSale = pair.sellTokensForShorts(tokensToShort);

        // SECURITY FIX (H-8): Verify actual ETH received matches reported amount
        uint256 actualReceived = address(this).balance - balanceBefore;
        if (actualReceived < ethFromSale) revert InsufficientReserves();

        // ============ EFFECTS ============

        // Create position
        positionId = nextPositionId++;

        _positions[positionId] = ShortPosition({
            ethCollateral: collateral,
            ethFromSale: ethFromSale,         // Actual ETH received from selling tokens
            tokenAmountShorted: tokensToShort,
            entryPrice: (tokensToShort * 1e18) / collateral,
            openedAt: block.timestamp,
            isOpen: true
        });

        positionOwner[positionId] = msg.sender;
        _userPositions[msg.sender].push(positionId);

        // Update global state
        totalOpenInterest += tokensToShort;
        totalCollateralLocked += collateral + ethFromSale; // Holds REAL 2x ETH
        accumulatedFees += fee;
        openPositionCount++;

        emit ShortOpened(
            positionId,
            msg.sender,
            collateral,
            tokensToShort,
            _positions[positionId].entryPrice
        );
    }

    /// @inheritdoc IR00TShorts
    /// @notice Closes a short position with REAL token buyback
    /// @dev Flow:
    ///   1. Calculate current cost to buy back the shorted tokens
    ///   2. Execute REAL buy: send ETH to pool, receive ROOT tokens back
    ///   3. Calculate PnL based on (original sale proceeds - current buy cost)
    ///   4. Pay user their collateral +/- PnL
    function closeShort(uint256 positionId, uint256 maxRepurchaseCost)
        external
        nonReentrant
    {
        ShortPosition storage position = _positions[positionId];

        // ============ CHECKS ============

        if (!position.isOpen) revert PositionNotOpen();
        if (positionOwner[positionId] != msg.sender) revert NotPositionOwner();
        if (block.timestamp < position.openedAt + POSITION_COOLDOWN) revert CooldownNotMet();

        // Calculate current cost to buy back tokens
        (uint256 ethReserve, uint256 tokenReserve) = pair.getReserves();

        // Cost to buy back the tokens we shorted
        uint256 repurchaseCost = _getAmountIn(
            position.tokenAmountShorted,
            ethReserve,
            tokenReserve
        );

        // Slippage protection
        if (repurchaseCost > maxRepurchaseCost) revert SlippageExceeded();

        // ============ EFFECTS (update state before external calls) ============

        position.isOpen = false;
        openPositionCount--;

        // Total ETH we're holding for this position
        uint256 totalHeld = position.ethCollateral + position.ethFromSale;
        totalCollateralLocked -= totalHeld;

        // Cap repurchase cost at what we actually have
        uint256 actualRepurchaseCost = repurchaseCost > totalHeld ? totalHeld : repurchaseCost;

        // Calculate payout: user gets whatever is left after buying back tokens
        uint256 payout = totalHeld - actualRepurchaseCost;

        // Calculate PnL for event
        int256 pnl;
        if (repurchaseCost <= position.ethFromSale) {
            pnl = int256(position.ethFromSale - repurchaseCost);
        } else {
            pnl = -int256(repurchaseCost - position.ethFromSale);
        }

        // ============ INTERACTIONS ============

        // Execute REAL buy: send ETH to pool, receive ROOT tokens back
        if (actualRepurchaseCost > 0) {
            pair.buyTokensForShorts{value: actualRepurchaseCost}(position.tokenAmountShorted);
        }
        // Always decrement by the full shorted amount — this was added at open time
        // and must be fully removed at close regardless of partial fills
        totalOpenInterest -= position.tokenAmountShorted;

        // Pay user their payout
        if (payout > 0) {
            (bool success, ) = msg.sender.call{value: payout}("");
            if (!success) revert TransferFailed();
        }

        emit ShortClosed(positionId, msg.sender, pnl, payout);
    }

    /// @inheritdoc IR00TShorts
    /// @notice Liquidate an underwater position with REAL token buyback
    /// @param positionId The position to liquidate
    /// @param maxRepurchaseCost Maximum ETH to spend buying back tokens (slippage protection)
    function liquidate(uint256 positionId, uint256 maxRepurchaseCost) external nonReentrant {
        ShortPosition storage position = _positions[positionId];

        // ============ CHECKS ============

        if (!position.isOpen) revert PositionNotOpen();
        if (!isLiquidatable(positionId)) revert PositionNotLiquidatable();

        // ============ EFFECTS ============

        position.isOpen = false;
        openPositionCount--;

        uint256 totalHeld = position.ethCollateral + position.ethFromSale;
        totalCollateralLocked -= totalHeld;

        // Calculate repurchase cost
        (uint256 ethReserve, uint256 tokenReserve) = pair.getReserves();
        uint256 repurchaseCost = _getAmountIn(
            position.tokenAmountShorted,
            ethReserve,
            tokenReserve
        );

        // SECURITY FIX (Vuln 9): Always enforce slippage protection - removed maxRepurchaseCost > 0 bypass
        if (repurchaseCost > maxRepurchaseCost) revert SlippageExceeded();

        // Cap at what we have
        uint256 actualRepurchaseCost = repurchaseCost > totalHeld ? totalHeld : repurchaseCost;
        uint256 remaining = totalHeld - actualRepurchaseCost;

        // Liquidation bonus (5% of remaining)
        uint256 liquidatorBonus = (remaining * LIQUIDATION_BONUS_BPS) / FEE_DENOMINATOR;
        uint256 returnToOwner = remaining - liquidatorBonus;

        address owner = positionOwner[positionId];

        // ============ INTERACTIONS ============

        // Execute REAL buy to close position - tokens return to this contract
        if (actualRepurchaseCost > 0) {
            pair.buyTokensForShorts{value: actualRepurchaseCost}(position.tokenAmountShorted);
        }
        // Always decrement by the full shorted amount — this was added at open time
        // and must be fully removed at liquidation regardless of partial fills
        totalOpenInterest -= position.tokenAmountShorted;

        // Pay liquidator their bonus
        if (liquidatorBonus > 0) {
            (bool s1, ) = msg.sender.call{value: liquidatorBonus}("");
            if (!s1) revert TransferFailed();
        }

        // Return remainder to position owner
        if (returnToOwner > 0) {
            (bool s2, ) = owner.call{value: returnToOwner}("");
            if (!s2) revert TransferFailed();
        }

        emit PositionLiquidated(positionId, owner, msg.sender, liquidatorBonus);
    }

    /// @inheritdoc IR00TShorts
    function collectFees() external onlyOwner {
        uint256 fees = accumulatedFees;
        if (fees == 0) revert NoFeesToCollect();

        accumulatedFees = 0;

        (bool success, ) = treasury.call{value: fees}("");
        if (!success) revert TransferFailed();

        emit FeesCollected(treasury, fees);
    }

    /// @notice Update the max open interest limit (owner only)
    /// @param _maxOpenInterestBps New max OI in basis points (e.g. 5000 = 50%)
    function setMaxOpenInterestBps(uint256 _maxOpenInterestBps) external onlyOwner {
        require(_maxOpenInterestBps <= FEE_DENOMINATOR, "Cannot exceed 100%");
        maxOpenInterestBps = _maxOpenInterestBps;
    }

    // ============ View Functions ============

    /// @inheritdoc IR00TShorts
    function calculatePnL(uint256 positionId)
        public
        view
        returns (int256 pnl, uint256 repurchaseCost)
    {
        ShortPosition storage position = _positions[positionId];

        (uint256 ethReserve, uint256 tokenReserve) = pair.getReserves();

        // Cost to buy back the shorted tokens
        repurchaseCost = _getAmountIn(
            position.tokenAmountShorted,
            ethReserve,
            tokenReserve
        );

        // PnL = what we sold for - what it costs to buy back
        uint256 saleProceeds = position.ethFromSale;

        if (repurchaseCost <= saleProceeds) {
            pnl = int256(saleProceeds - repurchaseCost);
        } else {
            pnl = -int256(repurchaseCost - saleProceeds);
        }
    }

    /// @inheritdoc IR00TShorts
    function isLiquidatable(uint256 positionId) public view returns (bool) {
        ShortPosition storage position = _positions[positionId];

        if (!position.isOpen) return false;

        (int256 pnl, ) = calculatePnL(positionId);

        // Profitable positions cannot be liquidated
        if (pnl >= 0) return false;

        uint256 loss = uint256(-pnl);
        uint256 totalHeld = position.ethCollateral + position.ethFromSale;

        // Liquidatable when loss exceeds (100% - threshold) of total held
        // With 90% threshold: liquidatable when loss > 10% of total
        uint256 maxLoss = (totalHeld * (FEE_DENOMINATOR - LIQUIDATION_THRESHOLD_BPS)) / FEE_DENOMINATOR;

        return loss >= maxLoss;
    }

    /// @inheritdoc IR00TShorts
    function getPosition(uint256 positionId)
        external
        view
        returns (ShortPosition memory position)
    {
        return _positions[positionId];
    }

    /// @inheritdoc IR00TShorts
    function getUserPositions(address user)
        external
        view
        returns (uint256[] memory positionIds)
    {
        return _userPositions[user];
    }

    /// @inheritdoc IR00TShorts
    function getCurrentPrice() external view returns (uint256 tokensPerEth) {
        (uint256 ethReserve, uint256 tokenReserve) = pair.getReserves();
        if (ethReserve == 0) return 0;

        tokensPerEth = (tokenReserve * 1e18) / ethReserve;
    }

    /// @notice Get the maximum profit potential for a position (if price goes to 0)
    /// @param positionId The position ID
    /// @return maxProfit Maximum possible profit (2x collateral - fees)
    function getMaxProfit(uint256 positionId) external view returns (uint256 maxProfit) {
        ShortPosition storage position = _positions[positionId];
        if (!position.isOpen) return 0;

        // If price goes to 0, repurchase cost = 0
        // User gets back: collateral + ethFromSale = 2x collateral
        maxProfit = position.ethCollateral + position.ethFromSale;
    }

    /// @notice Get contract health metrics
    function getContractMetrics()
        external
        view
        returns (
            uint256 totalPositions,
            uint256 openCount,
            uint256 totalOI,
            uint256 totalLocked,
            uint256 fees
        )
    {
        totalPositions = nextPositionId;
        openCount = openPositionCount;
        totalOI = totalOpenInterest;
        totalLocked = totalCollateralLocked;
        fees = accumulatedFees;
    }

    /// @notice Check contract invariants
    function checkInvariants()
        external
        view
        returns (bool healthy, uint256 actualBalance, uint256 expectedMinimum)
    {
        actualBalance = address(this).balance;
        // SECURITY FIX: Include accumulatedFees in expected minimum
        expectedMinimum = totalCollateralLocked + accumulatedFees;
        healthy = actualBalance >= expectedMinimum;
    }

    // ============ CRE Integration View Functions ============

    /// @notice Get the total number of positions (open + closed)
    /// @return Total position count
    function getPositionCount() external view returns (uint256) {
        return nextPositionId;
    }

    /// @notice Get the count of positions that are currently liquidatable
    /// @dev Iterates through recent positions — bounded by openPositionCount
    /// @return count Number of liquidatable positions
    function getLiquidatablePositionCount() external view returns (uint256 count) {
        // Iterate backwards from latest position, check up to openPositionCount active ones
        uint256 checked = 0;
        for (uint256 i = nextPositionId; i > 0 && checked < openPositionCount; i--) {
            ShortPosition storage pos = _positions[i - 1];
            if (!pos.isOpen) continue;
            checked++;

            // Check if liquidatable
            (int256 pnl, ) = calculatePnL(i - 1);
            if (pnl >= 0) continue;

            uint256 loss = uint256(-pnl);
            uint256 totalHeld = pos.ethCollateral + pos.ethFromSale;
            uint256 maxLoss = (totalHeld * (FEE_DENOMINATOR - LIQUIDATION_THRESHOLD_BPS)) / FEE_DENOMINATOR;

            if (loss >= maxLoss) {
                count++;
            }
        }
    }

    // ============ Internal Functions ============

    /// @notice Calculate output amount for a given input (AMM formula)
    function _getAmountOut(
        uint256 amountIn,
        uint256 reserveIn,
        uint256 reserveOut
    ) internal pure returns (uint256 amountOut) {
        uint256 amountInWithFee = amountIn * (FEE_DENOMINATOR - AMM_FEE_BPS);
        uint256 numerator = amountInWithFee * reserveOut;
        uint256 denominator = reserveIn * FEE_DENOMINATOR + amountInWithFee;
        amountOut = numerator / denominator;
    }

    /// @notice Calculate input amount for a given output (reverse AMM formula)
    function _getAmountIn(
        uint256 amountOut,
        uint256 reserveIn,
        uint256 reserveOut
    ) internal pure returns (uint256 amountIn) {
        if (reserveOut <= amountOut) {
            return type(uint256).max;
        }

        uint256 numerator = reserveIn * amountOut * FEE_DENOMINATOR;
        uint256 denominator = (reserveOut - amountOut) * (FEE_DENOMINATOR - AMM_FEE_BPS);
        amountIn = (numerator / denominator) + 1;
    }

    // ============ Token Management ============

    /// @notice Get available ROOT tokens for shorting
    /// @return available Number of ROOT tokens available
    function getAvailableTokens() external view returns (uint256 available) {
        return rootToken.balanceOf(address(this));
    }

    /// @notice Deposit ROOT tokens to enable shorting (owner only)
    /// @param amount Amount of ROOT tokens to deposit
    function depositTokens(uint256 amount) external onlyOwner {
        rootToken.safeTransferFrom(msg.sender, address(this), amount);
    }

    /// @notice Withdraw excess ROOT tokens (owner only)
    /// @dev Can only withdraw tokens not locked in open positions
    /// @param amount Amount of ROOT tokens to withdraw
    function withdrawTokens(uint256 amount) external onlyOwner {
        uint256 available = rootToken.balanceOf(address(this));
        // All tokens are available since we buy them back when closing positions
        require(amount <= available, "Insufficient tokens");
        rootToken.safeTransfer(msg.sender, amount);
    }

    // ============ Receive ============

    /// @notice Accept ETH from pair contract only
    receive() external payable {
        if (msg.sender != address(pair)) revert Unauthorized();
    }
}
