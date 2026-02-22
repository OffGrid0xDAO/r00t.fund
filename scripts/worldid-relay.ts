/**
 * World ID Relay — Lightweight CRE W8 Substitute
 *
 * Polls the WorldIDGatekeeper contract on Tenderly VNet for PENDING verification
 * requests and auto-approves them by calling receiveVerificationResult().
 *
 * This acts as a stand-in for CRE Workflow 8 (which isn't deployed to a
 * Chainlink DON yet), completing the full verification loop so the frontend
 * can pick up the result via its existing isVerified() polling.
 *
 * Usage: cd scripts && npm install && npm run worldid-relay
 */

import {
  createPublicClient,
  createWalletClient,
  http,
  formatEther,
  defineChain,
  type Address,
  type Hex,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

// ============ ABI ============

const WorldIDGatekeeperABI = [
  {
    type: 'function',
    name: 'receiveVerificationResult',
    inputs: [
      { name: 'requestId', type: 'uint256' },
      { name: 'verified', type: 'bool' },
      { name: 'reason', type: 'string' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'getRequest',
    inputs: [{ name: 'requestId', type: 'uint256' }],
    outputs: [
      { name: 'requester', type: 'address' },
      { name: 'nullifierHash', type: 'bytes32' },
      { name: 'status', type: 'uint8' },
      { name: 'verificationLevel', type: 'string' },
      { name: 'requestedAt', type: 'uint256' },
      { name: 'verifiedAt', type: 'uint256' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getRequestStatus',
    inputs: [{ name: 'requestId', type: 'uint256' }],
    outputs: [{ type: 'uint8' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'nextRequestId',
    inputs: [],
    outputs: [{ type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'totalPending',
    inputs: [],
    outputs: [{ type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'totalVerified',
    inputs: [],
    outputs: [{ type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'donForwarder',
    inputs: [],
    outputs: [{ type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'paused',
    inputs: [],
    outputs: [{ type: 'bool' }],
    stateMutability: 'view',
  },
] as const;

// ============ Config ============

const PRIVATE_KEY = (process.env.PRIVATE_KEY || '0xd9c12a02a85cda4fd98fedcb3cfda4dc60c7d8be08919f7f268de31415e59996') as Hex;
const RPC_URL = process.env.RPC_URL || 'https://virtual.sepolia.eu.rpc.tenderly.co/39fe020c-836e-4173-8786-5e726d0b3ba1';
const GATEKEEPER = (process.env.GATEKEEPER || '0x512d4a66760Aba053f4162205d729c8540d00145') as Address;
const POLL_INTERVAL = Number(process.env.POLL_INTERVAL || '10') * 1000; // seconds → ms
const MAX_SCAN = Number(process.env.MAX_SCAN || '10');

// ============ Setup ============

// Tenderly Virtual TestNet (forked from Sepolia)
const tenderlyVNet = defineChain({
  id: 73571,
  name: 'Tenderly VNet',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: {
    default: { http: [RPC_URL] },
  },
  testnet: true,
});

const account = privateKeyToAccount(PRIVATE_KEY);

const publicClient = createPublicClient({
  chain: tenderlyVNet,
  transport: http(RPC_URL),
});

const walletClient = createWalletClient({
  account,
  chain: tenderlyVNet,
  transport: http(RPC_URL),
});

// ============ Helpers ============

function ts(): string {
  return new Date().toISOString();
}

// ============ Preflight ============

async function preflight(): Promise<boolean> {
  console.log('='.repeat(60));
  console.log('  World ID Relay — CRE W8 Substitute');
  console.log('='.repeat(60));
  console.log(`  Gatekeeper:  ${GATEKEEPER}`);
  console.log(`  Relay wallet: ${account.address}`);
  console.log(`  RPC:          ${RPC_URL.replace(/\/v2\/.*/, '/v2/***')}`);
  console.log(`  Poll interval: ${POLL_INTERVAL / 1000}s`);
  console.log('='.repeat(60));

  // Verify contract exists at the address
  const code = await publicClient.getCode({ address: GATEKEEPER });
  if (!code || code === '0x') {
    console.error(`\n  ERROR: No contract found at ${GATEKEEPER} on this network.`);
    console.error(`  Make sure the contract is deployed to Sepolia and the address is correct.\n`);
    return false;
  }
  console.log(`  Contract:     deployed`);

  // Check donForwarder matches our wallet
  try {
    const donForwarder = await publicClient.readContract({
      address: GATEKEEPER,
      abi: WorldIDGatekeeperABI,
      functionName: 'donForwarder',
    });

    if (donForwarder.toLowerCase() !== account.address.toLowerCase()) {
      console.error(`\n  ERROR: donForwarder mismatch!`);
      console.error(`    Contract donForwarder: ${donForwarder}`);
      console.error(`    Relay wallet:          ${account.address}`);
      console.error(`\n  receiveVerificationResult() will revert with UnauthorizedForwarder.`);
      console.error(`  Either use the correct PRIVATE_KEY or call setDonForwarder() on the contract.\n`);
      return false;
    }
    console.log(`  donForwarder: MATCH`);
  } catch {
    console.warn(`  donForwarder: could not read (proceeding anyway)`);
  }

  // Check paused
  try {
    const isPaused = await publicClient.readContract({
      address: GATEKEEPER,
      abi: WorldIDGatekeeperABI,
      functionName: 'paused',
    });

    if (isPaused) {
      console.error(`\n  ERROR: Contract is paused. Call unpause() before running the relay.\n`);
      return false;
    }
    console.log(`  Paused:       false`);
  } catch {
    console.warn(`  Paused:       could not read (proceeding anyway)`);
  }

  // Read counters
  try {
    const [nextId, pending, verified] = await Promise.all([
      publicClient.readContract({ address: GATEKEEPER, abi: WorldIDGatekeeperABI, functionName: 'nextRequestId' }),
      publicClient.readContract({ address: GATEKEEPER, abi: WorldIDGatekeeperABI, functionName: 'totalPending' }),
      publicClient.readContract({ address: GATEKEEPER, abi: WorldIDGatekeeperABI, functionName: 'totalVerified' }),
    ]);
    console.log(`  nextRequestId: ${nextId}`);
    console.log(`  totalPending:  ${pending}`);
    console.log(`  totalVerified: ${verified}`);
  } catch {
    console.warn(`  Counters:     could not read (contract may not be fully deployed)`);
  }

  // Check ETH balance
  const balance = await publicClient.getBalance({ address: account.address });
  const balEth = formatEther(balance);
  console.log(`  ETH balance:   ${balEth}`);

  if (balance < 1_000_000_000_000_000n) { // < 0.001 ETH
    console.warn(`\n  WARNING: Low ETH balance (${balEth}). Relay transactions may fail.\n`);
  }

  console.log('='.repeat(60));
  console.log(`  Relay started. Watching for PENDING requests...\n`);
  return true;
}

// ============ Poll Loop ============

async function pollOnce(): Promise<void> {
  const nextId = await publicClient.readContract({
    address: GATEKEEPER,
    abi: WorldIDGatekeeperABI,
    functionName: 'nextRequestId',
  });

  const nextIdNum = Number(nextId);
  if (nextIdNum === 0) return;

  const scanStart = Math.max(0, nextIdNum - MAX_SCAN);
  let foundPending = false;

  for (let i = scanStart; i < nextIdNum; i++) {
    const status = await publicClient.readContract({
      address: GATEKEEPER,
      abi: WorldIDGatekeeperABI,
      functionName: 'getRequestStatus',
      args: [BigInt(i)],
    });

    if (Number(status) !== 1) continue; // Not PENDING
    foundPending = true;

    // Read full request details
    const req = await publicClient.readContract({
      address: GATEKEEPER,
      abi: WorldIDGatekeeperABI,
      functionName: 'getRequest',
      args: [BigInt(i)],
    });

    const [requester, , , verificationLevel] = req;

    console.log(`[${ts()}] [FOUND] Request #${i} | User: ${requester} | Level: ${verificationLevel} | Status: PENDING`);

    // Auto-approve
    try {
      const hash = await walletClient.writeContract({
        address: GATEKEEPER,
        abi: WorldIDGatekeeperABI,
        functionName: 'receiveVerificationResult',
        args: [BigInt(i), true, 'World ID verified (relay demo)'],
      });

      console.log(`[${ts()}] [TX]       Sent: ${hash}`);

      const receipt = await publicClient.waitForTransactionReceipt({ hash });

      if (receipt.status === 'success') {
        console.log(`[${ts()}] [VERIFIED] Request #${i} | User: ${requester} | Block: ${receipt.blockNumber}`);
      } else {
        console.error(`[${ts()}] [REVERTED] Request #${i} | Tx reverted on-chain`);
      }
    } catch (err: unknown) {
      const error = err as Error;
      const msg = error.message || String(err);

      if (msg.includes('UnauthorizedForwarder')) {
        console.error(`[${ts()}] [ERROR] UnauthorizedForwarder — wallet ${account.address} is not the donForwarder`);
      } else if (msg.includes('InvalidRequest')) {
        console.log(`[${ts()}] [SKIP] Request #${i} already processed`);
      } else {
        console.error(`[${ts()}] [ERROR] Request #${i}: ${msg.slice(0, 200)}`);
      }
    }
  }

  if (!foundPending) {
    process.stdout.write(`\r[${ts()}] [IDLE] No pending requests (scanned ${scanStart}..${nextIdNum - 1})   `);
  }
}

// ============ Main ============

let running = true;

process.on('SIGINT', () => {
  console.log(`\n[${ts()}] Shutting down relay...`);
  running = false;
});

async function main() {
  const ok = await preflight();
  if (!ok) process.exit(1);

  while (running) {
    try {
      await pollOnce();
    } catch (err: unknown) {
      const error = err as Error;
      console.error(`[${ts()}] [RPC ERROR] ${(error.message || String(err)).slice(0, 200)}`);
    }

    // Sleep
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL));
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
