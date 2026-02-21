// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./R00tCREReceiver.sol";
import "../interfaces/AggregatorV3Interface.sol";

/// @title RegenProofOfReserve
/// @author r00t.fund
/// @notice Chainlink-compatible Proof of Reserve data feed for ReFi reserves (Workflow 2)
/// @dev Prize Track: DeFi & Tokenization ($20k)
///      Implements AggregatorV3Interface so any protocol can consume reserve data.
///      CRE DON reads on-chain state (ZkAMMv3Pair, ZkProjectPools) + external
///      environmental data to produce composite reserve health reports.
contract RegenProofOfReserve is R00tCREReceiver, AggregatorV3Interface {
    // ============ Structs ============

    struct ReserveReport {
        uint256 ethReserve;
        uint256 tokenReserve;
        uint256 totalTVL;        // Total value locked across all pools (in wei)
        uint256 backingRatio;    // Scaled by 1e4 (10000 = 100% backed)
        uint256 impactScore;     // Environmental impact score (0-1000)
        uint256 timestamp;
    }

    // ============ State ============

    /// @notice Current round ID (incremented with each report)
    uint80 public currentRoundId;

    /// @notice Reports by round ID
    mapping(uint80 => ReserveReport) public reserveReports;

    /// @notice Latest report for quick access
    ReserveReport public latestReport;

    // ============ Events ============

    event ReserveReportUpdated(
        uint80 indexed roundId,
        uint256 totalTVL,
        uint256 backingRatio,
        uint256 impactScore,
        uint256 timestamp
    );

    // ============ Constructor ============

    constructor(
        address _donForwarder,
        address _owner
    ) R00tCREReceiver(_donForwarder, _owner) {}

    // ============ CRE Callback ============

    /// @notice Receive a Proof of Reserve report from the CRE DON
    /// @param ethReserve Aggregated ETH reserves across all pools
    /// @param tokenReserve Aggregated token reserves
    /// @param totalTVL Total value locked in wei
    /// @param backingRatio Reserve backing ratio (scaled by 1e4)
    /// @param impactScore Environmental impact score (0-1000)
    function receiveReport(
        uint256 ethReserve,
        uint256 tokenReserve,
        uint256 totalTVL,
        uint256 backingRatio,
        uint256 impactScore
    ) external onlyDonForwarder whenNotPaused {
        _recordReport();
        currentRoundId++;

        ReserveReport memory report = ReserveReport({
            ethReserve: ethReserve,
            tokenReserve: tokenReserve,
            totalTVL: totalTVL,
            backingRatio: backingRatio,
            impactScore: impactScore,
            timestamp: block.timestamp
        });

        reserveReports[currentRoundId] = report;
        latestReport = report;

        emit ReserveReportUpdated(
            currentRoundId,
            totalTVL,
            backingRatio,
            impactScore,
            block.timestamp
        );
    }

    // ============ AggregatorV3Interface Implementation ============

    /// @notice Returns 18 decimals for TVL reporting in wei
    function decimals() external pure override returns (uint8) {
        return 18;
    }

    /// @notice Description of this data feed
    function description() external pure override returns (string memory) {
        return "R00t.fund Regenerative Proof of Reserve - TVL";
    }

    /// @notice Version of the aggregator
    function version() external pure override returns (uint256) {
        return 1;
    }

    /// @notice Get data for a specific round
    function getRoundData(uint80 _roundId) external view override returns (
        uint80 roundId,
        int256 answer,
        uint256 startedAt,
        uint256 updatedAt,
        uint80 answeredInRound
    ) {
        ReserveReport storage report = reserveReports[_roundId];
        return (
            _roundId,
            int256(report.totalTVL),
            report.timestamp,
            report.timestamp,
            _roundId
        );
    }

    /// @notice Get the latest round data (Chainlink-compatible)
    function latestRoundData() external view override returns (
        uint80 roundId,
        int256 answer,
        uint256 startedAt,
        uint256 updatedAt,
        uint80 answeredInRound
    ) {
        return (
            currentRoundId,
            int256(latestReport.totalTVL),
            latestReport.timestamp,
            latestReport.timestamp,
            currentRoundId
        );
    }

    // ============ Extended View Functions ============

    /// @notice Get the full reserve health data
    function getReserveHealth() external view returns (
        uint256 ethReserve,
        uint256 tokenReserve,
        uint256 backingRatio,
        uint256 impactScore
    ) {
        return (
            latestReport.ethReserve,
            latestReport.tokenReserve,
            latestReport.backingRatio,
            latestReport.impactScore
        );
    }

    /// @notice Get the total TVL
    function getTotalTVL() external view returns (uint256) {
        return latestReport.totalTVL;
    }

    /// @notice Get the impact score
    function getImpactScore() external view returns (uint256) {
        return latestReport.impactScore;
    }
}
