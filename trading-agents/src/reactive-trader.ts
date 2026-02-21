#!/usr/bin/env npx tsx
/**
 * Reactive Trader - Tax External Buys
 *
 * Monitors for external buys using WebSocket/polling and
 * executes sells of 20% to capture profit from buy pressure.
 *
 * Usage:
 *   npm run tax          # Run the tax strategy
 *   DRY_RUN=true npm run tax  # Test without real trades
 */

import { ethers, Contract, JsonRpcProvider, Wallet, WebSocketProvider } from 'ethers';
import { poseidon2, poseidon3, poseidon5 } from 'poseidon-lite';
import * as snarkjs from 'snarkjs';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { CONFIG } from '../config.js';
import type { TokenNote } from './types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// =============================================================================
// Configuration
// =============================================================================

const TAX_CONFIG = {
  TAX_PERCENT: 20,           // Sell 20% of external buys
  MIN_BUY_TO_TAX: ethers.parseEther('0.01'), // Only tax buys > 0.01 ETH
  REACTION_DELAY_MS: 500,    // Small delay before reacting
  POLL_INTERVAL_MS: 2000,    // Fallback polling interval
};

// =============================================================================
// ABIs
// =============================================================================

const ROUTER_ABI = [
  'function sellPrivate(uint256[8] proof, uint256 merkleRoot, uint256 nullifierHash, uint256 tokenAmount, uint256 minEthOut, address recipient, address relayer, uint256 fee, uint256 changeCommitment, uint256 publicInputsBinding, uint256 deadline, bytes changeNote) external',
  'function getAmountOut(uint256 amountIn, uint256 reserveIn, uint256 reserveOut) view returns (uint256)',
  'event TokensPurchased(uint256 ethIn, uint256 tokensOut)',
];

const PAIR_ABI = [
  'function ethReserve() view returns (uint256)',
  'function tokenReserve() view returns (uint256)',
  'function currentMerkleRoot() view returns (uint256)',
  'event TokensPurchased(uint256 ethIn, uint256 tokensOut)',
];

const TOKEN_POOL_ABI = [
  'function getLeaf(uint256 index) view returns (uint256)',
  'function nextLeafIndex() view returns (uint256)',
];

// =============================================================================
// Crypto Helpers
// =============================================================================

const FIELD_PRIME = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
const ZERO_VALUE = 21663839004416932945382355908790599225266501822907911457504978515578255421292n;

function hashPair(left: bigint, right: bigint): bigint {
  return poseidon2([left, right]);
}

function hashCommitment(nullifier: bigint, secret: bigint, amount: bigint): bigint {
  return poseidon3([nullifier, secret, amount]);
}

function hashNullifier(nullifier: bigint, leafIndex: number): bigint {
  return poseidon2([nullifier, BigInt(leafIndex)]);
}

function computePublicInputsBinding(
  minEthOut: bigint,
  recipient: string,
  relayer: string,
  fee: bigint,
  changeCommitment: bigint
): bigint {
  return poseidon5([minEthOut, BigInt(recipient), BigInt(relayer), fee, changeCommitment]);
}

function randomFieldElement(): bigint {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let value = 0n;
  for (let i = 0; i < 32; i++) {
    value = (value << 8n) | BigInt(bytes[i]);
  }
  return value % FIELD_PRIME;
}

// =============================================================================
// Merkle Tree
// =============================================================================

class MerkleTree {
  private depth = 24;
  private leaves: Map<number, bigint> = new Map();
  private zeros: bigint[];

  constructor() {
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
  }

  getProof(leafIndex: number): { pathElements: bigint[]; pathIndices: number[]; root: bigint } {
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
    const layers: Map<number, bigint>[] = [];
    layers[0] = new Map(this.leaves);

    for (let level = 1; level <= this.depth; level++) {
      layers[level] = new Map();
      const prevLayer = layers[level - 1];
      const parentIndices = new Set<number>();

      for (const index of prevLayer.keys()) {
        parentIndices.add(Math.floor(index / 2));
      }

      const maxLeafIndex = this.leaves.size > 0 ? Math.max(...this.leaves.keys()) : 0;
      for (let i = 0; i <= Math.floor(maxLeafIndex / Math.pow(2, level)); i++) {
        parentIndices.add(i);
      }

      for (const parentIndex of parentIndices) {
        const leftChild = prevLayer.get(parentIndex * 2) ?? this.zeros[level - 1];
        const rightChild = prevLayer.get(parentIndex * 2 + 1) ?? this.zeros[level - 1];
        layers[level].set(parentIndex, hashPair(leftChild, rightChild));
      }
    }

    return layers;
  }
}

// =============================================================================
// Reactive Trader
// =============================================================================

class ReactiveTaxTrader {
  private provider: JsonRpcProvider;
  private pair: Contract;
  private router: Contract;
  private tokenPool: Contract;
  private ourWallets: Set<string> = new Set();
  private agentWallets: Map<number, Wallet> = new Map();
  private agentNotes: Map<number, TokenNote[]> = new Map();
  private tree: MerkleTree = new MerkleTree();
  private isDryRun: boolean;
  private funderKey: string;
  private lastProcessedBlock = 0;

  constructor(privateKey: string) {
    this.funderKey = privateKey;
    this.provider = new JsonRpcProvider(CONFIG.RPC_URL);
    this.router = new Contract(CONFIG.DEX_ROUTER, ROUTER_ABI, this.provider);
    this.pair = new Contract(CONFIG.DEX_PAIR, PAIR_ABI, this.provider);
    this.tokenPool = new Contract(CONFIG.TOKEN_POOL, TOKEN_POOL_ABI, this.provider);
    this.isDryRun = process.env.DRY_RUN === 'true';
  }

  async initialize(): Promise<void> {
    console.log('\n🎯 Reactive Tax Trader');
    console.log('=========================\n');

    if (this.isDryRun) {
      console.log('⚠️  DRY RUN MODE - No real trades\n');
    }

    // Derive our wallet addresses
    console.log('Initializing agent wallets...');
    for (let i = 0; i < CONFIG.NUM_AGENTS; i++) {
      const derivedKey = ethers.keccak256(
        ethers.solidityPacked(['bytes32', 'uint256'], [this.funderKey, i + 1])
      );
      const wallet = new Wallet(derivedKey, this.provider);
      this.agentWallets.set(i + 1, wallet);
      this.ourWallets.add(wallet.address.toLowerCase());
      this.agentNotes.set(i + 1, []);
    }
    console.log(`  ${CONFIG.NUM_AGENTS} wallets initialized`);

    // Load saved notes
    this.loadNotes();

    // Count tokens available
    let totalTokens = 0n;
    let agentsWithTokens = 0;
    for (const [id, notes] of this.agentNotes) {
      const unspent = notes.filter(n => !n.spent);
      if (unspent.length > 0) {
        agentsWithTokens++;
        for (const n of unspent) {
          totalTokens += BigInt(n.amount);
        }
      }
    }
    console.log(`  ${agentsWithTokens} agents have tokens`);
    console.log(`  Total tokens available: ${ethers.formatEther(totalTokens)}\n`);

    if (totalTokens === 0n) {
      console.log('⚠️  No tokens available to sell!');
      console.log('   Run the regular market maker first to accumulate tokens.\n');
    }

    // Build merkle tree
    await this.buildMerkleTree();

    console.log(`Tax Rate: ${TAX_CONFIG.TAX_PERCENT}%`);
    console.log(`Min Buy to Tax: ${ethers.formatEther(TAX_CONFIG.MIN_BUY_TO_TAX)} ETH\n`);
  }

  private loadNotes(): void {
    const filepath = path.join(__dirname, '../agent-notes.json');
    if (!fs.existsSync(filepath)) {
      console.log('  No saved notes found');
      return;
    }

    const data = JSON.parse(fs.readFileSync(filepath, 'utf-8'));
    for (const [id, notes] of Object.entries(data)) {
      this.agentNotes.set(
        Number(id),
        (notes as any[]).map(n => ({
          ...n,
          amount: BigInt(n.amount),
        }))
      );
    }
    console.log('  Loaded saved notes');
  }

  private saveNotes(): void {
    const filepath = path.join(__dirname, '../agent-notes.json');
    const data: Record<number, any[]> = {};
    for (const [id, notes] of this.agentNotes) {
      data[id] = notes.map(n => ({ ...n, amount: n.amount.toString() }));
    }
    fs.writeFileSync(filepath, JSON.stringify(data, null, 2));
  }

  private async buildMerkleTree(): Promise<void> {
    console.log('Building merkle tree...');
    const nextLeafIndex = Number(await this.tokenPool.nextLeafIndex());

    for (let i = 0; i < nextLeafIndex; i++) {
      const leaf = await this.tokenPool.getLeaf(i);
      this.tree.insertAt(i, leaf);
    }
    console.log(`  ${nextLeafIndex} leaves loaded\n`);
  }

  /**
   * Find an agent with tokens to sell
   */
  private findAgentWithTokens(): { agentId: number; note: TokenNote } | null {
    for (const [agentId, notes] of this.agentNotes) {
      const unspent = notes.filter(n => !n.spent);
      if (unspent.length > 0) {
        return { agentId, note: unspent[0] };
      }
    }
    return null;
  }

  /**
   * Execute a tax sell
   */
  private async executeTaxSell(
    externalBuyer: string,
    externalBuyTokens: bigint,
    txHash: string
  ): Promise<void> {
    const taxAmount = (externalBuyTokens * BigInt(TAX_CONFIG.TAX_PERCENT)) / 100n;

    console.log(`\n💰 TAX OPPORTUNITY`);
    console.log(`   External buyer: ${externalBuyer.slice(0, 10)}...`);
    console.log(`   They bought: ${ethers.formatEther(externalBuyTokens)} tokens`);
    console.log(`   Tax amount: ${ethers.formatEther(taxAmount)} tokens (${TAX_CONFIG.TAX_PERCENT}%)`);

    // Find agent with tokens
    const seller = this.findAgentWithTokens();
    if (!seller) {
      console.log('   ❌ No tokens available to sell');
      return;
    }

    const { agentId, note } = seller;
    const sellAmount = taxAmount > note.amount ? note.amount : taxAmount;

    console.log(`   Agent ${agentId} will sell ${ethers.formatEther(sellAmount)} tokens`);

    if (this.isDryRun) {
      console.log('   [DRY RUN] Would execute sell');
      return;
    }

    try {
      // Get current reserves
      const ethReserve = await this.pair.ethReserve();
      const tokenReserve = await this.pair.tokenReserve();

      // Calculate expected ETH out
      const expectedEthOut = await this.router.getAmountOut(sellAmount, tokenReserve, ethReserve);
      const minEthOut = expectedEthOut * 95n / 100n; // 5% slippage

      // Get merkle proof
      const { pathElements, pathIndices, root } = this.tree.getProof(note.leafIndex);

      // Compute nullifier hash
      const nullifierHash = hashNullifier(BigInt(note.nullifier), note.leafIndex);

      // Change commitment (if selling partial)
      const changeAmount = note.amount - sellAmount;
      let changeCommitment = 0n;
      let changeNullifier = 0n;
      let changeSecret = 0n;

      if (changeAmount > 0n) {
        changeNullifier = randomFieldElement();
        changeSecret = randomFieldElement();
        changeCommitment = hashCommitment(changeNullifier, changeSecret, changeAmount);
      }

      // Compute public inputs binding
      const wallet = this.agentWallets.get(agentId)!;
      const publicInputsBinding = computePublicInputsBinding(
        minEthOut,
        wallet.address,
        wallet.address,
        0n,
        changeCommitment
      );

      // Generate ZK proof
      console.log('   Generating ZK proof...');
      const circuitsPath = path.join(__dirname, '../../circuits/build');
      const wasmPath = path.join(circuitsPath, 'sellPrivate_js/sellPrivate.wasm');
      const zkeyPath = path.join(circuitsPath, 'sellPrivate.zkey');

      const circuitInputs = {
        nullifier: note.nullifier,
        secret: note.secret,
        tokenAmount: sellAmount.toString(),
        minEthOut: minEthOut.toString(),
        recipient: BigInt(wallet.address).toString(),
        relayer: BigInt(wallet.address).toString(),
        fee: '0',
        changeCommitment: changeCommitment.toString(),
        pathElements: pathElements.map(e => e.toString()),
        pathIndices: pathIndices,
      };

      const { proof } = await snarkjs.groth16.fullProve(circuitInputs, wasmPath, zkeyPath);

      const proofForContract = [
        BigInt(proof.pi_a[0]),
        BigInt(proof.pi_a[1]),
        BigInt(proof.pi_b[0][1]),
        BigInt(proof.pi_b[0][0]),
        BigInt(proof.pi_b[1][1]),
        BigInt(proof.pi_b[1][0]),
        BigInt(proof.pi_c[0]),
        BigInt(proof.pi_c[1]),
      ];

      // Execute sell
      console.log('   Submitting transaction...');
      const connectedRouter = this.router.connect(wallet) as Contract;
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 600);

      const tx = await connectedRouter.sellPrivate(
        proofForContract,
        root,
        nullifierHash,
        sellAmount,
        minEthOut,
        wallet.address,
        wallet.address,
        0n,
        changeCommitment,
        publicInputsBinding,
        deadline,
        '0x',
        { gasLimit: 2000000 }
      );

      const receipt = await tx.wait();
      console.log(`   ✅ TAXED! TX: ${receipt.hash}`);
      console.log(`   ETH received: ~${ethers.formatEther(expectedEthOut)}`);

      // Mark note as spent
      note.spent = true;

      // Add change note if any
      if (changeAmount > 0n) {
        const notes = this.agentNotes.get(agentId)!;
        notes.push({
          commitment: changeCommitment.toString(),
          nullifier: changeNullifier.toString(),
          secret: changeSecret.toString(),
          amount: changeAmount,
          leafIndex: 0, // Will be updated on next scan
          spent: false,
        });
      }

      this.saveNotes();

    } catch (error: any) {
      console.log(`   ❌ Error: ${error.message?.slice(0, 100)}`);
    }
  }

  /**
   * Poll for new buys
   */
  async run(): Promise<void> {
    console.log('🔍 Monitoring for external buys...\n');
    console.log('Press Ctrl+C to stop\n');

    // Get event signature
    const purchaseEventSig = ethers.id('TokensPurchased(uint256,uint256)');
    this.lastProcessedBlock = await this.provider.getBlockNumber();

    while (true) {
      try {
        const currentBlock = await this.provider.getBlockNumber();

        if (currentBlock > this.lastProcessedBlock) {
          // Get logs from new blocks
          const logs = await this.provider.getLogs({
            address: CONFIG.DEX_PAIR,
            topics: [purchaseEventSig],
            fromBlock: this.lastProcessedBlock + 1,
            toBlock: currentBlock,
          });

          for (const log of logs) {
            // Get transaction to find buyer
            const tx = await this.provider.getTransaction(log.transactionHash);
            if (!tx) continue;

            const buyer = tx.from.toLowerCase();

            // Skip if it's one of our wallets
            if (this.ourWallets.has(buyer)) {
              console.log(`[${new Date().toLocaleTimeString()}] Our wallet bought - ignoring`);
              continue;
            }

            // Parse the event
            const iface = new ethers.Interface(PAIR_ABI);
            const parsed = iface.parseLog({ topics: log.topics as string[], data: log.data });

            if (parsed && parsed.name === 'TokensPurchased') {
              const ethIn = parsed.args[0];
              const tokensOut = parsed.args[1];

              // Check if buy is large enough to tax
              if (ethIn >= TAX_CONFIG.MIN_BUY_TO_TAX) {
                await this.executeTaxSell(buyer, tokensOut, log.transactionHash);
              } else {
                console.log(`[${new Date().toLocaleTimeString()}] Small buy (${ethers.formatEther(ethIn)} ETH) - skipping`);
              }
            }
          }

          this.lastProcessedBlock = currentBlock;
        }

      } catch (error: any) {
        console.error('Poll error:', error.message?.slice(0, 50));
      }

      await new Promise(resolve => setTimeout(resolve, TAX_CONFIG.POLL_INTERVAL_MS));
    }
  }
}

// =============================================================================
// Main
// =============================================================================

async function main() {
  const privateKey = process.env.PRIVATE_KEY;
  if (!privateKey) {
    console.error('❌ PRIVATE_KEY required');
    process.exit(1);
  }

  const trader = new ReactiveTaxTrader(privateKey);
  await trader.initialize();
  await trader.run();
}

main().catch(console.error);
