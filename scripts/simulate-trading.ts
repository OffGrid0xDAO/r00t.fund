#!/usr/bin/env npx tsx
/**
 * Full ZkAMM Trading Simulation with REAL ZK Proofs (Groth16)
 *
 * Executes on Tenderly VNet:
 * 1. Buy R00T tokens (ETH → private commitment)
 * 2. Reconstruct merkle tree from on-chain events
 * 3. Generate real Groth16 sell proof via snarkjs
 * 4. Sell R00T tokens (private commitment → ETH with ZK proof)
 * 5. Open a short position on R00TShorts
 * 6. Multiple buy rounds at different sizes
 *
 * Usage:
 *   cd scripts && source ../contracts/.env && npx tsx simulate-trading.ts
 */

import { ethers } from 'ethers';
import { poseidon2, poseidon3 } from 'poseidon-lite';
import * as snarkjs from 'snarkjs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const FIELD_PRIME = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
const ZERO_VALUE = 21663839004416932945382355908790599225266501822907911457504978515578255421292n;
const DEPTH = 24;

// ============ Merkle Tree (mirrors SDK) ============

function hashPair(left: bigint, right: bigint): bigint {
  return poseidon2([left, right]);
}

function computeZeros(): bigint[] {
  const zeros: bigint[] = [ZERO_VALUE];
  for (let i = 1; i < DEPTH; i++) zeros[i] = hashPair(zeros[i - 1], zeros[i - 1]);
  return zeros;
}

const ZEROS = computeZeros();

class MerkleTree {
  private leaves: bigint[] = [];
  private depth = DEPTH;

  insert(leaf: bigint): number {
    const idx = this.leaves.length;
    this.leaves.push(leaf);
    return idx;
  }

  getRoot(): bigint {
    return this.computeNodeAtLevel(this.depth, 0);
  }

  private computeNodeAtLevel(level: number, index: number): bigint {
    if (level === 0) {
      return index < this.leaves.length ? this.leaves[index] : ZERO_VALUE;
    }
    const left = this.computeNodeAtLevel(level - 1, index * 2);
    const right = this.computeNodeAtLevel(level - 1, index * 2 + 1);
    return hashPair(left, right);
  }

  getProof(leafIndex: number): { pathElements: bigint[]; pathIndices: number[]; root: bigint } {
    const pathElements: bigint[] = [];
    const pathIndices: number[] = [];
    let currentIndex = leafIndex;

    for (let level = 0; level < this.depth; level++) {
      const siblingIndex = currentIndex % 2 === 0 ? currentIndex + 1 : currentIndex - 1;
      const sibling = this.computeNodeAtLevel(level, siblingIndex);
      pathElements.push(sibling);
      pathIndices.push(currentIndex % 2);
      currentIndex = Math.floor(currentIndex / 2);
    }

    return { pathElements, pathIndices, root: this.getRoot() };
  }

  getLeafCount(): number { return this.leaves.length; }
}

// ============ Crypto helpers ============

function randomFieldElement(): bigint {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let value = 0n;
  for (let i = 0; i < 32; i++) value = (value << 8n) | BigInt(bytes[i]);
  return value % FIELD_PRIME;
}

function hashCommitment(nullifier: bigint, secret: bigint, amount: bigint): bigint {
  return poseidon3([nullifier, secret, amount]);
}

function hashNullifier(nullifier: bigint, leafIndex: number): bigint {
  return poseidon2([nullifier, BigInt(leafIndex)]);
}

function formatProofForSolidity(proof: any): bigint[] {
  return [
    BigInt(proof.pi_a[0]), BigInt(proof.pi_a[1]),
    BigInt(proof.pi_b[0][1]), BigInt(proof.pi_b[0][0]),  // swapped for Solidity
    BigInt(proof.pi_b[1][1]), BigInt(proof.pi_b[1][0]),
    BigInt(proof.pi_c[0]), BigInt(proof.pi_c[1]),
  ];
}

function getAmountOut(amountIn: bigint, reserveIn: bigint, reserveOut: bigint): bigint {
  return (amountIn * reserveOut) / (reserveIn + amountIn);
}

// ============ ABIs ============

const ROUTER_ABI = [
  'function buyPrivate(uint256 newCommitment, uint256 minTokensOut, uint256 deadline, bytes encryptedNote) payable',
  'function sellPrivate(uint256[8] proof, uint256 merkleRoot, uint256 nullifierHash, uint256 tokenAmount, uint256 minEthOut, address recipient, address relayer, uint256 fee, uint256 changeCommitment, uint256 publicInputsBinding, uint256 deadline, bytes changeNote)',
];

const PAIR_ABI = [
  'function getReserves() view returns (uint256, uint256)',
  'function accumulatedProtocolFees() view returns (uint256)',
  'event NewCommitment(uint256 indexed commitment, uint256 indexed leafIndex, bytes encryptedNote)',
  'event TokensPurchased(uint256 ethIn, uint256 tokensOut)',
  'event TokensSold(uint256 tokensIn, uint256 ethOut)',
];

const TOKEN_POOL_ABI = [
  'function root() view returns (uint256)',
  'function nextIndex() view returns (uint256)',
];

const SHORTS_ABI = [
  'function openShort(uint256 minTokensShorted) payable returns (uint256)',
  'event ShortOpened(uint256 indexed positionId, address indexed trader, uint256 collateral, uint256 tokensShorted, uint256 entryPrice)',
];

// ============ Main ============

async function main() {
  const rpcUrl = process.env.TENDERLY_VIRTUAL_TESTNET_RPC;
  const privateKey = process.env.PRIVATE_KEY;
  if (!rpcUrl || !privateKey) { console.error('Missing env vars'); process.exit(1); }

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const wallet = new ethers.Wallet(privateKey, provider);

  const router = new ethers.Contract(process.env.ZKAMM_ROUTER_ADDRESS!, ROUTER_ABI, wallet);
  const pair = new ethers.Contract(process.env.ZKAMM_PAIR_ADDRESS!, PAIR_ABI, provider);
  const tokenPool = new ethers.Contract(process.env.TOKEN_POOL_ADDRESS!, TOKEN_POOL_ABI, provider);
  const shorts = new ethers.Contract(process.env.R00T_SHORTS_ADDRESS!, SHORTS_ABI, wallet);

  const sellWasm = path.join(__dirname, '../circuits/build/sell/sell_js/sell.wasm');
  const sellZkey = path.join(__dirname, '../circuits/build/sell/sell_final.zkey');
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);

  console.log('');
  console.log('==========================================================');
  console.log('   ZkAMM Trading Simulation (REAL Groth16 ZK Proofs)');
  console.log('   Target: Tenderly Virtual TestNet');
  console.log('==========================================================');
  console.log('');
  console.log('Wallet:', wallet.address);

  let txCount = 0;
  const [ethRes0, tokRes0] = await pair.getReserves();
  console.log(`Reserves: ${ethers.formatEther(ethRes0)} ETH / ${ethers.formatEther(tokRes0)} R00T`);
  console.log(`Price: 1 ETH = ${(Number(tokRes0) / Number(ethRes0)).toFixed(0)} R00T`);
  console.log('');

  // ==========================================
  // Step 0: Rebuild merkle tree from on-chain events
  // ==========================================
  console.log('--- Rebuilding Merkle Tree from On-Chain Events ---');
  const tree = new MerkleTree();

  const nextIndex = Number(await tokenPool.nextIndex());
  console.log(`  Existing leaves: ${nextIndex}`);

  if (nextIndex > 0) {
    // Get all NewCommitment events to rebuild tree
    const filter = pair.filters.NewCommitment();
    const events = await pair.queryFilter(filter, 0, 'latest');
    console.log(`  Found ${events.length} NewCommitment events`);

    // Sort by leaf index and insert in order
    const commitments = events.map(e => ({
      commitment: BigInt((e as any).args[0]),
      leafIndex: Number((e as any).args[1]),
    })).sort((a, b) => a.leafIndex - b.leafIndex);

    for (const { commitment } of commitments) {
      tree.insert(commitment);
    }

    const treeRoot = tree.getRoot();
    const chainRoot = BigInt(await tokenPool.root());
    console.log(`  Tree root match: ${treeRoot === chainRoot}`);
    if (treeRoot !== chainRoot) {
      console.log(`  WARNING: roots don't match!`);
      console.log(`    Local:   ${treeRoot}`);
      console.log(`    On-chain: ${chainRoot}`);
    }
  }
  console.log('');

  // Store commitment secrets for sell proof
  const commitmentSecrets: Map<number, { nullifier: bigint; secret: bigint; amount: bigint; commitment: bigint }> = new Map();

  // Helper: buy and track commitment
  async function buyR00T(ethAmount: string, label: string): Promise<number> {
    const amount = ethers.parseEther(ethAmount);
    const [ethRes, tokRes] = await pair.getReserves();
    const fee = amount * 100n / 10000n;
    const afterFee = amount - fee;
    const expectedTokens = getAmountOut(afterFee, ethRes, tokRes);

    const nullifier = randomFieldElement();
    const secret = randomFieldElement();
    const commitment = hashCommitment(nullifier, secret, expectedTokens);

    const tx = await router.buyPrivate(commitment, 0n, deadline, '0x', { value: amount });
    const receipt = await tx.wait();
    txCount++;

    // Get leaf index from event
    let leafIndex = tree.getLeafCount(); // fallback
    for (const log of receipt.logs) {
      try {
        const parsed = pair.interface.parseLog(log);
        if (parsed?.name === 'NewCommitment') leafIndex = Number(parsed.args.leafIndex);
      } catch {}
    }

    // Add to local tree
    tree.insert(commitment);

    // Store secrets for later sell
    commitmentSecrets.set(leafIndex, { nullifier, secret, amount: expectedTokens, commitment });

    console.log(`  ${label}: ${ethAmount} ETH → ${ethers.formatEther(expectedTokens)} R00T`);
    console.log(`    Leaf #${leafIndex} | TX: ${tx.hash.slice(0, 22)}...`);

    return leafIndex;
  }

  // ==========================================
  // Trade 1: Buy 0.005 ETH of R00T
  // ==========================================
  console.log('--- Trade 1: Buy R00T ---');
  const leaf1 = await buyR00T('0.005', 'Buy');
  console.log('');

  // ==========================================
  // Trade 2: Buy 0.01 ETH of R00T
  // ==========================================
  console.log('--- Trade 2: Buy R00T ---');
  const leaf2 = await buyR00T('0.01', 'Buy');
  console.log('');

  // ==========================================
  // Trade 3: Buy 0.003 ETH of R00T
  // ==========================================
  console.log('--- Trade 3: Buy R00T ---');
  const leaf3 = await buyR00T('0.003', 'Buy');
  console.log('');

  // ==========================================
  // Trade 4: SELL Trade 1 with REAL ZK proof
  // ==========================================
  console.log('--- Trade 4: Sell R00T (Real Groth16 Proof) ---');
  console.log('  Generating proof for leaf #' + leaf1 + '...');

  const secrets1 = commitmentSecrets.get(leaf1)!;
  const merkleProof = tree.getProof(leaf1);

  // Verify the merkle proof locally
  let verifyHash = secrets1.commitment;
  for (let i = 0; i < merkleProof.pathElements.length; i++) {
    if (merkleProof.pathIndices[i] === 0) {
      verifyHash = hashPair(verifyHash, merkleProof.pathElements[i]);
    } else {
      verifyHash = hashPair(merkleProof.pathElements[i], verifyHash);
    }
  }
  console.log(`  Local proof verification: ${verifyHash === merkleProof.root}`);

  const nullifierHash1 = hashNullifier(secrets1.nullifier, leaf1);
  const sellAmount = secrets1.amount;

  // Circuit inputs
  const circuitInputs = {
    merkleRoot: merkleProof.root.toString(),
    nullifierHash: nullifierHash1.toString(),
    tokenAmount: sellAmount.toString(),
    minEthOut: '0',
    recipient: BigInt(wallet.address).toString(),
    relayer: '0',
    fee: '0',
    changeCommitment: '0',
    nullifier: secrets1.nullifier.toString(),
    secret: secrets1.secret.toString(),
    amount: secrets1.amount.toString(),
    pathElements: merkleProof.pathElements.map(e => e.toString()),
    pathIndices: merkleProof.pathIndices,
    changeNullifier: '0',
    changeSecret: '0',
  };

  console.log('  Running snarkjs.groth16.fullProve()...');
  const { proof, publicSignals } = await snarkjs.groth16.fullProve(circuitInputs, sellWasm, sellZkey);
  console.log(`  Proof generated! (${publicSignals.length} public signals)`);

  const solidityProof = formatProofForSolidity(proof);
  const publicInputsBinding = BigInt(publicSignals[0]);

  console.log('  Submitting sellPrivate transaction...');
  const sellTx = await router.sellPrivate(
    solidityProof,
    merkleProof.root,
    nullifierHash1,
    sellAmount,
    0n,
    wallet.address,
    ethers.ZeroAddress,
    0n,
    0n, // no change commitment
    publicInputsBinding,
    deadline,
    '0x'
  );
  const sellReceipt = await sellTx.wait();
  txCount++;

  for (const log of sellReceipt.logs) {
    try {
      const parsed = pair.interface.parseLog(log);
      if (parsed?.name === 'TokensSold') {
        console.log(`  SOLD: ${ethers.formatEther(parsed.args.tokensIn)} R00T → ${ethers.formatEther(parsed.args.ethOut)} ETH`);
      }
    } catch {}
  }
  console.log(`  TX: ${sellTx.hash}`);
  console.log('');

  // ==========================================
  // Trade 5: Open Short Position
  // ==========================================
  console.log('--- Trade 5: Open Short (0.005 ETH) ---');
  const shortTx = await shorts.openShort(0n, { value: ethers.parseEther('0.005') });
  const shortReceipt = await shortTx.wait();
  txCount++;

  for (const log of shortReceipt.logs) {
    try {
      const parsed = shorts.interface.parseLog(log);
      if (parsed?.name === 'ShortOpened') {
        console.log(`  Position #${parsed.args.positionId}`);
        console.log(`  Collateral: ${ethers.formatEther(parsed.args.collateral)} ETH`);
        console.log(`  Shorted: ${ethers.formatEther(parsed.args.tokensShorted)} R00T`);
      }
    } catch {}
  }
  console.log(`  TX: ${shortTx.hash}`);
  console.log('');

  // ==========================================
  // Trade 6: Buy more to move price
  // ==========================================
  console.log('--- Trade 6: Buy R00T (0.008 ETH) ---');
  await buyR00T('0.008', 'Buy');
  console.log('');

  // ==========================================
  // Trade 7: Buy more (small)
  // ==========================================
  console.log('--- Trade 7: Buy R00T (0.002 ETH) ---');
  await buyR00T('0.002', 'Buy');
  console.log('');

  // ==========================================
  // Summary
  // ==========================================
  const [ethResFinal, tokResFinal] = await pair.getReserves();
  const fees = await pair.accumulatedProtocolFees();

  console.log('==========================================================');
  console.log('   TRADING SIMULATION COMPLETE');
  console.log('==========================================================');
  console.log('');
  console.log(`  Transactions: ${txCount}`);
  console.log(`  Buys: 5 (real commitments in merkle tree)`);
  console.log(`  Sells: 1 (real Groth16 ZK proof verified on-chain)`);
  console.log(`  Shorts: 1 (R00TShorts position opened)`);
  console.log('');
  console.log(`  Reserves: ${ethers.formatEther(ethResFinal)} ETH / ${ethers.formatEther(tokResFinal)} R00T`);
  console.log(`  Protocol fees: ${ethers.formatEther(fees)} ETH`);
  console.log(`  Price: 1 ETH = ${(Number(tokResFinal) / Number(ethResFinal)).toFixed(0)} R00T`);
  console.log('');
}

main().catch(console.error);
