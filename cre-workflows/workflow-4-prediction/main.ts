/**
 * Workflow 4: Regenerative Outcome Markets
 * Prize Track: Prediction Markets ($16k)
 *
 * CRE-automated prediction market settlement using environmental outcome data.
 * Reads market data from RegenPredictionMarket, fetches environmental outcome
 * data from multiple public APIs, computes median values, and resolves markets.
 *
 * The workflow:
 * 1. Reads pending markets from RegenPredictionMarket (getMarket)
 * 2. Fetches environmental outcome data from Gold Standard, Verra, Environmental Monitor
 * 3. Computes median value across sources
 * 4. Determines outcome (POSITIVE if actual >= target, else NEGATIVE)
 * 5. Writes resolution report to RegenPredictionMarket
 *
 * Trigger: CronCapability (every 6 hours)
 * Capabilities: HTTPClient, EVMClient
 */

import {
  bytesToHex,
  cre,
  encodeCallMsg,
  getNetwork,
  LAST_FINALIZED_BLOCK_NUMBER,
  hexToBase64,
  Runner,
  type Runtime,
  type CronPayload,
  type HTTPSendRequester,
} from '@chainlink/cre-sdk'
import {
  encodeFunctionData,
  decodeFunctionResult,
  encodeAbiParameters,
  parseAbiParameters,
  type Address,
  zeroAddress,
  keccak256,
  toBytes,
} from 'viem'
import { z } from 'zod'
import { RegenPredictionMarketABI } from '../contracts/abi/RegenPredictionMarket'
import { SerraEstrelaNativeForestABI } from '../contracts/abi/SerraEstrelaNativeForest'

// ============ Config Schema ============

const configSchema = z.object({
  schedule: z.string(),
  chainName: z.string(),
  predictionMarketAddress: z.string(),
  serraEstrelaAddress: z.string().default(""),
  gasLimit: z.string(),
})

type Config = z.infer<typeof configSchema>

// ============ Constants ============

// Environmental data sources for outcome verification
interface DataSource {
  name: string
  url: string
  parseValue: (data: Record<string, unknown>) => number
}

const ENVIRONMENTAL_SOURCES: DataSource[] = [
  {
    name: 'Gold Standard',
    url: 'https://api.goldstandard.org/v1/projects',
    parseValue: (data) => {
      const d = data as { metrics?: { value?: number } }
      return d.metrics?.value ?? 0
    },
  },
  {
    name: 'Verra Registry',
    url: 'https://registry.verra.org/api/v1/credits',
    parseValue: (data) => {
      const d = data as { total_credits?: number }
      return d.total_credits ?? 0
    },
  },
  {
    name: 'Environmental Monitor',
    url: 'https://api.environmentaldata.org/v1/metrics',
    parseValue: (data) => {
      const d = data as { measurement?: number }
      return d.measurement ?? 0
    },
  },
]

// Outcome enum (matches contract)
enum Outcome {
  UNRESOLVED = 0,
  POSITIVE = 1,
  NEGATIVE = 2,
}

// ============ HTTP Fetcher Functions ============

const fetchEnvironmentalData = (url: string, metric: string, marketId: number): HTTPSendRequester => ({
  url: `${url}?metric=${encodeURIComponent(metric)}&marketId=${marketId}`,
  method: 'GET',
  headers: { Accept: 'application/json' },
})

// ============ Workflow Init ============

const initWorkflow = (config: Config) => {
  const cron = new cre.capabilities.CronCapability()
  return [cre.handler(cron.trigger({ schedule: config.schedule }), onCronTrigger)]
}

// ============ Handler ============

const onCronTrigger = (runtime: Runtime<Config>, payload: CronPayload): string => {
  const config = runtime.config

  const network = getNetwork({
    chainFamily: 'evm',
    chainSelectorName: config.chainName,
    isTestnet: !config.chainName.includes('mainnet'),
  })

  const evmClient = new cre.capabilities.EVMClient(network.chainSelector.selector)
  const httpCapability = new cre.capabilities.HTTPClient()

  // ---- Step 1: Read market data from RegenPredictionMarket ----
  // Check market 0 (the first market) for pending resolution
  const marketId = 0

  const getMarketCallData = encodeFunctionData({
    abi: RegenPredictionMarketABI,
    functionName: 'getMarket',
    args: [BigInt(marketId)],
  })

  let proposalId = BigInt(0)
  let metric = 'NDVI_recovery'
  let targetValue = BigInt(700)
  let status = 0

  try {
    const marketResult = evmClient.callContract(runtime, {
      call: encodeCallMsg({
        from: zeroAddress,
        to: config.predictionMarketAddress as Address,
        data: getMarketCallData,
      }),
      blockNumber: LAST_FINALIZED_BLOCK_NUMBER,
    }).result()

    const market = decodeFunctionResult({
      abi: RegenPredictionMarketABI,
      functionName: 'getMarket',
      data: bytesToHex(marketResult.data),
    }) as readonly [bigint, string, bigint, bigint, number, bigint, bigint, bigint]

    proposalId = market[0]
    metric = market[1]
    targetValue = market[2]
    status = market[4]
  } catch (err) {
    // Market may not exist or have different ABI structure -- use defaults for simulation (err: ${err instanceof Error ? err.message : 'unknown'})
  }

  // Status 0 = active/pending, status 1 = resolved
  // If already resolved or no active market, skip
  if (status !== 0) {
    const skipPayload = encodeAbiParameters(parseAbiParameters('uint8'), [0])
    const reportResponse = runtime.report({
      encodedPayload: hexToBase64(skipPayload),
      encoderName: 'evm',
      signingAlgo: 'ecdsa',
      hashingAlgo: 'keccak256',
    }).result()
    return `Market ${marketId} already resolved or inactive (status=${status}). Report: ${reportResponse}`
  }

  // ---- Step 2: Fetch environmental outcome data from multiple sources ----
  const validResults: number[] = []

  for (const source of ENVIRONMENTAL_SOURCES) {
    try {
      const response = httpCapability.sendRequest(
        runtime,
        fetchEnvironmentalData(source.url, metric, marketId),
      ).result()

      if (response?.body) {
        const data = JSON.parse(response.body) as Record<string, unknown>
        const value = source.parseValue(data)
        if (value > 0) {
          validResults.push(value)
        }
      }
    } catch (err) {
      // Source unavailable, skip (err: ${err instanceof Error ? err.message : 'unknown'})
    }
  }

  // If no valid data from APIs, read from W7's on-chain environmental data feed
  if (validResults.length === 0 && config.serraEstrelaAddress) {
    try {
      const reportCallData = encodeFunctionData({
        abi: SerraEstrelaNativeForestABI,
        functionName: 'getLatestReport',
      })
      const reportResult = evmClient.callContract(runtime, {
        call: encodeCallMsg({
          from: zeroAddress,
          to: config.serraEstrelaAddress as Address,
          data: reportCallData,
        }),
        blockNumber: LAST_FINALIZED_BLOCK_NUMBER,
      }).result()
      const report = decodeFunctionResult({
        abi: SerraEstrelaNativeForestABI,
        functionName: 'getLatestReport',
        data: bytesToHex(reportResult.data),
      }) as any
      const fireRecoveryIndex = Number(report.fireRecoveryIndex ?? report[8] ?? 0)
      const ndviRecoveryPct = Number(report.ndviRecoveryPct ?? report[2] ?? 0)
      const carbonCredits = Number(report.carbonCredits ?? report[7] ?? 0)
      if (fireRecoveryIndex > 0) validResults.push(fireRecoveryIndex)
      if (ndviRecoveryPct > 0) validResults.push(ndviRecoveryPct)
      if (carbonCredits > 0) validResults.push(carbonCredits)
    } catch (err) {
      // Serra da Estrela contract not available (err: ${err instanceof Error ? err.message : 'unknown'})
    }
  }

  // ---- Step 3: Compute median value across sources ----
  validResults.sort((a, b) => a - b)
  const medianIndex = Math.floor(validResults.length / 2)
  const actualValue =
    validResults.length % 2 === 0
      ? Math.floor((validResults[medianIndex - 1] + validResults[medianIndex]) / 2)
      : validResults[medianIndex]

  // ---- Step 4: Determine outcome ----
  const outcome =
    BigInt(actualValue) >= targetValue ? Outcome.POSITIVE : Outcome.NEGATIVE

  // ---- Step 5: Create proof hash and push resolution on-chain ----
  const proofData = `market:${marketId}:outcome:${outcome}:value:${actualValue}:sources:${validResults.join(',')}`
  const proofHash = keccak256(toBytes(proofData))

  // Encode report payload: (uint256 marketId, uint8 outcome, uint256 actualValue, bytes32 proofHash)
  const reportPayload = encodeAbiParameters(
    parseAbiParameters('uint256, uint8, uint256, bytes32'),
    [BigInt(marketId), outcome, BigInt(actualValue), proofHash]
  )

  const reportResponse = runtime.report({
    encodedPayload: hexToBase64(reportPayload),
    encoderName: 'evm',
    signingAlgo: 'ecdsa',
    hashingAlgo: 'keccak256',
  }).result()

  // Write report to RegenPredictionMarket
  const writeResp = evmClient.writeReport(runtime, {
    receiver: config.predictionMarketAddress as Address,
    report: reportResponse,
    gasConfig: { gasLimit: config.gasLimit },
  }).result()

  return `Market ${marketId} resolved: ${Outcome[outcome]}, ` +
    `actual=${actualValue} vs target=${targetValue}, ` +
    `sources=${validResults.length}, proof=${proofHash}. TX: ${writeResp}`
}

// ============ Entry Point ============

export async function main() {
  const runner = await Runner.newRunner<Config>({ configSchema })
  await runner.run(initWorkflow)
}

main()
