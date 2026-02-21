#!/usr/bin/env npx tsx
/**
 * Trading Agents - Main Entry Point
 *
 * Runs multiple trading agents with different strategies.
 * Each agent makes independent decisions based on market state.
 *
 * Usage:
 *   npm start                    # Run with default config
 *   DRY_RUN=true npm start       # Test without real trades
 */

import { ethers, Contract, JsonRpcProvider } from 'ethers';
import { poseidon3 } from 'poseidon-lite';
import { CONFIG } from '../config.js';
import { WalletManager } from './agents/WalletManager.js';
import { assignStrategies, BaseStrategy } from './strategies/index.js';
import type { MarketState, TradeResult, TokenNote } from './types.js';

// =============================================================================
// ABIs
// =============================================================================

const DEX_ABI = [
  'function buyPrivate(uint256 newCommitment, uint256 minTokensOut, uint256 deadline, bytes encryptedNote) payable',
  'function getAmountOut(uint256 amountIn, uint256 reserveIn, uint256 reserveOut) view returns (uint256)',
  'event TokensPurchased(uint256 ethIn, uint256 tokensOut)',
  'event NewCommitment(uint256 indexed commitment, uint256 indexed leafIndex, bytes encryptedNote)',
];

const PAIR_ABI = [
  'function ethReserve() view returns (uint256)',
  'function tokenReserve() view returns (uint256)',
];

// =============================================================================
// Crypto Helpers
// =============================================================================

const FIELD_PRIME = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;

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

// =============================================================================
// Trading Engine
// =============================================================================

class TradingEngine {
  private provider: JsonRpcProvider;
  private walletManager: WalletManager;
  private strategies: BaseStrategy[] = [];
  private router: Contract;
  private pair: Contract;
  private priceHistory: number[] = [];
  private isDryRun: boolean;

  constructor(privateKey: string) {
    this.provider = new JsonRpcProvider(CONFIG.RPC_URL);
    this.walletManager = new WalletManager(privateKey);
    this.router = new Contract(CONFIG.DEX_ROUTER, DEX_ABI, this.provider);
    this.pair = new Contract(CONFIG.DEX_PAIR, PAIR_ABI, this.provider);
    this.isDryRun = process.env.DRY_RUN === 'true';
  }

  async initialize(): Promise<void> {
    console.log('\n🤖 Trading Agents Framework');
    console.log('================================\n');

    if (this.isDryRun) {
      console.log('⚠️  DRY RUN MODE - No real trades will be executed\n');
    }

    // Initialize wallets
    console.log(`Initializing ${CONFIG.NUM_AGENTS} agents...`);
    await this.walletManager.initialize(CONFIG.NUM_AGENTS);

    // Assign strategies
    this.strategies = assignStrategies(CONFIG.NUM_AGENTS);
    console.log('\nStrategy distribution:');
    const counts: Record<string, number> = {};
    for (const s of this.strategies) {
      counts[s.name] = (counts[s.name] || 0) + 1;
    }
    for (const [name, count] of Object.entries(counts)) {
      console.log(`  ${name}: ${count} agents`);
    }

    // Check balances
    console.log('\nChecking balances...');
    const balances = await this.walletManager.getAllBalances();
    let totalEth = 0n;
    let agentsReady = 0;

    for (const [id, balance] of balances) {
      totalEth += balance.eth;
      if (balance.eth > CONFIG.MIN_TRADE_ETH + CONFIG.GAS_BUFFER) {
        agentsReady++;
      }
    }

    console.log(`  Total ETH: ${ethers.formatEther(totalEth)}`);
    console.log(`  Agents ready to trade: ${agentsReady}/${CONFIG.NUM_AGENTS}`);

    // Load saved notes
    try {
      this.walletManager.loadNotes('./agent-notes.json');
      console.log('  Loaded saved notes');
    } catch {
      console.log('  No saved notes found');
    }
  }

  async getMarketState(): Promise<MarketState> {
    const ethReserve = await this.pair.ethReserve();
    const tokenReserve = await this.pair.tokenReserve();
    const price = Number(ethReserve) / Number(tokenReserve);

    this.priceHistory.push(price);
    if (this.priceHistory.length > 50) {
      this.priceHistory.shift();
    }

    return {
      price,
      priceHistory: [...this.priceHistory],
      ethReserve,
      tokenReserve,
      timestamp: Date.now(),
    };
  }

  async executeBuy(agentId: number, amount: bigint): Promise<TradeResult> {
    if (this.isDryRun) {
      console.log(`    [DRY RUN] Would buy with ${ethers.formatEther(amount)} ETH`);
      return { success: true, ethSpent: amount, tokensReceived: 0n };
    }

    const wallet = this.walletManager.getWallet(agentId);
    const connectedRouter = this.router.connect(wallet) as Contract;

    // Create commitment
    const nullifier = randomFieldElement();
    const secret = randomFieldElement();

    // Get expected tokens
    const ethReserve = await this.pair.ethReserve();
    const tokenReserve = await this.pair.tokenReserve();
    const expectedTokens = await this.router.getAmountOut(amount, ethReserve, tokenReserve);

    const commitment = hashCommitment(nullifier, secret, expectedTokens);
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 600);

    try {
      const tx = await connectedRouter.buyPrivate(commitment, 0n, deadline, '0x', {
        value: amount,
        gasLimit: 1200000,
      });

      const receipt = await tx.wait();

      // Parse actual tokens from event
      let actualTokens = expectedTokens;
      let leafIndex = 0;

      for (const log of receipt.logs) {
        try {
          const parsed = this.router.interface.parseLog(log);
          if (parsed?.name === 'TokensPurchased') {
            actualTokens = parsed.args.tokensOut;
          }
          if (parsed?.name === 'NewCommitment') {
            leafIndex = Number(parsed.args.leafIndex);
          }
        } catch {}
      }

      // Store note
      const note: TokenNote = {
        commitment: commitment.toString(),
        nullifier: nullifier.toString(),
        secret: secret.toString(),
        amount: actualTokens,
        leafIndex,
        spent: false,
      };
      this.walletManager.storeNote(agentId, note);

      return {
        success: true,
        txHash: receipt.hash,
        ethSpent: amount,
        tokensReceived: actualTokens,
      };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  async run(): Promise<void> {
    console.log('\n🚀 Starting trading loop...\n');
    console.log('Round | Agent | Strategy      | Action | Amount        | Reason');
    console.log('------|-------|---------------|--------|---------------|---------------------------');

    let round = 0;
    const maxRounds = CONFIG.MAX_ROUNDS || Infinity;

    while (round < maxRounds) {
      round++;

      // Get market state
      const market = await this.getMarketState();

      // Select random agents for this round
      const agentIds = Array.from({ length: CONFIG.NUM_AGENTS }, (_, i) => i + 1)
        .sort(() => Math.random() - 0.5)
        .slice(0, CONFIG.AGENTS_PER_ROUND);

      for (const agentId of agentIds) {
        const strategy = this.strategies[agentId - 1];
        const balance = await this.walletManager.getBalance(agentId);
        const decision = strategy.decide(market, balance);

        if (decision.action === 'BUY' && decision.amount > 0n) {
          const result = await this.executeBuy(agentId, decision.amount);

          console.log(
            `${String(round).padStart(5)} | ` +
            `${String(agentId).padStart(5)} | ` +
            `${strategy.name.padEnd(13)} | ` +
            `BUY    | ` +
            `${ethers.formatEther(decision.amount).padStart(13)} | ` +
            `${decision.reason.slice(0, 25)}`
          );

          if (!result.success) {
            console.log(`      └─ Error: ${result.error?.slice(0, 50)}`);
          }
        } else if (decision.action === 'SELL' && decision.amount > 0n) {
          // TODO: Implement sell with ZK proofs
          console.log(
            `${String(round).padStart(5)} | ` +
            `${String(agentId).padStart(5)} | ` +
            `${strategy.name.padEnd(13)} | ` +
            `SELL   | ` +
            `${ethers.formatEther(decision.amount).padStart(13)} | ` +
            `${decision.reason.slice(0, 25)}`
          );
        }
      }

      // Save notes periodically
      if (round % 10 === 0) {
        this.walletManager.saveNotes('./agent-notes.json');
      }

      // Wait before next round
      await new Promise(resolve => setTimeout(resolve, CONFIG.TRADE_INTERVAL_MS));

      // Progress update
      if (round % 10 === 0) {
        const market = await this.getMarketState();
        console.log(`\n--- Round ${round}/${maxRounds} | Price: ${market.price.toExponential(4)} ---\n`);
      }
    }

    // Final save
    this.walletManager.saveNotes('./agent-notes.json');
    console.log('\n✅ Trading complete!\n');
  }
}

// =============================================================================
// Main
// =============================================================================

async function main() {
  const privateKey = process.env.PRIVATE_KEY;
  if (!privateKey) {
    console.error('❌ PRIVATE_KEY environment variable required');
    console.log('\nUsage: PRIVATE_KEY=0x... npm start');
    process.exit(1);
  }

  const engine = new TradingEngine(privateKey);
  await engine.initialize();
  await engine.run();
}

main().catch(console.error);
