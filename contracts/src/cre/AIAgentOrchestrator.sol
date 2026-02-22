// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./R00tCREReceiver.sol";

/// @title AIAgentOrchestrator
/// @author r00t.fund
/// @notice CRE callback contract for AI-assisted strategy recommendations (Workflow 3)
/// @dev Prize Track: CRE & AI ($17k)
///      CRE DON reads market state, calls LLM via ConfidentialHTTPClient, and pushes
///      AI-generated strategy recommendations on-chain. Trading agents read from this
///      contract before executing trades.
contract AIAgentOrchestrator is R00tCREReceiver {
    // ============ Enums ============

    /// @notice AI-assessed risk levels
    enum RiskLevel { LOW, MODERATE, HIGH, EXTREME }

    /// @notice AI-recommended trading actions
    enum TradingAction { HOLD, BUY, SELL, HEDGE, REDUCE_EXPOSURE }

    /// @notice Governance vote recommendation
    enum VoteRecommendation { ABSTAIN, VOTE_FOR, VOTE_AGAINST }

    // ============ Structs ============

    struct MarketAnalysis {
        uint256 timestamp;
        RiskLevel riskLevel;
        TradingAction recommendedAction;
        bytes32 analysisHash;      // IPFS/hash of full analysis text
        bytes strategyData;        // Encoded strategy parameters
    }

    struct GovernanceAdvisory {
        uint256 proposalId;
        VoteRecommendation recommendation;
        uint256 confidence;        // 0-10000 (basis points, 10000 = 100%)
        bytes32 reasoningHash;     // IPFS/hash of reasoning text
        uint256 timestamp;
    }

    // ============ State ============

    /// @notice Latest market analysis
    MarketAnalysis public latestAnalysis;

    /// @notice Historical analyses by index
    mapping(uint256 => MarketAnalysis) public analyses;

    /// @notice Total market analyses received
    uint256 public analysisCount;

    /// @notice Governance advisories by proposal ID
    mapping(uint256 => GovernanceAdvisory) public governanceAdvisories;

    /// @notice List of proposal IDs with advisories
    uint256[] public advisedProposalIds;

    // ============ Events ============

    event AIStrategyUpdate(
        uint256 indexed analysisIndex,
        RiskLevel riskLevel,
        TradingAction recommendedAction,
        bytes32 analysisHash,
        uint256 timestamp
    );

    event AIGovernanceAdvisory(
        uint256 indexed proposalId,
        VoteRecommendation recommendation,
        uint256 confidence,
        uint256 timestamp
    );

    // ============ Constructor ============

    constructor(
        address _donForwarder,
        address _owner
    ) R00tCREReceiver(_donForwarder, _owner) {}

    // ============ CRE Callbacks ============

    /// @notice Receive a market analysis report from the CRE DON
    /// @param riskLevel AI-assessed risk level (0-3)
    /// @param recommendedAction Recommended trading action (0-4)
    /// @param analysisHash Hash of the full analysis text
    /// @param strategyData Encoded strategy parameters for trading agents
    function receiveReport(
        uint8 riskLevel,
        uint8 recommendedAction,
        bytes32 analysisHash,
        bytes calldata strategyData
    ) external onlyDonForwarder whenNotPaused {
        _recordReport();
        analysisCount++;

        MarketAnalysis memory analysis = MarketAnalysis({
            timestamp: block.timestamp,
            riskLevel: RiskLevel(riskLevel),
            recommendedAction: TradingAction(recommendedAction),
            analysisHash: analysisHash,
            strategyData: strategyData
        });

        latestAnalysis = analysis;
        analyses[analysisCount] = analysis;

        emit AIStrategyUpdate(
            analysisCount,
            RiskLevel(riskLevel),
            TradingAction(recommendedAction),
            analysisHash,
            block.timestamp
        );
    }

    /// @notice Receive a governance advisory from the CRE DON
    /// @param proposalId LaunchpadGovernance proposal ID
    /// @param recommendation Vote recommendation (0-2)
    /// @param confidence Confidence level (0-10000)
    /// @param reasoningHash Hash of reasoning text
    function receiveGovernanceAdvisory(
        uint256 proposalId,
        uint8 recommendation,
        uint256 confidence,
        bytes32 reasoningHash
    ) external onlyDonForwarder whenNotPaused {
        _recordReport();

        GovernanceAdvisory memory advisory = GovernanceAdvisory({
            proposalId: proposalId,
            recommendation: VoteRecommendation(recommendation),
            confidence: confidence,
            reasoningHash: reasoningHash,
            timestamp: block.timestamp
        });

        // Track if this is a new proposal
        if (governanceAdvisories[proposalId].timestamp == 0) {
            advisedProposalIds.push(proposalId);
        }

        governanceAdvisories[proposalId] = advisory;

        emit AIGovernanceAdvisory(
            proposalId,
            VoteRecommendation(recommendation),
            confidence,
            block.timestamp
        );
    }

    // ============ View Functions ============

    /// @notice Get the latest AI market analysis
    function getLatestAnalysis() external view returns (MarketAnalysis memory) {
        return latestAnalysis;
    }

    /// @notice Get a specific analysis by index
    function getAnalysis(uint256 index) external view returns (MarketAnalysis memory) {
        return analyses[index];
    }

    /// @notice Get governance advisory for a proposal
    function getGovernanceAdvisory(uint256 proposalId) external view returns (GovernanceAdvisory memory) {
        return governanceAdvisories[proposalId];
    }

    /// @notice Get all proposal IDs that have advisories
    function getAdvisedProposalIds() external view returns (uint256[] memory) {
        return advisedProposalIds;
    }

    /// @notice Check if AI recommends holding (safe for agents)
    function isSafeToTrade() external view returns (bool) {
        return uint8(latestAnalysis.riskLevel) <= uint8(RiskLevel.MODERATE);
    }
}
