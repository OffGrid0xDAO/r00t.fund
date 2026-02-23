// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./R00tCREReceiver.sol";
import "../interfaces/AggregatorV3Interface.sol";

/// @title SerraEstrelaNativeForest
/// @author r00t.fund
/// @notice Chainlink-compatible data feed for Serra da Estrela native forest restoration
/// @dev Custom CRE Data Feed monitoring post-2025 fire reforestation.
///
///      Real Project:
///      - Location: 40.3228°N, 7.6114°W — Serra da Estrela Natural Park, Seia, Portugal
///      - Area: 9 hectares (90,000 m²)
///      - Species: Quercus robur, Q. pyrenaica, Castanea sativa, Crataegus monogyna,
///                 Prunus spinosa, Arbutus unedo, Fraxinus angustifolia
///      - Total trees: 2,550 native specimens
///      - Fire date: September 2025 | Planting target: Spring 2026 (pending funding)
///      - ICNF Reference: PRRF-SE-2025-0042
///
///      Data Feed publishes:
///      - NDVI recovery trajectory (Copernicus Sentinel-2)
///      - dNBR fire scar severity (Sentinel-2 SWIR)
///      - Soil organic carbon (ISRIC SoilGrids)
///      - Tree survival estimates
///      - Carbon sequestration (tCO2e/year)
///      - Fire Recovery Index (composite 0-1000)
///
///      Implements AggregatorV3Interface so any Chainlink consumer can read the
///      Fire Recovery Index as a standard price feed (1000 = fully recovered).
contract SerraEstrelaNativeForest is R00tCREReceiver, AggregatorV3Interface {
    // ============ Structs ============

    /// @notice Full restoration report from CRE DON
    struct RestorationReport {
        int256 ndviCurrent;          // Current NDVI × 10000 (signed: can be negative early post-fire)
        int256 ndviPreFire;          // Pre-fire NDVI × 10000 (reference baseline)
        uint256 ndviRecoveryPct;     // Recovery towards pre-fire (% × 100)
        int256 dnbr;                 // dNBR × 10000 (positive = still burned, negative = recovered)
        uint256 soilOrganicCarbon;   // SOC in tonnes C/ha × 100
        uint256 estimatedLiveTrees;  // Number of trees estimated alive
        uint256 annualCO2;           // Annual CO2 sequestration in kg (tCO2e × 1000)
        uint256 carbonCredits;       // Carbon credits eligible (tCO2e × 1000)
        uint256 fireRecoveryIndex;   // Composite score 0-1000
        uint256 timestamp;
    }

    // ============ Constants ============

    /// @notice Total trees planted
    uint256 public constant TOTAL_TREES_PLANTED = 2550;

    /// @notice Project area in hectares × 100 (for precision)
    uint256 public constant AREA_HECTARES_X100 = 900;

    /// @notice Project latitude × 10000
    int256 public constant PROJECT_LAT = 403228;

    /// @notice Project longitude × 10000
    int256 public constant PROJECT_LON = -76114;

    // ============ State ============

    /// @notice All restoration reports by round ID
    mapping(uint80 => RestorationReport) public reports;

    /// @notice Current round ID (increments with each report)
    uint80 public currentRoundId;

    /// @notice Latest fire recovery index (0-1000)
    uint256 public latestFireRecoveryIndex;

    /// @notice Peak NDVI observed since planting
    int256 public peakNdvi;

    /// @notice Cumulative carbon credits issued (tCO2e × 1000)
    uint256 public cumulativeCarbonCredits;

    /// @notice Highest tree survival count observed
    uint256 public peakLiveTrees;

    // ============ Events ============

    event RestorationReportPublished(
        uint80 indexed roundId,
        int256 ndviCurrent,
        uint256 ndviRecoveryPct,
        uint256 estimatedLiveTrees,
        uint256 annualCO2,
        uint256 carbonCredits,
        uint256 fireRecoveryIndex,
        uint256 timestamp
    );

    event MilestoneReached(
        string milestone,
        uint256 value,
        uint256 timestamp
    );

    // ============ Constructor ============

    constructor(
        address _donForwarder,
        address _owner
    ) R00tCREReceiver(_donForwarder, _owner) {}

    // ============ CRE Callback — Data Feed Update ============

    /// @notice Receive a restoration data report from CRE DON
    function receiveReport(
        int256 ndviCurrent,
        int256 ndviPreFire,
        uint256 ndviRecoveryPct,
        int256 dnbr,
        uint256 soilOrganicCarbon,
        uint256 estimatedLiveTrees,
        uint256 annualCO2,
        uint256 carbonCredits,
        uint256 fireRecoveryIndex
    ) external onlyDonForwarder whenNotPaused {
        _recordReport();

        currentRoundId++;
        uint80 roundId = currentRoundId;

        reports[roundId] = RestorationReport({
            ndviCurrent: ndviCurrent,
            ndviPreFire: ndviPreFire,
            ndviRecoveryPct: ndviRecoveryPct,
            dnbr: dnbr,
            soilOrganicCarbon: soilOrganicCarbon,
            estimatedLiveTrees: estimatedLiveTrees,
            annualCO2: annualCO2,
            carbonCredits: carbonCredits,
            fireRecoveryIndex: fireRecoveryIndex,
            timestamp: block.timestamp
        });

        latestFireRecoveryIndex = fireRecoveryIndex;

        // Track records
        if (ndviCurrent > peakNdvi) {
            peakNdvi = ndviCurrent;
        }
        if (estimatedLiveTrees > peakLiveTrees) {
            peakLiveTrees = estimatedLiveTrees;
        }
        cumulativeCarbonCredits += carbonCredits;

        emit RestorationReportPublished(
            roundId,
            ndviCurrent,
            ndviRecoveryPct,
            estimatedLiveTrees,
            annualCO2,
            carbonCredits,
            fireRecoveryIndex,
            block.timestamp
        );

        // Milestone events
        if (ndviRecoveryPct >= 5000 && roundId > 1) { // 50% recovery
            RestorationReport storage prev = reports[roundId - 1];
            if (prev.ndviRecoveryPct < 5000) {
                emit MilestoneReached("50% NDVI Recovery", ndviRecoveryPct, block.timestamp);
            }
        }

        if (fireRecoveryIndex >= 500 && roundId > 1) { // Recovery Index > 500
            RestorationReport storage prev2 = reports[roundId - 1];
            if (prev2.fireRecoveryIndex < 500) {
                emit MilestoneReached("Fire Recovery Index > 500", fireRecoveryIndex, block.timestamp);
            }
        }
    }

    // ============ AggregatorV3Interface (Chainlink-compatible) ============

    /// @notice Returns the Fire Recovery Index as the "price" (0-1000)
    function latestRoundData() external view override returns (
        uint80 roundId,
        int256 answer,
        uint256 startedAt,
        uint256 updatedAt,
        uint80 answeredInRound
    ) {
        RestorationReport storage report = reports[currentRoundId];
        return (
            currentRoundId,
            int256(report.fireRecoveryIndex), // Fire Recovery Index as "price"
            report.timestamp,
            report.timestamp,
            currentRoundId
        );
    }

    function getRoundData(uint80 _roundId) external view override returns (
        uint80 roundId,
        int256 answer,
        uint256 startedAt,
        uint256 updatedAt,
        uint80 answeredInRound
    ) {
        RestorationReport storage report = reports[_roundId];
        return (
            _roundId,
            int256(report.fireRecoveryIndex),
            report.timestamp,
            report.timestamp,
            _roundId
        );
    }

    function decimals() external pure override returns (uint8) {
        return 0; // Fire Recovery Index is integer 0-1000
    }

    function description() external pure override returns (string memory) {
        return "Serra da Estrela Native Forest Restoration / Fire Recovery Index";
    }

    function version() external pure override returns (uint256) {
        return 1;
    }

    // ============ Extended View Functions ============

    /// @notice Get the full latest restoration report
    function getLatestReport() external view returns (RestorationReport memory) {
        return reports[currentRoundId];
    }

    /// @notice Get a specific round's report
    function getReport(uint80 roundId) external view returns (RestorationReport memory) {
        return reports[roundId];
    }

    /// @notice Get current NDVI recovery percentage
    function getNdviRecoveryPct() external view returns (uint256) {
        return reports[currentRoundId].ndviRecoveryPct;
    }

    /// @notice Get estimated live trees
    function getEstimatedLiveTrees() external view returns (uint256) {
        return reports[currentRoundId].estimatedLiveTrees;
    }

    /// @notice Get tree survival rate (% × 100)
    function getTreeSurvivalRate() external view returns (uint256) {
        uint256 live = reports[currentRoundId].estimatedLiveTrees;
        if (live == 0) return 0;
        return (live * 10000) / TOTAL_TREES_PLANTED;
    }

    /// @notice Get annual carbon sequestration (tCO2e × 1000)
    function getAnnualCO2() external view returns (uint256) {
        return reports[currentRoundId].annualCO2;
    }

    /// @notice Get carbon credits eligible for issuance (tCO2e × 1000)
    function getCarbonCredits() external view returns (uint256) {
        return reports[currentRoundId].carbonCredits;
    }

    /// @notice Get cumulative carbon credits across all reports
    function getCumulativeCarbonCredits() external view returns (uint256) {
        return cumulativeCarbonCredits;
    }

    /// @notice Get fire recovery index (0-1000)
    function getFireRecoveryIndex() external view returns (uint256) {
        return latestFireRecoveryIndex;
    }

    /// @notice Get project summary
    function getProjectSummary() external view returns (
        uint256 totalTreesPlanted,
        uint256 estimatedLiveTrees,
        uint256 survivalRatePct,
        uint256 fireRecoveryIndex,
        uint256 ndviRecoveryPct,
        uint256 annualCO2Kg,
        uint256 totalReports,
        uint256 lastUpdateTimestamp
    ) {
        RestorationReport storage latest = reports[currentRoundId];
        uint256 live = latest.estimatedLiveTrees;
        return (
            TOTAL_TREES_PLANTED,
            live,
            live > 0 ? (live * 10000) / TOTAL_TREES_PLANTED : 0,
            latest.fireRecoveryIndex,
            latest.ndviRecoveryPct,
            latest.annualCO2,
            uint256(currentRoundId),
            latest.timestamp
        );
    }
}
