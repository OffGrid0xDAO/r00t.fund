/**
 * Workflow 6: Compliant Private Transfers (Chainlink ACE Pattern)
 * Prize Track: Privacy ($16k) -- extends W1 with Anonymous Compliant Exchange
 *
 * Implements the Chainlink ACE (Anonymous Compliant Exchange) pattern adapted
 * for R00t.fund's ZK-SNARK privacy infrastructure. This workflow acts as the
 * Identity Manager — the compliance gate that users MUST pass before any ETH
 * can enter the private ZK system (ZkAMM).
 *
 * Correct Flow (compliance BEFORE ZkAMM access):
 * 1. User calls requestDeposit() on CompliantPrivateVault — ETH held in escrow
 * 2. CRE W6 polls for pending requests (ACE "Present")
 * 3. CRE reads R00tPolicyEngine (ACE "Verify" — sanctions, KYC, jurisdiction,
 *    amount limits, daily volume)
 * 4. CRE calls authorizeTransfer() or denyTransfer() (ACE "Write")
 * 5. If authorized → Vault inserts commitment into ZkAMMPair Merkle tree
 *    (via insertCommitmentFromCRE) — user now has private ZK commitment
 * 6. If denied → ETH refunded to user, no ZkAMM access
 *
 * The ZkAMM (buyPrivate, depositPublic, addLiquidity) is the DESTINATION
 * after compliance clears — users cannot bypass the vault to access it directly.
 *
 * ACE Flow:
 * 1. Present  — User submits deposit with address hash (privacy-preserving ID)
 * 2. Verify   — CRE reads R00tPolicyEngine to check compliance
 * 3. Write    — CRE calls authorizeTransfer() or denyTransfer() on-chain
 *
 * Privacy Guarantees:
 * - Only address hashes (never raw addresses) used in compliance checks
 * - On-chain: only sees "transfer authorized/denied" — no identity linkage
 * - ZK proofs ensure commitment ownership without revealing user identity
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
import { CompliantPrivateVaultABI } from '../contracts/abi/CompliantPrivateVault'
import { R00tPolicyEngineABI } from '../contracts/abi/R00tPolicyEngine'

// ============ Config Schema ============

const configSchema = z.object({
  schedule: z.string(),
  chainName: z.string(),
  compliantVaultAddress: z.string(),
  policyEngineAddress: z.string(),
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
    isTestnet: true,
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
    const recipientHash = (request.recipientHash ?? request[6] ?? '0x0000000000000000000000000000000000000000000000000000000000000000') as `0x${string}`

    const requestId = BigInt(i)

    // ---- Step 2: Verify compliance via PolicyEngine (ACE "Verify" step) ----
    let policyAllowed = false
    let policyReason = 'PolicyEngine unavailable'

    const policyCallData = encodeFunctionData({
      abi: R00tPolicyEngineABI,
      functionName: 'checkPrivateTransferAllowed',
      args: [senderHash, recipientHash, amount, requestType],
    })

    try {
      const policyResult = evmClient.callContract(runtime, {
        call: encodeCallMsg({
          from: zeroAddress,
          to: config.policyEngineAddress as Address,
          data: policyCallData,
        }),
        blockNumber: LAST_FINALIZED_BLOCK_NUMBER,
      }).result()

      const policyDecoded = decodeFunctionResult({
        abi: R00tPolicyEngineABI,
        functionName: 'checkPrivateTransferAllowed',
        data: bytesToHex(policyResult.data),
      }) as any

      policyAllowed = Boolean(policyDecoded[0] ?? policyDecoded.allowed ?? false)
      policyReason = String(policyDecoded[1] ?? policyDecoded.reason ?? '')
    } catch {
      // PolicyEngine call failed -- deny transfer for safety
      policyAllowed = false
      policyReason = 'PolicyEngine unavailable'
    }

    processedCount++

    // ---- Step 3: Authorize or Deny (ACE "Write" step) ----
    if (policyAllowed) {
      // Authorize the transfer
      const authorizeData = encodeFunctionData({
        abi: CompliantPrivateVaultABI,
        functionName: 'authorizeTransfer',
        args: [requestId],
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
