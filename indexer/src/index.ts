import { ponder } from "@/generated";
import { formatEther, formatUnits } from "viem";
import { buildPoseidon } from "circomlibjs";
import { trades, commitments, withdrawals, nullifiers, stats, merkleTreeState, merkleRoots, poolState, lpPositions, lpWithdrawals, lpFeeClaims, lpNullifiers, lpStats } from "../ponder.schema";

// Pair address holds reserves (ethReserve, tokenReserve, getTokenPrice)
// Trade events come from Router, but reserves live on Pair
const PAIR_ADDRESS = (process.env.PONDER_NETWORK === "arbitrum"
  ? "0xc7E7fD3bC101621F588a3A47cf03343BFAC05451"
  : "0xdacF977d96840748EB5624508BF98fc5E8CC84E1"
).toLowerCase();

// Constants matching the on-chain TokenPool
const TREE_DEPTH = 24;

// Zero hashes for empty tree (precomputed)
let ZEROS: bigint[] = [];
let poseidon: any = null;

// Initialize Poseidon and zero hashes
async function initPoseidon() {
  if (poseidon) return;
  poseidon = await buildPoseidon();

  // Compute zero hashes - each level is hash of previous level's zero with itself
  // Level 0 zero MUST match the contract's ZERO_VALUE from TokenPool.sol
  let currentZero = BigInt("21663839004416932945382355908790599225266501822907911457504978515578255421292");

  ZEROS = [currentZero];
  for (let i = 1; i <= TREE_DEPTH; i++) {
    currentZero = hashPair(currentZero, currentZero);
    ZEROS.push(currentZero);
  }
}

// Poseidon hash function
function hashPair(left: bigint, right: bigint): bigint {
  if (!poseidon) throw new Error("Poseidon not initialized");
  const hash = poseidon.F.toString(poseidon([left, right]));
  return BigInt(hash);
}

// Insert a leaf and return updated state
function insertLeaf(
  leaf: bigint,
  filledSubtrees: bigint[],
  nextIndex: number
): { newRoot: bigint; newFilledSubtrees: bigint[]; newNextIndex: number } {
  let currentIndex = nextIndex;
  let currentHash = leaf;
  const newFilledSubtrees = [...filledSubtrees];

  for (let level = 0; level < TREE_DEPTH; level++) {
    if (currentIndex % 2 === 0) {
      newFilledSubtrees[level] = currentHash;
      currentHash = hashPair(currentHash, ZEROS[level]);
    } else {
      currentHash = hashPair(newFilledSubtrees[level], currentHash);
    }
    currentIndex = Math.floor(currentIndex / 2);
  }

  return {
    newRoot: currentHash,
    newFilledSubtrees,
    newNextIndex: nextIndex + 1
  };
}

// Helper to update pool state by reading reserves from the PAIR contract
// Trade events come from the Router, but reserves (ethReserve, tokenReserve) live on the Pair.
// Pool state is stored under the Pair address so the frontend can query it consistently.
// Only runs for recent blocks (within 5 minutes) to avoid RPC spam during historical sync
async function updatePoolState(context: any, _eventAddress: string, blockNumber: bigint, timestamp: bigint) {
  // Skip if block is older than 5 minutes (historical sync)
  const nowSeconds = BigInt(Math.floor(Date.now() / 1000));
  const fiveMinutesAgo = nowSeconds - 300n;
  if (timestamp < fiveMinutesAgo) {
    return; // Skip historical events to avoid RPC spam
  }

  const { db, client } = context;

  // Always read reserves from the PAIR contract (not Router)
  const readAddress = PAIR_ADDRESS as `0x${string}`;

  try {
    const [ethReserve, tokenReserve, tokenPrice] = await Promise.all([
      client.readContract({
        abi: context.contracts.ZkAMMWithToken.abi,
        address: readAddress,
        functionName: "ethReserve",
      }),
      client.readContract({
        abi: context.contracts.ZkAMMWithToken.abi,
        address: readAddress,
        functionName: "tokenReserve",
      }),
      client.readContract({
        abi: context.contracts.ZkAMMWithToken.abi,
        address: readAddress,
        functionName: "getTokenPrice",
      }),
    ]);

    // Store under Pair address (frontend queries by Pair address)
    const existingPoolState = await db.find(poolState, { id: PAIR_ADDRESS });

    if (existingPoolState) {
      await db.update(poolState, { id: PAIR_ADDRESS }).set({
        ethReserve: ethReserve.toString(),
        tokenReserve: tokenReserve.toString(),
        tokenPrice: tokenPrice.toString(),
        blockNumber,
        timestamp,
      });
    } else {
      await db.insert(poolState).values({
        id: PAIR_ADDRESS,
        ethReserve: ethReserve.toString(),
        tokenReserve: tokenReserve.toString(),
        tokenPrice: tokenPrice.toString(),
        blockNumber,
        timestamp,
      });
    }
  } catch (err) {
    // Expected during historical sync or if Pair doesn't support these functions
  }
}

// Reusable handler for NewCommitment events (from Pair or Router)
async function handleNewCommitment({ event, context }: any) {
  await initPoseidon();
  const { db } = context;
  const { commitment, leafIndex, encryptedNote } = event.args;
  const contractAddress = event.log.address.toLowerCase();

  console.log(`[Ponder] Processing NewCommitment for ${contractAddress} at block ${event.block.number}`);

  await db.insert(commitments).values({
    id: event.log.id,
    commitment: commitment.toString(),
    leafIndex,
    encryptedNote,
    blockNumber: event.block.number,
    timestamp: event.block.timestamp,
    transactionHash: event.transaction.hash,
    address: contractAddress,
  });

  const existingState = await db.find(merkleTreeState, { id: contractAddress });

  let leaves: string[];
  let filledSubtrees: bigint[];
  let nextIndex: number;

  if (!existingState) {
    leaves = [];
    filledSubtrees = ZEROS.slice(0, TREE_DEPTH);
    nextIndex = 0;
  } else {
    leaves = JSON.parse(existingState.leaves);
    filledSubtrees = JSON.parse(existingState.filledSubtrees).map((s: string) => BigInt(s));
    nextIndex = Number(existingState.nextIndex);
  }

  const newLeaf = BigInt(commitment.toString());
  const index = Number(leafIndex);

  while (leaves.length < index) {
    leaves.push(ZEROS[0].toString());
  }

  if (leaves.length === index) {
    leaves.push(newLeaf.toString());
  } else {
    leaves[index] = newLeaf.toString();
  }

  const { newRoot, newFilledSubtrees, newNextIndex } = insertLeaf(
    newLeaf,
    filledSubtrees,
    nextIndex
  );

  await db.insert(merkleRoots).values({
    id: newRoot.toString(),
    leafIndex: BigInt(newNextIndex - 1),
    blockNumber: event.block.number,
    timestamp: event.block.timestamp,
  });

  if (existingState) {
    await db.update(merkleTreeState, { id: contractAddress }).set({
      nextIndex: BigInt(newNextIndex),
      currentRoot: newRoot.toString(),
      filledSubtrees: JSON.stringify(newFilledSubtrees.map(s => s.toString())),
      leaves: JSON.stringify(leaves),
      updatedAt: event.block.timestamp,
    });
  } else {
    await db.insert(merkleTreeState).values({
      id: contractAddress,
      nextIndex: BigInt(newNextIndex),
      currentRoot: newRoot.toString(),
      filledSubtrees: JSON.stringify(newFilledSubtrees.map(s => s.toString())),
      leaves: JSON.stringify(leaves),
      updatedAt: event.block.timestamp,
    });
  }
}

// Event Handlers
// Shared handler for TokensPurchased (buy) events - used by both Router and Pair (shorts)
async function handleTokensPurchased({ event, context }: any) {
  console.log("[Ponder] Processing TokensPurchased event at block", event.block.number);
  const { db } = context;
  const { ethIn, tokensOut } = event.args;
  const ethAmount = formatEther(ethIn);
  const tokenAmount = formatUnits(tokensOut, 18);
  const price = (Number(tokenAmount) / Number(ethAmount)).toString();

  await db.insert(trades).values({
    id: event.log.id,
    type: "buy",
    ethAmount,
    tokenAmount,
    price,
    blockNumber: event.block.number,
    timestamp: event.block.timestamp,
    transactionHash: event.transaction.hash,
    address: event.log.address.toLowerCase(),
  });

  const existingStats = await db.find(stats, { id: "global" });
  if (existingStats) {
    await db.update(stats, { id: "global" }).set({
      totalVolume: (Number(existingStats.totalVolume) + Number(ethAmount)).toString(),
      totalTrades: existingStats.totalTrades + 1,
      lastPrice: price,
      updatedAt: event.block.timestamp,
    });
  } else {
    await db.insert(stats).values({
      id: "global",
      totalVolume: ethAmount,
      totalTrades: 1,
      lastPrice: price,
      updatedAt: event.block.timestamp,
    });
  }

  await updatePoolState(context, PAIR_ADDRESS, event.block.number, event.block.timestamp);
}

// Shared handler for TokensSold (sell) events - used by both Router and Pair (shorts)
async function handleTokensSold({ event, context }: any) {
  console.log("[Ponder] Processing TokensSold event at block", event.block.number);
  const { db } = context;
  const { tokensIn, ethOut } = event.args;
  const ethAmount = formatEther(ethOut);
  const tokenAmount = formatUnits(tokensIn, 18);
  const price = (Number(tokenAmount) / Number(ethAmount)).toString();

  await db.insert(trades).values({
    id: event.log.id,
    type: "sell",
    ethAmount,
    tokenAmount,
    price,
    blockNumber: event.block.number,
    timestamp: event.block.timestamp,
    transactionHash: event.transaction.hash,
    address: event.log.address.toLowerCase(),
  });

  const existingStats = await db.find(stats, { id: "global" });
  if (existingStats) {
    await db.update(stats, { id: "global" }).set({
      totalVolume: (Number(existingStats.totalVolume) + Number(ethAmount)).toString(),
      totalTrades: existingStats.totalTrades + 1,
      lastPrice: price,
      updatedAt: event.block.timestamp,
    });
  } else {
    await db.insert(stats).values({
      id: "global",
      totalVolume: ethAmount,
      totalTrades: 1,
      lastPrice: price,
      updatedAt: event.block.timestamp,
    });
  }

  await updatePoolState(context, PAIR_ADDRESS, event.block.number, event.block.timestamp);
}

// Router trade events (regular swaps)
ponder.on("ZkAMMWithToken:TokensPurchased", handleTokensPurchased);
ponder.on("ZkAMMWithToken:TokensSold", handleTokensSold);

// Pair trade events (shorts open/close via R00TShorts)
ponder.on("ZkAMMPair:TokensPurchased", handleTokensPurchased);
ponder.on("ZkAMMPair:TokensSold", handleTokensSold);

ponder.on("ZkAMMPair:NewCommitment", handleNewCommitment);
ponder.on("ZkAMMWithToken:NewCommitment", handleNewCommitment);

ponder.on("ZkAMMPair:NullifierSpent", async ({ event, context }) => {
  const { db } = context;
  const { nullifierHash } = event.args;
  await db.insert(nullifiers).values({
    id: nullifierHash.toString(),
    transactionHash: event.transaction.hash,
    blockNumber: event.block.number,
    timestamp: event.block.timestamp,
    address: event.log.address.toLowerCase(),
  });
});

ponder.on("ZkAMMPair:PublicWithdrawal", async ({ event, context }) => {
  const { db } = context;
  const { nullifierHash, recipient, amount } = event.args;
  await db.insert(withdrawals).values({
    id: event.log.id,
    nullifierHash: nullifierHash.toString(),
    recipient,
    amount: formatUnits(amount, 18),
    blockNumber: event.block.number,
    timestamp: event.block.timestamp,
    transactionHash: event.transaction.hash,
    address: event.log.address.toLowerCase(),
  });
});

ponder.on("ZkAMMWithToken:LiquidityAddedPrivate", async ({ event, context }) => {
  const { db } = context;
  const { commitment, ethAmount, tokenAmount, lpShares } = event.args;
  const ethAmountStr = formatEther(ethAmount);
  const tokenAmountStr = formatUnits(tokenAmount, 18);
  const lpSharesStr = formatUnits(lpShares, 18);

  // Use upsert pattern to avoid duplicate key errors when events are processed multiple times
  const existingPosition = await db.find(lpPositions, { id: commitment.toString() });

  if (existingPosition) {
    // Update existing position with amounts from Router event
    await db.update(lpPositions, { id: commitment.toString() }).set({
      ethAmount: ethAmountStr,
      tokenAmount: tokenAmountStr,
      lpShares: lpSharesStr,
      blockNumber: event.block.number,
      timestamp: event.block.timestamp,
      transactionHash: event.transaction.hash,
    });
  } else {
    await db.insert(lpPositions).values({
      id: commitment.toString(),
      commitment: commitment.toString(),
      leafIndex: 0n,
      ethAmount: ethAmountStr,
      tokenAmount: tokenAmountStr,
      lpShares: lpSharesStr,
      encryptedNote: "",
      blockNumber: event.block.number,
      timestamp: event.block.timestamp,
      transactionHash: event.transaction.hash,
      address: event.log.address.toLowerCase(),
    });
  }

  await db.insert(trades).values({
    id: event.log.id,
    type: "add_lp",
    ethAmount: ethAmountStr,
    tokenAmount: tokenAmountStr,
    price: "0",
    lpShares: lpSharesStr,
    blockNumber: event.block.number,
    timestamp: event.block.timestamp,
    transactionHash: event.transaction.hash,
    address: event.log.address.toLowerCase(),
  });

  const existingLPStats = await db.find(lpStats, { id: "global" });
  if (existingLPStats) {
    await db.update(lpStats, { id: "global" }).set({
      totalLPShares: (Number(existingLPStats.totalLPShares) + Number(lpSharesStr)).toString(),
      totalETHDeposited: (Number(existingLPStats.totalETHDeposited) + Number(ethAmountStr)).toString(),
      totalPositions: existingLPStats.totalPositions + 1,
      updatedAt: event.block.timestamp,
    });
  } else {
    await db.insert(lpStats).values({
      id: "global",
      totalLPShares: lpSharesStr,
      totalETHDeposited: ethAmountStr,
      totalETHWithdrawn: "0",
      totalFeesClaimed: "0",
      totalPositions: 1,
      totalWithdrawals: 0,
      totalClaims: 0,
      updatedAt: event.block.timestamp,
    });
  }

  await updatePoolState(context, event.log.address.toLowerCase(), event.block.number, event.block.timestamp);
});

ponder.on("ZkAMMWithToken:LiquidityRemovedPrivate", async ({ event, context }) => {
  const { db } = context;
  const { nullifierHash, ethOut, tokensOut } = event.args;
  const ethOutStr = formatEther(ethOut);
  const tokensOutStr = formatUnits(tokensOut, 18);

  await db.insert(lpWithdrawals).values({
    id: event.log.id,
    nullifierHash: nullifierHash.toString(),
    ethOut: ethOutStr,
    tokensOut: tokensOutStr,
    blockNumber: event.block.number,
    timestamp: event.block.timestamp,
    transactionHash: event.transaction.hash,
    address: event.log.address.toLowerCase(),
  });

  await db.insert(trades).values({
    id: event.log.id,
    type: "remove_lp",
    ethAmount: ethOutStr,
    tokenAmount: tokensOutStr,
    price: "0",
    lpShares: null,
    blockNumber: event.block.number,
    timestamp: event.block.timestamp,
    transactionHash: event.transaction.hash,
    address: event.log.address.toLowerCase(),
  });

  const existingLPStats = await db.find(lpStats, { id: "global" });
  if (existingLPStats) {
    await db.update(lpStats, { id: "global" }).set({
      totalETHWithdrawn: (Number(existingLPStats.totalETHWithdrawn) + Number(ethOutStr)).toString(),
      totalWithdrawals: existingLPStats.totalWithdrawals + 1,
      updatedAt: event.block.timestamp,
    });
  }

  await updatePoolState(context, event.log.address.toLowerCase(), event.block.number, event.block.timestamp);
});

ponder.on("ZkAMMWithToken:LPFeesClaimed", async ({ event, context }) => {
  const { db } = context;
  const { claimNullifier, recipient, amount } = event.args;
  const amountStr = formatEther(amount);

  await db.insert(lpFeeClaims).values({
    id: event.log.id,
    commitment: claimNullifier.toString(), // This is the claim nullifier, stored in commitment field for compatibility
    recipient,
    amount: amountStr,
    blockNumber: event.block.number,
    timestamp: event.block.timestamp,
    transactionHash: event.transaction.hash,
    address: event.log.address.toLowerCase(),
  });

  await db.insert(trades).values({
    id: event.log.id,
    type: "claim_fees",
    ethAmount: amountStr,
    tokenAmount: "0",
    price: "0",
    lpShares: null,
    blockNumber: event.block.number,
    timestamp: event.block.timestamp,
    transactionHash: event.transaction.hash,
    address: event.log.address.toLowerCase(),
  });

  const existingLPStats = await db.find(lpStats, { id: "global" });
  if (existingLPStats) {
    await db.update(lpStats, { id: "global" }).set({
      totalFeesClaimed: (Number(existingLPStats.totalFeesClaimed) + Number(amountStr)).toString(),
      totalClaims: existingLPStats.totalClaims + 1,
      updatedAt: event.block.timestamp,
    });
  }
});

ponder.on("ZkAMMPair:NewLPCommitment", async ({ event, context }) => {
  const { db } = context;
  const { commitment, leafIndex, lpShares, encryptedNote } = event.args;
  const lpPoolAddress = event.log.address.toLowerCase();
  const existingPosition = await db.find(lpPositions, { id: commitment.toString() });

  if (existingPosition) {
    // Update existing position with leafIndex, encryptedNote, AND address
    // This ensures the address is always the LPPool address for consistent queries
    await db.update(lpPositions, { id: commitment.toString() }).set({
      leafIndex,
      encryptedNote,
      address: lpPoolAddress, // Normalize to LP Pool address
    });
  } else {
    await db.insert(lpPositions).values({
      id: commitment.toString(),
      commitment: commitment.toString(),
      leafIndex,
      ethAmount: "0",
      tokenAmount: "0",
      lpShares: formatUnits(lpShares, 18),
      encryptedNote,
      blockNumber: event.block.number,
      timestamp: event.block.timestamp,
      transactionHash: event.transaction.hash,
      address: lpPoolAddress,
    });
  }
});

ponder.on("ZkAMMPair:LPNullifierSpent", async ({ event, context }) => {
  const { db } = context;
  const { nullifierHash } = event.args;
  await db.insert(lpNullifiers).values({
    id: nullifierHash.toString(),
    transactionHash: event.transaction.hash,
    blockNumber: event.block.number,
    timestamp: event.block.timestamp,
    address: event.log.address.toLowerCase(),
  });
});
