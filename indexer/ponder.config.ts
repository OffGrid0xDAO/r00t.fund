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

// Tenderly VNet config (CRE + ZK trading simulation environment)
const TENDERLY_FIRST_BLOCK = 0;
const TENDERLY_ZKAMM_ADDRESS = "0x79D52AB5EdaCFdC868c53DF8dd685f309cA20884"; // ZkAMM Router
const TENDERLY_ZKAMM_PAIR_ADDRESS = "0xE9D2De4bfEadC1923B90B09C3c8b197Ae5eE979d"; // ZkAMM Pair
const TENDERLY_RPC = process.env.PONDER_RPC_URL_73571 || "https://virtual.sepolia.eu.rpc.tenderly.co/39fe020c-836e-4173-8786-5e726d0b3ba1";

// Robinhood Chain (4663) mainnet — deployed 2026-07-11
const ROBINHOOD_FIRST_BLOCK = 7139981;
const ROBINHOOD_ZKAMM_ADDRESS = "0x2EaFE93d9ecf8B8E2Dd0C5f0B5c86a374206C6B0"; // ZkAMM Router
const ROBINHOOD_ZKAMM_PAIR_ADDRESS = "0xbd34EF73b3Cb1b8Bb0fFba47a42AFdbA90Ccf511"; // ZkAMM Pair
const ROBINHOOD_RPC = process.env.PONDER_RPC_URL_4663 || "https://rpc.mainnet.chain.robinhood.com";

// Pledge vault (anonymous plot funding, Phase C). Address + start block are set
// after Phase C deploys — wire via PONDER_PLEDGE_ADDRESS / PONDER_PLEDGE_START_BLOCK
// (or paste below). The contract only registers when a real (non-placeholder)
// address is provided, so the indexer boots today against the frozen ABIs.
const PLEDGE_ADDRESS = process.env.PONDER_PLEDGE_ADDRESS || ""; // e.g. 0x… after Phase C
const PLEDGE_START_BLOCK = Number(process.env.PONDER_PLEDGE_START_BLOCK || ROBINHOOD_FIRST_BLOCK);
const PLEDGE_ENABLED = /^0x[0-9a-fA-F]{40}$/.test(PLEDGE_ADDRESS);

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

// LandVault events (private ETH/USDC funding of land parcels + dual claim):
//   Funded(commitment, leafIndex, parcelId, rootOut, paid, payToken, note)  → tree insert
//   ClaimedR00T(nullifierHash, recipient, parcelId, amount)                 → nullifier spend
//   ClaimedParcelToken(nullifierHash, recipient, parcelId, parcelOut)       → nullifier spend
const PledgeAbi = [
  {
    type: "event",
    name: "Funded",
    inputs: [
      { type: "uint256", indexed: true, name: "commitment" },
      { type: "uint256", indexed: true, name: "leafIndex" },
      { type: "bytes32", indexed: false, name: "parcelId" },
      { type: "uint256", indexed: false, name: "rootOut" },
      { type: "uint256", indexed: false, name: "paid" },
      { type: "address", indexed: false, name: "payToken" },
      { type: "bytes", indexed: false, name: "note" },
    ],
  },
  {
    type: "event",
    name: "ClaimedR00T",
    inputs: [
      { type: "uint256", indexed: true, name: "nullifierHash" },
      { type: "address", indexed: true, name: "recipient" },
      { type: "bytes32", indexed: false, name: "parcelId" },
      { type: "uint256", indexed: false, name: "amount" },
    ],
  },
  {
    type: "event",
    name: "ClaimedParcelToken",
    inputs: [
      { type: "uint256", indexed: true, name: "nullifierHash" },
      { type: "address", indexed: true, name: "recipient" },
      { type: "bytes32", indexed: false, name: "parcelId" },
      { type: "uint256", indexed: false, name: "parcelOut" },
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
    ...(NETWORK === "tenderly" && {
      tenderly: {
        chainId: 73571,
        transport: http(TENDERLY_RPC),
        // Tenderly VNet only produces blocks on-demand (no mining without txs)
        // Poll every 2s for responsive local dev
        pollingInterval: 2_000,
      },
    }),
    ...(NETWORK === "robinhood" && {
      robinhood: {
        chainId: 4663,
        // ~0.1s blocks; poll every 2s. Use a private RPC (PONDER_RPC_URL_4663) in prod.
        // 25 rps: Alchemy handles this comfortably and cuts the 637k-block historical
        // backfill from ~5h to ~30min. Override with PONDER_RPS if the RPC throttles.
        transport: rateLimit(http(ROBINHOOD_RPC), { requestsPerSecond: Number(process.env.PONDER_RPS) || 25 }),
        pollingInterval: 2_000,
        maxRequestsPerSecond: Number(process.env.PONDER_RPS) || 25,
      },
    }),
  },
  contracts: {
    // ZkAMM Router - handles trades, LP operations
    ZkAMMWithToken: {
      network: NETWORK === "arbitrum" ? "arbitrum" : NETWORK === "tenderly" ? "tenderly" : NETWORK === "robinhood" ? "robinhood" : "sepolia",
      abi: ZkAMMWithTokenAbi,
      address: NETWORK === "arbitrum" ? ARBITRUM_ADDRESS : NETWORK === "tenderly" ? TENDERLY_ZKAMM_ADDRESS : NETWORK === "robinhood" ? ROBINHOOD_ZKAMM_ADDRESS : SEPOLIA_ZKAMM_ADDRESS,
      startBlock: NETWORK === "arbitrum" ? ARBITRUM_FIRST_BLOCK : NETWORK === "tenderly" ? TENDERLY_FIRST_BLOCK : NETWORK === "robinhood" ? ROBINHOOD_FIRST_BLOCK : SEPOLIA_FIRST_BLOCK,
    },
    // ZkAMMPair - handles token AND LP commitments
    // NewCommitment, NewLPCommitment, NullifierSpent, LPNullifierSpent all come from Pair
    ...((NETWORK === "sepolia" || NETWORK === "tenderly" || NETWORK === "robinhood") && {
      ZkAMMPair: {
        network: NETWORK === "tenderly" ? "tenderly" : NETWORK === "robinhood" ? "robinhood" : "sepolia",
        abi: PairAbi,
        address: NETWORK === "tenderly" ? TENDERLY_ZKAMM_PAIR_ADDRESS : NETWORK === "robinhood" ? ROBINHOOD_ZKAMM_PAIR_ADDRESS : SEPOLIA_ZKAMM_PAIR_ADDRESS,
        startBlock: NETWORK === "tenderly" ? TENDERLY_FIRST_BLOCK : NETWORK === "robinhood" ? ROBINHOOD_FIRST_BLOCK : SEPOLIA_FIRST_BLOCK,
      },
    }),
    // PledgeVault — anonymous plot funding (Phase C). Only registered once a real
    // address is wired (PONDER_PLEDGE_ADDRESS), so a placeholder never breaks boot.
    ...(NETWORK === "robinhood" && PLEDGE_ENABLED && {
      PledgeVault: {
        network: "robinhood",
        abi: PledgeAbi,
        address: PLEDGE_ADDRESS as `0x${string}`,
        startBlock: PLEDGE_START_BLOCK,
      },
    }),
  },
});
