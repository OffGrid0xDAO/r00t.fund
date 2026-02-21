import { createConfig, rateLimit } from "@ponder/core";
import { http } from "viem";

import { ZkAMMWithTokenAbi } from "./abis/ZkAMMWithToken";

// Environment-based network selection
const NETWORK = process.env.PONDER_NETWORK || "sepolia"; // Default to sepolia for testing

// Arbitrum mainnet config
const ARBITRUM_FIRST_BLOCK = 420982912;
const ARBITRUM_ADDRESS = "0xc7E7fD3bC101621F588a3A47cf03343BFAC05451";
const ARBITRUM_RPC = process.env.PONDER_RPC_URL_42161 || "https://arb1.arbitrum.io/rpc";

// Sepolia testnet config (fresh deploy - 2026-02-06, configurable OI limit + liquidation fix)
// Deployed at block 10206123
const SEPOLIA_FIRST_BLOCK = 10206123;
const SEPOLIA_ZKAMM_ADDRESS = "0xd1b972eb47626B67Fe700ee9F3Ab4Fe76751b630"; // ZkAMM Router
const SEPOLIA_ZKAMM_PAIR_ADDRESS = "0xdacF977d96840748EB5624508BF98fc5E8CC84E1"; // ZkAMM Pair (emits NewCommitment + TokensSold/TokensPurchased from shorts)
const SEPOLIA_LP_POOL_ADDRESS = "0x6b0b337D69C3f79f7f0Aac59cc5eaf953D0F8580"; // LPPool (LP commitments)
const SEPOLIA_RPC = process.env.PONDER_RPC_URL_11155111 || "https://eth-sepolia.g.alchemy.com/v2/demo";

// ABI for Pair events (NewCommitment AND NewLPCommitment come from Pair, NOT TokenPool/LPPool)
// The Pair calls tokenPool.insert() which emits LeafInserted, then Pair emits NewCommitment
// The Pair also emits NewLPCommitment when LP positions are created
const PairAbi = [
  {
    type: "event",
    name: "NewCommitment",
    inputs: [
      { type: "uint256", indexed: true, name: "commitment" },
      { type: "uint256", indexed: true, name: "leafIndex" },
      { type: "bytes", indexed: false, name: "encryptedNote" },
    ],
  },
  {
    type: "event",
    name: "NullifierSpent",
    inputs: [{ type: "uint256", indexed: true, name: "nullifierHash" }],
  },
  {
    type: "event",
    name: "PublicWithdrawal",
    inputs: [
      { type: "uint256", indexed: true, name: "nullifierHash" },
      { type: "address", indexed: true, name: "recipient" },
      { type: "uint256", indexed: false, name: "amount" },
    ],
  },
  // LP events are also emitted by Pair, not LPPool
  {
    type: "event",
    name: "NewLPCommitment",
    inputs: [
      { type: "uint256", indexed: true, name: "commitment" },
      { type: "uint256", indexed: true, name: "leafIndex" },
      { type: "uint256", indexed: false, name: "lpShares" },
      { type: "bytes", indexed: false, name: "encryptedNote" },
    ],
  },
  {
    type: "event",
    name: "LPNullifierSpent",
    inputs: [{ type: "uint256", indexed: true, name: "nullifierHash" }],
  },
  // Shorts trade events (emitted by Pair when R00TShorts sells/buys tokens)
  {
    type: "event",
    name: "TokensSold",
    inputs: [
      { type: "uint256", indexed: false, name: "tokensIn" },
      { type: "uint256", indexed: false, name: "ethOut" },
    ],
  },
  {
    type: "event",
    name: "TokensPurchased",
    inputs: [
      { type: "uint256", indexed: false, name: "ethIn" },
      { type: "uint256", indexed: false, name: "tokensOut" },
    ],
  },
] as const;

export default createConfig({
  database: process.env.DATABASE_URL
    ? { kind: "postgres", connectionString: process.env.DATABASE_URL }
    : { kind: "pglite" },
  server: {
    port: parseInt(process.env.PORT || "42069"),
  },
  networks: {
    // Include both networks, PONDER_NETWORK env var determines which contracts are active
    ...(NETWORK === "arbitrum" && {
      arbitrum: {
        chainId: 42161,
        transport: rateLimit(http(ARBITRUM_RPC), { requestsPerSecond: 10 }),
        // Arbitrum has ~250ms blocks but we don't need sub-second updates
        // Poll every 4s to drastically reduce Railway egress while staying reasonably fresh
        pollingInterval: 4_000,
        maxRequestsPerSecond: 10,
      },
    }),
    ...(NETWORK === "sepolia" && {
      sepolia: {
        chainId: 11155111,
        // Reduced rate limit to avoid exhausting Alchemy free tier
        transport: rateLimit(http(SEPOLIA_RPC), { requestsPerSecond: 2 }),
        // Sepolia block time is ~12s, polling every 1s (default) wastes 11/12 requests
        // Poll every 15s to minimize Railway costs while catching every block
        pollingInterval: 15_000,
        maxRequestsPerSecond: 2,
      },
    }),
  },
  contracts: {
    // ZkAMM Router - handles trades, LP operations
    ZkAMMWithToken: {
      network: NETWORK === "arbitrum" ? "arbitrum" : "sepolia",
      abi: ZkAMMWithTokenAbi,
      address: NETWORK === "arbitrum" ? ARBITRUM_ADDRESS : SEPOLIA_ZKAMM_ADDRESS,
      startBlock: NETWORK === "arbitrum" ? ARBITRUM_FIRST_BLOCK : SEPOLIA_FIRST_BLOCK,
    },
    // ZkAMMPair - handles token AND LP commitments
    // NewCommitment, NewLPCommitment, NullifierSpent, LPNullifierSpent all come from Pair
    ...(NETWORK === "sepolia" && {
      ZkAMMPair: {
        network: "sepolia",
        abi: PairAbi,
        address: SEPOLIA_ZKAMM_PAIR_ADDRESS,
        startBlock: SEPOLIA_FIRST_BLOCK,
      },
    }),
  },
});
