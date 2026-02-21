/**
 * Workflow 4: Regenerative Outcome Markets
 * Prize Track: Prediction Markets ($16k)
 *
 * CRE-automated prediction market settlement using environmental outcome data.
 * Listens for ResolutionRequested events, fetches outcome data from multiple APIs,
 * achieves consensus via median, and resolves markets on-chain.
 *
 * Trigger: EVMClient.logTrigger on ResolutionRequested + CronCapability
 * Capabilities: HTTPClient, EVMClient, ConsensusAggregationByFields
 */

import {
  type CRERuntime,
  type EVMClient,
  type HTTPClient,
  handler,
  consensusMedianAggregation,
} from "@chainlink/cre-sdk";
import { encodeAbiParameters, parseAbiParameters, keccak256, toBytes } from "viem";
import { RegenPredictionMarketABI } from "../contracts/abi/RegenPredictionMarket.js";

// ============ Configuration ============

const SEPOLIA_CHAIN_ID = 11155111;
const PREDICTION_MARKET = process.env.REGEN_PREDICTION_MARKET_ADDRESS ?? "0x";

// Environmental data sources
const ENVIRONMENTAL_SOURCES = [
  {
    name: "Gold Standard",
    url: "https://api.goldstandard.org/v1/projects",
    parseValue: (data: Record<string, unknown>) =>
      (data as { metrics?: { value?: number } }).metrics?.value ?? 0,
  },
  {
    name: "Verra Registry",
    url: "https://registry.verra.org/api/v1/credits",
    parseValue: (data: Record<string, unknown>) =>
      (data as { total_credits?: number }).total_credits ?? 0,
  },
  {
    name: "Environmental Monitor",
    url: "https://api.environmentaldata.org/v1/metrics",
    parseValue: (data: Record<string, unknown>) =>
      (data as { measurement?: number }).measurement ?? 0,
  },
];

// Outcome enum (matches contract)
enum Outcome {
  UNRESOLVED = 0,
  POSITIVE = 1,
  NEGATIVE = 2,
}

// ============ Workflow Handler ============

export default handler(
  {
    triggers: [
      {
        type: "evmLogTrigger",
        address: PREDICTION_MARKET,
        event: "ResolutionRequested(uint256,uint256,string,uint256)",
        chainId: SEPOLIA_CHAIN_ID,
      },
      { type: "cron", schedule: "*/10 * * * *" },
    ],
    consensus: consensusMedianAggregation({
      fields: ["actualValue"],
    }),
  },
  async (runtime: CRERuntime) => {
    const evmClient: EVMClient = runtime.getEVMClient(SEPOLIA_CHAIN_ID);
    const httpClient: HTTPClient = runtime.getHTTPClient();

    // ---- Step 1: Get the trigger data (log event or cron) ----
    const trigger = runtime.getTriggerData();

    let marketId: bigint;
    let proposalId: bigint;
    let metric: string;
    let targetValue: bigint;

    if (trigger.type === "evmLogTrigger") {
      // Extract from event log
      const log = trigger.log;
      marketId = log.args.marketId as bigint;
      proposalId = log.args.proposalId as bigint;
      metric = log.args.metric as string;
      targetValue = log.args.targetValue as bigint;
    } else {
      // Cron trigger — check for any pending resolutions
      // In production, would scan recent ResolutionRequested events
      runtime.log("Cron trigger — checking for pending market resolutions");
      return runtime.report(encodeAbiParameters(parseAbiParameters("uint8"), [0]));
    }

    runtime.log(
      `Resolving market ${marketId}: proposalId=${proposalId}, ` +
        `metric=${metric}, target=${targetValue}`
    );

    // ---- Step 2: Fetch environmental outcome data from multiple sources ----
    const fetchPromises = ENVIRONMENTAL_SOURCES.map(async (source) => {
      try {
        const response = await httpClient.fetch(
          `${source.url}?metric=${encodeURIComponent(metric)}&proposalId=${proposalId}`,
          {
            method: "GET",
            headers: { Accept: "application/json" },
          }
        );
        const data = JSON.parse(response.body);
        const value = source.parseValue(data);
        runtime.log(`${source.name}: value=${value}`);
        return value;
      } catch (e) {
        runtime.log(`${source.name} fetch failed: ${e}`);
        return null;
      }
    });

    const results = await Promise.all(fetchPromises);
    const validResults = results.filter((r): r is number => r !== null && r > 0);

    if (validResults.length === 0) {
      runtime.log("No valid data sources responded — skipping resolution");
      return runtime.report(
        encodeAbiParameters(parseAbiParameters("uint8"), [0])
      );
    }

    // ---- Step 3: Compute median value across sources ----
    validResults.sort((a, b) => a - b);
    const medianIndex = Math.floor(validResults.length / 2);
    const actualValue =
      validResults.length % 2 === 0
        ? Math.floor((validResults[medianIndex - 1] + validResults[medianIndex]) / 2)
        : validResults[medianIndex];

    runtime.log(
      `Median outcome value: ${actualValue} (from ${validResults.length} sources)`
    );

    // ---- Step 4: Determine outcome ----
    const outcome =
      BigInt(actualValue) >= targetValue ? Outcome.POSITIVE : Outcome.NEGATIVE;

    runtime.log(
      `Outcome: ${Outcome[outcome]} (actual=${actualValue} vs target=${targetValue})`
    );

    // ---- Step 5: Create proof hash and push resolution on-chain ----
    const proofData = `market:${marketId}:outcome:${outcome}:value:${actualValue}:sources:${validResults.join(",")}`;
    const proofHash = keccak256(toBytes(proofData));

    const reportData = encodeAbiParameters(
      parseAbiParameters("uint256, uint8, uint256, bytes32"),
      [marketId, outcome, BigInt(actualValue), proofHash]
    );

    const report = runtime.report(reportData);

    await evmClient.writeReport(report, {
      address: PREDICTION_MARKET as `0x${string}`,
      abi: RegenPredictionMarketABI,
      functionName: "receiveReport",
      args: [marketId, outcome, BigInt(actualValue), proofHash],
    });

    runtime.log(
      `Market ${marketId} resolved: ${Outcome[outcome]}, value=${actualValue}, proof=${proofHash}`
    );

    return report;
  }
);
