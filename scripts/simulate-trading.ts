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
  private filledSubtrees: bigint[];
  private currentRoot: bigint;
  private depth = DEPTH;

  constructor() {
    this.filledSubtrees = [...ZEROS];
    // Compute empty root
    let current = ZERO_VALUE;
    for (let i = 0; i < DEPTH; i++) current = hashPair(current, current);
    this.currentRoot = current;
  }

  insert(leaf: bigint): number {
    const index = this.leaves.length;
    this.leaves.push(leaf);

    let currentIndex = index;
    let currentHash = leaf;

    for (let i = 0; i < this.depth; i++) {
      if (currentIndex % 2 === 0) {
        this.filledSubtrees[i] = currentHash;
        currentHash = hashPair(currentHash, ZEROS[i]);
      } else {
        currentHash = hashPair(this.filledSubtrees[i], currentHash);
      }
      currentIndex = Math.floor(currentIndex / 2);
    }

    this.currentRoot = currentHash;
    return index;
  }

  getRoot(): bigint { return this.currentRoot; }

  getProof(leafIndex: number): { pathElements: bigint[]; pathIndices: number[]; root: bigint } {
    // Build the tree bottom-up, only computing necessary nodes
    // Level 0 = leaves, level DEPTH = root
    const layers: bigint[][] = [];

    // Level 0: leaves padded with ZERO_VALUE
    const leafCount = this.leaves.length;
    const level0Size = Math.max(leafCount, leafIndex + 1);
    // We only need nodes up to the sibling of our target at each level
    layers[0] = [];
    for (let i = 0; i < level0Size + (level0Size % 2 === 0 ? 0 : 1) + 1; i++) {
      layers[0][i] = i < leafCount ? this.leaves[i] : ZERO_VALUE;
    }

    // Build upper layers
    for (let level = 1; level <= this.depth; level++) {
      layers[level] = [];
      const prevLen = layers[level - 1].length;
      const numPairs = Math.ceil(prevLen / 2);
      for (let i = 0; i < numPairs; i++) {
        const left = layers[level - 1][i * 2] ?? ZERO_VALUE;
        const right = layers[level - 1][i * 2 + 1] ?? ZERO_VALUE;
        // If both are from beyond the tree, use precomputed zero
        if (i * Math.pow(2, level) >= leafCount) {
          layers[level][i] = ZEROS[level];
        } else {
          const r = (i * 2 + 1) < prevLen ? layers[level - 1][i * 2 + 1] : ZEROS[level - 1];
          layers[level][i] = hashPair(left, r);
        }
      }
    }

    // Extract proof path
    const pathElements: bigint[] = [];
    const pathIndices: number[] = [];
    let ci = leafIndex;

    for (let level = 0; level < this.depth; level++) {
      const sibIdx = ci % 2 === 0 ? ci + 1 : ci - 1;
      const sibling = layers[level][sibIdx] ?? ZEROS[level];
      pathElements.push(sibling);
      pathIndices.push(ci % 2);
      ci = Math.floor(ci / 2);
    }

    return { pathElements, pathIndices, root: this.currentRoot };
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
  'function liquidate(uint256 positionId, uint256 maxRepurchaseCost)',
  'function isLiquidatable(uint256 positionId) view returns (bool)',
  'function calculatePnL(uint256 positionId) view returns (int256 pnl, uint256 repurchaseCost)',
  'function getPosition(uint256 positionId) view returns (tuple(uint256 ethCollateral, uint256 ethFromSale, uint256 tokenAmountShorted, uint256 entryPrice, uint256 openedAt, bool isOpen))',
  'function nextPositionId() view returns (uint256)',
  'function closeShort(uint256 positionId, uint256 maxRepurchaseCost)',
  'event ShortOpened(uint256 indexed positionId, address indexed user, uint256 collateral, uint256 tokensShorted, uint256 entryPrice)',
  'event PositionLiquidated(uint256 indexed positionId, address indexed owner, address indexed liquidator, uint256 bonus)',
  'event ShortClosed(uint256 indexed positionId, address indexed user, int256 pnl, uint256 payout)',
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
  // Trade 5: Open Short Position (min 0.01 ETH)
  // ==========================================
  console.log('--- Trade 5: Open Short (0.01 ETH) ---');
  const shortTx = await shorts.openShort(0n, { value: ethers.parseEther('0.01') });
  const shortReceipt = await shortTx.wait();
  txCount++;

  let shortPositionId = 0;
  for (const log of shortReceipt.logs) {
    try {
      const parsed = shorts.interface.parseLog(log);
      if (parsed?.name === 'ShortOpened') {
        shortPositionId = Number(parsed.args.positionId);
        console.log(`  Position #${shortPositionId}`);
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
  // Liquidation Test: Push price up to make short underwater
  // ==========================================
  console.log('--- Liquidation Test ---');
  console.log('');

  // Check current position state
  const pos = await shorts.getPosition(shortPositionId);
  const [pnlBefore, repCostBefore] = await shorts.calculatePnL(shortPositionId);
  const isLiqBefore = await shorts.isLiquidatable(shortPositionId);
  console.log(`  Short Position #${shortPositionId} State:`);
  console.log(`    Collateral: ${ethers.formatEther(pos.ethCollateral)} ETH`);
  console.log(`    Tokens shorted: ${ethers.formatEther(pos.tokenAmountShorted)} R00T`);
  console.log(`    Sale proceeds: ${ethers.formatEther(pos.ethFromSale)} ETH`);
  console.log(`    Current PnL: ${ethers.formatEther(pnlBefore)} ETH`);
  console.log(`    Repurchase cost: ${ethers.formatEther(repCostBefore)} ETH`);
  console.log(`    Liquidatable: ${isLiqBefore}`);
  console.log('');

  // Buy aggressively to push price up (making short position lose money)
  // Short profits when price goes DOWN, loses when price goes UP
  console.log('  Pumping price to make short underwater...');

  const pumpAmounts = ['0.05', '0.1', '0.2', '0.5'];
  for (const amt of pumpAmounts) {
    await buyR00T(amt, `  Pump buy`);
    const [pnl] = await shorts.calculatePnL(shortPositionId);
    const isLiq = await shorts.isLiquidatable(shortPositionId);
    console.log(`    PnL after: ${ethers.formatEther(pnl)} ETH | Liquidatable: ${isLiq}`);
    if (isLiq) {
      console.log('    Position is now liquidatable!');
      break;
    }
  }
  console.log('');

  // Check if liquidatable now
  const isLiqNow = await shorts.isLiquidatable(shortPositionId);
  if (isLiqNow) {
    console.log('--- Executing Liquidation ---');
    const [, repCost] = await shorts.calculatePnL(shortPositionId);
    // Add 10% slippage buffer
    const maxCost = repCost * 110n / 100n;
    console.log(`  Repurchase cost: ${ethers.formatEther(repCost)} ETH`);
    console.log(`  Max cost (10% buffer): ${ethers.formatEther(maxCost)} ETH`);

    const liqTx = await shorts.liquidate(shortPositionId, maxCost);
    const liqReceipt = await liqTx.wait();
    txCount++;

    for (const log of liqReceipt.logs) {
      try {
        const parsed = shorts.interface.parseLog(log);
        if (parsed?.name === 'PositionLiquidated') {
          console.log(`  LIQUIDATED Position #${parsed.args.positionId}`);
          console.log(`  Owner: ${parsed.args.owner}`);
          console.log(`  Liquidator bonus: ${ethers.formatEther(parsed.args.bonus)} ETH`);
        }
      } catch {}
    }
    console.log(`  TX: ${liqTx.hash}`);
  } else {
    console.log('  Position not yet liquidatable — need more price movement');
    // Open a new short with smaller collateral for easier liquidation
    console.log('  Opening a smaller short for easier liquidation test...');
    const shortTx2 = await shorts.openShort(0n, { value: ethers.parseEther('0.01') });
    const shortReceipt2 = await shortTx2.wait();
    txCount++;
    let newPosId = 0;
    for (const log of shortReceipt2.logs) {
      try {
        const parsed = shorts.interface.parseLog(log);
        if (parsed?.name === 'ShortOpened') newPosId = Number(parsed.args.positionId);
      } catch {}
    }
    console.log(`  New short position #${newPosId}`);

    // Pump more
    for (const amt of ['1.0', '2.0', '5.0']) {
      await buyR00T(amt, `  Pump buy`);
      const isLiq2 = await shorts.isLiquidatable(newPosId);
      if (isLiq2) {
        console.log('    Position is now liquidatable!');
        const [, repCost2] = await shorts.calculatePnL(newPosId);
        const maxCost2 = repCost2 * 110n / 100n;
        const liqTx2 = await shorts.liquidate(newPosId, maxCost2);
        const liqReceipt2 = await liqTx2.wait();
        txCount++;
        for (const log of liqReceipt2.logs) {
          try {
            const parsed = shorts.interface.parseLog(log);
            if (parsed?.name === 'PositionLiquidated') {
              console.log(`  LIQUIDATED Position #${parsed.args.positionId}`);
              console.log(`  Liquidator bonus: ${ethers.formatEther(parsed.args.bonus)} ETH`);
            }
          } catch {}
        }
        console.log(`  TX: ${liqTx2.hash}`);
        break;
      }
    }
  }
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
