import { onchainTable, index } from "@ponder/core";

export const trades = onchainTable("trades", (t) => ({
  id: t.text().primaryKey(),
  type: t.text().notNull(), // 'buy', 'sell', 'add_lp', 'remove_lp', 'claim_fees'
  ethAmount: t.text().notNull(), // Store as string to preserve precision
  tokenAmount: t.text().notNull(),
  price: t.text().notNull(), // tokens per ETH (or '0' for LP ops)
  lpShares: t.text(), // LP shares for LP operations (optional)
  blockNumber: t.bigint().notNull(),
  timestamp: t.bigint().notNull(),
  transactionHash: t.text().notNull(),
  address: t.text().notNull(), // contract address
}));

export const commitments = onchainTable(
  "commitments",
  (t) => ({
    id: t.text().primaryKey(),
    commitment: t.text().notNull(),
    leafIndex: t.bigint().notNull(),
    encryptedNote: t.text().notNull(),
    blockNumber: t.bigint().notNull(),
    timestamp: t.bigint().notNull(),
    transactionHash: t.text().notNull(),
    address: t.text().notNull(), // contract address
  }),
  (table) => ({
    addressIdx: index("commitments_address_idx").on(table.address),
  })
);

export const withdrawals = onchainTable("withdrawals", (t) => ({
  id: t.text().primaryKey(),
  nullifierHash: t.text().notNull(),
  recipient: t.text().notNull(),
  amount: t.text().notNull(),
  blockNumber: t.bigint().notNull(),
  timestamp: t.bigint().notNull(),
  transactionHash: t.text().notNull(),
  address: t.text().notNull(), // contract address
}));

export const nullifiers = onchainTable("nullifiers", (t) => ({
  id: t.text().primaryKey(), // nullifierHash
  transactionHash: t.text().notNull(),
  blockNumber: t.bigint().notNull(),
  timestamp: t.bigint().notNull(),
  address: t.text().notNull(), // contract address
}));

export const stats = onchainTable("stats", (t) => ({
  id: t.text().primaryKey(), // 'global'
  totalVolume: t.text().notNull(),
  totalTrades: t.integer().notNull(),
  lastPrice: t.text().notNull(),
  updatedAt: t.bigint().notNull(),
}));

// Merkle tree state - stores the full tree for proof generation
export const merkleTreeState = onchainTable("merkle_tree_state", (t) => ({
  id: t.text().primaryKey(), // contract address
  nextIndex: t.bigint().notNull(),
  currentRoot: t.text().notNull(),
  // Store filled subtrees as JSON array of strings
  filledSubtrees: t.text().notNull(), // JSON array
  // Store all leaves as JSON array
  leaves: t.text().notNull(), // JSON array
  updatedAt: t.bigint().notNull(),
}));

// Store merkle roots with timestamps for historical lookups
export const merkleRoots = onchainTable("merkle_roots", (t) => ({
  id: t.text().primaryKey(), // root value
  leafIndex: t.bigint().notNull(), // index when this root was created
  blockNumber: t.bigint().notNull(),
  timestamp: t.bigint().notNull(),
}));

// Pool state - updated on every trade for swapper UI
export const poolState = onchainTable("pool_state", (t) => ({
  id: t.text().primaryKey(), // contract address
  ethReserve: t.text().notNull(), // wei as string
  tokenReserve: t.text().notNull(), // wei as string
  tokenPrice: t.text().notNull(), // tokens per ETH as string
  blockNumber: t.bigint().notNull(),
  timestamp: t.bigint().notNull(),
}));

// ============ LP (Liquidity Provider) Tables ============

// LP positions - tracks private LP deposits
export const lpPositions = onchainTable("lp_positions", (t) => ({
  id: t.text().primaryKey(), // commitment
  commitment: t.text().notNull(),
  leafIndex: t.bigint().notNull(),
  ethAmount: t.text().notNull(), // ETH deposited
  tokenAmount: t.text().notNull(), // Token deposited (0 for ETH-only)
  lpShares: t.text().notNull(), // LP shares received
  encryptedNote: t.text().notNull(),
  blockNumber: t.bigint().notNull(),
  timestamp: t.bigint().notNull(),
  transactionHash: t.text().notNull(),
  address: t.text().notNull(), // contract address
}));

// LP withdrawals - tracks private LP removals
export const lpWithdrawals = onchainTable("lp_withdrawals", (t) => ({
  id: t.text().primaryKey(),
  nullifierHash: t.text().notNull(),
  ethOut: t.text().notNull(),
  tokensOut: t.text().notNull(),
  blockNumber: t.bigint().notNull(),
  timestamp: t.bigint().notNull(),
  transactionHash: t.text().notNull(),
  address: t.text().notNull(), // contract address
}));

// LP fee claims - tracks fee claims by LPs
export const lpFeeClaims = onchainTable("lp_fee_claims", (t) => ({
  id: t.text().primaryKey(),
  commitment: t.text().notNull(), // LP commitment that claimed
  recipient: t.text().notNull(),
  amount: t.text().notNull(), // ETH claimed
  blockNumber: t.bigint().notNull(),
  timestamp: t.bigint().notNull(),
  transactionHash: t.text().notNull(),
  address: t.text().notNull(), // contract address
}));

// ============ Pledge (anonymous plot funding) Tables ============
// Phase C emits PledgeCommitment / PledgeClaimed from the pledge vault. The
// commitment tree is maintained in `merkleTreeState` keyed by the pledge vault
// address (same handler shape as zkAMM NewCommitment), so the frontend can build
// claim proofs with the existing MERKLE_TREE_STATE_QUERY.

// Pledge commitments - private plot pledges, one leaf per shielded pledge
export const pledgeCommitments = onchainTable(
  "pledge_commitments",
  (t) => ({
    id: t.text().primaryKey(),
    commitment: t.text().notNull(),
    leafIndex: t.bigint().notNull(),
    parcelId: t.text().notNull(), // bytes32 parcel the pledge is bound to
    note: t.text().notNull(), // encrypted pledge note (client-decryptable)
    blockNumber: t.bigint().notNull(),
    timestamp: t.bigint().notNull(),
    transactionHash: t.text().notNull(),
    address: t.text().notNull(), // pledge vault contract address
  }),
  (table) => ({
    parcelIdx: index("pledge_commitments_parcel_idx").on(table.parcelId),
    addressIdx: index("pledge_commitments_address_idx").on(table.address),
  })
);

// Pledge nullifiers - spent pledge nullifiers (a pledge that has been claimed)
export const pledgeNullifiers = onchainTable("pledge_nullifiers", (t) => ({
  id: t.text().primaryKey(), // nullifierHash
  transactionHash: t.text().notNull(),
  blockNumber: t.bigint().notNull(),
  timestamp: t.bigint().notNull(),
  address: t.text().notNull(), // pledge vault contract address
}));

// Pledge claims - a pledge claimed out to a recipient wallet
export const pledgeClaims = onchainTable("pledge_claims", (t) => ({
  id: t.text().primaryKey(),
  nullifierHash: t.text().notNull(),
  recipient: t.text().notNull(),
  parcelId: t.text().notNull(),
  amount: t.text().notNull(),
  blockNumber: t.bigint().notNull(),
  timestamp: t.bigint().notNull(),
  transactionHash: t.text().notNull(),
  address: t.text().notNull(), // pledge vault contract address
}));

// LP nullifiers - tracks spent LP nullifiers
export const lpNullifiers = onchainTable("lp_nullifiers", (t) => ({
  id: t.text().primaryKey(), // nullifierHash
  transactionHash: t.text().notNull(),
  blockNumber: t.bigint().notNull(),
  timestamp: t.bigint().notNull(),
  address: t.text().notNull(), // contract address
}));

// LP stats - global LP statistics
export const lpStats = onchainTable("lp_stats", (t) => ({
  id: t.text().primaryKey(), // 'global'
  totalLPShares: t.text().notNull(),
  totalETHDeposited: t.text().notNull(),
  totalETHWithdrawn: t.text().notNull(),
  totalFeesClaimed: t.text().notNull(),
  totalPositions: t.integer().notNull(),
  totalWithdrawals: t.integer().notNull(),
  totalClaims: t.integer().notNull(),
  updatedAt: t.bigint().notNull(),
}));
