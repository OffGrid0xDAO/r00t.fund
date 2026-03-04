// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./R00tCREReceiver.sol";

/// @title RegenPredictionMarket
/// @author r00t.fund
/// @notice CRE-settled prediction markets for environmental milestones (Workflow 4)
/// @dev Prize Track: Prediction Markets ($16k)
///      Users create markets tied to LaunchpadGovernance proposals. Markets resolve
///      when the CRE DON fetches environmental outcome data from external APIs.
///      Uses constant product pricing for shares.
contract RegenPredictionMarket is R00tCREReceiver {
    // ============ Enums ============

    enum MarketStatus { OPEN, RESOLUTION_REQUESTED, RESOLVED, CANCELLED }
    enum Outcome { UNRESOLVED, POSITIVE, NEGATIVE }

    // ============ Structs ============

    struct Market {
        uint256 proposalId;          // Linked LaunchpadGovernance proposal
        string metric;               // Environmental metric (e.g., "carbon_offset_tonnes")
        uint256 targetValue;         // Target value for positive outcome
        uint256 resolutionTime;      // Earliest time market can be resolved
        uint256 createdAt;
        address creator;
        MarketStatus status;
        Outcome outcome;
        uint256 actualValue;         // Filled on resolution
        bytes32 proofHash;           // Resolution proof hash
        uint256 totalPositiveShares;
        uint256 totalNegativeShares;
        uint256 totalPool;           // Total ETH in the market pool
    }

    // ============ State ============

    /// @notice Next market ID
    uint256 public nextMarketId;

    /// @notice Markets by ID
    mapping(uint256 => Market) public markets;

    /// @notice User share balances: marketId => user => isPositive => shares
    mapping(uint256 => mapping(address => mapping(bool => uint256))) public userShares;

    /// @notice Whether a user has claimed their payout
    mapping(uint256 => mapping(address => bool)) public hasClaimed;

    /// @notice Minimum market duration (1 day)
    uint256 public constant MIN_MARKET_DURATION = 1 days;

    /// @notice Market creation fee in basis points (1%)
    uint256 public constant CREATION_FEE_BPS = 100;

    /// @notice Fee denominator
    uint256 public constant FEE_DENOMINATOR = 10000;

    /// @notice Platform treasury for fees
    address public treasury;

    /// @notice SECURITY FIX (Vuln 6): Dispute period before payouts are claimable (TESTNET: 5 minutes)
    /// @dev Prevents single DON forwarder from settling markets with fabricated outcomes.
    ///      Owner can dispute within this window to override resolution.
    uint256 public constant DISPUTE_PERIOD = 5 minutes; // TESTNET: Changed from 24 hours for testing

    /// @notice Timestamp when each market was resolved
    mapping(uint256 => uint256) public marketResolvedAt;

    // ============ Events ============

    event MarketCreated(
        uint256 indexed marketId,
        uint256 indexed proposalId,
        string metric,
        uint256 targetValue,
        uint256 resolutionTime,
        address creator
    );

    event SharesPurchased(
        uint256 indexed marketId,
        address indexed buyer,
        bool isPositive,
        uint256 shares,
        uint256 cost
    );

    event ResolutionRequested(
        uint256 indexed marketId,
        uint256 indexed proposalId,
        string metric,
        uint256 targetValue
    );

    event MarketResolved(
        uint256 indexed marketId,
        Outcome outcome,
        uint256 actualValue,
        bytes32 proofHash
    );

    event PayoutClaimed(
        uint256 indexed marketId,
        address indexed user,
        uint256 payout
    );

    // ============ Errors ============

    error MarketNotOpen();
    error MarketNotResolvable();
    error InvalidResolutionTime();
    error InsufficientShares();
    error AlreadyClaimed();
    error MarketNotResolved();
    error NoPayout();
    error InvalidMarket();
    error DisputePeriodActive();
    error DisputeWindowClosed();
    error MarketNotDisputable();

    // ============ Constructor ============

    constructor(
        address _donForwarder,
        address _owner,
        address _treasury
    ) R00tCREReceiver(_donForwarder, _owner) {
        if (_treasury == address(0)) revert ZeroAddress();
        treasury = _treasury;
    }

    // ============ Market Functions ============

    /// @notice Create a new prediction market
    /// @param proposalId LaunchpadGovernance proposal this market is linked to
    /// @param metric Environmental metric to track
    /// @param targetValue Target value for positive outcome
    /// @param resolutionTime Earliest time the market can be resolved
    /// @return marketId The new market's ID
    function createMarket(
        uint256 proposalId,
        string calldata metric,
        uint256 targetValue,
        uint256 resolutionTime
    ) external returns (uint256 marketId) {
        if (resolutionTime < block.timestamp + MIN_MARKET_DURATION) revert InvalidResolutionTime();

        marketId = nextMarketId++;

        markets[marketId] = Market({
            proposalId: proposalId,
            metric: metric,
            targetValue: targetValue,
            resolutionTime: resolutionTime,
            createdAt: block.timestamp,
            creator: msg.sender,
            status: MarketStatus.OPEN,
            outcome: Outcome.UNRESOLVED,
            actualValue: 0,
            proofHash: bytes32(0),
            totalPositiveShares: 0,
            totalNegativeShares: 0,
            totalPool: 0
        });

        emit MarketCreated(marketId, proposalId, metric, targetValue, resolutionTime, msg.sender);
    }

    /// @notice Buy shares in a prediction market
    /// @param marketId Market to buy shares in
    /// @param isPositive True for positive outcome shares, false for negative
    /// @param minShares Minimum shares to receive (slippage protection)
    /// @return sharesBought Number of shares purchased
    function buyShares(
        uint256 marketId,
        bool isPositive,
        uint256 minShares
    ) external payable returns (uint256 sharesBought) {
        Market storage market = markets[marketId];
        if (market.status != MarketStatus.OPEN) revert MarketNotOpen();

        uint256 fee = (msg.value * CREATION_FEE_BPS) / FEE_DENOMINATOR;
        uint256 netAmount = msg.value - fee;

        // Simple constant product: shares = sqrt(amount * totalPool) or amount for initial
        if (market.totalPool == 0) {
            sharesBought = netAmount;
        } else {
            // Simplified LMSR-inspired pricing
            uint256 totalShares = isPositive ? market.totalPositiveShares : market.totalNegativeShares;
            uint256 otherShares = isPositive ? market.totalNegativeShares : market.totalPositiveShares;

            if (totalShares == 0) {
                sharesBought = netAmount;
            } else {
                // Price proportional to share ratio
                sharesBought = (netAmount * (totalShares + otherShares)) / (totalShares + netAmount);
                if (sharesBought == 0) sharesBought = 1;
            }
        }

        if (sharesBought < minShares) revert InsufficientShares();

        // Update state
        if (isPositive) {
            market.totalPositiveShares += sharesBought;
        } else {
            market.totalNegativeShares += sharesBought;
        }
        market.totalPool += netAmount;
        userShares[marketId][msg.sender][isPositive] += sharesBought;

        // Send fee to treasury
        if (fee > 0) {
            (bool sent,) = treasury.call{value: fee}("");
            if (!sent) revert NoPayout();
        }

        emit SharesPurchased(marketId, msg.sender, isPositive, sharesBought, msg.value);
    }

    /// @notice Request resolution of a market (triggers CRE workflow)
    /// @param marketId Market to resolve
    function requestResolution(uint256 marketId) external {
        Market storage market = markets[marketId];
        if (market.status != MarketStatus.OPEN) revert MarketNotOpen();
        if (block.timestamp < market.resolutionTime) revert MarketNotResolvable();

        market.status = MarketStatus.RESOLUTION_REQUESTED;

        emit ResolutionRequested(
            marketId,
            market.proposalId,
            market.metric,
            market.targetValue
        );
    }

    // ============ CRE Callback ============

    /// @notice Receive market resolution from the CRE DON
    /// @param marketId Market being resolved
    /// @param outcome Resolution outcome (1 = POSITIVE, 2 = NEGATIVE)
    /// @param actualValue Actual environmental metric value
    /// @param proofHash Hash of resolution proof data
    function receiveReport(
        uint256 marketId,
        uint8 outcome,
        uint256 actualValue,
        bytes32 proofHash
    ) external onlyDonForwarder whenNotPaused {
        Market storage market = markets[marketId];
        if (market.status != MarketStatus.RESOLUTION_REQUESTED) revert MarketNotResolvable();

        _recordReport();

        market.status = MarketStatus.RESOLVED;
        market.outcome = Outcome(outcome);
        market.actualValue = actualValue;
        market.proofHash = proofHash;

        // SECURITY FIX (Vuln 6): Record resolution timestamp for dispute period
        marketResolvedAt[marketId] = block.timestamp;

        emit MarketResolved(marketId, Outcome(outcome), actualValue, proofHash);
    }

    /// @notice SECURITY FIX (Vuln 6): Owner can dispute a resolution within the dispute period
    /// @dev Reverts market to RESOLUTION_REQUESTED so CRE DON can re-resolve with correct data
    /// @param marketId Market to dispute
    function disputeResolution(uint256 marketId) external onlyOwner {
        Market storage market = markets[marketId];
        if (market.status != MarketStatus.RESOLVED) revert MarketNotDisputable();
        if (block.timestamp >= marketResolvedAt[marketId] + DISPUTE_PERIOD) revert DisputeWindowClosed();

        market.status = MarketStatus.RESOLUTION_REQUESTED;
        market.outcome = Outcome.UNRESOLVED;
        market.actualValue = 0;
        market.proofHash = bytes32(0);
        marketResolvedAt[marketId] = 0;
    }

    /// @notice Claim payout from a resolved market
    /// @param marketId Market to claim from
    /// @return payout Amount of ETH received
    function claimPayout(uint256 marketId) external returns (uint256 payout) {
        Market storage market = markets[marketId];
        if (market.status != MarketStatus.RESOLVED) revert MarketNotResolved();
        // SECURITY FIX (Vuln 6): Enforce dispute period before payouts
        if (block.timestamp < marketResolvedAt[marketId] + DISPUTE_PERIOD) revert DisputePeriodActive();
        if (hasClaimed[marketId][msg.sender]) revert AlreadyClaimed();

        bool isPositiveOutcome = market.outcome == Outcome.POSITIVE;
        uint256 winningShares = userShares[marketId][msg.sender][isPositiveOutcome];
        if (winningShares == 0) revert NoPayout();

        uint256 totalWinningShares = isPositiveOutcome
            ? market.totalPositiveShares
            : market.totalNegativeShares;

        // Payout proportional to winning shares
        payout = (market.totalPool * winningShares) / totalWinningShares;

        hasClaimed[marketId][msg.sender] = true;

        (bool sent,) = msg.sender.call{value: payout}("");
        if (!sent) revert NoPayout();

        emit PayoutClaimed(marketId, msg.sender, payout);
    }

    // ============ View Functions ============

    /// @notice Get market details
    function getMarket(uint256 marketId) external view returns (Market memory) {
        return markets[marketId];
    }

    /// @notice Get user's shares in a market
    function getUserShares(uint256 marketId, address user) external view returns (
        uint256 positiveShares,
        uint256 negativeShares
    ) {
        positiveShares = userShares[marketId][user][true];
        negativeShares = userShares[marketId][user][false];
    }

    /// @notice Calculate potential payout for a user
    function calculatePotentialPayout(
        uint256 marketId,
        address user,
        bool isPositive
    ) external view returns (uint256) {
        Market storage market = markets[marketId];
        uint256 shares = userShares[marketId][user][isPositive];
        if (shares == 0) return 0;

        uint256 totalShares = isPositive
            ? market.totalPositiveShares
            : market.totalNegativeShares;

        if (totalShares == 0) return 0;
        return (market.totalPool * shares) / totalShares;
    }

    /// @notice Update treasury address
    function setTreasury(address _treasury) external onlyOwner {
        if (_treasury == address(0)) revert ZeroAddress();
        treasury = _treasury;
    }

    /// @notice Receive ETH
    receive() external payable {}
}
