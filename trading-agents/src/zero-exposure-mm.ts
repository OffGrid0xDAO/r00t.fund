#!/usr/bin/env npx tsx
/**
 * Zero Exposure Market Maker with Tax
 *
 * Strategy:
 * 1. Generate organic volume with BUY+SELL pairs (net 0 exposure)
 * 2. Monitor for external buys
 * 3. Tax 20% of external buys → profits go to PROFIT_WALLET
 *
 * The only profit comes from taxing external buyers.
 * All organic trading is neutral (buy X, then sell X).
 *
 * Usage:
 *   PROFIT_WALLET=0x... npm run tax
 */

import { ethers, Contract, JsonRpcProvider, Wallet } from 'ethers';
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

const MM_CONFIG = {
  // Tax settings
  TAX_PERCENT: 20,
  MIN_BUY_TO_TAX: ethers.parseEther('0.005'), // Tax buys > 0.005 ETH
  PROFIT_WALLET: process.env.PROFIT_WALLET || '', // Where profits go

  // Organic volume settings (net 0 exposure)
  ORGANIC_TRADE_SIZE: ethers.parseEther('0.02'), // Size of buy+sell pairs
  ORGANIC_INTERVAL_MS: 30000, // Every 30 seconds
  AGENTS_PER_ROUND: 2, // How many agents do organic trades per round

  // Monitoring
  POLL_INTERVAL_MS: 2000,

  // Indexer URL for fetching merkle tree data
  INDEXER_URL: process.env.INDEXER_URL || 'https://ponder-indexer-production-50c3.up.railway.app',
};

// =============================================================================
// ABIs
// =============================================================================

const ROUTER_ABI = [
  'function buyPrivate(uint256 newCommitment, uint256 minTokensOut, uint256 deadline, bytes encryptedNote) payable',
  'function sellPrivate(uint256[8] proof, uint256 merkleRoot, uint256 nullifierHash, uint256 tokenAmount, uint256 minEthOut, address recipient, address relayer, uint256 fee, uint256 changeCommitment, uint256 publicInputsBinding, uint256 deadline, bytes changeNote) external',
  'function getAmountOut(uint256 amountIn, uint256 reserveIn, uint256 reserveOut) view returns (uint256)',
  'event TokensPurchased(uint256 ethIn, uint256 tokensOut)',
  'event NewCommitment(uint256 indexed commitment, uint256 indexed leafIndex, bytes encryptedNote)',
];

const PAIR_ABI = [
  'function ethReserve() view returns (uint256)',
  'function tokenReserve() view returns (uint256)',
  'function currentMerkleRoot() view returns (uint256)',
  'event TokensPurchased(uint256 ethIn, uint256 tokensOut)',
];

const TOKEN_POOL_ABI = [
  'function getNextIndex() view returns (uint256)',
  'function getRoot() view returns (uint256)',
  'function isKnownRoot(uint256 _root) view returns (bool)',
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
// Zero Exposure Market Maker
// =============================================================================

class ZeroExposureMM {
  private provider: JsonRpcProvider;
  private router: Contract;
  private pair: Contract;
  private tokenPool: Contract;
  private ourWallets: Set<string> = new Set();
  private agentWallets: Map<number, Wallet> = new Map();
  private agentNotes: Map<number, TokenNote[]> = new Map();
  private tree: MerkleTree = new MerkleTree();
  private funderKey: string;
  private lastProcessedBlock = 0;
  private totalProfit = 0n;
  private totalTaxes = 0;
  private isDryRun: boolean;

  constructor(privateKey: string) {
    this.funderKey = privateKey;
    this.provider = new JsonRpcProvider(CONFIG.RPC_URL);
    this.router = new Contract(CONFIG.DEX_ROUTER, ROUTER_ABI, this.provider);
    this.pair = new Contract(CONFIG.DEX_PAIR, PAIR_ABI, this.provider);
    this.tokenPool = new Contract(CONFIG.TOKEN_POOL, TOKEN_POOL_ABI, this.provider);
    this.isDryRun = process.env.DRY_RUN === 'true';
  }

  async initialize(): Promise<void> {
    console.log('\n💀 Zero Exposure Market Maker + Tax');
    console.log('=====================================\n');

    if (this.isDryRun) console.log('⚠️  DRY RUN MODE\n');

    if (!MM_CONFIG.PROFIT_WALLET) {
      console.log('⚠️  No PROFIT_WALLET set - profits stay in agent wallets');
      console.log('   Set PROFIT_WALLET=0x... to send profits elsewhere\n');
    } else {
      console.log(`💰 Profits go to: ${MM_CONFIG.PROFIT_WALLET}\n`);
    }

    // Initialize wallets
    console.log('Initializing agents...');
    for (let i = 0; i < CONFIG.NUM_AGENTS; i++) {
      const derivedKey = ethers.keccak256(
        ethers.solidityPacked(['bytes32', 'uint256'], [this.funderKey, i + 1])
      );
      const wallet = new Wallet(derivedKey, this.provider);
      this.agentWallets.set(i + 1, wallet);
      this.ourWallets.add(wallet.address.toLowerCase());
      this.agentNotes.set(i + 1, []);
    }
    console.log(`  ${CONFIG.NUM_AGENTS} agents ready\n`);

    // Load notes
    this.loadNotes();

    // Build merkle tree
    await this.buildMerkleTree();

    console.log(`Strategy:`);
    console.log(`  • Organic volume: Buy+Sell ${ethers.formatEther(MM_CONFIG.ORGANIC_TRADE_SIZE)} ETH (net 0)`);
    console.log(`  • Tax rate: ${MM_CONFIG.TAX_PERCENT}% of external buys`);
    console.log(`  • Min buy to tax: ${ethers.formatEther(MM_CONFIG.MIN_BUY_TO_TAX)} ETH\n`);
  }

  private loadNotes(): void {
    const filepath = path.join(__dirname, '../agent-notes.json');
    if (!fs.existsSync(filepath)) return;

    const data = JSON.parse(fs.readFileSync(filepath, 'utf-8'));
    for (const [id, notes] of Object.entries(data)) {
      this.agentNotes.set(
        Number(id),
        (notes as any[]).map(n => ({ ...n, amount: BigInt(n.amount) }))
      );
    }
  }

  private saveNotes(): void {
    const filepath = path.join(__dirname, '../agent-notes.json');
    const data: Record<number, any[]> = {};
    for (const [id, notes] of this.agentNotes) {
      data[id] = notes.map(n => ({ ...n, amount: n.amount.toString() }));
    }
    fs.writeFileSync(filepath, JSON.stringify(data, null, 2));
  }

  /**
   * Fetch all commitments from the Ponder indexer
   */
  private async fetchCommitmentsFromChain(): Promise<{ commitment: bigint; leafIndex: number }[]> {
    try {
      // Query Ponder indexer - table is "commitmentss" (double s)
      // Note: limit 1000 works, 10000 causes server error
      const query = `{
        commitmentss(limit: 1000, orderBy: "leafIndex", orderDirection: "asc") {
          items {
            commitment
            leafIndex
          }
        }
      }`;

      const response = await fetch(MM_CONFIG.INDEXER_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query }),
      });

      if (!response.ok) {
        throw new Error(`Indexer request failed: ${response.status}`);
      }

      const data = await response.json();
      const items = data?.data?.commitmentss?.items || [];

      return items.map((item: any) => ({
        commitment: BigInt(item.commitment),
        leafIndex: Number(item.leafIndex),
      }));
    } catch (error: any) {
      console.log(`  ⚠️  Could not fetch from indexer: ${error.message?.slice(0, 50)}`);
      return [];
    }
  }

  private async buildMerkleTree(): Promise<void> {
    // Fetch all commitments from Ponder indexer
    console.log('  Fetching commitments from indexer...');
    const chainCommitments = await this.fetchCommitmentsFromChain();

    // Build tree from indexer data
    for (const c of chainCommitments) {
      this.tree.insertAt(c.leafIndex, c.commitment);
    }

    // Also add our saved notes (in case indexer is behind)
    let notesAdded = 0;
    for (const [agentId, notes] of this.agentNotes) {
      for (const note of notes) {
        if (!note.spent && note.leafIndex >= 0) {
          // Only add if not already in tree from indexer
          this.tree.insertAt(note.leafIndex, BigInt(note.commitment));
          notesAdded++;
        }
      }
    }

    const contractRoot = await this.tokenPool.getRoot();
    const localRoot = this.tree.getProof(0).root;

    console.log(`  Indexer: ${chainCommitments.length} commitments`);
    console.log(`  Local notes: ${notesAdded}`);
    console.log(`  Contract root: ${contractRoot.toString().slice(0, 20)}...`);
    console.log(`  Local root: ${localRoot.toString().slice(0, 20)}...`);

    if (contractRoot.toString() !== localRoot.toString()) {
      console.log(`  ⚠️  Root mismatch - merkle tree may be incomplete\n`);
    } else {
      console.log(`  ✓ Merkle roots match\n`);
    }
  }

  /**
   * Execute organic BUY (part of net-0 trade)
   */
  private async organicBuy(agentId: number, amount: bigint): Promise<TokenNote | null> {
    const wallet = this.agentWallets.get(agentId)!;
    const balance = await this.provider.getBalance(wallet.address);

    if (balance < amount + CONFIG.GAS_BUFFER) {
      return null;
    }

    const nullifier = randomFieldElement();
    const secret = randomFieldElement();

    const ethReserve = await this.pair.ethReserve();
    const tokenReserve = await this.pair.tokenReserve();
    const expectedTokens = await this.router.getAmountOut(amount, ethReserve, tokenReserve);

    const commitment = hashCommitment(nullifier, secret, expectedTokens);
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 600);

    if (this.isDryRun) {
      console.log(`  [DRY] Agent ${agentId} BUY ${ethers.formatEther(amount)} ETH`);
      return null;
    }

    try {
      const connectedRouter = this.router.connect(wallet) as Contract;
      const tx = await connectedRouter.buyPrivate(commitment, 0n, deadline, '0x', {
        value: amount,
        gasLimit: 1200000,
      });

      const receipt = await tx.wait();

      // Get actual tokens and leaf index from events
      let actualTokens = expectedTokens;
      let leafIndex = 0;
      for (const log of receipt.logs) {
        try {
          const parsed = this.router.interface.parseLog(log);
          if (parsed?.name === 'TokensPurchased') actualTokens = parsed.args[1];
          if (parsed?.name === 'NewCommitment') leafIndex = Number(parsed.args[1]);
        } catch {}
      }

      const note: TokenNote = {
        commitment: commitment.toString(),
        nullifier: nullifier.toString(),
        secret: secret.toString(),
        amount: actualTokens,
        leafIndex,
        spent: false,
      };

      const notes = this.agentNotes.get(agentId)!;
      notes.push(note);

      // Update merkle tree
      this.tree.insertAt(leafIndex, commitment);

      return note;

    } catch (error: any) {
      console.log(`  ❌ Buy error: ${error.message?.slice(0, 50)}`);
      return null;
    }
  }

  /**
   * Execute SELL (for organic net-0 or tax)
   */
  private async executeSell(
    agentId: number,
    note: TokenNote,
    sellAmount: bigint,
    recipient: string, // Where ETH goes
    isTax: boolean = false
  ): Promise<bigint> {
    const wallet = this.agentWallets.get(agentId)!;

    if (this.isDryRun) {
      console.log(`  [DRY] Agent ${agentId} SELL ${ethers.formatEther(sellAmount)} tokens${isTax ? ' (TAX)' : ''}`);
      return 0n;
    }

    try {
      // Refresh merkle tree from indexer before selling
      this.tree = new MerkleTree();
      const chainCommitments = await this.fetchCommitmentsFromChain();
      for (const c of chainCommitments) {
        this.tree.insertAt(c.leafIndex, c.commitment);
      }
      // Also add our commitment (in case indexer hasn't indexed it yet)
      this.tree.insertAt(note.leafIndex, BigInt(note.commitment));

      const ethReserve = await this.pair.ethReserve();
      const tokenReserve = await this.pair.tokenReserve();
      const expectedEthOut = await this.router.getAmountOut(sellAmount, tokenReserve, ethReserve);
      const minEthOut = expectedEthOut * 95n / 100n;

      const { pathElements, pathIndices, root } = this.tree.getProof(note.leafIndex);
      const nullifierHash = hashNullifier(BigInt(note.nullifier), note.leafIndex);

      // Change commitment for remaining tokens
      const changeAmount = note.amount - sellAmount;
      let changeCommitment = 0n;
      let changeNullifier = 0n;
      let changeSecret = 0n;

      if (changeAmount > 0n) {
        changeNullifier = randomFieldElement();
        changeSecret = randomFieldElement();
        changeCommitment = hashCommitment(changeNullifier, changeSecret, changeAmount);
      }

      const publicInputsBinding = computePublicInputsBinding(
        minEthOut,
        recipient,
        recipient,
        0n,
        changeCommitment
      );

      // Generate proof
      const circuitsPath = path.join(__dirname, '../../circuits/build/sell');
      const wasmPath = path.join(circuitsPath, 'sell_js/sell.wasm');
      const zkeyPath = path.join(circuitsPath, 'sell_final.zkey');

      const circuitInputs = {
        // Public inputs
        merkleRoot: root.toString(),
        nullifierHash: nullifierHash.toString(),
        tokenAmount: sellAmount.toString(),
        minEthOut: minEthOut.toString(),
        recipient: BigInt(recipient).toString(),
        relayer: BigInt(recipient).toString(),
        fee: '0',
        changeCommitment: changeCommitment.toString(),
        // Private inputs
        nullifier: note.nullifier,
        secret: note.secret,
        amount: note.amount.toString(),
        pathElements: pathElements.map(e => e.toString()),
        pathIndices,
        changeNullifier: changeNullifier.toString(),
        changeSecret: changeSecret.toString(),
      };

      const { proof } = await snarkjs.groth16.fullProve(circuitInputs, wasmPath, zkeyPath);

      const proofForContract = [
        BigInt(proof.pi_a[0]), BigInt(proof.pi_a[1]),
        BigInt(proof.pi_b[0][1]), BigInt(proof.pi_b[0][0]),
        BigInt(proof.pi_b[1][1]), BigInt(proof.pi_b[1][0]),
        BigInt(proof.pi_c[0]), BigInt(proof.pi_c[1]),
      ];

      const connectedRouter = this.router.connect(wallet) as Contract;
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 600);

      const tx = await connectedRouter.sellPrivate(
        proofForContract, root, nullifierHash, sellAmount, minEthOut,
        recipient, recipient, 0n, changeCommitment, publicInputsBinding,
        deadline, '0x', { gasLimit: 2000000 }
      );

      await tx.wait();

      // Update note
      note.spent = true;

      if (changeAmount > 0n) {
        const notes = this.agentNotes.get(agentId)!;
        notes.push({
          commitment: changeCommitment.toString(),
          nullifier: changeNullifier.toString(),
          secret: changeSecret.toString(),
          amount: changeAmount,
          leafIndex: 0,
          spent: false,
        });
      }

      this.saveNotes();
      return expectedEthOut;

    } catch (error: any) {
      const reason = error.reason || error.shortMessage || error.message?.slice(0, 80);
      console.log(`  ❌ Sell error: ${reason}`);
      if (error.data) console.log(`     Data: ${error.data}`);
      return 0n;
    }
  }

  /**
   * Execute organic BUY+SELL pair (net 0 exposure)
   */
  private async organicRoundTrip(agentId: number): Promise<void> {
    console.log(`\n🔄 Agent ${agentId}: Organic round-trip`);

    // BUY
    const note = await this.organicBuy(agentId, MM_CONFIG.ORGANIC_TRADE_SIZE);
    if (!note) {
      console.log(`   Skipped (no balance or error)`);
      return;
    }

    console.log(`   BUY: ${ethers.formatEther(MM_CONFIG.ORGANIC_TRADE_SIZE)} ETH → ${ethers.formatEther(note.amount)} tokens`);

    // Small delay
    await new Promise(r => setTimeout(r, 3000));

    // SELL back (to same wallet = net 0)
    const wallet = this.agentWallets.get(agentId)!;
    const ethBack = await this.executeSell(agentId, note, note.amount, wallet.address, false);

    if (ethBack > 0n) {
      console.log(`   SELL: ${ethers.formatEther(note.amount)} tokens → ${ethers.formatEther(ethBack)} ETH`);
      console.log(`   Net exposure: ~0 ETH ✓`);
    }
  }

  /**
   * Tax an external buy
   */
  private async taxExternalBuy(buyer: string, tokensBought: bigint): Promise<void> {
    const taxAmount = (tokensBought * BigInt(MM_CONFIG.TAX_PERCENT)) / 100n;

    console.log(`\n💰 TAX OPPORTUNITY`);
    console.log(`   External: ${buyer.slice(0, 10)}... bought ${ethers.formatEther(tokensBought)} tokens`);
    console.log(`   Tax: ${ethers.formatEther(taxAmount)} tokens (${MM_CONFIG.TAX_PERCENT}%)`);

    // Find agent with tokens
    for (const [agentId, notes] of this.agentNotes) {
      const unspent = notes.filter(n => !n.spent);
      if (unspent.length === 0) continue;

      const note = unspent[0];
      const sellAmount = taxAmount > note.amount ? note.amount : taxAmount;

      // Send profits to PROFIT_WALLET or back to agent
      const recipient = MM_CONFIG.PROFIT_WALLET || this.agentWallets.get(agentId)!.address;

      console.log(`   Agent ${agentId} selling ${ethers.formatEther(sellAmount)} tokens`);
      console.log(`   Profits → ${recipient.slice(0, 10)}...`);

      const ethReceived = await this.executeSell(agentId, note, sellAmount, recipient, true);

      if (ethReceived > 0n) {
        this.totalProfit += ethReceived;
        this.totalTaxes++;
        console.log(`   ✅ TAXED! +${ethers.formatEther(ethReceived)} ETH`);
        console.log(`   Total profit: ${ethers.formatEther(this.totalProfit)} ETH (${this.totalTaxes} taxes)`);
      }
      return;
    }

    console.log(`   ❌ No tokens available to sell`);
  }

  /**
   * Monitor for external buys
   */
  private async monitorExternalBuys(): Promise<void> {
    const purchaseEventSig = ethers.id('TokensPurchased(uint256,uint256)');
    const currentBlock = await this.provider.getBlockNumber();

    if (currentBlock <= this.lastProcessedBlock) return;

    const logs = await this.provider.getLogs({
      address: CONFIG.DEX_PAIR,
      topics: [purchaseEventSig],
      fromBlock: this.lastProcessedBlock + 1,
      toBlock: currentBlock,
    });

    for (const log of logs) {
      const tx = await this.provider.getTransaction(log.transactionHash);
      if (!tx) continue;

      const buyer = tx.from.toLowerCase();

      // Skip our wallets
      if (this.ourWallets.has(buyer)) continue;

      const iface = new ethers.Interface(PAIR_ABI);
      const parsed = iface.parseLog({ topics: log.topics as string[], data: log.data });

      if (parsed?.name === 'TokensPurchased') {
        const ethIn = parsed.args[0];
        const tokensOut = parsed.args[1];

        if (ethIn >= MM_CONFIG.MIN_BUY_TO_TAX) {
          await this.taxExternalBuy(buyer, tokensOut);
        }
      }
    }

    this.lastProcessedBlock = currentBlock;
  }

  async run(): Promise<void> {
    console.log('🚀 Starting Zero Exposure MM...\n');
    console.log('Press Ctrl+C to stop\n');

    this.lastProcessedBlock = await this.provider.getBlockNumber();

    let lastOrganicTime = 0;
    let organicRound = 0;

    while (true) {
      try {
        // Monitor for external buys (tax opportunities)
        await this.monitorExternalBuys();

        // Organic volume generation (net 0 exposure)
        const now = Date.now();
        if (now - lastOrganicTime > MM_CONFIG.ORGANIC_INTERVAL_MS) {
          organicRound++;
          console.log(`\n--- Organic Round ${organicRound} ---`);

          // Pick random agents for organic trades
          const agentIds = Array.from({ length: CONFIG.NUM_AGENTS }, (_, i) => i + 1)
            .sort(() => Math.random() - 0.5)
            .slice(0, MM_CONFIG.AGENTS_PER_ROUND);

          for (const agentId of agentIds) {
            await this.organicRoundTrip(agentId);
          }

          lastOrganicTime = now;
        }

      } catch (error: any) {
        console.error('Error:', error.message?.slice(0, 50));
      }

      await new Promise(r => setTimeout(r, MM_CONFIG.POLL_INTERVAL_MS));
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
    console.log('\nUsage:');
    console.log('  PRIVATE_KEY=0x... npm run tax');
    console.log('  PRIVATE_KEY=0x... PROFIT_WALLET=0x... npm run tax');
    process.exit(1);
  }

  const mm = new ZeroExposureMM(privateKey);
  await mm.initialize();
  await mm.run();
}

main().catch(console.error);
