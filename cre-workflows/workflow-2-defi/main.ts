/**
 * Workflow 2: Regenerative Proof of Reserve
 * Prize Track: DeFi & Tokenization ($20k)
 *
 * Custom Chainlink-compatible Proof of Reserve data feed for ReFi reserves.
 * Aggregates on-chain TVL data with external environmental impact metrics
 * using HTTPClient + ConsensusAggregationByFields + median.
 *
 * Trigger: CronCapability (every 30 minutes)
 * Capabilities: HTTPClient, EVMClient, ConsensusAggregationByFields
 */

import {
  type CRERuntime,
  type EVMClient,
  type HTTPClient,
  handler,
  consensusMedianAggregation,
} from "@chainlink/cre-sdk";
import { encodeAbiParameters, parseAbiParameters } from "viem";
import { ZkAMMv3PairABI } from "../contracts/abi/ZkAMMv3Pair.js";
import { R00TShortsABI } from "../contracts/abi/R00TShorts.js";
import { RegenProofOfReserveABI } from "../contracts/abi/RegenProofOfReserve.js";

// ============ Configuration ============

const SEPOLIA_CHAIN_ID = 11155111;

const ZKAMM_PAIR = process.env.ZKAMM_PAIR_ADDRESS ?? "0x";
const R00T_SHORTS = process.env.R00T_SHORTS_ADDRESS ?? "0x";
const PROOF_OF_RESERVE = process.env.REGEN_PROOF_OF_RESERVE_ADDRESS ?? "0x";

// Carbon credit price sources (EU voluntary market + global)
const CARBON_PRICE_SOURCES = [
  "https://api.ember-climate.org/v1/carbon-price",        // EU ETS EUA price
  "https://www.sendeco2.com/api/v1/prices/current",       // SENDECO2 Iberian market
  "https://api.climatetrade.com/v1/carbon-price",          // ClimateTrade (Spain-based)
  "https://api.toucan.earth/v1/bct-price",                 // Toucan BCT (on-chain carbon)
];

// Portuguese carbon market reference
const APA_CARBON_PRICE_API = "https://apambiente.pt/api/v1/carbon-price";

// Verified carbon credit data from CRE W1 attestations (on-chain)
import { ConfidentialFundingVaultABI } from "../contracts/abi/ConfidentialFundingVault.js";
const FUNDING_VAULT = process.env.CONFIDENTIAL_FUNDING_VAULT_ADDRESS ?? "0x";

// ============ Workflow Handler ============

export default handler(
  {
    triggers: [{ type: "cron", schedule: "*/30 * * * *" }],
    consensus: consensusMedianAggregation({
      fields: [
        "ethReserve",
        "tokenReserve",
        "totalTVL",
        "backingRatio",
        "impactScore",
      ],
    }),
  },
  async (runtime: CRERuntime) => {
    const evmClient: EVMClient = runtime.getEVMClient(SEPOLIA_CHAIN_ID);
    const httpClient: HTTPClient = runtime.getHTTPClient();

    // ---- Step 1: Read on-chain reserves from ZkAMMv3Pair ----
    const [reserves, totalLPShares, protocolFees] = await Promise.all([
      evmClient.callContract({
        address: ZKAMM_PAIR as `0x${string}`,
        abi: ZkAMMv3PairABI,
        functionName: "getReserves",
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
    ]);

    const ethReserve = reserves[0];
    const tokenReserve = reserves[1];

    // ---- Step 2: Read shorts contract state ----
    const [shortsCollateral, shortsOI] = await Promise.all([
      evmClient.callContract({
        address: R00T_SHORTS as `0x${string}`,
        abi: R00TShortsABI,
        functionName: "totalCollateralLocked",
      }),
      evmClient.callContract({
        address: R00T_SHORTS as `0x${string}`,
        abi: R00TShortsABI,
        functionName: "totalOpenInterest",
      }),
    ]);

    // ---- Step 3: Fetch external data (carbon credit prices, impact scores) ----
    // Fetch from multiple sources for consensus
    const carbonPricePromises = CARBON_PRICE_SOURCES.map(async (url) => {
      try {
        const response = await httpClient.fetch(url, {
          method: "GET",
          headers: { Accept: "application/json" },
        });
        const data = JSON.parse(response.body);
        return data.price_per_tonne_usd ?? 0;
      } catch {
        return 0;
      }
    });

    // ---- Step 3b: Read verified carbon credits from W1 attestations (on-chain) ----
    // This is what makes the PoR unique: TVL includes verified carbon credit value
    let verifiedCarbonCredits = 0;
    let carbonCreditImpactScore = 0;

    try {
      // Read latest attestation count from ConfidentialFundingVault
      const verifiedCount = await evmClient.callContract({
        address: FUNDING_VAULT as `0x${string}`,
        abi: ConfidentialFundingVaultABI,
        functionName: "getProjectAttestation",
        args: [BigInt(0)], // Check first proposal
      });

      if (verifiedCount) {
        carbonCreditImpactScore = Number(verifiedCount[0] ?? 0); // impactScore
        verifiedCarbonCredits = carbonCreditImpactScore > 0 ? 1 : 0;
        runtime.log(`Verified carbon credits from W1: impactScore=${carbonCreditImpactScore}`);
      }
    } catch {
      runtime.log("No verified carbon credit attestations found (W1 not yet active)");
    }

    // Environmental impact score: blend carbon credit verification + market data
    let impactScore = carbonCreditImpactScore > 0
      ? carbonCreditImpactScore  // Use verified W1 score if available
      : 500;                      // Default moderate impact

    const carbonPrices = await Promise.all(carbonPricePromises);
    const validPrices = carbonPrices.filter((p) => p > 0);
    const medianCarbonPrice =
      validPrices.length > 0
        ? validPrices.sort((a, b) => a - b)[
            Math.floor(validPrices.length / 2)
          ]
        : 30; // Default $30/tonne

    // ---- Step 4: Compute aggregate metrics ----

    const ethReserveNum = Number(ethReserve);
    const tokenReserveNum = Number(tokenReserve);
    const shortsCollateralNum = Number(shortsCollateral);

    // Total TVL = ETH reserve + shorts collateral + carbon credit value (all in wei)
    // Carbon credit value: verified credits × median price × conversion to wei
    const carbonCreditValueWei = BigInt(
      Math.floor(verifiedCarbonCredits * medianCarbonPrice * 1e14) // Rough USD→wei conversion
    );

    const totalTVL = BigInt(ethReserveNum) + BigInt(shortsCollateralNum) + carbonCreditValueWei;

    // Backing ratio: how well reserves + carbon credits back obligations (scaled by 1e4)
    const totalObligations =
      Number(protocolFees) + shortsCollateralNum;
    const totalBacking = ethReserveNum + Number(carbonCreditValueWei);
    const backingRatio =
      totalObligations > 0
        ? Math.floor((totalBacking * 10000) / totalObligations)
        : 50000; // 500%

    // Impact score from verified carbon credits + environmental data (0-1000)
    const clampedImpact = Math.min(1000, Math.max(0, impactScore));

    // ---- Step 5: Encode and push report ----
    const reportData = encodeAbiParameters(
      parseAbiParameters(
        "uint256, uint256, uint256, uint256, uint256"
      ),
      [
        ethReserve as bigint,
        tokenReserve as bigint,
        totalTVL,
        BigInt(backingRatio),
        BigInt(clampedImpact),
      ]
    );

    runtime.log(
      `PoR Report: ethReserve=${ethReserve}, tokenReserve=${tokenReserve}, ` +
        `TVL=${totalTVL} (incl. ${carbonCreditValueWei} wei carbon credits), ` +
        `backingRatio=${backingRatio}, impact=${clampedImpact}, ` +
        `carbonPrice=$${medianCarbonPrice}/tonne, verifiedCredits=${verifiedCarbonCredits}`
    );

    const report = runtime.report(reportData);

    await evmClient.writeReport(report, {
      address: PROOF_OF_RESERVE as `0x${string}`,
      abi: RegenProofOfReserveABI,
      functionName: "receiveReport",
      args: [
        ethReserve as bigint,
        tokenReserve as bigint,
        totalTVL,
        BigInt(backingRatio),
        BigInt(clampedImpact),
      ],
    });

    return report;
  }
);
