#!/usr/bin/env npx tsx
/**
 * ZkAMM Market Maker - 33 Competing Trading Agents
 *
 * This script creates 33 wallets that compete against each other trading
 * on the ZkAMM to generate volume, test the contracts, and see which
 * trading strategy performs best.
 *
 * Features:
 * - 33 HD-derived wallets from a master seed
 * - Multiple trading strategies competing
 * - Real ZK proof generation for sells
 * - Performance leaderboard
 * - Volume generation for LP rewards testing
 */

import { ethers, HDNodeWallet, Wallet } from 'ethers';
import { poseidon2, poseidon3, poseidon5 } from 'poseidon-lite';
import * as snarkjs from 'snarkjs';
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
  CHAIN_ID: 11155111,

  // Contracts (Sepolia) - FRESH DEPLOY 2026-02-06 (configurable OI limit + liquidation fix)
  ZKAMM_ROUTER: '0xd1b972eb47626B67Fe700ee9F3Ab4Fe76751b630',
  ZKAMM_PAIR: '0xdacF977d96840748EB5624508BF98fc5E8CC84E1',
  TOKEN_POOL: '0xC8301Eafed00a003751292F268f3653CdACa2467', // Token Pool for commitments

  // Agent settings
  NUM_AGENTS: 33,
  MASTER_SEED: process.env.MM_SEED || (() => { throw new Error('MM_SEED environment variable required'); })(),

  // Trading settings - ORGANIC HIGH FREQUENCY
  MIN_TRADE_ETH: ethers.parseEther('0.01'),   // 0.01 ETH min trade (small for frequency)
  MAX_TRADE_ETH: ethers.parseEther('0.05'),   // 0.05 ETH max trade (avg ~0.03 ETH)
  GAS_BUFFER: ethers.parseEther('0.005'),     // Keep for gas
  TRADE_INTERVAL_MS: 500,                      // 0.5 second between rounds (very fast!)
  MAX_ROUNDS: 150,                             // 150 rounds x ~15 active agents = ~2250 trades

  // ORGANIC MODE: No tax, let strategies naturally buy/sell
  // All 33 agents trade each round for dynamic chart
  TAX_PERCENT: 0,  // Disabled - pure organic trading

  // Circuit paths
  CIRCUITS_PATH: path.join(__dirname, '../circuits/build'),

  // === EXTERNAL BUY TRACKING ===
  // When external wallets buy, we sell 20% to capture the price rise
  TRACK_EXTERNAL_BUYS: true,
  EXTERNAL_SELL_PERCENT: 20,  // Sell 20% of external buy size
  PROFIT_WALLET: process.env.PROFIT_WALLET || '0x42069c220DD72541C2C7Cb7620f2094f1601430A', // Profits go here
};

// Track volume generated (for 0 exposure mode)
let totalVolumeGenerated = 0n;  // ETH volume
let totalRoundTrips = 0;        // Complete buy+sell cycles

// Track external buy profits
let totalExternalBuysDetected = 0;
let totalProfitExtracted = 0n;

// BN254 field prime
const FIELD_PRIME = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;

// =============================================================================
// ORGANIC TRADE AMOUNT GENERATION
// =============================================================================

/**
 * Generate organic-looking trade amounts using multiple random distributions
 * This makes trades look more human/natural rather than identical
 */
function generateOrganicTradeAmount(minEth: bigint, maxEth: bigint, availableBalance: bigint): bigint {
  const effectiveMax = maxEth < availableBalance ? maxEth : availableBalance;
  if (effectiveMax <= minEth) return minEth;

  const range = effectiveMax - minEth;

  // Use beta-like distribution (sum of randoms) for more natural clustering
  // Most trades cluster around the middle with tails
  const r1 = Math.random();
  const r2 = Math.random();
  const r3 = Math.random();
  const betaLike = (r1 + r2 + r3) / 3; // Tends toward 0.5

  // Add some noise for variety
  const noise = (Math.random() - 0.5) * 0.3; // ±15% variation
  const factor = Math.max(0, Math.min(1, betaLike + noise));

  const amount = minEth + BigInt(Math.floor(Number(range) * factor));

  // Round to nice numbers (like humans do) - round to nearest 0.01 ETH
  const roundedWei = (amount / ethers.parseEther('0.01')) * ethers.parseEther('0.01');

  return roundedWei > minEth ? roundedWei : minEth;
}

// Zero value for empty leaves (must match contract's ZERO_VALUE)
const ZERO_VALUE = 21663839004416932945382355908790599225266501822907911457504978515578255421292n;

// =============================================================================
// MERKLE TREE (matches SDK implementation)
// =============================================================================

class MerkleTree {
  private depth: number;
  private leaves: Map<number, bigint> = new Map();
  private zeros: bigint[];
  private nodeCache: Map<string, bigint> = new Map(); // Cache for computed nodes

  constructor(depth: number = 24) {
    this.depth = depth;
    this.zeros = this.computeZeros();
  }

  private computeZeros(): bigint[] {
    const zeros: bigint[] = [ZERO_VALUE];
    for (let i = 1; i <= this.depth; i++) {
      zeros.push(hashPair(zeros[i - 1], zeros[i - 1]));
    }
    return zeros;
  }

  insertAt(index: number, leaf: bigint): void {
    this.leaves.set(index, leaf);
    this.nodeCache.clear(); // Clear cache when tree changes
  }

  getProof(leafIndex: number): { pathElements: bigint[]; pathIndices: number[]; root: bigint } {
    // Build all layers bottom-up for efficient proof generation
    const layers = this.buildLayers();

    const pathElements: bigint[] = [];
    const pathIndices: number[] = [];
    let currentIndex = leafIndex;

    for (let level = 0; level < this.depth; level++) {
      const isLeftChild = currentIndex % 2 === 0;
      pathIndices.push(isLeftChild ? 0 : 1);

      const siblingIndex = isLeftChild ? currentIndex + 1 : currentIndex - 1;
      pathElements.push(layers[level].get(siblingIndex) ?? this.zeros[level]);

      currentIndex = Math.floor(currentIndex / 2);
    }

    const root = layers[this.depth].get(0) ?? this.zeros[this.depth];
    return { pathElements, pathIndices, root };
  }

  private buildLayers(): Map<number, bigint>[] {
    const cacheKey = 'layers';
    if (this.nodeCache.has(cacheKey)) {
      // Return from string key mapping
      return this.cachedLayers!;
    }

    const layers: Map<number, bigint>[] = [];

    // Layer 0 = leaves
    layers[0] = new Map(this.leaves);

    // Build each layer from the previous
    for (let level = 1; level <= this.depth; level++) {
      layers[level] = new Map();
      const prevLayer = layers[level - 1];

      // Find all unique parent indices
      const parentIndices = new Set<number>();
      for (const index of prevLayer.keys()) {
        parentIndices.add(Math.floor(index / 2));
      }

      // Also include parents of zeros up to the rightmost leaf
      const maxLeafIndex = this.leaves.size > 0 ? Math.max(...this.leaves.keys()) : 0;
      for (let i = 0; i <= Math.floor(maxLeafIndex / Math.pow(2, level)); i++) {
        parentIndices.add(i);
      }

      for (const parentIndex of parentIndices) {
        const leftChildIndex = parentIndex * 2;
        const rightChildIndex = parentIndex * 2 + 1;
        const leftChild = prevLayer.get(leftChildIndex) ?? this.zeros[level - 1];
        const rightChild = prevLayer.get(rightChildIndex) ?? this.zeros[level - 1];
        layers[level].set(parentIndex, hashPair(leftChild, rightChild));
      }
    }

    this.cachedLayers = layers;
    this.nodeCache.set(cacheKey, 1n); // Mark as cached
    return layers;
  }

  private cachedLayers: Map<number, bigint>[] | null = null;

  computeRoot(): bigint {
    const layers = this.buildLayers();
    return layers[this.depth].get(0) ?? this.zeros[this.depth];
  }

  getLeafCount(): number {
    if (this.leaves.size === 0) return 0;
    return Math.max(...Array.from(this.leaves.keys())) + 1;
  }
}

// =============================================================================
// INDEXER QUERIES
// =============================================================================

const INDEXER_URL = process.env.INDEXER_URL || 'https://ponder-indexer-production-50c3.up.railway.app';

interface MerkleTreeStateResponse {
  merkleTreeState: {
    id: string;
    leaves: string;
    nextIndex: string;
    currentRoot: string;
  } | null;
}

async function fetchAllCommitments(pairAddress: string): Promise<{ commitment: bigint; leafIndex: number }[]> {
  const query = `
    query GetMerkleTreeState($id: String!) {
      merkleTreeState(id: $id) {
        id
        nextIndex
        currentRoot
        leaves
      }
    }
  `;

  try {
    const response = await fetch(`${INDEXER_URL}/graphql`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query,
        variables: { id: pairAddress.toLowerCase() }
      }),
    });

    if (!response.ok) {
      console.warn(`[fetchAllCommitments] HTTP ${response.status}`);
      return [];
    }

    const result = await response.json() as { data: MerkleTreeStateResponse };

    if (!result.data?.merkleTreeState) {
      console.warn('[fetchAllCommitments] No merkle tree state found');
      return [];
    }

    const { leaves: leavesRaw } = result.data.merkleTreeState;
    const leaves: string[] = typeof leavesRaw === 'string' ? JSON.parse(leavesRaw) : leavesRaw;

    console.log(`[fetchAllCommitments] Found ${leaves.length} commitments`);

    return leaves.map((l, i) => ({
      commitment: BigInt(l),
      leafIndex: i
    }));
  } catch (err: any) {
    console.warn('[fetchAllCommitments] Error:', err.message);
    return [];
  }
}

// =============================================================================
// ABIs
// =============================================================================

const ZKAMM_ROUTER_ABI = [
  'function buyPrivate(uint256 newCommitment, uint256 minTokensOut, uint256 deadline, bytes encryptedNote) payable',
  'function sellPrivate(uint256[8] proof, uint256 merkleRoot, uint256 nullifierHash, uint256 tokenAmount, uint256 minEthOut, address recipient, address relayer, uint256 fee, uint256 changeCommitment, uint256 publicInputsBinding, uint256 deadline, bytes changeNote)',
  'function getAmountOut(uint256 amountIn, uint256 reserveIn, uint256 reserveOut) view returns (uint256)',
  'event NewCommitment(uint256 indexed commitment, uint256 indexed leafIndex, bytes encryptedNote)',
  'event TokensPurchased(uint256 ethIn, uint256 tokensOut)',
  'event TokensSold(uint256 tokensIn, uint256 ethOut, uint256 protocolFee, uint256 lpFee)',
];

const ZKAMM_PAIR_ABI = [
  'function ethReserve() view returns (uint256)',
  'function tokenReserve() view returns (uint256)',
  'function isKnownRoot(uint256 root) view returns (bool)',
  'function isNullifierSpent(uint256 nullifier) view returns (bool)',
  // Events emitted by router (which calls pair)
  'event TokensSold(uint256 tokensIn, uint256 ethOut, uint256 protocolFee, uint256 lpFee)',
  'event TokensPurchased(uint256 ethIn, uint256 tokensOut)',
];

const TOKEN_POOL_ABI = [
  'function root() view returns (uint256)',
  'function nextIndex() view returns (uint256)',
  'function filledSubtrees(uint256) view returns (uint256)',
  'function zeros(uint256) view returns (uint256)',
  'function TREE_DEPTH() view returns (uint256)',
];

// =============================================================================
// CRYPTO HELPERS
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

// Deterministic derivation for recoverable notes
// This allows notes to be reconstructed if the script crashes
function deriveNullifier(privateKey: string, buyIndex: number): bigint {
  const hash = ethers.keccak256(ethers.solidityPacked(
    ['bytes32', 'string', 'uint256'],
    [privateKey, 'nullifier', buyIndex]
  ));
  return BigInt(hash) % FIELD_PRIME;
}

function deriveSecret(privateKey: string, buyIndex: number): bigint {
  const hash = ethers.keccak256(ethers.solidityPacked(
    ['bytes32', 'string', 'uint256'],
    [privateKey, 'secret', buyIndex]
  ));
  return BigInt(hash) % FIELD_PRIME;
}

function hashCommitment(nullifier: bigint, secret: bigint, amount: bigint): bigint {
  return poseidon3([nullifier, secret, amount]);
}

function hashNullifier(nullifier: bigint, leafIndex: number): bigint {
  return poseidon2([nullifier, BigInt(leafIndex)]);
}

function hashPair(left: bigint, right: bigint): bigint {
  return poseidon2([left, right]);
}

function computePublicInputsBinding(
  minEthOut: bigint,
  recipient: string,
  relayer: string,
  fee: bigint,
  changeCommitment: bigint
): bigint {
  return poseidon5([
    minEthOut,
    BigInt(recipient),
    BigInt(relayer),
    fee,
    changeCommitment,
  ]);
}

// =============================================================================
// COMMITMENT NOTE STRUCTURE
// =============================================================================

interface CommitmentNote {
  commitment: bigint;
  nullifier: bigint;
  secret: bigint;
  amount: bigint;
  leafIndex: number;
  spent: boolean;
}

// =============================================================================
// TRADING STRATEGIES
// =============================================================================

type StrategyName =
  | 'MOMENTUM'
  | 'MEAN_REVERSION'
  | 'RANDOM'
  | 'AGGRESSIVE_BUYER'
  | 'AGGRESSIVE_SELLER'
  | 'BALANCED'
  | 'CONTRARIAN';

interface TradeDecision {
  action: 'BUY' | 'SELL' | 'HOLD';
  amount: bigint; // ETH for buy, tokens for sell
  reason: string;
}

interface MarketState {
  ethReserve: bigint;
  tokenReserve: bigint;
  price: number; // ETH per token
  priceHistory: number[];
}

// Base strategy class
abstract class TradingStrategy {
  name: StrategyName;

  constructor(name: StrategyName) {
    this.name = name;
  }

  abstract decide(
    market: MarketState,
    agentBalance: { eth: bigint; tokenNotes: CommitmentNote[] }
  ): TradeDecision;
}

// Momentum Strategy: Buy when price is rising, sell when falling
class MomentumStrategy extends TradingStrategy {
  constructor() {
    super('MOMENTUM');
  }

  decide(market: MarketState, balance: { eth: bigint; tokenNotes: CommitmentNote[] }): TradeDecision {
    const history = market.priceHistory;
    if (history.length < 3) {
      return { action: 'HOLD', amount: 0n, reason: 'Insufficient price history' };
    }

    const recent = history.slice(-3);
    const trend = recent[2] - recent[0];
    const availableTokens = balance.tokenNotes.filter(n => !n.spent);

    if (trend > 0 && balance.eth > CONFIG.MIN_TRADE_ETH + CONFIG.GAS_BUFFER) {
      // Price rising - buy more
      const amount = generateOrganicTradeAmount(CONFIG.MIN_TRADE_ETH, CONFIG.MAX_TRADE_ETH, balance.eth - CONFIG.GAS_BUFFER);
      return { action: 'BUY', amount, reason: `Momentum UP: ${trend.toFixed(6)}` };
    } else if (trend < 0 && availableTokens.length > 0) {
      // Price falling - sell
      const note = availableTokens[0];
      return { action: 'SELL', amount: note.amount, reason: `Momentum DOWN: ${trend.toFixed(6)}` };
    }

    return { action: 'HOLD', amount: 0n, reason: 'No clear momentum' };
  }
}

// Mean Reversion Strategy: Buy when price is low, sell when high
class MeanReversionStrategy extends TradingStrategy {
  private meanPrice: number = 0;

  constructor() {
    super('MEAN_REVERSION');
  }

  decide(market: MarketState, balance: { eth: bigint; tokenNotes: CommitmentNote[] }): TradeDecision {
    const history = market.priceHistory;
    if (history.length < 5) {
      return { action: 'HOLD', amount: 0n, reason: 'Insufficient price history for mean' };
    }

    // Calculate mean
    this.meanPrice = history.reduce((a, b) => a + b, 0) / history.length;
    const currentPrice = market.price;
    const deviation = (currentPrice - this.meanPrice) / this.meanPrice;
    const availableTokens = balance.tokenNotes.filter(n => !n.spent);

    if (deviation < -0.02 && balance.eth > CONFIG.MIN_TRADE_ETH + CONFIG.GAS_BUFFER) {
      // Price below mean - buy
      const amount = generateOrganicTradeAmount(CONFIG.MIN_TRADE_ETH, CONFIG.MAX_TRADE_ETH, balance.eth - CONFIG.GAS_BUFFER);
      return { action: 'BUY', amount, reason: `Below mean: ${(deviation * 100).toFixed(2)}%` };
    } else if (deviation > 0.02 && availableTokens.length > 0) {
      // Price above mean - sell
      const note = availableTokens[0];
      return { action: 'SELL', amount: note.amount, reason: `Above mean: ${(deviation * 100).toFixed(2)}%` };
    }

    return { action: 'HOLD', amount: 0n, reason: `Near mean: ${(deviation * 100).toFixed(2)}%` };
  }
}

// Random Strategy: Random buy/sell with random amounts
class RandomStrategy extends TradingStrategy {
  constructor() {
    super('RANDOM');
  }

  decide(market: MarketState, balance: { eth: bigint; tokenNotes: CommitmentNote[] }): TradeDecision {
    const rand = Math.random();
    const availableTokens = balance.tokenNotes.filter(n => !n.spent);

    if (rand < 0.4 && balance.eth > CONFIG.MIN_TRADE_ETH + CONFIG.GAS_BUFFER) {
      const amount = generateOrganicTradeAmount(CONFIG.MIN_TRADE_ETH, CONFIG.MAX_TRADE_ETH, balance.eth - CONFIG.GAS_BUFFER);
      return { action: 'BUY', amount, reason: 'Random buy' };
    } else if (rand < 0.8 && availableTokens.length > 0) {
      const note = availableTokens[Math.floor(Math.random() * availableTokens.length)];
      return { action: 'SELL', amount: note.amount, reason: 'Random sell' };
    }

    return { action: 'HOLD', amount: 0n, reason: 'Random hold' };
  }
}

// Aggressive Buyer: Always tries to buy
class AggressiveBuyerStrategy extends TradingStrategy {
  constructor() {
    super('AGGRESSIVE_BUYER');
  }

  decide(market: MarketState, balance: { eth: bigint; tokenNotes: CommitmentNote[] }): TradeDecision {
    if (balance.eth > CONFIG.MIN_TRADE_ETH + CONFIG.GAS_BUFFER) {
      const amount = generateOrganicTradeAmount(CONFIG.MIN_TRADE_ETH, CONFIG.MAX_TRADE_ETH, balance.eth - CONFIG.GAS_BUFFER);
      return { action: 'BUY', amount, reason: 'Aggressive accumulation' };
    }
    return { action: 'HOLD', amount: 0n, reason: 'No ETH for buying' };
  }
}

// Aggressive Seller: Always tries to sell
class AggressiveSellerStrategy extends TradingStrategy {
  constructor() {
    super('AGGRESSIVE_SELLER');
  }

  decide(market: MarketState, balance: { eth: bigint; tokenNotes: CommitmentNote[] }): TradeDecision {
    const availableTokens = balance.tokenNotes.filter(n => !n.spent);
    if (availableTokens.length > 0) {
      const note = availableTokens[0];
      return { action: 'SELL', amount: note.amount, reason: 'Aggressive selling' };
    }

    // If no tokens, buy some first (organic amount)
    if (balance.eth > CONFIG.MIN_TRADE_ETH + CONFIG.GAS_BUFFER) {
      const amount = generateOrganicTradeAmount(CONFIG.MIN_TRADE_ETH, CONFIG.MAX_TRADE_ETH, balance.eth - CONFIG.GAS_BUFFER);
      return { action: 'BUY', amount, reason: 'Need tokens to sell' };
    }

    return { action: 'HOLD', amount: 0n, reason: 'No tokens to sell' };
  }
}

// Balanced Strategy: Tries to maintain 50/50 ETH/token ratio
class BalancedStrategy extends TradingStrategy {
  constructor() {
    super('BALANCED');
  }

  decide(market: MarketState, balance: { eth: bigint; tokenNotes: CommitmentNote[] }): TradeDecision {
    const availableTokens = balance.tokenNotes.filter(n => !n.spent);
    const tokenValueEth = availableTokens.reduce((sum, n) => {
      const ethValue = (n.amount * market.ethReserve) / market.tokenReserve;
      return sum + ethValue;
    }, 0n);

    const totalValue = balance.eth + tokenValueEth;
    const targetEth = totalValue / 2n;

    if (balance.eth > targetEth + CONFIG.MIN_TRADE_ETH + CONFIG.GAS_BUFFER) {
      // Too much ETH, buy tokens
      const amount = generateOrganicTradeAmount(CONFIG.MIN_TRADE_ETH, CONFIG.MAX_TRADE_ETH, balance.eth - CONFIG.GAS_BUFFER);
      return { action: 'BUY', amount, reason: 'Rebalancing: too much ETH' };
    } else if (balance.eth < targetEth - CONFIG.MIN_TRADE_ETH && availableTokens.length > 0) {
      // Too few ETH, sell tokens
      const note = availableTokens[0];
      return { action: 'SELL', amount: note.amount, reason: 'Rebalancing: need more ETH' };
    }

    return { action: 'HOLD', amount: 0n, reason: 'Portfolio balanced' };
  }
}

// Contrarian Strategy: Do opposite of market trend
class ContrarianStrategy extends TradingStrategy {
  constructor() {
    super('CONTRARIAN');
  }

  decide(market: MarketState, balance: { eth: bigint; tokenNotes: CommitmentNote[] }): TradeDecision {
    const history = market.priceHistory;
    if (history.length < 3) {
      return { action: 'HOLD', amount: 0n, reason: 'Insufficient history' };
    }

    const recent = history.slice(-3);
    const trend = recent[2] - recent[0];
    const availableTokens = balance.tokenNotes.filter(n => !n.spent);

    if (trend > 0 && availableTokens.length > 0) {
      // Price rising - contrarian sells
      const note = availableTokens[0];
      return { action: 'SELL', amount: note.amount, reason: `Contrarian: selling into rise` };
    } else if (trend < 0 && balance.eth > CONFIG.MIN_TRADE_ETH + CONFIG.GAS_BUFFER) {
      // Price falling - contrarian buys
      const amount = generateOrganicTradeAmount(CONFIG.MIN_TRADE_ETH, CONFIG.MAX_TRADE_ETH, balance.eth - CONFIG.GAS_BUFFER);
      return { action: 'BUY', amount, reason: `Contrarian: buying the dip` };
    }

    return { action: 'HOLD', amount: 0n, reason: 'No clear trend to counter' };
  }
}

// Strategy factory
function createStrategy(index: number): TradingStrategy {
  const strategies = [
    () => new MomentumStrategy(),
    () => new MeanReversionStrategy(),
    () => new RandomStrategy(),
    () => new AggressiveBuyerStrategy(),
    () => new AggressiveSellerStrategy(),
    () => new BalancedStrategy(),
    () => new ContrarianStrategy(),
  ];

  return strategies[index % strategies.length]();
}

// =============================================================================
// TRADING AGENT
// =============================================================================

interface AgentStats {
  totalBuys: number;
  totalSells: number;
  totalEthSpent: bigint;
  totalEthReceived: bigint;
  totalTokensBought: bigint;
  totalTokensSold: bigint;
  errors: number;
}

class TradingAgent {
  id: number;
  wallet: Wallet;
  strategy: TradingStrategy;
  notes: CommitmentNote[] = [];
  stats: AgentStats = {
    totalBuys: 0,
    totalSells: 0,
    totalEthSpent: 0n,
    totalEthReceived: 0n,
    totalTokensBought: 0n,
    totalTokensSold: 0n,
    errors: 0,
  };

  private router: ethers.Contract;
  private pair: ethers.Contract;
  private tokenPool: ethers.Contract;

  constructor(
    id: number,
    wallet: Wallet,
    strategy: TradingStrategy,
    provider: ethers.Provider
  ) {
    this.id = id;
    this.wallet = wallet.connect(provider);
    this.strategy = strategy;
    this.router = new ethers.Contract(CONFIG.ZKAMM_ROUTER, ZKAMM_ROUTER_ABI, this.wallet);
    this.pair = new ethers.Contract(CONFIG.ZKAMM_PAIR, ZKAMM_PAIR_ABI, provider);
    this.tokenPool = new ethers.Contract(CONFIG.TOKEN_POOL, TOKEN_POOL_ABI, provider);
  }

  async getBalance(): Promise<{ eth: bigint; tokenNotes: CommitmentNote[] }> {
    const eth = await this.wallet.provider!.getBalance(this.wallet.address);
    return { eth, tokenNotes: this.notes };
  }

  async executeTrade(decision: TradeDecision, market: MarketState): Promise<boolean> {
    try {
      if (decision.action === 'BUY') {
        return await this.executeBuy(decision.amount, market);
      } else if (decision.action === 'SELL') {
        return await this.executeSell(decision.amount);
      }
      return true; // HOLD is always successful
    } catch (error: any) {
      console.error(`Agent ${this.id} trade error:`, error.message?.slice(0, 100));
      this.stats.errors++;
      return false;
    }
  }

  private async executeBuy(ethAmount: bigint, market: MarketState): Promise<boolean> {
    // === ZERO EXPOSURE MODE ===
    // Buy tokens, then immediately sell ALL of them back
    // This generates volume while keeping price neutral

    const buyIndex = this.stats.totalBuys;
    const privateKey = (this.wallet as Wallet).privateKey;
    const nullifier = deriveNullifier(privateKey, buyIndex);
    const secret = deriveSecret(privateKey, buyIndex);

    // Calculate expected tokens
    const expectedTokens = await this.router.getAmountOut(ethAmount, market.ethReserve, market.tokenReserve);
    const commitment = hashCommitment(nullifier, secret, expectedTokens);

    const deadline = BigInt(Math.floor(Date.now() / 1000) + 600);

    console.log(`  Agent ${this.id} [${this.strategy.name}]: Buying with ${ethers.formatEther(ethAmount)} ETH...`);

    const tx = await this.router.buyPrivate(commitment, 0n, deadline, '0x', {
      value: ethAmount,
      gasLimit: 1200000,
    });

    const receipt = await tx.wait();

    let leafIndex = 0;
    let actualTokens = expectedTokens;
    for (const log of receipt.logs) {
      try {
        const parsed = this.router.interface.parseLog(log);
        if (parsed?.name === 'NewCommitment') {
          leafIndex = Number(parsed.args.leafIndex);
        }
        if (parsed?.name === 'TokensPurchased') {
          actualTokens = parsed.args.tokensOut;
        }
      } catch {}
    }

    this.notes.push({
      commitment,
      nullifier,
      secret,
      amount: actualTokens,
      leafIndex,
      spent: false,
    });

    this.stats.totalBuys++;
    this.stats.totalEthSpent += ethAmount;
    this.stats.totalTokensBought += actualTokens;
    this.saveNotes();

    console.log(`  Agent ${this.id}: Bought ${ethers.formatEther(actualTokens)} ROOT (leaf ${leafIndex})`);

    // === TAX MODE: Sell only 20% back to capture profit at higher price ===
    // Buy pushes price up, then we sell 20% at higher price = profit
    // 80% remains as buy pressure (good for chart)
    if (CONFIG.TAX_PERCENT > 0) {
      const taxTokens = (actualTokens * BigInt(CONFIG.TAX_PERCENT)) / 100n;
      const keepTokens = actualTokens - taxTokens;

      console.log(`  Agent ${this.id} [TAX ${CONFIG.TAX_PERCENT}%]: Selling ${ethers.formatEther(taxTokens)} ROOT to extract profit...`);
      console.log(`    Keeping ${ethers.formatEther(keepTokens)} ROOT as inventory (${100 - CONFIG.TAX_PERCENT}%)`);

      try {
        // Use partial sell with change commitment
        // Sell 20%, keep 80% via change note
        const ethBefore = this.stats.totalEthReceived;
        const sellSuccess = await this.executePartialSell(
          this.notes.length - 1, // The note we just created
          taxTokens,              // Sell 20%
          keepTokens              // Keep 80% as change
        );

        if (sellSuccess) {
          const ethBack = this.stats.totalEthReceived - ethBefore;
          totalVolumeGenerated += ethAmount + ethBack;
          totalRoundTrips++;

          console.log(`  Agent ${this.id} [TAX]: Tax extracted!`);
          console.log(`    Sold: ${ethers.formatEther(taxTokens)} ROOT → ${ethers.formatEther(ethBack)} ETH`);
          console.log(`    Kept: ${ethers.formatEther(keepTokens)} ROOT as inventory`);
          console.log(`    Total volume: ${ethers.formatEther(totalVolumeGenerated)} ETH | Round trips: ${totalRoundTrips}`);
        }
      } catch (error: any) {
        console.log(`  Agent ${this.id} [TAX]: Tax extraction failed: ${error.message?.slice(0, 80)}`);
      }
    }

    return true;
  }

  // Save notes to file for recovery if script crashes
  private saveNotes(): void {
    const notesFile = path.join(__dirname, `.notes-agent-${this.id}.json`);
    const data = this.notes.map(n => ({
      commitment: n.commitment.toString(),
      nullifier: n.nullifier.toString(),
      secret: n.secret.toString(),
      amount: n.amount.toString(),
      leafIndex: n.leafIndex,
      spent: n.spent,
    }));
    fs.writeFileSync(notesFile, JSON.stringify(data, null, 2));
  }

  // Load notes from file
  loadNotes(): void {
    const notesFile = path.join(__dirname, `.notes-agent-${this.id}.json`);
    if (fs.existsSync(notesFile)) {
      const data = JSON.parse(fs.readFileSync(notesFile, 'utf-8'));
      this.notes = data.map((n: any) => ({
        commitment: BigInt(n.commitment),
        nullifier: BigInt(n.nullifier),
        secret: BigInt(n.secret),
        amount: BigInt(n.amount),
        leafIndex: n.leafIndex,
        spent: n.spent,
      }));
      console.log(`  Agent ${this.id}: Loaded ${this.notes.length} notes from file`);
    }
  }

  // Sell all unspent notes
  async sellAll(): Promise<void> {
    const unspentNotes = this.notes.filter(n => !n.spent);
    console.log(`  Agent ${this.id}: Selling ${unspentNotes.length} positions...`);

    for (const note of unspentNotes) {
      try {
        await this.executeSell(note.amount);
      } catch (error: any) {
        console.error(`  Agent ${this.id}: Failed to sell note: ${error.message?.slice(0, 50)}`);
      }
    }
  }

  // Partial sell: sell some tokens, keep the rest as change
  private async executePartialSell(noteIndex: number, sellAmount: bigint, changeAmount: bigint): Promise<boolean> {
    const note = this.notes[noteIndex];
    if (!note || note.spent) {
      console.log(`  Agent ${this.id}: Note ${noteIndex} not found or already spent`);
      return false;
    }

    // Verify amounts
    if (sellAmount + changeAmount !== note.amount) {
      console.log(`  Agent ${this.id}: Amount mismatch: ${sellAmount} + ${changeAmount} != ${note.amount}`);
      return false;
    }

    // Get merkle proof
    const merkleProof = await this.getMerkleProof(note.leafIndex, note.commitment);

    // Compute nullifier hash
    const nullifierHash = hashNullifier(note.nullifier, note.leafIndex);

    // Create change commitment for the tokens we're keeping
    const privateKey = (this.wallet as Wallet).privateKey;
    const changeNullifier = deriveNullifier(privateKey, this.stats.totalBuys + 1000); // Offset to avoid collision
    const changeSecret = deriveSecret(privateKey, this.stats.totalBuys + 1000);
    const changeCommitment = hashCommitment(changeNullifier, changeSecret, changeAmount);

    // Compute public inputs binding
    const minEthOut = 0n;
    const publicInputsBinding = computePublicInputsBinding(
      minEthOut,
      this.wallet.address,
      this.wallet.address,
      0n,
      changeCommitment
    );

    console.log(`  Agent ${this.id} [PARTIAL SELL]: Generating ZK proof...`);

    // Generate ZK proof with change
    const circuitInputs = {
      merkleRoot: merkleProof.root.toString(),
      nullifierHash: nullifierHash.toString(),
      tokenAmount: sellAmount.toString(),  // Only selling this much
      minEthOut: minEthOut.toString(),
      recipient: BigInt(this.wallet.address).toString(),
      relayer: BigInt(this.wallet.address).toString(),
      fee: '0',
      changeCommitment: changeCommitment.toString(),  // Keep the rest
      nullifier: note.nullifier.toString(),
      secret: note.secret.toString(),
      amount: note.amount.toString(),  // Original note amount
      pathElements: merkleProof.pathElements.map(e => e.toString()),
      pathIndices: merkleProof.pathIndices,
      changeNullifier: changeNullifier.toString(),
      changeSecret: changeSecret.toString(),
    };

    const wasmPath = path.join(CONFIG.CIRCUITS_PATH, 'sell/sell_js/sell.wasm');
    const zkeyPath = path.join(CONFIG.CIRCUITS_PATH, 'sell/sell_final.zkey');

    if (!fs.existsSync(wasmPath) || !fs.existsSync(zkeyPath)) {
      console.log(`  Agent ${this.id}: Circuit files not found`);
      return false;
    }

    const { proof } = await snarkjs.groth16.fullProve(circuitInputs, wasmPath, zkeyPath);

    // Format proof for Solidity
    const solidityProof: bigint[] = [
      BigInt(proof.pi_a[0]),
      BigInt(proof.pi_a[1]),
      BigInt(proof.pi_b[0][1]),
      BigInt(proof.pi_b[0][0]),
      BigInt(proof.pi_b[1][1]),
      BigInt(proof.pi_b[1][0]),
      BigInt(proof.pi_c[0]),
      BigInt(proof.pi_c[1]),
    ];

    const deadline = BigInt(Math.floor(Date.now() / 1000) + 600);

    // Encode change note (nullifier + secret + amount)
    const changeNote = ethers.AbiCoder.defaultAbiCoder().encode(
      ['uint256', 'uint256', 'uint256'],
      [changeNullifier, changeSecret, changeAmount]
    );

    console.log(`  Agent ${this.id}: Executing partial sellPrivate...`);

    const tx = await this.router.sellPrivate(
      solidityProof,
      merkleProof.root,
      nullifierHash,
      sellAmount,
      minEthOut,
      this.wallet.address,
      this.wallet.address,
      0n,
      changeCommitment,
      publicInputsBinding,
      deadline,
      changeNote,
      { gasLimit: 1500000 }
    );

    const receipt = await tx.wait();

    // Parse events
    let ethReceived = 0n;
    let changeLeafIndex = 0;
    for (const log of receipt.logs) {
      try {
        const parsed = this.router.interface.parseLog(log);
        if (parsed?.name === 'TokensSold') {
          ethReceived = parsed.args.ethOut;
        }
        if (parsed?.name === 'NewCommitment') {
          changeLeafIndex = Number(parsed.args.leafIndex);
        }
      } catch {}
      try {
        const parsed = this.pair.interface.parseLog(log);
        if (parsed?.name === 'TokensSold') {
          ethReceived = parsed.args.ethOut;
        }
      } catch {}
    }

    // Mark original note as spent
    this.notes[noteIndex].spent = true;

    // Add change note (the 80% we kept)
    this.notes.push({
      commitment: changeCommitment,
      nullifier: changeNullifier,
      secret: changeSecret,
      amount: changeAmount,
      leafIndex: changeLeafIndex,
      spent: false,
    });

    this.saveNotes();

    this.stats.totalSells++;
    this.stats.totalEthReceived += ethReceived;
    this.stats.totalTokensSold += sellAmount;

    console.log(`  Agent ${this.id}: Partial sell complete - sold ${ethers.formatEther(sellAmount)} ROOT for ${ethers.formatEther(ethReceived)} ETH`);
    return true;
  }

  private async executeSell(tokenAmount: bigint): Promise<boolean> {
    // Find the note to sell
    const noteIndex = this.notes.findIndex(n => !n.spent && n.amount === tokenAmount);
    if (noteIndex === -1) {
      console.log(`  Agent ${this.id}: No matching note found for sell`);
      return false;
    }

    const note = this.notes[noteIndex];

    // Get merkle proof
    const merkleProof = await this.getMerkleProof(note.leafIndex, note.commitment);

    // Compute nullifier hash
    const nullifierHash = hashNullifier(note.nullifier, note.leafIndex);

    // No change (selling full amount)
    const changeCommitment = 0n;

    // Compute public inputs binding
    const minEthOut = 0n; // No slippage protection for testing
    const publicInputsBinding = computePublicInputsBinding(
      minEthOut,
      this.wallet.address,
      this.wallet.address,
      0n,
      changeCommitment
    );

    console.log(`  Agent ${this.id} [${this.strategy.name}]: Generating ZK proof for sell...`);

    // Generate ZK proof
    const circuitInputs = {
      merkleRoot: merkleProof.root.toString(),
      nullifierHash: nullifierHash.toString(),
      tokenAmount: tokenAmount.toString(),
      minEthOut: minEthOut.toString(),
      recipient: BigInt(this.wallet.address).toString(),
      relayer: BigInt(this.wallet.address).toString(),
      fee: '0',
      changeCommitment: changeCommitment.toString(),
      nullifier: note.nullifier.toString(),
      secret: note.secret.toString(),
      amount: note.amount.toString(),
      pathElements: merkleProof.pathElements.map(e => e.toString()),
      pathIndices: merkleProof.pathIndices,
      changeNullifier: '0',
      changeSecret: '0',
    };

    const wasmPath = path.join(CONFIG.CIRCUITS_PATH, 'sell/sell_js/sell.wasm');
    const zkeyPath = path.join(CONFIG.CIRCUITS_PATH, 'sell/sell_final.zkey');

    if (!fs.existsSync(wasmPath) || !fs.existsSync(zkeyPath)) {
      console.log(`  Agent ${this.id}: Circuit files not found, skipping sell`);
      return false;
    }

    const { proof } = await snarkjs.groth16.fullProve(circuitInputs, wasmPath, zkeyPath);

    // Format proof for Solidity
    const solidityProof: bigint[] = [
      BigInt(proof.pi_a[0]),
      BigInt(proof.pi_a[1]),
      BigInt(proof.pi_b[0][1]),
      BigInt(proof.pi_b[0][0]),
      BigInt(proof.pi_b[1][1]),
      BigInt(proof.pi_b[1][0]),
      BigInt(proof.pi_c[0]),
      BigInt(proof.pi_c[1]),
    ];

    const deadline = BigInt(Math.floor(Date.now() / 1000) + 600);

    console.log(`  Agent ${this.id}: Executing sellPrivate...`);

    const tx = await this.router.sellPrivate(
      solidityProof,
      merkleProof.root,
      nullifierHash,
      tokenAmount,
      minEthOut,
      this.wallet.address,
      this.wallet.address,
      0n,
      changeCommitment,
      publicInputsBinding,
      deadline,
      '0x',
      { gasLimit: 1500000 } // ZK proof verification + merkle needs more gas
    );

    const receipt = await tx.wait();

    // Parse events - try both router and pair interfaces
    let ethReceived = 0n;
    for (const log of receipt.logs) {
      // Try router interface first
      try {
        const parsed = this.router.interface.parseLog(log);
        if (parsed?.name === 'TokensSold') {
          ethReceived = parsed.args.ethOut;
          break;
        }
      } catch {}
      // Try pair interface (event might come from pair contract)
      try {
        const parsed = this.pair.interface.parseLog(log);
        if (parsed?.name === 'TokensSold') {
          ethReceived = parsed.args.ethOut;
          break;
        }
      } catch {}
    }

    // Mark note as spent and persist
    this.notes[noteIndex].spent = true;
    this.saveNotes();

    this.stats.totalSells++;
    this.stats.totalEthReceived += ethReceived;
    this.stats.totalTokensSold += tokenAmount;

    console.log(`  Agent ${this.id}: Sold ${ethers.formatEther(tokenAmount)} ROOT for ${ethers.formatEther(ethReceived)} ETH`);
    return true;
  }

  private async getMerkleProof(
    leafIndex: number,
    commitment: bigint
  ): Promise<{ pathElements: bigint[]; pathIndices: number[]; root: bigint }> {
    // Fetch ALL commitments from the indexer
    const allCommitments = await fetchAllCommitments(CONFIG.ZKAMM_PAIR);

    if (allCommitments.length === 0) {
      throw new Error('No commitments found in indexer. Is the indexer running?');
    }

    // Build a local merkle tree with all commitments
    const tree = new MerkleTree(24);
    for (const c of allCommitments) {
      tree.insertAt(c.leafIndex, c.commitment);
    }

    // Verify our commitment is in the tree
    const found = allCommitments.find(c => c.leafIndex === leafIndex);
    if (!found || found.commitment !== commitment) {
      console.warn(`[getMerkleProof] Commitment mismatch at index ${leafIndex}`);
      console.warn(`  Expected: ${commitment.toString().slice(0, 30)}...`);
      console.warn(`  Found: ${found?.commitment.toString().slice(0, 30) || 'none'}...`);
    }

    // Generate merkle proof
    const proof = tree.getProof(leafIndex);

    console.log(`[getMerkleProof] Generated proof for leaf ${leafIndex}, tree has ${allCommitments.length} leaves`);
    console.log(`  Root: ${proof.root.toString().slice(0, 30)}...`);

    return proof;
  }

  // REALIZED PnL only - ETH received from sells minus ETH spent on buys
  // This is the TRUE profit - tokens can lose value, ETH is real
  getRealizedPnL(): number {
    const spent = Number(ethers.formatEther(this.stats.totalEthSpent));
    const received = Number(ethers.formatEther(this.stats.totalEthReceived));
    return received - spent;
  }

  // Get unrealized value of held tokens (for reference only)
  getUnrealizedValue(currentPrice: number): number {
    const holdingTokens = this.notes.filter(n => !n.spent).reduce((sum, n) => sum + Number(ethers.formatEther(n.amount)), 0);
    return holdingTokens * currentPrice;
  }

  // Total PnL (realized + unrealized) - for reference
  getTotalPnL(currentPrice: number): number {
    return this.getRealizedPnL() + this.getUnrealizedValue(currentPrice);
  }
}

// =============================================================================
// MARKET MAKER ORCHESTRATOR
// =============================================================================

class MarketMaker {
  private provider: ethers.Provider;
  private agents: TradingAgent[] = [];
  private marketState: MarketState = {
    ethReserve: 0n,
    tokenReserve: 0n,
    price: 0,
    priceHistory: [],
  };
  private pair: ethers.Contract;
  private funder: Wallet;
  private agentAddresses: Set<string> = new Set();  // Track our agent addresses
  private isProcessingExternalBuy: boolean = false; // Prevent concurrent processing
  private router: ethers.Contract | null = null;

  constructor() {
    this.provider = new ethers.JsonRpcProvider(CONFIG.RPC_URL);
    this.pair = new ethers.Contract(CONFIG.ZKAMM_PAIR, ZKAMM_PAIR_ABI, this.provider);
    this.router = new ethers.Contract(CONFIG.ZKAMM_ROUTER, ZKAMM_ROUTER_ABI, this.provider);

    // Funder wallet (from env or master seed derivation)
    const funderKey = process.env.PRIVATE_KEY;
    if (funderKey) {
      this.funder = new Wallet(funderKey, this.provider);
    } else {
      // Derive from master seed
      const masterNode = ethers.HDNodeWallet.fromPhrase(CONFIG.MASTER_SEED);
      this.funder = masterNode.deriveChild(0) as unknown as Wallet;
    }

    // Also add funder to known addresses
    this.agentAddresses.add(this.funder.address.toLowerCase());
  }

  async initialize(): Promise<void> {
    console.log('\n=== ZkAMM Market Maker - 33 Competing Agents ===\n');
    console.log('Network:', CONFIG.RPC_URL.includes('sepolia') ? 'Sepolia' : 'Unknown');
    console.log('Router:', CONFIG.ZKAMM_ROUTER);
    console.log('Pair:', CONFIG.ZKAMM_PAIR);
    console.log('');

    // Create 33 agents with different strategies
    console.log('Creating 33 trading agents...\n');

    // Get the funder's private key to derive agent keys
    const funderKey = process.env.PRIVATE_KEY!;

    for (let i = 0; i < CONFIG.NUM_AGENTS; i++) {
      // Derive a unique private key for each agent using keccak256(funderKey + index)
      const derivedKey = ethers.keccak256(
        ethers.solidityPacked(['bytes32', 'uint256'], [funderKey, i + 1])
      );
      const derivedWallet = new Wallet(derivedKey);
      const strategy = createStrategy(i);
      const agent = new TradingAgent(i + 1, derivedWallet, strategy, this.provider);
      agent.loadNotes(); // Load existing token notes from previous runs
      this.agents.push(agent);

      // Track agent address for external buy detection
      this.agentAddresses.add(derivedWallet.address.toLowerCase());

      const unspent = agent.notes.filter(n => !n.spent).length;
      console.log(`  Agent ${i + 1}: ${derivedWallet.address.slice(0, 10)}... [${strategy.name}]${unspent > 0 ? ` (${unspent} notes)` : ''}`);
    }

    console.log('\n');

    // Start external buy watcher if enabled
    if (CONFIG.TRACK_EXTERNAL_BUYS) {
      console.log('🔍 External buy tracking ENABLED');
      console.log(`   Sell ${CONFIG.EXTERNAL_SELL_PERCENT}% of external buys`);
      console.log(`   Profits → ${CONFIG.PROFIT_WALLET}\n`);
      this.startExternalBuyWatcher();
    }
  }

  // =============================================================================
  // EXTERNAL BUY WATCHER - Poll Ponder indexer for external buys
  // =============================================================================

  private lastSeenTradeTimestamp: bigint = 0n;
  private externalBuyWatcherInterval: NodeJS.Timeout | null = null;

  private startExternalBuyWatcher(): void {
    console.log('👁️  Starting external buy watcher (Ponder polling)...\n');

    // Initialize lastSeenTradeTimestamp to now to avoid processing historical trades
    this.lastSeenTradeTimestamp = BigInt(Math.floor(Date.now() / 1000));

    // Poll every 3 seconds
    this.externalBuyWatcherInterval = setInterval(async () => {
      await this.checkForExternalBuys();
    }, 3000);

    // Also do an initial check
    this.checkForExternalBuys();
  }

  private async checkForExternalBuys(): Promise<void> {
    try {
      const query = `
        query GetRecentBuys($timestamp: BigInt!) {
          tradess(
            where: { type: "buy", timestamp_gt: $timestamp }
            orderBy: "timestamp"
            orderDirection: "asc"
            limit: 50
          ) {
            items {
              id
              ethAmount
              tokenAmount
              timestamp
              transactionHash
            }
          }
        }
      `;

      const response = await fetch(`${INDEXER_URL}/graphql`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query,
          variables: { timestamp: this.lastSeenTradeTimestamp.toString() }
        }),
      });

      if (!response.ok) {
        return; // Silent fail on polling errors
      }

      const result = await response.json() as any;
      const trades = result.data?.tradess?.items || [];

      for (const trade of trades) {
        // Update last seen timestamp
        const tradeTimestamp = BigInt(trade.timestamp);
        if (tradeTimestamp > this.lastSeenTradeTimestamp) {
          this.lastSeenTradeTimestamp = tradeTimestamp;
        }

        // Look up transaction to get buyer address
        const txHash = trade.transactionHash;
        const tx = await this.provider.getTransaction(txHash);
        if (!tx || !tx.from) continue;

        const buyerAddress = tx.from.toLowerCase();

        // Check if this is one of our agents
        if (this.agentAddresses.has(buyerAddress)) {
          continue; // Skip our own buys
        }

        // External buy detected!
        const tokensOut = ethers.parseEther(trade.tokenAmount);

        console.log(`\n🚨 EXTERNAL BUY DETECTED!`);
        console.log(`   Buyer: ${buyerAddress.slice(0, 10)}...`);
        console.log(`   ETH In: ${trade.ethAmount} ETH`);
        console.log(`   Tokens Out: ${trade.tokenAmount} ROOT`);
        console.log(`   TX: ${txHash.slice(0, 20)}...`);

        totalExternalBuysDetected++;

        // Calculate how much to sell (20% of what they bought)
        const targetSellAmount = (tokensOut * BigInt(CONFIG.EXTERNAL_SELL_PERCENT)) / 100n;
        console.log(`   Target sell: ${ethers.formatEther(targetSellAmount)} ROOT (${CONFIG.EXTERNAL_SELL_PERCENT}%)`);

        // React by selling from our inventory
        await this.reactToExternalBuy(targetSellAmount);
      }
    } catch (err: any) {
      // Silent fail - will retry on next poll
    }
  }

  private async reactToExternalBuy(targetSellAmount: bigint): Promise<void> {
    if (this.isProcessingExternalBuy) {
      console.log('   ⏳ Already processing a sell, skipping...');
      return;
    }

    this.isProcessingExternalBuy = true;

    try {
      // Find an agent with enough tokens to sell
      let soldAmount = 0n;
      let ethReceived = 0n;

      for (const agent of this.agents) {
        if (soldAmount >= targetSellAmount) break;

        const availableNotes = agent.notes.filter(n => !n.spent);
        for (const note of availableNotes) {
          if (soldAmount >= targetSellAmount) break;

          // Sell this note
          console.log(`   💰 Agent ${agent.id} selling ${ethers.formatEther(note.amount)} ROOT...`);

          const balanceBefore = await this.provider.getBalance(agent.wallet.address);

          try {
            // Execute the sell (this will update agent stats)
            const decision: TradeDecision = {
              action: 'SELL',
              amount: note.amount,
              reason: 'Reactive sell into external buy',
            };

            await agent.executeTrade(decision, this.marketState);
            soldAmount += note.amount;

            const balanceAfter = await this.provider.getBalance(agent.wallet.address);
            const ethGained = balanceAfter - balanceBefore;
            if (ethGained > 0n) {
              ethReceived += ethGained;
            }

            console.log(`   ✓ Sold! ETH gained: ~${ethers.formatEther(ethGained > 0n ? ethGained : 0n)} ETH`);
          } catch (err: any) {
            console.log(`   ✗ Sell failed: ${err.message?.slice(0, 40)}`);
          }
        }
      }

      if (soldAmount > 0n) {
        console.log(`\n   📊 External buy response complete:`);
        console.log(`      Sold: ${ethers.formatEther(soldAmount)} ROOT`);
        console.log(`      ETH received: ~${ethers.formatEther(ethReceived)} ETH`);
        totalProfitExtracted += ethReceived;

        // Send profits to profit wallet
        if (ethReceived > ethers.parseEther('0.01')) {
          await this.sendProfitToWallet(ethReceived);
        }
      } else {
        console.log('   ⚠️ No tokens available to sell');
      }
    } finally {
      this.isProcessingExternalBuy = false;
    }
  }

  private async sendProfitToWallet(amount: bigint): Promise<void> {
    // Find an agent with enough ETH to send
    for (const agent of this.agents) {
      const balance = await this.provider.getBalance(agent.wallet.address);
      const sendAmount = amount - ethers.parseEther('0.005'); // Keep some for gas

      if (balance > sendAmount + ethers.parseEther('0.01')) {
        try {
          console.log(`   💸 Sending ${ethers.formatEther(sendAmount)} ETH profit to ${CONFIG.PROFIT_WALLET.slice(0, 10)}...`);
          const tx = await agent.wallet.sendTransaction({
            to: CONFIG.PROFIT_WALLET,
            value: sendAmount,
            gasLimit: 21000,
          });
          await tx.wait();
          console.log(`   ✓ Profit sent! TX: ${tx.hash.slice(0, 20)}...`);
          return;
        } catch (err: any) {
          console.log(`   ✗ Send failed: ${err.message?.slice(0, 40)}`);
        }
      }
    }
    console.log('   ⚠️ No agent with enough ETH to forward profits');
  }

  async fundAgents(targetPerAgent: bigint): Promise<void> {
    console.log(`Target funding: ${ethers.formatEther(targetPerAgent)} ETH per agent\n`);

    const funderBalance = await this.provider.getBalance(this.funder.address);
    console.log(`Funder: ${this.funder.address}`);
    console.log(`Funder balance: ${ethers.formatEther(funderBalance)} ETH`);

    // Calculate actual funding needed (only for agents below target)
    let totalNeeded = 0n;
    const fundingNeeds: { agent: TradingAgent; balance: bigint; needed: bigint }[] = [];

    for (const agent of this.agents) {
      const balance = await this.provider.getBalance(agent.wallet.address);
      if (balance < targetPerAgent) {
        const needed = targetPerAgent - balance;
        totalNeeded += needed;
        fundingNeeds.push({ agent, balance, needed });
      }
    }

    console.log(`Agents needing funding: ${fundingNeeds.length}/${CONFIG.NUM_AGENTS}`);
    console.log(`Total ETH needed: ${ethers.formatEther(totalNeeded)} ETH\n`);

    if (totalNeeded > 0n && funderBalance < totalNeeded) {
      console.error('ERROR: Insufficient funder balance!');
      console.log(`Please fund ${this.funder.address} with at least ${ethers.formatEther(totalNeeded)} ETH`);
      process.exit(1);
    }

    // Fund agents that need it (top up to target) - sequential with nonce management
    let nonce = await this.provider.getTransactionCount(this.funder.address, 'pending');
    for (const { agent, balance, needed } of fundingNeeds) {
      try {
        console.log(`  Funding Agent ${agent.id} (has ${ethers.formatEther(balance)}, adding ${ethers.formatEther(needed)})...`);
        const tx = await this.funder.sendTransaction({
          to: agent.wallet.address,
          value: needed,
          nonce: nonce++,
          gasLimit: 21000,
        });
        await tx.wait();
      } catch (err: any) {
        console.log(`  Funding Agent ${agent.id} failed: ${err.message?.slice(0, 50)}`);
      }
    }

    // Log agents that already have enough
    const alreadyFunded = this.agents.filter(a => !fundingNeeds.find(f => f.agent.id === a.id));
    if (alreadyFunded.length > 0) {
      console.log(`\n  ${alreadyFunded.length} agents already at/above target`);
    }

    console.log('\nAll agents ready!\n');
  }

  async updateMarketState(): Promise<void> {
    this.marketState.ethReserve = await this.pair.ethReserve();
    this.marketState.tokenReserve = await this.pair.tokenReserve();

    // Price = ETH per token
    if (this.marketState.tokenReserve > 0n) {
      this.marketState.price =
        Number(this.marketState.ethReserve) / Number(this.marketState.tokenReserve);
    }

    // Keep last 20 prices
    this.marketState.priceHistory.push(this.marketState.price);
    if (this.marketState.priceHistory.length > 20) {
      this.marketState.priceHistory.shift();
    }
  }

  async runTradingRound(roundNum: number): Promise<void> {
    console.log(`\n--- Round ${roundNum} ---`);
    await this.updateMarketState();

    console.log(`Market: ${ethers.formatEther(this.marketState.ethReserve)} ETH / ${ethers.formatEther(this.marketState.tokenReserve)} ROOT`);
    console.log(`Price: ${this.marketState.price.toExponential(4)} ETH/ROOT`);

    // Shuffle agents for variety
    const shuffled = [...this.agents].sort(() => Math.random() - 0.5);

    // Process in batches of 8 to avoid rate limits
    const BATCH_SIZE = 8;
    let totalBuys = 0, totalSells = 0, totalHolds = 0;

    for (let i = 0; i < shuffled.length; i += BATCH_SIZE) {
      const batch = shuffled.slice(i, i + BATCH_SIZE);

      const batchPromises = batch.map(async (agent) => {
        try {
          const balance = await agent.getBalance();
          const decision = agent.strategy.decide(this.marketState, balance);

          if (decision.action === 'BUY') {
            console.log(`  A${agent.id} BUY ${ethers.formatEther(decision.amount)}`);
            await agent.executeTrade(decision, this.marketState);
            return 'BUY';
          } else if (decision.action === 'SELL') {
            console.log(`  A${agent.id} SELL`);
            await agent.executeTrade(decision, this.marketState);
            return 'SELL';
          }
          return 'HOLD';
        } catch (error: any) {
          console.log(`  A${agent.id} ERR: ${error.message?.slice(0, 40)}`);
          return 'ERROR';
        }
      });

      const results = await Promise.allSettled(batchPromises);
      results.forEach(r => {
        if (r.status === 'fulfilled') {
          if (r.value === 'BUY') totalBuys++;
          else if (r.value === 'SELL') totalSells++;
          else if (r.value === 'HOLD') totalHolds++;
        }
      });

      // Small delay between batches to avoid rate limits
      if (i + BATCH_SIZE < shuffled.length) {
        await this.sleep(300);
      }
    }

    console.log(`  >> ${totalBuys} buys | ${totalSells} sells | ${totalHolds} holds`);
  }

  displayLeaderboard(): void {
    console.log('\n========================================');
    console.log('    AGENT LEADERBOARD (Realized ETH)');
    console.log('========================================\n');

    const leaderboard = this.agents
      .map(agent => ({
        id: agent.id,
        strategy: agent.strategy.name,
        address: agent.wallet.address.slice(0, 10) + '...',
        realizedPnL: agent.getRealizedPnL(),
        unrealized: agent.getUnrealizedValue(this.marketState.price),
        buys: agent.stats.totalBuys,
        sells: agent.stats.totalSells,
        errors: agent.stats.errors,
        ethSpent: Number(ethers.formatEther(agent.stats.totalEthSpent)),
        ethReceived: Number(ethers.formatEther(agent.stats.totalEthReceived)),
      }))
      .sort((a, b) => b.realizedPnL - a.realizedPnL);

    console.log('Rank | Agent | Strategy           | Realized ETH | ETH Out | ETH In  | Buys | Sells');
    console.log('-----|-------|-------------------|--------------|---------|---------|------|------');

    leaderboard.forEach((agent, index) => {
      const pnlStr = agent.realizedPnL >= 0 ? `+${agent.realizedPnL.toFixed(4)}` : agent.realizedPnL.toFixed(4);
      console.log(
        `${String(index + 1).padStart(4)} | ` +
        `${String(agent.id).padStart(5)} | ` +
        `${agent.strategy.padEnd(17)} | ` +
        `${pnlStr.padStart(12)} | ` +
        `${agent.ethSpent.toFixed(2).padStart(7)} | ` +
        `${agent.ethReceived.toFixed(2).padStart(7)} | ` +
        `${String(agent.buys).padStart(4)} | ` +
        `${String(agent.sells).padStart(5)}`
      );
    });

    // Summary stats
    const totalBuys = this.agents.reduce((sum, a) => sum + a.stats.totalBuys, 0);
    const totalSells = this.agents.reduce((sum, a) => sum + a.stats.totalSells, 0);
    const totalEthSpent = this.agents.reduce((sum, a) => sum + Number(ethers.formatEther(a.stats.totalEthSpent)), 0);
    const totalEthReceived = this.agents.reduce((sum, a) => sum + Number(ethers.formatEther(a.stats.totalEthReceived)), 0);
    const netRealizedPnL = totalEthReceived - totalEthSpent;

    console.log('\n========================================');
    console.log('           SUMMARY STATS');
    console.log('========================================');
    console.log(`Total Trades: ${totalBuys + totalSells} (${totalBuys} buys, ${totalSells} sells)`);
    console.log(`Total ETH Spent (buys): ${totalEthSpent.toFixed(4)} ETH`);
    console.log(`Total ETH Received (sells): ${totalEthReceived.toFixed(4)} ETH`);
    console.log(`Net Realized P&L: ${netRealizedPnL >= 0 ? '+' : ''}${netRealizedPnL.toFixed(4)} ETH`);
    console.log(`Current Price: ${this.marketState.price.toExponential(4)} ETH/ROOT`);

    // Tax mode stats
    if (CONFIG.TAX_PERCENT > 0) {
      console.log('\n--- Tax Mode (Volume + Profit Extraction) ---');
      console.log(`Tax Rate: ${CONFIG.TAX_PERCENT}% of each buy`);
      console.log(`Tax Trades: ${totalRoundTrips}`);
      console.log(`Total Volume Generated: ${ethers.formatEther(totalVolumeGenerated)} ETH`);
      console.log(`Protocol Fees Earned: ~${ethers.formatEther(totalVolumeGenerated * 3n / 1000n)} ETH (0.3% of volume)`);
    }

    // External buy tracking stats
    if (CONFIG.TRACK_EXTERNAL_BUYS) {
      console.log('\n--- External Buy Tracking ---');
      console.log(`External buys detected: ${totalExternalBuysDetected}`);
      console.log(`Profit extracted: ${ethers.formatEther(totalProfitExtracted)} ETH`);
      console.log(`Profit wallet: ${CONFIG.PROFIT_WALLET}`);
    }

    // Strategy performance - REALIZED ONLY
    const strategyStats: Record<string, { realizedPnL: number; count: number; ethSpent: number; ethReceived: number }> = {};
    for (const agent of this.agents) {
      const strat = agent.strategy.name;
      if (!strategyStats[strat]) {
        strategyStats[strat] = { realizedPnL: 0, count: 0, ethSpent: 0, ethReceived: 0 };
      }
      strategyStats[strat].realizedPnL += agent.getRealizedPnL();
      strategyStats[strat].ethSpent += Number(ethers.formatEther(agent.stats.totalEthSpent));
      strategyStats[strat].ethReceived += Number(ethers.formatEther(agent.stats.totalEthReceived));
      strategyStats[strat].count++;
    }

    console.log('\n--- Strategy Performance (Realized ETH Only) ---');
    Object.entries(strategyStats)
      .sort((a, b) => b[1].realizedPnL - a[1].realizedPnL)
      .forEach(([strat, stats]) => {
        const avgPnl = stats.realizedPnL / stats.count;
        const sign = stats.realizedPnL >= 0 ? '+' : '';
        console.log(`${strat}: ${sign}${stats.realizedPnL.toFixed(4)} ETH (spent: ${stats.ethSpent.toFixed(2)}, received: ${stats.ethReceived.toFixed(2)})`);
      });
  }

  async run(): Promise<void> {
    await this.initialize();

    // Fund agents to 0.03 ETH target (minimal - they already have funds from previous runs)
    await this.fundAgents(ethers.parseEther('0.03'));

    console.log('Starting trading competition...\n');

    for (let round = 1; round <= CONFIG.MAX_ROUNDS; round++) {
      await this.runTradingRound(round);
      await this.sleep(CONFIG.TRADE_INTERVAL_MS);

      // Display leaderboard every 10 rounds
      if (round % 10 === 0) {
        this.displayLeaderboard();
      }
    }

    // Final leaderboard
    this.displayLeaderboard();
    console.log('\n=== Market Maker Competition Complete! ===\n');
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// =============================================================================
// EXPORT AGENT KEYS
// =============================================================================

function exportAgentKeys(): void {
  const funderKey = process.env.PRIVATE_KEY;
  if (!funderKey) {
    console.error('ERROR: PRIVATE_KEY environment variable required');
    process.exit(1);
  }

  console.log('\n=== AGENT WALLET KEYS ===\n');
  console.log('⚠️  KEEP THESE SECRET - These are real private keys!\n');

  const agents: { id: number; address: string; privateKey: string }[] = [];

  for (let i = 0; i < CONFIG.NUM_AGENTS; i++) {
    const derivedKey = ethers.keccak256(
      ethers.solidityPacked(['bytes32', 'uint256'], [funderKey, i + 1])
    );
    const wallet = new Wallet(derivedKey);
    agents.push({
      id: i + 1,
      address: wallet.address,
      privateKey: derivedKey,
    });
  }

  // Display in console
  agents.forEach(a => {
    console.log(`Agent ${String(a.id).padStart(2)}: ${a.address}`);
    console.log(`         ${a.privateKey}\n`);
  });

  // Save to .env format (typically gitignored for safety)
  const envContent = agents.map(a =>
    `# Agent ${a.id}: ${a.address}\nAGENT_${a.id}_PRIVATE_KEY=${a.privateKey}`
  ).join('\n\n');

  const envPath = path.join(__dirname, '.env.agents');
  fs.writeFileSync(envPath, envContent);
  console.log(`\n✅ Keys saved to: ${envPath}`);
  console.log('   This .env file should be gitignored for safety.');
  console.log('   Import individual keys into MetaMask to access the funds.\n');
}

// =============================================================================
// MAIN
// =============================================================================

async function sellAllPositions(): Promise<void> {
  console.log('\n=== SELLING ALL AGENT POSITIONS ===\n');

  const provider = new ethers.JsonRpcProvider(CONFIG.RPC_URL);
  const funderKey = process.env.PRIVATE_KEY;

  if (!funderKey) {
    console.error('ERROR: PRIVATE_KEY environment variable required');
    process.exit(1);
  }

  let totalSold = 0;
  let totalEthReceived = 0n;

  // Create agents and load their notes from files
  for (let i = 1; i <= CONFIG.NUM_AGENTS; i++) {
    const derivedKey = ethers.keccak256(
      ethers.solidityPacked(['bytes32', 'uint256'], [funderKey, i])
    );
    const wallet = new Wallet(derivedKey);
    const strategy = createStrategy(i - 1); // Use factory function

    const agent = new TradingAgent(i, wallet, strategy, provider);
    agent.loadNotes();

    const unspentNotes = agent.notes.filter(n => !n.spent);
    if (unspentNotes.length > 0) {
      console.log(`\nAgent ${i}: ${unspentNotes.length} positions to sell`);
      const beforeEth = agent.stats.totalEthReceived;
      await agent.sellAll();
      totalSold += unspentNotes.length;
      totalEthReceived += agent.stats.totalEthReceived - beforeEth;
    }
  }

  console.log('\n========================================');
  console.log('         SELL ALL SUMMARY');
  console.log('========================================');
  console.log(`Total positions sold: ${totalSold}`);
  console.log(`Total ETH received: ${ethers.formatEther(totalEthReceived)} ETH`);
  console.log('\n=== SELL ALL COMPLETE ===\n');
}

async function main() {
  // Check for --export-keys flag
  if (process.argv.includes('--export-keys')) {
    exportAgentKeys();
    return;
  }

  // Check for --sell-all flag
  if (process.argv.includes('--sell-all')) {
    await sellAllPositions();
    return;
  }

  const mm = new MarketMaker();
  await mm.run();
}

main().catch(console.error);
