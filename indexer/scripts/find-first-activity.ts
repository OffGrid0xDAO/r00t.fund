/**
 * find-first-activity.ts
 *
 * Fast discovery of first contract activity using:
 * 1. eth_getLogs to find actual events (fast on public RPCs)
 * 2. Falls back to state-based binary search if logs fail
 * 3. Tries multiple RPCs for reliability
 *
 * This runs BEFORE Ponder starts to find the optimal startBlock,
 * avoiding linear scanning of millions of empty blocks.
 */

import { createPublicClient, http } from "viem";
import { arbitrum } from "viem/chains";
import { ZkAMMWithTokenAbi } from "../abis/ZkAMMWithToken";

// Configuration
const CONTRACT_ADDRESS = "0xc7E7fD3bC101621F588a3A47cf03343BFAC05451" as const;
const DEPLOYMENT_BLOCK = 419526457;
const KNOWN_FIRST_EVENT = 420982912; // Fallback if discovery fails
const COARSE_STEP = 10000;
const FINE_THRESHOLD = 10;

// Multiple RPCs to try - PUBLIC RPCs FIRST (they allow larger getLogs ranges)
// Alchemy/paid RPCs have 10k block limits which break our full-range scan
const RPC_URLS = [
  "https://arb1.arbitrum.io/rpc",           // Public - allows large ranges
  "https://arbitrum-one.publicnode.com",    // Public - allows large ranges
  "https://rpc.ankr.com/arbitrum",          // Public
  "https://arbitrum.drpc.org",              // Public
  // Alchemy last - has 10k block limit for getLogs
  process.env.PONDER_RPC_URL_42161,
].filter(Boolean) as string[];

/**
 * Create a client with a specific RPC
 */
function createClient(rpcUrl: string) {
  return createPublicClient({
    chain: arbitrum,
    transport: http(rpcUrl, { timeout: 30000 }),
  });
}

/**
 * Try eth_getLogs to find all events
 */
async function findEventsWithLogs(
  client: ReturnType<typeof createPublicClient>,
  startBlock: number,
  endBlock: number
): Promise<{ firstEventBlock: number; totalEvents: number } | null> {
  console.log(`[LogScan] Fetching logs from ${startBlock} to ${endBlock}...`);

  const logs = await client.getLogs({
    address: CONTRACT_ADDRESS,
    fromBlock: BigInt(startBlock),
    toBlock: BigInt(endBlock),
  });

  if (logs.length === 0) {
    console.log("[LogScan] No events found");
    return null;
  }

  const eventBlocks = [...new Set(logs.map(log => Number(log.blockNumber)))].sort((a, b) => a - b);
  console.log(`[LogScan] Found ${logs.length} events across ${eventBlocks.length} blocks`);
  console.log(`[LogScan] First event block: ${eventBlocks[0]}`);

  return {
    firstEventBlock: eventBlocks[0],
    totalEvents: logs.length,
  };
}

/**
 * Get ethReserve at a specific block
 */
async function getReserveAtBlock(
  client: ReturnType<typeof createPublicClient>,
  blockNumber: number
): Promise<bigint> {
  try {
    return await client.readContract({
      address: CONTRACT_ADDRESS,
      abi: ZkAMMWithTokenAbi,
      functionName: "ethReserve",
      blockNumber: BigInt(blockNumber),
    });
  } catch {
    return 0n;
  }
}

/**
 * State-based binary search - finds when ethReserve CHANGED (not just > 0)
 * This handles contracts initialized with liquidity at deployment
 */
async function stateChangeBinarySearch(
  client: ReturnType<typeof createPublicClient>,
  startBlock: number,
  endBlock: number
): Promise<number | null> {
  console.log(`[StateScan] Finding state changes from ${startBlock} to ${endBlock}...`);

  // Get initial state at deployment
  const initialReserve = await getReserveAtBlock(client, startBlock);
  const currentReserve = await getReserveAtBlock(client, endBlock);

  console.log(`[StateScan] Initial reserve: ${initialReserve}, Current: ${currentReserve}`);

  if (initialReserve === currentReserve) {
    console.log("[StateScan] No state change detected");
    return null;
  }

  let low = startBlock;
  let high = endBlock;
  let lastDifferentBlock = endBlock;

  // Coarse scan - find first block where state differs from initial
  console.log(`[StateScan] Coarse scan (step: ${COARSE_STEP})...`);
  for (let block = startBlock; block <= endBlock; block += COARSE_STEP) {
    const reserve = await getReserveAtBlock(client, block);
    process.stdout.write(`\r[StateScan] Block ${block}: reserve=${reserve}`);

    if (reserve !== initialReserve) {
      lastDifferentBlock = block;
      high = block;
      low = Math.max(startBlock, block - COARSE_STEP);
      console.log(`\n[StateScan] State changed! Narrowing to ${low}-${high}`);
      break;
    }
  }

  if (low === startBlock && high === endBlock) {
    // Didn't find change in coarse scan, use last different block
    console.log(`[StateScan] Change is near current block`);
    return lastDifferentBlock;
  }

  // Binary search to find exact block where state changed
  console.log(`[StateScan] Binary search in range ${low}-${high}...`);
  while (high - low > FINE_THRESHOLD) {
    const mid = Math.floor((low + high) / 2);
    const reserve = await getReserveAtBlock(client, mid);

    if (reserve !== initialReserve) {
      high = mid;
    } else {
      low = mid;
    }
  }

  // Fine scan for exact block
  console.log(`[StateScan] Fine scan ${low}-${high}...`);
  for (let block = low; block <= high; block++) {
    const reserve = await getReserveAtBlock(client, block);
    if (reserve !== initialReserve) {
      console.log(`[StateScan] First state change at block ${block}`);
      return block;
    }
  }

  return high;
}

/**
 * Main function: Find first activity block with multiple RPC fallbacks
 */
async function findFirstActivityBlock(): Promise<number> {
  console.log("=".repeat(60));
  console.log("Finding First Activity Block");
  console.log("=".repeat(60));
  console.log(`Contract: ${CONTRACT_ADDRESS}`);
  console.log(`RPCs to try: ${RPC_URLS.length}`);
  console.log("=".repeat(60));

  const startTime = Date.now();

  // Try each RPC until one works
  for (let i = 0; i < RPC_URLS.length; i++) {
    const rpcUrl = RPC_URLS[i];
    console.log(`\n[Attempt ${i + 1}/${RPC_URLS.length}] Using RPC: ${rpcUrl.slice(0, 50)}...`);

    try {
      const client = createClient(rpcUrl);
      const currentBlock = await client.getBlockNumber();
      console.log(`[RPC] Connected! Current block: ${currentBlock}`);

      // Try eth_getLogs first
      try {
        const logResult = await findEventsWithLogs(client, DEPLOYMENT_BLOCK, Number(currentBlock));
        if (logResult) {
          const optimizedBlock = Math.max(DEPLOYMENT_BLOCK, logResult.firstEventBlock - 10);
          const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
          console.log(`\n${"=".repeat(60)}`);
          console.log(`RESULT: First event at ${logResult.firstEventBlock}`);
          console.log(`Optimized startBlock: ${optimizedBlock}`);
          console.log(`Time: ${elapsed}s`);
          console.log("=".repeat(60));
          return optimizedBlock;
        }
      } catch (logErr) {
        console.log(`[LogScan] Failed: ${String(logErr).slice(0, 100)}`);
      }

      // Fallback to state-based search - finds when state CHANGED (works on any RPC)
      console.log("[Fallback] Trying state-change binary search...");
      try {
        const stateResult = await stateChangeBinarySearch(client, DEPLOYMENT_BLOCK, Number(currentBlock));
        if (stateResult) {
          const optimizedBlock = Math.max(DEPLOYMENT_BLOCK, stateResult - 10);
          const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
          console.log(`\n${"=".repeat(60)}`);
          console.log(`RESULT: First state change at ${stateResult}`);
          console.log(`Optimized startBlock: ${optimizedBlock}`);
          console.log(`Time: ${elapsed}s`);
          console.log("=".repeat(60));
          return optimizedBlock;
        }
      } catch (stateErr) {
        console.log(`[StateScan] Failed: ${String(stateErr).slice(0, 100)}`);
      }

    } catch (rpcErr) {
      console.log(`[RPC] Failed to connect: ${String(rpcErr).slice(0, 100)}`);
    }
  }

  // All RPCs failed - use known first event block
  console.log(`\n${"=".repeat(60)}`);
  console.log(`WARNING: All RPCs failed, using known first event block`);
  console.log(`Optimized startBlock: ${KNOWN_FIRST_EVENT}`);
  console.log("=".repeat(60));
  return KNOWN_FIRST_EVENT;
}

// Run if executed directly
const isMainModule = import.meta.url === `file://${process.argv[1]}`;

if (isMainModule) {
  findFirstActivityBlock()
    .then((block) => {
      console.log(`\nOPTIMIZED_START_BLOCK=${block}`);
      process.exit(0);
    })
    .catch((error) => {
      console.error("Error:", error);
      console.log(`Falling back to known block: ${KNOWN_FIRST_EVENT}`);
      console.log(`\nOPTIMIZED_START_BLOCK=${KNOWN_FIRST_EVENT}`);
      process.exit(0); // Don't fail - use fallback
    });
}

export { findFirstActivityBlock };
