/**
 * Workflow 6: Compliant Private Transfers (Chainlink ACE Pattern)
 * Prize Track: Privacy ($16k) -- extends W1 with Anonymous Compliant Exchange
 *
 * Implements the Chainlink ACE (Anonymous Compliant Exchange) pattern adapted
 * for R00t.fund's ZK-SNARK privacy infrastructure. This workflow acts as the
 * Identity Manager — the compliance gate that users MUST pass before any ETH
 * can enter the private ZK system (ZkAMM).
 *
 * Flow (compliance BEFORE ZkAMM access):
 * 1. User calls requestDeposit() on CompliantPrivateVault — ETH held in escrow
 * 2. CRE W6 polls for pending requests (ACE "Present")
 * 3. CRE calls CompliantPrivateVault.checkCompliance() which wraps the official
 *    Chainlink ACE PolicyEngine.check() (sanctions, KYC, volume, jurisdiction)
 * 4. If ALLOWED:
 *    → Read ZkAMMPair reserves, calculate minTokensOut (5% slippage)
 *    → CRE calls authorizeAndBuy(requestId, minTokensOut, deadline)
 *    → Vault forwards ETH to ZkAMMRouter.buyPrivate()
 *    → User gets ZK token commitment (real AMM-priced tokens)
 * 5. If REJECTED:
 *    → CRE calls denyTransfer(requestId, reason) → ETH refunded
 *
 * ACE Flow:
 * 1. Present  — User submits deposit with address hash (privacy-preserving ID)
 * 2. Verify   — CRE reads ACE PolicyEngine via checkCompliance()
 * 3. Write    — CRE calls authorizeAndBuy() or denyTransfer() on-chain
 *
 * Privacy Guarantees:
 * - Only address hashes (never raw addresses) used in compliance checks
 * - On-chain: only sees "transfer authorized/denied" — no identity linkage
 * - ZK proofs ensure commitment ownership without revealing user identity
 *
 * Trigger: CronCapability (every 6 hours)
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
import { CompliantPrivateVaultABI } from '../contracts/abi/CompliantPrivateVault'
import { ZkAMMPairABI } from '../contracts/abi/ZkAMMPair'

// ============ Config Schema ============

const configSchema = z.object({
  schedule: z.string(),
  chainName: z.string(),
  compliantVaultAddress: z.string(),
  policyEngineAddress: z.string(),
  zkAMMPairAddress: z.string(),
  gasLimit: z.string(),
})

type Config = z.infer<typeof configSchema>

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
    isTestnet: !config.chainName.includes('mainnet'),
  })
  const evmClient = new cre.capabilities.EVMClient(network.chainSelector.selector)

  // ---- Step 1: Read pending requests from CompliantPrivateVault (ACE "Present") ----
  // Users call requestDeposit() on the vault to begin the compliance flow.
  // ETH is held in escrow — it does NOT enter the ZkAMM until compliance clears.
  // This CRE workflow polls for pending requests and processes them.
  // Read nextRequestId to know how many requests exist
  const nextRequestIdCallData = encodeFunctionData({
    abi: CompliantPrivateVaultABI,
    functionName: 'nextRequestId',
  })
  const nextRequestIdResult = evmClient.callContract(runtime, {
    call: encodeCallMsg({
      from: zeroAddress,
      to: config.compliantVaultAddress as Address,
      data: nextRequestIdCallData,
    }),
    blockNumber: LAST_FINALIZED_BLOCK_NUMBER,
  }).result()

  const nextRequestIdDecoded = decodeFunctionResult({
    abi: CompliantPrivateVaultABI,
    functionName: 'nextRequestId',
    data: bytesToHex(nextRequestIdResult.data),
  })
  const nextRequestId = Number(nextRequestIdDecoded)

  if (nextRequestId === 0) {
    return 'No transfer requests found'
  }

  // Scan recent requests (check last 10 or fewer) for pending ones (status=0 = PENDING)
  const maxScan = Math.min(nextRequestId, 10)
  let processedCount = 0
  let authorizedCount = 0
  let deniedCount = 0

  for (let i = nextRequestId - maxScan; i < nextRequestId; i++) {
    // Read request status
    const statusCallData = encodeFunctionData({
      abi: CompliantPrivateVaultABI,
      functionName: 'getRequestStatus',
      args: [BigInt(i)],
    })
    const statusResult = evmClient.callContract(runtime, {
      call: encodeCallMsg({
        from: zeroAddress,
        to: config.compliantVaultAddress as Address,
        data: statusCallData,
      }),
      blockNumber: LAST_FINALIZED_BLOCK_NUMBER,
    }).result()

    const statusDecoded = decodeFunctionResult({
      abi: CompliantPrivateVaultABI,
      functionName: 'getRequestStatus',
      data: bytesToHex(statusResult.data),
    })
    const status = Number(statusDecoded)

    // Status 0 = PENDING -- only process pending requests
    if (status !== 0) continue

    // Read the full request details
    const requestCallData = encodeFunctionData({
      abi: CompliantPrivateVaultABI,
      functionName: 'getRequest',
      args: [BigInt(i)],
    })
    const requestResult = evmClient.callContract(runtime, {
      call: encodeCallMsg({
        from: zeroAddress,
        to: config.compliantVaultAddress as Address,
        data: requestCallData,
      }),
      blockNumber: LAST_FINALIZED_BLOCK_NUMBER,
    }).result()

    const requestDecoded = decodeFunctionResult({
      abi: CompliantPrivateVaultABI,
      functionName: 'getRequest',
      data: bytesToHex(requestResult.data),
    }) as any

    // Extract fields from the request tuple
    const request = requestDecoded as any
    const requestType = Number(request.requestType ?? request[0] ?? 0)
    const amount = BigInt(request.amount ?? request[3] ?? 0)
    const senderHash = (request.senderHash ?? request[5] ?? '0x0000000000000000000000000000000000000000000000000000000000000000') as `0x${string}`

    const requestId = BigInt(i)

    // ---- Step 2: Verify compliance via ACE PolicyEngine (ACE "Verify" step) ----
    // CompliantPrivateVault.checkCompliance() wraps the official Chainlink ACE
    // PolicyEngine.check() internally — modular policies (sanctions, volume, KYC)
    let policyAllowed = false
    let policyReason = 'ACE PolicyEngine unavailable'

    const complianceCallData = encodeFunctionData({
      abi: CompliantPrivateVaultABI,
      functionName: 'checkCompliance',
      args: [senderHash, amount, requestType],
    })

    try {
      const complianceResult = evmClient.callContract(runtime, {
        call: encodeCallMsg({
          from: zeroAddress,
          to: config.compliantVaultAddress as Address,
          data: complianceCallData,
        }),
        blockNumber: LAST_FINALIZED_BLOCK_NUMBER,
      }).result()

      const complianceDecoded = decodeFunctionResult({
        abi: CompliantPrivateVaultABI,
        functionName: 'checkCompliance',
        data: bytesToHex(complianceResult.data),
      }) as any

      policyAllowed = Boolean(complianceDecoded)
      policyReason = policyAllowed ? '' : 'ACE PolicyEngine denied transfer'
    } catch (err) {
      // PolicyEngine call failed -- deny transfer for safety (err: ${err instanceof Error ? err.message : 'unknown'})
      policyAllowed = false
      policyReason = 'ACE PolicyEngine unavailable'
    }

    processedCount++

    // ---- Step 3: Authorize or Deny (ACE "Write" step) ----
    if (policyAllowed) {
      // ---- Step 3a: Read AMM reserves and calculate minTokensOut ----
      // Read ZkAMMPair reserves to calculate slippage-protected minTokensOut
      const reservesCallData = encodeFunctionData({
        abi: ZkAMMPairABI,
        functionName: 'getReserves',
      })
      const reservesResult = evmClient.callContract(runtime, {
        call: encodeCallMsg({
          from: zeroAddress,
          to: config.zkAMMPairAddress as Address,
          data: reservesCallData,
        }),
        blockNumber: LAST_FINALIZED_BLOCK_NUMBER,
      }).result()

      const reservesDecoded = decodeFunctionResult({
        abi: ZkAMMPairABI,
        functionName: 'getReserves',
        data: bytesToHex(reservesResult.data),
      }) as any

      const ethReserve = BigInt(reservesDecoded[0] ?? reservesDecoded._ethReserve ?? 0)
      const tokenReserve = BigInt(reservesDecoded[1] ?? reservesDecoded._tokenReserve ?? 0)

      // Calculate expected tokens out using constant-product formula
      // expectedTokens = (amount * tokenReserve) / (ethReserve + amount)
      // Apply 5% slippage tolerance: minTokensOut = expectedTokens * 95 / 100
      let minTokensOut = BigInt(0)
      if (ethReserve > BigInt(0) && tokenReserve > BigInt(0)) {
        const expectedTokens = (amount * tokenReserve) / (ethReserve + amount)
        minTokensOut = (expectedTokens * BigInt(95)) / BigInt(100)
      }

      // Deadline: 10 minutes from now (600 seconds)
      // Note: CRE runtime doesn't have block.timestamp, use a generous deadline
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 600)

      // ---- Step 3b: Authorize and buy via AMM ----
      const authorizeData = encodeFunctionData({
        abi: CompliantPrivateVaultABI,
        functionName: 'authorizeAndBuy',
        args: [requestId, minTokensOut, deadline],
      })

      const reportResponse = runtime.report({
        encodedPayload: hexToBase64(authorizeData),
        encoderName: 'evm',
        signingAlgo: 'ecdsa',
        hashingAlgo: 'keccak256',
      }).result()

      evmClient.writeReport(runtime, {
        receiver: config.compliantVaultAddress as Address,
        report: reportResponse,
        gasConfig: { gasLimit: config.gasLimit },
      }).result()

      authorizedCount++
    } else {
      // Deny the transfer
      const denyData = encodeFunctionData({
        abi: CompliantPrivateVaultABI,
        functionName: 'denyTransfer',
        args: [requestId, policyReason],
      })

      const reportResponse = runtime.report({
        encodedPayload: hexToBase64(denyData),
        encoderName: 'evm',
        signingAlgo: 'ecdsa',
        hashingAlgo: 'keccak256',
      }).result()

      evmClient.writeReport(runtime, {
        receiver: config.compliantVaultAddress as Address,
        report: reportResponse,
        gasConfig: { gasLimit: config.gasLimit },
      }).result()

      deniedCount++
    }
  }

  return `Compliance check: scanned ${maxScan} requests, processed=${processedCount}, ` +
    `authorized=${authorizedCount}, denied=${deniedCount}`
}

// ============ Entry Point ============

export async function main() {
  const runner = await Runner.newRunner<Config>({ configSchema })
  await runner.run(initWorkflow)
}

main()
