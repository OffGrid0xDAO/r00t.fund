#!/usr/bin/env npx tsx
/**
 * Simple Market Maker - Buy-Only Mode
 *
 * A simplified version that only executes buy orders.
 * Perfect for generating volume without ZK proof complexity.
 * Use this for initial testing and LP reward generation.
 *
 * Usage:
 *   npx tsx scripts/market-maker-simple.ts
 */

import { ethers, Wallet } from 'ethers';
import { poseidon3 } from 'poseidon-lite';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env from contracts directory
const envPath = path.join(__dirname, '../contracts/.env');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf-8');
  envContent.split('\n').forEach(line => {
    const [key, ...valueParts] = line.split('=');
    if (key && valueParts.length > 0 && !process.env[key.trim()]) {
      process.env[key.trim()] = valueParts.join('=').trim();
    }
  });
  console.log('Loaded environment from contracts/.env');
}

// =============================================================================
// CONFIGURATION
// =============================================================================

const CONFIG = {
  // Network
  RPC_URL: process.env.SEPOLIA_RPC_URL || 'https://eth-sepolia.g.alchemy.com/v2/demo',

  // Contracts (Sepolia) - FRESH DEPLOY 2026-02-06 (configurable OI limit + liquidation fix)
  ZKAMM_ROUTER: '0xd1b972eb47626B67Fe700ee9F3Ab4Fe76751b630',
  ZKAMM_PAIR: '0xdacF977d96840748EB5624508BF98fc5E8CC84E1',

  // Agent settings
  NUM_AGENTS: 33,
  MASTER_SEED: process.env.MM_SEED || (() => { throw new Error('MM_SEED environment variable required'); })(),

  // Trading settings - MINIMAL ETH CONFIG (testing with very limited funds)
  MIN_TRADE_ETH: ethers.parseEther('0.001'),     // 0.001 ETH min
  MAX_TRADE_ETH: ethers.parseEther('0.003'),     // 0.003 ETH max
  GAS_BUFFER: ethers.parseEther('0.001'),        // Keep 0.001 ETH for gas
  TRADE_INTERVAL_MS: 3000,                        // 3 seconds between rounds
  MAX_ROUNDS: 30,                                 // Fewer rounds
  AGENTS_PER_ROUND: 2,                           // 2 agents per round
};

// BN254 field prime
const FIELD_PRIME = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;

// =============================================================================
// ABIs
// =============================================================================

const ZKAMM_ROUTER_ABI = [
  'function buyPrivate(uint256 newCommitment, uint256 minTokensOut, uint256 deadline, bytes encryptedNote) payable',
  'function getAmountOut(uint256 amountIn, uint256 reserveIn, uint256 reserveOut) view returns (uint256)',
  'event NewCommitment(uint256 indexed commitment, uint256 indexed leafIndex, bytes encryptedNote)',
  'event TokensPurchased(uint256 ethIn, uint256 tokensOut)',
];

const ZKAMM_PAIR_ABI = [
  'function ethReserve() view returns (uint256)',
  'function tokenReserve() view returns (uint256)',
];

// =============================================================================
// HELPERS
// =============================================================================

function randomFieldElement(): bigint {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let value = 0n;
  for (let i = 0; i < 32; i++) {
    value = (value << 8n) | BigInt(bytes[i]);
  }
  return value % FIELD_PRIME;
}

function hashCommitment(nullifier: bigint, secret: bigint, amount: bigint): bigint {
  return poseidon3([nullifier, secret, amount]);
}

function randomAmount(min: bigint, max: bigint): bigint {
  if (max <= min) return min;
  const range = max - min;
  return min + BigInt(Math.floor(Math.random() * Number(range)));
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// =============================================================================
// AGENT TYPES
// =============================================================================

type AgentType = 'WHALE' | 'MINNOW' | 'RANDOM' | 'STEADY' | 'BURST';

interface Agent {
  id: number;
  type: AgentType;
  wallet: Wallet;
  buys: number;
  totalSpent: bigint;
  totalTokens: bigint;
}

function getAgentType(index: number): AgentType {
  const types: AgentType[] = ['WHALE', 'MINNOW', 'RANDOM', 'STEADY', 'BURST'];
  return types[index % types.length];
}

function getTradeAmount(agentType: AgentType, maxBalance: bigint): bigint {
  const safeMax = maxBalance > CONFIG.MAX_TRADE_ETH ? CONFIG.MAX_TRADE_ETH : maxBalance;

  switch (agentType) {
    case 'WHALE':
      // Larger trades
      return randomAmount(safeMax / 2n, safeMax);
    case 'MINNOW':
      // Tiny trades
      return randomAmount(CONFIG.MIN_TRADE_ETH, CONFIG.MIN_TRADE_ETH * 3n);
    case 'RANDOM':
      // Completely random
      return randomAmount(CONFIG.MIN_TRADE_ETH, safeMax);
    case 'STEADY':
      // Consistent medium trades
      return (CONFIG.MIN_TRADE_ETH + safeMax) / 2n;
    case 'BURST':
      // Either tiny or large
      return Math.random() > 0.5 ? CONFIG.MIN_TRADE_ETH : safeMax;
    default:
      return CONFIG.MIN_TRADE_ETH;
  }
}

// =============================================================================
// MAIN
// =============================================================================

async function main() {
  console.log('\n==============================================');
  console.log('   ZkAMM Simple Market Maker (Buy Only)');
  console.log('==============================================\n');

  const provider = new ethers.JsonRpcProvider(CONFIG.RPC_URL);
  const router = new ethers.Contract(CONFIG.ZKAMM_ROUTER, ZKAMM_ROUTER_ABI, provider);
  const pair = new ethers.Contract(CONFIG.ZKAMM_PAIR, ZKAMM_PAIR_ABI, provider);

  // Get funder wallet
  const funderKey = process.env.PRIVATE_KEY;
  if (!funderKey) {
    console.error('ERROR: PRIVATE_KEY environment variable required');
    console.log('Usage: PRIVATE_KEY=0x... npx tsx scripts/market-maker-simple.ts');
    process.exit(1);
  }

  const funder = new Wallet(funderKey, provider);
  console.log('Funder:', funder.address);

  const funderBalance = await provider.getBalance(funder.address);
  console.log('Funder Balance:', ethers.formatEther(funderBalance), 'ETH\n');

  // Create agents by deriving keys from the funder's private key
  console.log('Creating 33 agents...\n');
  const agents: Agent[] = [];

  for (let i = 0; i < CONFIG.NUM_AGENTS; i++) {
    // Derive a unique private key for each agent using keccak256(funderKey + index)
    const derivedKey = ethers.keccak256(
      ethers.solidityPacked(['bytes32', 'uint256'], [funderKey, i + 1])
    );
    const agentType = getAgentType(i);
    agents.push({
      id: i + 1,
      type: agentType,
      wallet: new Wallet(derivedKey, provider),
      buys: 0,
      totalSpent: 0n,
      totalTokens: 0n,
    });
  }

  // Display agent addresses
  console.log('Agent Addresses:');
  agents.forEach((a, i) => {
    if (i < 5 || i >= CONFIG.NUM_AGENTS - 2) {
      console.log(`  ${a.id}. ${a.wallet.address} [${a.type}]`);
    } else if (i === 5) {
      console.log('  ...');
    }
  });

  // Fund agents that need it - skip if already have enough for several trades
  const minBalanceForTrading = CONFIG.GAS_BUFFER + CONFIG.MAX_TRADE_ETH * 2n; // ~0.007 ETH
  const topUpAmount = ethers.parseEther('0.003'); // Top up by 0.003 ETH when needed

  console.log(`\nChecking agent balances (min: ${ethers.formatEther(minBalanceForTrading)} ETH)...\n`);

  // Check all balances first
  const needsFunding: { agent: Agent; balance: bigint }[] = [];
  for (const agent of agents) {
    const balance = await provider.getBalance(agent.wallet.address);
    if (balance < minBalanceForTrading) {
      needsFunding.push({ agent, balance });
    }
  }

  if (needsFunding.length > 0) {
    console.log(`  ${needsFunding.length} agents need funding. Sending sequentially...\n`);

    // Get starting nonce
    let nonce = await provider.getTransactionCount(funder.address, 'pending');

    // Send funding transactions sequentially with explicit nonces
    for (const { agent, balance } of needsFunding) {
      try {
        const tx = await funder.sendTransaction({
          to: agent.wallet.address,
          value: topUpAmount,
          gasLimit: 21000,
          nonce: nonce++,
        });
        console.log(`  Agent ${agent.id}: ${ethers.formatEther(balance)} -> +${ethers.formatEther(topUpAmount)} ETH (tx: ${tx.hash.slice(0, 10)}...)`);
        await tx.wait();
      } catch (err: unknown) {
        console.log(`  Agent ${agent.id}: funding failed, skipping`);
      }
    }
    console.log(`\n  Funded agents!\n`);
  } else {
    console.log('  All agents have sufficient balance!\n');
  }

  // Trading loop
  console.log('Starting trading rounds...\n');
  console.log('Round | Agent | Type     | ETH Spent | Tokens Bought');
  console.log('------|-------|----------|-----------|---------------');

  let totalVolume = 0n;
  let totalTrades = 0;

  for (let round = 1; round <= CONFIG.MAX_ROUNDS; round++) {
    // Shuffle and pick random agents
    const shuffled = [...agents].sort(() => Math.random() - 0.5);
    const traders = shuffled.slice(0, CONFIG.AGENTS_PER_ROUND);

    for (const agent of traders) {
      try {
        // Check balance - need trade amount + gas buffer
        const balance = await provider.getBalance(agent.wallet.address);
        const availableForTrade = balance > CONFIG.GAS_BUFFER ? balance - CONFIG.GAS_BUFFER : 0n;
        if (availableForTrade < CONFIG.MIN_TRADE_ETH) {
          continue; // Skip if not enough for minimum trade + gas
        }

        // Get market state
        const ethReserve = await pair.ethReserve();
        const tokenReserve = await pair.tokenReserve();

        // Determine trade amount based on agent type
        const tradeAmount = getTradeAmount(agent.type, availableForTrade);

        if (tradeAmount < CONFIG.MIN_TRADE_ETH) continue;

        // Calculate expected tokens
        const expectedTokens = await router.getAmountOut(tradeAmount, ethReserve, tokenReserve);

        // Create commitment
        const nullifier = randomFieldElement();
        const secret = randomFieldElement();
        const commitment = hashCommitment(nullifier, secret, expectedTokens);

        // Set deadline
        const deadline = BigInt(Math.floor(Date.now() / 1000) + 600);

        // Execute buy
        const connectedRouter = router.connect(agent.wallet) as ethers.Contract;
        const tx = await connectedRouter.buyPrivate(commitment, 0n, deadline, '0x', {
          value: tradeAmount,
          gasLimit: 1200000, // Merkle tree insert needs ~1M gas
        });

        const receipt = await tx.wait();

        // Parse actual tokens from event
        let actualTokens = expectedTokens;
        for (const log of receipt.logs) {
          try {
            const parsed = router.interface.parseLog(log);
            if (parsed?.name === 'TokensPurchased') {
              actualTokens = parsed.args.tokensOut;
            }
          } catch {}
        }

        // Update stats
        agent.buys++;
        agent.totalSpent += tradeAmount;
        agent.totalTokens += actualTokens;
        totalVolume += tradeAmount;
        totalTrades++;

        console.log(
          `${String(round).padStart(5)} | ` +
          `${String(agent.id).padStart(5)} | ` +
          `${agent.type.padEnd(8)} | ` +
          `${ethers.formatEther(tradeAmount).padStart(9)} | ` +
          `${Number(ethers.formatEther(actualTokens)).toFixed(2)}`
        );

      } catch (error: any) {
        console.error(`  Agent ${agent.id} error:`, error.message?.slice(0, 50));
      }

      await sleep(500); // Brief delay between agents
    }

    await sleep(CONFIG.TRADE_INTERVAL_MS);

    // Progress update every 10 rounds
    if (round % 10 === 0) {
      console.log(`\n--- Progress: Round ${round}/${CONFIG.MAX_ROUNDS} ---`);
      console.log(`Total Volume: ${ethers.formatEther(totalVolume)} ETH`);
      console.log(`Total Trades: ${totalTrades}\n`);
    }
  }

  // Final stats
  console.log('\n==============================================');
  console.log('              FINAL RESULTS');
  console.log('==============================================\n');

  // Sort agents by total tokens bought
  const sorted = [...agents].sort((a, b) =>
    Number(b.totalTokens - a.totalTokens)
  );

  console.log('Rank | Agent | Type     | Buys | ETH Spent   | Tokens Bought');
  console.log('-----|-------|----------|------|-------------|---------------');

  sorted.forEach((agent, rank) => {
    if (agent.buys > 0) {
      console.log(
        `${String(rank + 1).padStart(4)} | ` +
        `${String(agent.id).padStart(5)} | ` +
        `${agent.type.padEnd(8)} | ` +
        `${String(agent.buys).padStart(4)} | ` +
        `${ethers.formatEther(agent.totalSpent).padStart(11)} | ` +
        `${Number(ethers.formatEther(agent.totalTokens)).toFixed(2)}`
      );
    }
  });

  // Type performance
  console.log('\n--- Performance by Agent Type ---');
  const typeStats: Record<AgentType, { buys: number; spent: bigint; tokens: bigint }> = {
    WHALE: { buys: 0, spent: 0n, tokens: 0n },
    MINNOW: { buys: 0, spent: 0n, tokens: 0n },
    RANDOM: { buys: 0, spent: 0n, tokens: 0n },
    STEADY: { buys: 0, spent: 0n, tokens: 0n },
    BURST: { buys: 0, spent: 0n, tokens: 0n },
  };

  for (const agent of agents) {
    typeStats[agent.type].buys += agent.buys;
    typeStats[agent.type].spent += agent.totalSpent;
    typeStats[agent.type].tokens += agent.totalTokens;
  }

  Object.entries(typeStats)
    .sort((a, b) => Number(b[1].tokens - a[1].tokens))
    .forEach(([type, stats]) => {
      if (stats.buys > 0) {
        const avgPrice = Number(stats.spent) / Number(stats.tokens);
        console.log(
          `${type.padEnd(8)}: ${stats.buys} buys, ` +
          `${ethers.formatEther(stats.spent)} ETH spent, ` +
          `${Number(ethers.formatEther(stats.tokens)).toFixed(2)} tokens ` +
          `(avg price: ${avgPrice.toExponential(4)})`
        );
      }
    });

  console.log('\n--- Summary ---');
  console.log(`Total Volume Generated: ${ethers.formatEther(totalVolume)} ETH`);
  console.log(`Total Trades: ${totalTrades}`);

  // Get final pool state
  const finalEthReserve = await pair.ethReserve();
  const finalTokenReserve = await pair.tokenReserve();
  const finalPrice = Number(finalEthReserve) / Number(finalTokenReserve);

  console.log(`\nFinal Pool State:`);
  console.log(`  ETH Reserve: ${ethers.formatEther(finalEthReserve)} ETH`);
  console.log(`  Token Reserve: ${ethers.formatEther(finalTokenReserve)} ROOT`);
  console.log(`  Price: ${finalPrice.toExponential(4)} ETH/ROOT`);

  console.log('\n=== Market Making Complete! ===\n');
}

main().catch(console.error);
