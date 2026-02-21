/**
 * Workflow 5: Protocol Health Monitor
 * Prize Track: Risk & Compliance ($16k)
 *
 * CRE Workflow that reads extensive on-chain state from ZkAMMv3Pair, R00TShorts,
 * and NullifierRegistry to compute composite risk scores and push health reports
 * on-chain. Supports automated circuit breaker triggers.
 *
 * Trigger: CronCapability (every 60 seconds)
 * Capabilities: EVMClient, ConfidentialHTTPClient (optional sanctions screening)
 */

import {
  type CRERuntime,
  type EVMClient,
  type ConfidentialHTTPClient,
  handler,
  consensusIdenticalAggregation,
} from "@chainlink/cre-sdk";
import { encodeAbiParameters, parseAbiParameters } from "viem";
import { ZkAMMv3PairABI } from "../contracts/abi/ZkAMMv3Pair.js";
import { R00TShortsABI } from "../contracts/abi/R00TShorts.js";
import { ProtocolHealthMonitorABI } from "../contracts/abi/ProtocolHealthMonitor.js";

// ============ Configuration ============

const SEPOLIA_CHAIN_ID = 11155111;

// Contract addresses (populated from config)
const ZKAMM_PAIR = process.env.ZKAMM_PAIR_ADDRESS ?? "0x";
const R00T_SHORTS = process.env.R00T_SHORTS_ADDRESS ?? "0x";
const HEALTH_MONITOR = process.env.PROTOCOL_HEALTH_MONITOR_ADDRESS ?? "0x";

// Risk thresholds (scaled by 1e4, 10000 = 100%)
const RESERVE_RATIO_WARNING = 12000; // 120%
const RESERVE_RATIO_CRITICAL = 10500; // 105%
const SHORTS_UTIL_WARNING = 7000; // 70%
const SHORTS_UTIL_CRITICAL = 9000; // 90%

// Risk levels
enum RiskLevel {
  LOW = 0,
  MODERATE = 1,
  ELEVATED = 2,
  HIGH = 3,
  CRITICAL = 4,
}

// Recommended actions
enum RecommendedAction {
  NONE = 0,
  MONITOR = 1,
  REDUCE_EXPOSURE = 2,
  PAUSE_NEW_POSITIONS = 3,
  EMERGENCY_PAUSE = 4,
}

// ============ Workflow Handler ============

export default handler(
  {
    triggers: [{ type: "cron", schedule: "* * * * *" }],
    consensus: consensusIdenticalAggregation(),
  },
  async (runtime: CRERuntime) => {
    const evmClient: EVMClient = runtime.getEVMClient(SEPOLIA_CHAIN_ID);

    // ---- Step 1: Read ZkAMMv3Pair state ----
    const [ethReserve, tokenReserve, totalLPShares, protocolFees, lpFees] =
      await Promise.all([
        evmClient.callContract({
          address: ZKAMM_PAIR as `0x${string}`,
          abi: ZkAMMv3PairABI,
          functionName: "ethReserve",
        }),
        evmClient.callContract({
          address: ZKAMM_PAIR as `0x${string}`,
          abi: ZkAMMv3PairABI,
          functionName: "tokenReserve",
        }),
        evmClient.callContract({
          address: ZKAMM_PAIR as `0x${string}`,
          abi: ZkAMMv3PairABI,
          functionName: "totalLPShares",
        }),
        evmClient.callContract({
          address: ZKAMM_PAIR as `0x${string}`,
          abi: ZkAMMv3PairABI,
          functionName: "accumulatedProtocolFees",
        }),
        evmClient.callContract({
          address: ZKAMM_PAIR as `0x${string}`,
          abi: ZkAMMv3PairABI,
          functionName: "accumulatedLPFees",
        }),
      ]);

    // ---- Step 2: Read R00TShorts state ----
    const [totalOpenInterest, totalCollateralLocked, openPositionCount] =
      await Promise.all([
        evmClient.callContract({
          address: R00T_SHORTS as `0x${string}`,
          abi: R00TShortsABI,
          functionName: "totalOpenInterest",
        }),
        evmClient.callContract({
          address: R00T_SHORTS as `0x${string}`,
          abi: R00TShortsABI,
          functionName: "totalCollateralLocked",
        }),
        evmClient.callContract({
          address: R00T_SHORTS as `0x${string}`,
          abi: R00TShortsABI,
          functionName: "openPositionCount",
        }),
      ]);

    // ---- Step 3: Compute risk metrics ----

    // Reserve ratio: ethReserve / (protocolFees + lpFees) as percentage
    const ethReserveNum = Number(ethReserve);
    const tokenReserveNum = Number(tokenReserve);
    const totalFeesNum = Number(protocolFees) + Number(lpFees);
    const totalOINum = Number(totalOpenInterest);

    // Reserve ratio (how much ETH backs obligations)
    const reserveRatio =
      totalFeesNum > 0
        ? Math.floor((ethReserveNum * 10000) / totalFeesNum)
        : 50000; // 500% if no obligations

    // Shorts utilization: totalOpenInterest / tokenReserve
    const shortsUtilization =
      tokenReserveNum > 0
        ? Math.floor((totalOINum * 10000) / tokenReserveNum)
        : 0;

    // ---- Step 4: Compute overall risk level ----
    let riskScore = 0;

    // Reserve ratio scoring
    if (reserveRatio < RESERVE_RATIO_CRITICAL) riskScore += 40;
    else if (reserveRatio < RESERVE_RATIO_WARNING) riskScore += 20;

    // Shorts utilization scoring
    if (shortsUtilization > SHORTS_UTIL_CRITICAL) riskScore += 40;
    else if (shortsUtilization > SHORTS_UTIL_WARNING) riskScore += 20;

    // LP health scoring
    const totalLPNum = Number(totalLPShares);
    if (totalLPNum === 0 && ethReserveNum > 0) riskScore += 20;

    // Map score to risk level
    let overallRiskLevel: RiskLevel;
    let recommendedAction: RecommendedAction;

    if (riskScore >= 80) {
      overallRiskLevel = RiskLevel.CRITICAL;
      recommendedAction = RecommendedAction.EMERGENCY_PAUSE;
    } else if (riskScore >= 60) {
      overallRiskLevel = RiskLevel.HIGH;
      recommendedAction = RecommendedAction.PAUSE_NEW_POSITIONS;
    } else if (riskScore >= 40) {
      overallRiskLevel = RiskLevel.ELEVATED;
      recommendedAction = RecommendedAction.REDUCE_EXPOSURE;
    } else if (riskScore >= 20) {
      overallRiskLevel = RiskLevel.MODERATE;
      recommendedAction = RecommendedAction.MONITOR;
    } else {
      overallRiskLevel = RiskLevel.LOW;
      recommendedAction = RecommendedAction.NONE;
    }

    // ---- Step 5: Encode and push report on-chain ----
    const reportData = encodeAbiParameters(
      parseAbiParameters(
        "uint256, uint256, uint256, uint256, uint8, uint8"
      ),
      [
        BigInt(ethReserveNum),
        BigInt(tokenReserveNum),
        BigInt(reserveRatio),
        BigInt(shortsUtilization),
        overallRiskLevel,
        recommendedAction,
      ]
    );

    runtime.log(
      `Health Report: reserveRatio=${reserveRatio}, shortsUtil=${shortsUtilization}, ` +
        `risk=${RiskLevel[overallRiskLevel]}, action=${RecommendedAction[recommendedAction]}, ` +
        `positions=${openPositionCount}`
    );

    const report = runtime.report(reportData);

    await evmClient.writeReport(report, {
      address: HEALTH_MONITOR as `0x${string}`,
      abi: ProtocolHealthMonitorABI,
      functionName: "receiveReport",
      args: [
        BigInt(ethReserveNum),
        BigInt(tokenReserveNum),
        BigInt(reserveRatio),
        BigInt(shortsUtilization),
        overallRiskLevel,
        recommendedAction,
      ],
    });

    return report;
  }
);
