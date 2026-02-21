#!/usr/bin/env npx tsx
/**
 * Sell All Old Tokens
 * Recovers notes from the OLD contracts and sells them to get ETH back
 */

import { ethers, Wallet } from 'ethers';
import { poseidon2, poseidon3, poseidon5 } from 'poseidon-lite';
import * as snarkjs from 'snarkjs';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env
const envPath = path.join(__dirname, '../contracts/.env');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf-8');
  envContent.split('\n').forEach(line => {
    const [key, ...valueParts] = line.split('=');
    if (key && valueParts.length > 0 && !process.env[key.trim()]) {
      process.env[key.trim()] = valueParts.join('=').trim();
    }
  });
}

// OLD contract addresses (before the shorts upgrade)
const CONFIG = {
  RPC_URL: process.env.SEPOLIA_RPC_URL || 'https://eth-sepolia.g.alchemy.com/v2/demo',
  OLD_ROUTER: '0x82a72fb9e51f52f0A38138791879563a7e64E45e',
  OLD_PAIR: '0xb794FE99149440EA619ae9d80D7cB0cB01210b8c',
  OLD_TOKEN_POOL: '0xb2cf2146016C1B7Fe6aE3e4B1AdA8AEAf62F0e58',
  INDEXER: 'https://ponder-indexer-production-50c3.up.railway.app',
  PRIVATE_KEY: process.env.PRIVATE_KEY!,
  NUM_AGENTS: 33,
  CIRCUITS_PATH: path.join(__dirname, '../circuits/build'),
  TARGET_WALLET: '0x42069c220DD72541C2C7Cb7620f2094f1601430A',
};

const FIELD_PRIME = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
const ZERO_VALUE = 21663839004416932945382355908790599225266501822907911457504978515578255421292n;

// Crypto helpers
const deriveNull = (pk: string, i: number): bigint =>
  BigInt(ethers.keccak256(ethers.solidityPacked(['bytes32', 'string', 'uint256'], [pk, 'nullifier', i]))) % FIELD_PRIME;

const deriveSec = (pk: string, i: number): bigint =>
  BigInt(ethers.keccak256(ethers.solidityPacked(['bytes32', 'string', 'uint256'], [pk, 'secret', i]))) % FIELD_PRIME;

const hashComm = (n: bigint, s: bigint, a: bigint): bigint => poseidon3([n, s, a]);
const hashNull = (n: bigint, i: number): bigint => poseidon2([n, BigInt(i)]);
const hashPair = (a: bigint, b: bigint): bigint => poseidon2([a, b]);

interface Note {
  commitment: string;
  nullifier: bigint;
  secret: bigint;
  amount: bigint;
  leafIndex: number;
  wallet: Wallet;
  walletName: string;
}

interface Commitment {
  commitment: string;
  leafIndex: number;
  blockNumber: number;
  transactionHash: string;
}

// Merkle Tree (depth 24)
class MerkleTree {
  private depth: number = 24;
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
      for (let i = 0; i <= Math.floor(maxLeafIndex / (1 << level)); i++) {
        parentIndices.add(i);
      }
      for (const parentIdx of parentIndices) {
        const leftIdx = parentIdx * 2;
        const rightIdx = parentIdx * 2 + 1;
        const left = prevLayer.get(leftIdx) ?? this.zeros[level - 1];
        const right = prevLayer.get(rightIdx) ?? this.zeros[level - 1];
        layers[level].set(parentIdx, hashPair(left, right));
      }
    }

    return layers;
  }

  getRoot(): bigint {
    return this.buildLayers()[this.depth].get(0) ?? this.zeros[this.depth];
  }
}

async function fetchAllCommitments(): Promise<Commitment[]> {
  const all: Commitment[] = [];
  let cursor: string | null = null;
  const addr = CONFIG.OLD_PAIR.toLowerCase();

  console.log('Fetching commitments from indexer...');

  for (let page = 0; page < 20; page++) {
    const afterClause = cursor ? `,after:"${cursor}"` : '';
    try {
      const resp = await fetch(`${CONFIG.INDEXER}/graphql`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: `{commitmentss(limit:1000,where:{address:"${addr}"}${afterClause}){pageInfo{endCursor hasNextPage}items{leafIndex commitment blockNumber transactionHash}}}`
        }),
      });

      const j = await resp.json() as any;
      const items = j.data?.commitmentss?.items;
      if (!items) break;

      for (const it of items) {
        all.push({
          commitment: it.commitment,
          leafIndex: Number(it.leafIndex),
          blockNumber: Number(it.blockNumber),
          transactionHash: it.transactionHash,
        });
      }

      const pageInfo = j.data?.commitmentss?.pageInfo;
      if (!pageInfo?.hasNextPage) break;
      cursor = pageInfo.endCursor;
      process.stdout.write(`\r  Page ${page + 1}: ${all.length} commitments`);
    } catch (err) {
      console.log('\n  Indexer not responding, using chain scan...');
      break;
    }
  }

  console.log(`\n  Total: ${all.length} commitments\n`);
  return all;
}

async function fetchSpentNullifiers(): Promise<Set<string>> {
  const spent = new Set<string>();
  let cursor: string | null = null;

  console.log('Fetching spent nullifiers...');

  for (let page = 0; page < 50; page++) {
    const afterClause = cursor ? `,after:"${cursor}"` : '';
    try {
      const resp = await fetch(`${CONFIG.INDEXER}/graphql`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: `{nullifierss(limit:1000${afterClause}){pageInfo{endCursor hasNextPage}items{id}}}`
        }),
      });

      const j = await resp.json() as any;
      const items = j.data?.nullifierss?.items;
      if (!items) break;

      for (const it of items) {
        spent.add(it.id);
      }

      const pageInfo = j.data?.nullifierss?.pageInfo;
      if (!pageInfo?.hasNextPage) break;
      cursor = pageInfo.endCursor;
      process.stdout.write(`\r  Page ${page + 1}: ${spent.size} nullifiers`);
    } catch (err) {
      break;
    }
  }

  console.log(`\n  Total: ${spent.size} spent nullifiers\n`);
  return spent;
}

async function generateSellProof(
  note: Note,
  merkleTree: MerkleTree,
  ethToReceive: bigint,
  change: bigint,
  newNullifier: bigint,
  newSecret: bigint,
  recipient: string
): Promise<{ proof: any; publicSignals: any }> {
  const { pathElements, pathIndices, root } = merkleTree.getProof(note.leafIndex);
  const nullifierHash = hashNull(note.nullifier, note.leafIndex);
  const newCommitment = hashComm(newNullifier, newSecret, change);

  const publicInputsHash = BigInt(
    ethers.solidityPackedKeccak256(
      ['uint256', 'uint256', 'uint256', 'uint256', 'address'],
      [root.toString(), nullifierHash.toString(), newCommitment.toString(), ethToReceive.toString(), recipient]
    )
  ) % FIELD_PRIME;

  const input = {
    publicInputsHash: publicInputsHash.toString(),
    root: root.toString(),
    nullifierHash: nullifierHash.toString(),
    newCommitment: newCommitment.toString(),
    ethToReceive: ethToReceive.toString(),
    recipient: BigInt(recipient).toString(),
    nullifier: note.nullifier.toString(),
    secret: note.secret.toString(),
    tokenAmount: note.amount.toString(),
    leafIndex: note.leafIndex.toString(),
    pathElements: pathElements.map(e => e.toString()),
    pathIndices: pathIndices.map(i => i.toString()),
    change: change.toString(),
    newNullifier: newNullifier.toString(),
    newSecret: newSecret.toString(),
  };

  const wasmPath = path.join(CONFIG.CIRCUITS_PATH, 'sell_js/sell.wasm');
  const zkeyPath = path.join(CONFIG.CIRCUITS_PATH, 'sell.zkey');

  if (!fs.existsSync(wasmPath) || !fs.existsSync(zkeyPath)) {
    throw new Error('Circuit files not found. Run: cd circuits && ./compile.sh sell');
  }

  const { proof, publicSignals } = await snarkjs.groth16.fullProve(input, wasmPath, zkeyPath);
  return { proof, publicSignals };
}

function formatProof(proof: any): string[] {
  return [
    proof.pi_a[0], proof.pi_a[1],
    proof.pi_b[0][1], proof.pi_b[0][0], proof.pi_b[1][1], proof.pi_b[1][0],
    proof.pi_c[0], proof.pi_c[1],
  ];
}

async function main() {
  console.log('\n=== SELL ALL OLD TOKENS ===\n');
  console.log('Old Router:', CONFIG.OLD_ROUTER);
  console.log('Old Pair:', CONFIG.OLD_PAIR);
  console.log('Target Wallet:', CONFIG.TARGET_WALLET);
  console.log('');

  const provider = new ethers.JsonRpcProvider(CONFIG.RPC_URL);
  const funderKey = CONFIG.PRIVATE_KEY;

  if (!funderKey) {
    console.error('ERROR: PRIVATE_KEY not found');
    process.exit(1);
  }

  // Get all wallets
  const wallets: { wallet: Wallet; pk: string; name: string }[] = [];
  const deployerWallet = new Wallet(funderKey, provider);
  wallets.push({ wallet: deployerWallet, pk: funderKey, name: 'Deployer' });

  for (let i = 1; i <= CONFIG.NUM_AGENTS; i++) {
    const dk = ethers.keccak256(ethers.solidityPacked(['bytes32', 'uint256'], [funderKey, i]));
    const w = new Wallet(dk, provider);
    wallets.push({ wallet: w, pk: dk, name: `Agent#${i}` });
  }

  // Fetch commitments and nullifiers
  const commitments = await fetchAllCommitments();
  const spentNullifiers = await fetchSpentNullifiers();

  if (commitments.length === 0) {
    console.log('No commitments found on old contracts. Indexer may need to sync.');
    console.log('Trying to scan chain directly...\n');

    // If no commitments from indexer, fall back to chain scan
    const pairABI = [
      'event NewCommitment(uint256 indexed commitment, uint256 indexed leafIndex, bytes encryptedNote)',
    ];
    const pair = new ethers.Contract(CONFIG.OLD_PAIR, pairABI, provider);
    const filter = pair.filters.NewCommitment();

    console.log('Scanning from block 7000000...');
    const events = await pair.queryFilter(filter, 7000000);
    console.log(`Found ${events.length} commitments on chain\n`);

    for (const ev of events) {
      const args = (ev as any).args;
      commitments.push({
        commitment: args.commitment.toString(),
        leafIndex: Number(args.leafIndex),
        blockNumber: ev.blockNumber,
        transactionHash: ev.transactionHash,
      });
    }
  }

  // Build merkle tree
  const merkleTree = new MerkleTree();
  for (const c of commitments) {
    merkleTree.insertAt(c.leafIndex, BigInt(c.commitment));
  }

  // Find unspent notes for our wallets
  console.log('Scanning for recoverable notes...\n');

  const routerABI = [
    'event TokensPurchased(uint256 ethIn, uint256 tokensOut, uint256 newEthReserve, uint256 newTokenReserve)',
  ];
  const routerIface = new ethers.Interface(routerABI);

  const unspentNotes: Note[] = [];
  let processed = 0;

  for (const comm of commitments) {
    processed++;
    if (processed % 50 === 0) {
      process.stdout.write(`\rProcessing ${processed}/${commitments.length} (found: ${unspentNotes.length})`);
    }

    try {
      const receipt = await provider.getTransactionReceipt(comm.transactionHash);
      if (!receipt) continue;

      const tx = await provider.getTransaction(comm.transactionHash);
      if (!tx) continue;

      // Check if tx is from one of our wallets
      const walletInfo = wallets.find(w => w.wallet.address.toLowerCase() === tx.from.toLowerCase());
      if (!walletInfo) continue;

      // Get token amount from TokensPurchased event
      let tokenAmount: bigint | null = null;
      for (const log of receipt.logs) {
        try {
          const parsed = routerIface.parseLog({ topics: log.topics as string[], data: log.data });
          if (parsed?.name === 'TokensPurchased') {
            tokenAmount = parsed.args[1];
            break;
          }
        } catch {}
      }

      if (!tokenAmount) continue;

      // Try to find the matching index
      for (let buyIndex = 0; buyIndex < 500; buyIndex++) {
        const nullifier = deriveNull(walletInfo.pk, buyIndex);
        const secret = deriveSec(walletInfo.pk, buyIndex);
        const computedComm = hashComm(nullifier, secret, tokenAmount);

        if (computedComm.toString() === comm.commitment) {
          const nullifierHash = hashNull(nullifier, comm.leafIndex);
          const isSpent = spentNullifiers.has(nullifierHash.toString());

          if (!isSpent) {
            unspentNotes.push({
              commitment: comm.commitment,
              nullifier,
              secret,
              amount: tokenAmount,
              leafIndex: comm.leafIndex,
              wallet: walletInfo.wallet,
              walletName: walletInfo.name,
            });
          }
          break;
        }
      }
    } catch (err) {
      // Skip errors
    }
  }

  console.log(`\n\nFound ${unspentNotes.length} unspent notes\n`);

  if (unspentNotes.length === 0) {
    console.log('No unspent notes to sell.');
    return;
  }

  // Calculate total value
  const totalTokens = unspentNotes.reduce((sum, n) => sum + n.amount, 0n);
  console.log(`Total tokens to sell: ${ethers.formatEther(totalTokens)} ROOT`);

  // Get current reserves to estimate ETH out
  const pairABI2 = ['function getReserves() view returns (uint256, uint256)'];
  const pair = new ethers.Contract(CONFIG.OLD_PAIR, pairABI2, provider);
  const [ethReserve, tokenReserve] = await pair.getReserves();

  console.log(`Pool reserves: ${ethers.formatEther(ethReserve)} ETH, ${ethers.formatEther(tokenReserve)} ROOT`);

  // Estimate ETH output (x * dy / (y + dy)) for constant product
  const estimatedEthOut = (ethReserve * totalTokens) / (tokenReserve + totalTokens);
  console.log(`Estimated ETH out: ${ethers.formatEther(estimatedEthOut)} ETH\n`);

  // Sell each note
  const routerABI3 = [
    'function sellWithProof(uint256[8] calldata proof, uint256 root, uint256 nullifierHash, uint256 newCommitment, uint256 ethOut, address recipient) external',
  ];

  let totalEthReceived = 0n;
  let successCount = 0;

  for (let i = 0; i < unspentNotes.length; i++) {
    const note = unspentNotes[i];
    console.log(`\n[${i + 1}/${unspentNotes.length}] Selling note from ${note.walletName}`);
    console.log(`  Amount: ${ethers.formatEther(note.amount)} ROOT`);
    console.log(`  Leaf index: ${note.leafIndex}`);

    try {
      // Get fresh reserves
      const [ethRes, tokRes] = await pair.getReserves();

      // Calculate ETH out for this specific sell (full amount, no change)
      const ethOut = (ethRes * note.amount * 997n) / ((tokRes * 1000n) + (note.amount * 997n));
      console.log(`  Expected ETH out: ${ethers.formatEther(ethOut)} ETH`);

      // For full sell, change = 0, use random new commitment params
      const newNullifier = BigInt(ethers.keccak256(ethers.randomBytes(32))) % FIELD_PRIME;
      const newSecret = BigInt(ethers.keccak256(ethers.randomBytes(32))) % FIELD_PRIME;
      const change = 0n;

      console.log(`  Generating ZK proof...`);
      const { proof } = await generateSellProof(
        note,
        merkleTree,
        ethOut,
        change,
        newNullifier,
        newSecret,
        CONFIG.TARGET_WALLET
      );

      const formattedProof = formatProof(proof);
      const { pathElements, pathIndices, root } = merkleTree.getProof(note.leafIndex);
      const nullifierHash = hashNull(note.nullifier, note.leafIndex);
      const newCommitment = hashComm(newNullifier, newSecret, change);

      const router = new ethers.Contract(CONFIG.OLD_ROUTER, routerABI3, note.wallet);

      console.log(`  Submitting sell tx...`);
      const tx = await router.sellWithProof(
        formattedProof,
        root.toString(),
        nullifierHash.toString(),
        newCommitment.toString(),
        ethOut.toString(),
        CONFIG.TARGET_WALLET
      );

      console.log(`  Tx: ${tx.hash}`);
      const receipt = await tx.wait();
      console.log(`  Confirmed in block ${receipt.blockNumber}`);

      totalEthReceived += ethOut;
      successCount++;
    } catch (err: any) {
      console.log(`  ERROR: ${err.message?.slice(0, 100) || 'Failed'}`);
    }
  }

  console.log('\n=== SUMMARY ===');
  console.log(`Successful sells: ${successCount}/${unspentNotes.length}`);
  console.log(`Total ETH received: ${ethers.formatEther(totalEthReceived)} ETH`);

  // Check target balance
  const targetBalance = await provider.getBalance(CONFIG.TARGET_WALLET);
  console.log(`\nTarget wallet balance: ${ethers.formatEther(targetBalance)} ETH`);
}

main().catch(console.error);
