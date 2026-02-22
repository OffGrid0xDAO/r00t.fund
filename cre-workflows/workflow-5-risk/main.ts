/**
 * Workflow 5: Protocol Health Monitor
 * Prize Track: Risk & Compliance ($16k)
 *
 * CRE Workflow that reads extensive on-chain state from ZkAMMPair and R00TShorts
 * to compute composite risk scores and push health reports on-chain.
 * Supports automated circuit breaker triggers.
 *
 * Trigger: CronCapability (every 60 seconds)
 * Capabilities: EVMClient
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
} from '@chainlink/cre-sdk'
import {
  encodeFunctionData,
  decodeFunctionResult,
  type Address,
  zeroAddress,
} from 'viem'
import { z } from 'zod'
import { ZkAMMPairABI } from '../contracts/abi/ZkAMMPair'
import { R00TShortsABI } from '../contracts/abi/R00TShorts'
import { ProtocolHealthMonitorABI } from '../contracts/abi/ProtocolHealthMonitor'

// ============ Config Schema ============

const configSchema = z.object({
  schedule: z.string(),
  chainName: z.string(),
  zkammPairAddress: z.string(),
  r00tShortsAddress: z.string(),
  healthMonitorAddress: z.string(),
  gasLimit: z.string(),
})

type Config = z.infer<typeof configSchema>

// ============ Risk Thresholds (scaled by 1e4, 10000 = 100%) ============

const RESERVE_RATIO_WARNING = 12000   // 120%
const RESERVE_RATIO_CRITICAL = 10500  // 105%
const SHORTS_UTIL_WARNING = 7000      // 70%
const SHORTS_UTIL_CRITICAL = 9000     // 90%

// Risk levels: 0=LOW, 1=MODERATE, 2=ELEVATED, 3=HIGH, 4=CRITICAL
// Recommended actions: 0=NONE, 1=MONITOR, 2=REDUCE_EXPOSURE, 3=PAUSE_NEW_POSITIONS, 4=EMERGENCY_PAUSE

// ============ Helper: Read a uint256 view function ============

function readUint256(
  runtime: Runtime<Config>,
  evmClient: InstanceType<typeof cre.capabilities.EVMClient>,
  contractAddress: string,
  abi: readonly any[],
  functionName: string
): bigint {
  const callData = encodeFunctionData({ abi, functionName })
  const result = evmClient.callContract(runtime, {
    call: encodeCallMsg({
      from: zeroAddress,
      to: contractAddress as Address,
      data: callData,
    }),
    blockNumber: LAST_FINALIZED_BLOCK_NUMBER,
  }).result()

  const decoded = decodeFunctionResult({
    abi,
    functionName,
    data: bytesToHex(result.data),
  })

  return BigInt(decoded as any)
}

// ============ Workflow Init ============

const initWorkflow = (config: Config) => {
  const cron = new cre.capabilities.CronCapability()
  return [cre.handler(cron.trigger({ schedule: config.schedule }), onCronTrigger)]
}

// ============ Handler ============

const onCronTrigger = (runtime: Runtime<Config>, _payload: CronPayload): string => {
  const config = runtime.config

  const network = getNetwork({
    chainFamily: 'evm',
    chainSelectorName: config.chainName,
    isTestnet: true,
  })
  const evmClient = new cre.capabilities.EVMClient(network.chainSelector.selector)

  // ---- Step 1: Read ZkAMMPair state ----
  const ethReserve = readUint256(runtime, evmClient, config.zkammPairAddress, ZkAMMPairABI, 'ethReserve')
  const tokenReserve = readUint256(runtime, evmClient, config.zkammPairAddress, ZkAMMPairABI, 'tokenReserve')
  const totalLPShares = readUint256(runtime, evmClient, config.zkammPairAddress, ZkAMMPairABI, 'totalLPShares')
  const protocolFees = readUint256(runtime, evmClient, config.zkammPairAddress, ZkAMMPairABI, 'accumulatedProtocolFees')
  const lpFees = readUint256(runtime, evmClient, config.zkammPairAddress, ZkAMMPairABI, 'accumulatedLPFees')

  // ---- Step 2: Read R00TShorts state ----
  const totalOpenInterest = readUint256(runtime, evmClient, config.r00tShortsAddress, R00TShortsABI, 'totalOpenInterest')
  const totalCollateralLocked = readUint256(runtime, evmClient, config.r00tShortsAddress, R00TShortsABI, 'totalCollateralLocked')
  const openPositionCount = readUint256(runtime, evmClient, config.r00tShortsAddress, R00TShortsABI, 'openPositionCount')

  // ---- Step 3: Compute risk metrics ----
  const ethReserveNum = Number(ethReserve)
  const tokenReserveNum = Number(tokenReserve)
  const totalFeesNum = Number(protocolFees) + Number(lpFees)
  const totalOINum = Number(totalOpenInterest)

  // Reserve ratio: how much ETH backs obligations
  const reserveRatio =
    totalFeesNum > 0
      ? Math.floor((ethReserveNum * 10000) / totalFeesNum)
      : 50000 // 500% if no obligations

  // Shorts utilization: totalOpenInterest / tokenReserve
  const shortsUtilization =
    tokenReserveNum > 0
      ? Math.floor((totalOINum * 10000) / tokenReserveNum)
      : 0

  // ---- Step 4: Compute overall risk level ----
  let riskScore = 0

  // Reserve ratio scoring
  if (reserveRatio < RESERVE_RATIO_CRITICAL) riskScore += 40
  else if (reserveRatio < RESERVE_RATIO_WARNING) riskScore += 20

  // Shorts utilization scoring
  if (shortsUtilization > SHORTS_UTIL_CRITICAL) riskScore += 40
  else if (shortsUtilization > SHORTS_UTIL_WARNING) riskScore += 20

  // LP health scoring
  const totalLPNum = Number(totalLPShares)
  if (totalLPNum === 0 && ethReserveNum > 0) riskScore += 20

  // Map score to risk level and recommended action
  let overallRiskLevel: number
  let recommendedAction: number

  if (riskScore >= 80) {
    overallRiskLevel = 4 // CRITICAL
    recommendedAction = 4 // EMERGENCY_PAUSE
  } else if (riskScore >= 60) {
    overallRiskLevel = 3 // HIGH
    recommendedAction = 3 // PAUSE_NEW_POSITIONS
  } else if (riskScore >= 40) {
    overallRiskLevel = 2 // ELEVATED
    recommendedAction = 2 // REDUCE_EXPOSURE
  } else if (riskScore >= 20) {
    overallRiskLevel = 1 // MODERATE
    recommendedAction = 1 // MONITOR
  } else {
    overallRiskLevel = 0 // LOW
    recommendedAction = 0 // NONE
  }

  const riskLabels = ['LOW', 'MODERATE', 'ELEVATED', 'HIGH', 'CRITICAL']
  const actionLabels = ['NONE', 'MONITOR', 'REDUCE_EXPOSURE', 'PAUSE_NEW_POSITIONS', 'EMERGENCY_PAUSE']

  // ---- Step 5: Encode and push report on-chain ----
  const reportData = encodeFunctionData({
    abi: ProtocolHealthMonitorABI,
    functionName: 'receiveReport',
    args: [
      BigInt(ethReserveNum),
      BigInt(tokenReserveNum),
      BigInt(reserveRatio),
      BigInt(shortsUtilization),
      overallRiskLevel,
      recommendedAction,
    ],
  })

  const reportResponse = runtime.report({
    encodedPayload: hexToBase64(reportData),
    encoderName: 'evm',
    signingAlgo: 'ecdsa',
    hashingAlgo: 'keccak256',
  }).result()

  const resp = evmClient.writeReport(runtime, {
    receiver: config.healthMonitorAddress as Address,
    report: reportResponse,
    gasConfig: { gasLimit: config.gasLimit },
  }).result()

  return `Health Report: reserveRatio=${reserveRatio}, shortsUtil=${shortsUtilization}, ` +
    `risk=${riskLabels[overallRiskLevel]}, action=${actionLabels[recommendedAction]}, ` +
    `positions=${openPositionCount}, collateral=${totalCollateralLocked}, tx=${resp}`
}

// ============ Entry Point ============

export async function main() {
  const runner = await Runner.newRunner<Config>({ configSchema })
  await runner.run(initWorkflow)
}

main()
