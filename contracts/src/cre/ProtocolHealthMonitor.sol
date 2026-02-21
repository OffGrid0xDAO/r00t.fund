// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./R00tCREReceiver.sol";

/// @title ProtocolHealthMonitor
/// @author r00t.fund
/// @notice CRE callback contract for real-time protocol risk monitoring (Workflow 5)
/// @dev Prize Track: Risk & Compliance ($16k)
///      Receives health reports from the CRE DON that read ZkAMMv3Pair, R00TShorts,
///      and NullifierRegistry state. Computes composite risk scores and can trigger
///      emergency circuit breakers when risk exceeds thresholds.
contract ProtocolHealthMonitor is R00tCREReceiver {
    // ============ Enums ============

    /// @notice Risk levels (0-4 scale)
    enum RiskLevel { LOW, MODERATE, ELEVATED, HIGH, CRITICAL }

    /// @notice Recommended actions
    enum RecommendedAction { NONE, MONITOR, REDUCE_EXPOSURE, PAUSE_NEW_POSITIONS, EMERGENCY_PAUSE }

    // ============ Structs ============

    struct HealthReport {
        uint256 ethReserve;
        uint256 tokenReserve;
        uint256 reserveRatio;        // Scaled by 1e4 (10000 = 100%)
        uint256 shortsUtilization;   // Scaled by 1e4
        RiskLevel overallRiskLevel;
        RecommendedAction recommendedAction;
        uint256 timestamp;
    }

    // ============ State ============

    /// @notice Latest health report
    HealthReport public latestHealthReport;

    /// @notice Historical reports by index
    mapping(uint256 => HealthReport) public reports;

    /// @notice Whether automatic circuit breaker is enabled
    bool public autoCircuitBreakerEnabled;

    /// @notice Risk level threshold for circuit breaker (default: CRITICAL)
    RiskLevel public circuitBreakerThreshold;

    /// @notice ZkAMMv3Admin address for emergency actions
    address public zkAMMAdmin;

    /// @notice Alert threshold for emitting RiskAlert events
    RiskLevel public riskAlertThreshold;

    // ============ Events ============

    event HealthReportPublished(
        uint256 indexed reportIndex,
        RiskLevel overallRiskLevel,
        uint256 reserveRatio,
        uint256 shortsUtilization,
        uint256 timestamp
    );

    event RiskAlert(
        uint256 indexed reportIndex,
        RiskLevel riskLevel,
        RecommendedAction recommendedAction,
        uint256 timestamp
    );

    event CircuitBreakerTriggered(
        uint256 indexed reportIndex,
        RiskLevel riskLevel,
        uint256 timestamp
    );

    event CircuitBreakerConfigUpdated(bool enabled, RiskLevel threshold);
    event ZkAMMAdminUpdated(address indexed oldAdmin, address indexed newAdmin);

    // ============ Constructor ============

    constructor(
        address _donForwarder,
        address _owner,
        address _zkAMMAdmin
    ) R00tCREReceiver(_donForwarder, _owner) {
        zkAMMAdmin = _zkAMMAdmin;
        circuitBreakerThreshold = RiskLevel.CRITICAL;
        riskAlertThreshold = RiskLevel.ELEVATED;
    }

    // ============ CRE Callback ============

    /// @notice Receive a health report from the CRE DON
    /// @param ethReserve Current ETH reserve in ZkAMMv3Pair
    /// @param tokenReserve Current token reserve in ZkAMMv3Pair
    /// @param reserveRatio Reserve health ratio (scaled by 1e4)
    /// @param shortsUtilization Shorts utilization percentage (scaled by 1e4)
    /// @param overallRiskLevel Composite risk level (0-4)
    /// @param recommendedAction Recommended protocol action (0-4)
    function receiveReport(
        uint256 ethReserve,
        uint256 tokenReserve,
        uint256 reserveRatio,
        uint256 shortsUtilization,
        uint8 overallRiskLevel,
        uint8 recommendedAction
    ) external onlyDonForwarder whenNotPaused {
        _recordReport();

        RiskLevel risk = RiskLevel(overallRiskLevel);
        RecommendedAction action = RecommendedAction(recommendedAction);

        HealthReport memory report = HealthReport({
            ethReserve: ethReserve,
            tokenReserve: tokenReserve,
            reserveRatio: reserveRatio,
            shortsUtilization: shortsUtilization,
            overallRiskLevel: risk,
            recommendedAction: action,
            timestamp: block.timestamp
        });

        latestHealthReport = report;
        reports[reportCount] = report;

        emit HealthReportPublished(
            reportCount,
            risk,
            reserveRatio,
            shortsUtilization,
            block.timestamp
        );

        // Emit risk alert if threshold exceeded
        if (uint8(risk) >= uint8(riskAlertThreshold)) {
            emit RiskAlert(reportCount, risk, action, block.timestamp);
        }

        // Auto circuit breaker
        if (autoCircuitBreakerEnabled && uint8(risk) >= uint8(circuitBreakerThreshold)) {
            emit CircuitBreakerTriggered(reportCount, risk, block.timestamp);
            // Note: actual emergency pause requires calling ZkAMMv3Admin
            // which needs proper authorization (emergency signer multisig)
        }
    }

    // ============ View Functions ============

    /// @notice Get the latest health report
    function getLatestReport() external view returns (HealthReport memory) {
        return latestHealthReport;
    }

    /// @notice Get a specific report by index
    function getReport(uint256 index) external view returns (HealthReport memory) {
        return reports[index];
    }

    /// @notice Check if the protocol is in a healthy state
    function isHealthy() external view returns (bool) {
        return uint8(latestHealthReport.overallRiskLevel) <= uint8(RiskLevel.MODERATE);
    }

    /// @notice Get the current risk level
    function getCurrentRiskLevel() external view returns (RiskLevel) {
        return latestHealthReport.overallRiskLevel;
    }

    // ============ Admin Functions ============

    /// @notice Configure the circuit breaker
    function setCircuitBreaker(bool _enabled, uint8 _threshold) external onlyOwner {
        autoCircuitBreakerEnabled = _enabled;
        circuitBreakerThreshold = RiskLevel(_threshold);
        emit CircuitBreakerConfigUpdated(_enabled, RiskLevel(_threshold));
    }

    /// @notice Update ZkAMM admin address
    function setZkAMMAdmin(address _zkAMMAdmin) external onlyOwner {
        if (_zkAMMAdmin == address(0)) revert ZeroAddress();
        address old = zkAMMAdmin;
        zkAMMAdmin = _zkAMMAdmin;
        emit ZkAMMAdminUpdated(old, _zkAMMAdmin);
    }

    /// @notice Set the risk alert threshold
    function setRiskAlertThreshold(uint8 _threshold) external onlyOwner {
        riskAlertThreshold = RiskLevel(_threshold);
    }
}
