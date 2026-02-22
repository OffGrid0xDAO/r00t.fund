#!/usr/bin/env npx tsx
/**
 * ZkAMM LP Simulation with REAL ZK Proofs (Groth16)
 *
 * Executes on Tenderly VNet:
 * 1. Buy R00T tokens (creates private commitment)
 * 2. Add liquidity (spend token commitment + ETH → LP commitment)
 * 3. Remove liquidity (spend LP commitment → ETH + new token commitment)
 *
 * Both addLiquidity and removeLiquidity require real Groth16 ZK proofs
 * generated via snarkjs, verified on-chain by the respective verifiers.
 *
 * Usage:
 *   cd scripts && source ../contracts/.env && npx tsx simulate-lp.ts
 */

import { ethers } from 'ethers';
import { poseidon2, poseidon3, poseidon5, poseidon7 } from 'poseidon-lite';
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
    const layers: bigint[][] = [];
    const leafCount = this.leaves.length;
    const level0Size = Math.max(leafCount, leafIndex + 1);
    layers[0] = [];
    for (let i = 0; i < level0Size + (level0Size % 2 === 0 ? 0 : 1) + 1; i++) {
      layers[0][i] = i < leafCount ? this.leaves[i] : ZERO_VALUE;
    }

    for (let level = 1; level <= this.depth; level++) {
      layers[level] = [];
      const prevLen = layers[level - 1].length;
      const numPairs = Math.ceil(prevLen / 2);
      for (let i = 0; i < numPairs; i++) {
        const left = layers[level - 1][i * 2] ?? ZERO_VALUE;
        if (i * Math.pow(2, level) >= leafCount) {
          layers[level][i] = ZEROS[level];
        } else {
          const r = (i * 2 + 1) < prevLen ? layers[level - 1][i * 2 + 1] : ZEROS[level - 1];
          layers[level][i] = hashPair(left, r);
        }
      }
    }

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

// ============ ABIs ============

const ROUTER_ABI = [
  'function buyPrivate(uint256 newCommitment, uint256 minTokensOut, uint256 deadline, bytes encryptedNote) payable',
  'function addLiquidityPrivate(uint256[8] proof, uint256 merkleRoot, uint256 nullifierHash, uint256 tokenAmount, uint256 lpCommitment, uint256 changeCommitment, uint256 userLpShares, uint256 publicInputsBinding, uint256 deadline, bytes lpNote, bytes changeNote) payable',
  'function removeLiquidityPrivate(uint256[8] proof, uint256 merkleRoot, uint256 nullifierHash, uint256 commitment, uint256 lpShares, uint256 minEthOut, address recipient, uint256 tokenCommitment, uint256 changeLPCommitment, uint256 tokensOut, uint256 publicInputsBinding, uint256 deadline, bytes tokenNote, bytes changeNote)',
  'event LiquidityAddedPrivate(uint256 indexed commitment, uint256 ethAmount, uint256 tokenAmount, uint256 lpShares)',
  'event LiquidityRemovedPrivate(uint256 indexed nullifierHash, uint256 ethOut, uint256 tokensOut)',
];

const PAIR_ABI = [
  'function getReserves() view returns (uint256, uint256)',
  'function totalLPShares() view returns (uint256)',
  'function accumulatedProtocolFees() view returns (uint256)',
  'function isKnownRoot(uint256 root) view returns (bool)',
  'function isKnownLPRoot(uint256 root) view returns (bool)',
  'function getLPCommitmentInfo(uint256 commitment) view returns (uint256 shares, uint256 depositTime, uint256 feeEpoch, bool isWithdrawn, bool isLocked)',
  'event NewCommitment(uint256 indexed commitment, uint256 indexed leafIndex, bytes encryptedNote)',
  'event NewLPCommitment(uint256 indexed commitment, uint256 indexed leafIndex, uint256 lpShares, bytes encryptedNote)',
  'event TokensPurchased(uint256 ethIn, uint256 tokensOut)',
];

const TOKEN_POOL_ABI = [
  'function root() view returns (uint256)',
  'function nextIndex() view returns (uint256)',
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
  const lpPool = new ethers.Contract(process.env.LP_POOL_ADDRESS!, TOKEN_POOL_ABI, provider);

  const addLiqWasm = path.join(__dirname, '../circuits/build/addLiquidity/addLiquidity_js/addLiquidity.wasm');
  const addLiqZkey = path.join(__dirname, '../circuits/build/addLiquidity/addLiquidity_final.zkey');
  const removeLiqWasm = path.join(__dirname, '../circuits/build/removeLiquidity/removeLiquidity_js/removeLiquidity.wasm');
  const removeLiqZkey = path.join(__dirname, '../circuits/build/removeLiquidity/removeLiquidity_final.zkey');

  const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);

  console.log('');
  console.log('==========================================================');
  console.log('   ZkAMM LP Simulation (REAL Groth16 ZK Proofs)');
  console.log('   Target: Tenderly Virtual TestNet');
  console.log('==========================================================');
  console.log('');
  console.log('Wallet:', wallet.address);

  let txCount = 0;
  const [ethRes0, tokRes0] = await pair.getReserves();
  const totalLP0 = await pair.totalLPShares();
  console.log(`Reserves: ${ethers.formatEther(ethRes0)} ETH / ${ethers.formatEther(tokRes0)} R00T`);
  console.log(`Total LP Shares: ${ethers.formatEther(totalLP0)}`);
  console.log(`Price: 1 ETH = ${(Number(tokRes0) / Number(ethRes0)).toFixed(0)} R00T`);
  console.log('');

  // ==========================================
  // Step 0: Rebuild token merkle tree from on-chain events
  // ==========================================
  console.log('--- Rebuilding Token Merkle Tree ---');
  const tokenTree = new MerkleTree();

  const nextIndex = Number(await tokenPool.nextIndex());
  console.log(`  Existing token leaves: ${nextIndex}`);

  if (nextIndex > 0) {
    const filter = pair.filters.NewCommitment();
    const events = await pair.queryFilter(filter, 0, 'latest');
    console.log(`  Found ${events.length} NewCommitment events`);

    const commitments = events.map(e => ({
      commitment: BigInt((e as any).args[0]),
      leafIndex: Number((e as any).args[1]),
    })).sort((a, b) => a.leafIndex - b.leafIndex);

    for (const { commitment } of commitments) {
      tokenTree.insert(commitment);
    }

    const treeRoot = tokenTree.getRoot();
    const chainRoot = BigInt(await tokenPool.root());
    console.log(`  Tree root match: ${treeRoot === chainRoot}`);
  }
  console.log('');

  // Also rebuild LP merkle tree
  console.log('--- Rebuilding LP Merkle Tree ---');
  const lpTree = new MerkleTree();
  const lpNextIndex = Number(await lpPool.nextIndex());
  console.log(`  Existing LP leaves: ${lpNextIndex}`);

  if (lpNextIndex > 0) {
    const lpFilter = pair.filters.NewLPCommitment();
    const lpEvents = await pair.queryFilter(lpFilter, 0, 'latest');
    console.log(`  Found ${lpEvents.length} NewLPCommitment events`);

    const lpCommitments = lpEvents.map(e => ({
      commitment: BigInt((e as any).args[0]),
      leafIndex: Number((e as any).args[1]),
    })).sort((a, b) => a.leafIndex - b.leafIndex);

    for (const { commitment } of lpCommitments) {
      lpTree.insert(commitment);
    }

    const lpTreeRoot = lpTree.getRoot();
    const lpChainRoot = BigInt(await lpPool.root());
    console.log(`  LP tree root match: ${lpTreeRoot === lpChainRoot}`);
  }
  console.log('');

  // ==========================================
  // Step 1: Buy R00T tokens (creates commitment we'll use for LP)
  // ==========================================
  console.log('--- Step 1: Buy R00T Tokens (0.02 ETH) ---');

  const buyAmount = ethers.parseEther('0.02');
  const [ethResB, tokResB] = await pair.getReserves();
  const fee = buyAmount * 100n / 10000n; // 1% fee
  const afterFee = buyAmount - fee;
  const expectedTokens = (afterFee * tokResB) / (ethResB + afterFee);

  const tokenNullifier = randomFieldElement();
  const tokenSecret = randomFieldElement();
  const tokenCommitmentHash = hashCommitment(tokenNullifier, tokenSecret, expectedTokens);

  const buyTx = await router.buyPrivate(tokenCommitmentHash, 0n, deadline, '0x', { value: buyAmount });
  const buyReceipt = await buyTx.wait();
  txCount++;

  let tokenLeafIndex = tokenTree.getLeafCount();
  for (const log of buyReceipt.logs) {
    try {
      const parsed = pair.interface.parseLog(log);
      if (parsed?.name === 'NewCommitment') tokenLeafIndex = Number(parsed.args.leafIndex);
      if (parsed?.name === 'TokensPurchased') {
        console.log(`  Bought: ${ethers.formatEther(parsed.args.tokensOut)} R00T for 0.02 ETH`);
      }
    } catch {}
  }

  tokenTree.insert(tokenCommitmentHash);
  console.log(`  Token commitment at leaf #${tokenLeafIndex}`);
  console.log(`  TX: ${buyTx.hash.slice(0, 22)}...`);
  console.log('');

  // ==========================================
  // Step 2: Add Liquidity (spend token commitment + send ETH)
  // ==========================================
  console.log('--- Step 2: Add Liquidity (Real Groth16 Proof) ---');

  // Calculate LP parameters
  const [ethResLP, tokResLP] = await pair.getReserves();
  const totalLPShares = await pair.totalLPShares();

  // We'll use all tokens from our commitment
  const tokenAmount = expectedTokens;

  // ETH required = tokenAmount * ethReserve / tokenReserve
  // Add 10 bps protocol fee on top
  const ethRequired = (tokenAmount * ethResLP) / tokResLP;
  const ethWithFee = (ethRequired * 10000n) / 9990n + 1n; // account for 10 bps protocol fee + rounding

  // Calculate expected LP shares (min of ETH ratio, token ratio)
  const ethAfterFee = ethWithFee - (ethWithFee * 10n / 10000n);
  let calculatedLpShares: bigint;
  if (totalLPShares === 0n) {
    // sqrt(ethAfterFee * tokenAmount) — but shouldn't happen since pool is bootstrapped
    calculatedLpShares = BigInt(Math.floor(Math.sqrt(Number(ethAfterFee * tokenAmount))));
  } else {
    const ethRatio = (ethAfterFee * totalLPShares) / ethResLP;
    const tokenRatio = (tokenAmount * totalLPShares) / tokResLP;
    calculatedLpShares = ethRatio < tokenRatio ? ethRatio : tokenRatio;
  }

  console.log(`  Token amount: ${ethers.formatEther(tokenAmount)} R00T`);
  console.log(`  ETH to send: ${ethers.formatEther(ethWithFee)} ETH`);
  console.log(`  Expected LP shares: ${ethers.formatEther(calculatedLpShares)}`);

  // Create LP commitment = Poseidon(lpNullifier, lpSecret, lpShares)
  const lpNullifier = randomFieldElement();
  const lpSecret = randomFieldElement();
  const lpCommitment = hashCommitment(lpNullifier, lpSecret, calculatedLpShares);

  // No change (using full token amount)
  const changeCommitment = 0n;

  // Get merkle proof for our token commitment
  const tokenMerkleProof = tokenTree.getProof(tokenLeafIndex);
  const nullifierHash = hashNullifier(tokenNullifier, tokenLeafIndex);

  // Verify merkle root is known on-chain
  const isKnown = await pair.isKnownRoot(tokenMerkleProof.root);
  console.log(`  Merkle root known on-chain: ${isKnown}`);

  // Build circuit inputs for addLiquidity
  const addLiqInputs = {
    // Public inputs
    merkleRoot: tokenMerkleProof.root.toString(),
    nullifierHash: nullifierHash.toString(),
    tokenAmount: tokenAmount.toString(),
    lpCommitment: lpCommitment.toString(),
    changeCommitment: changeCommitment.toString(),
    // Private inputs - original token commitment
    nullifier: tokenNullifier.toString(),
    secret: tokenSecret.toString(),
    amount: expectedTokens.toString(), // original amount = tokenAmount (using all)
    pathElements: tokenMerkleProof.pathElements.map(e => e.toString()),
    pathIndices: tokenMerkleProof.pathIndices,
    // Private inputs - LP commitment
    lpNullifier: lpNullifier.toString(),
    lpSecret: lpSecret.toString(),
    lpShares: calculatedLpShares.toString(),
    // Private inputs - change commitment (no change, using full amount)
    changeNullifier: '0',
    changeSecret: '0',
  };

  console.log('  Generating addLiquidity proof...');
  const { proof: addProof, publicSignals: addPubSignals } = await snarkjs.groth16.fullProve(
    addLiqInputs, addLiqWasm, addLiqZkey
  );
  console.log(`  Proof generated! (${addPubSignals.length} public signals)`);

  const addSolidityProof = formatProofForSolidity(addProof);
  const addPubBinding = BigInt(addPubSignals[0]);

  // Verify the binding matches what we expect
  const expectedBinding = poseidon5([
    tokenMerkleProof.root, nullifierHash, tokenAmount, lpCommitment, changeCommitment
  ]);
  console.log(`  Binding hash match: ${addPubBinding === expectedBinding}`);

  console.log('  Submitting addLiquidityPrivate transaction...');
  const addLiqTx = await router.addLiquidityPrivate(
    addSolidityProof,
    tokenMerkleProof.root,
    nullifierHash,
    tokenAmount,
    lpCommitment,
    changeCommitment,
    calculatedLpShares,
    addPubBinding,
    deadline,
    '0x', // lpNote
    '0x', // changeNote
    { value: ethWithFee }
  );
  const addLiqReceipt = await addLiqTx.wait();
  txCount++;

  let lpLeafIndex = lpTree.getLeafCount();
  for (const log of addLiqReceipt.logs) {
    try {
      const parsed = pair.interface.parseLog(log);
      if (parsed?.name === 'NewLPCommitment') {
        lpLeafIndex = Number(parsed.args.leafIndex);
        console.log(`  LP commitment at leaf #${lpLeafIndex}, shares: ${ethers.formatEther(parsed.args.lpShares)}`);
      }
    } catch {}
    try {
      const parsed = router.interface.parseLog(log);
      if (parsed?.name === 'LiquidityAddedPrivate') {
        console.log(`  Added: ${ethers.formatEther(parsed.args.ethAmount)} ETH + ${ethers.formatEther(parsed.args.tokenAmount)} R00T`);
        console.log(`  LP Shares minted: ${ethers.formatEther(parsed.args.lpShares)}`);
      }
    } catch {}
  }
  console.log(`  TX: ${addLiqTx.hash}`);
  console.log('');

  // Insert LP commitment into local LP tree
  lpTree.insert(lpCommitment);

  // Verify LP state
  const [ethResAfterAdd, tokResAfterAdd] = await pair.getReserves();
  const totalLPAfterAdd = await pair.totalLPShares();
  console.log(`  Reserves after add: ${ethers.formatEther(ethResAfterAdd)} ETH / ${ethers.formatEther(tokResAfterAdd)} R00T`);
  console.log(`  Total LP shares: ${ethers.formatEther(totalLPAfterAdd)}`);
  console.log('');

  // ==========================================
  // Step 2.5: Advance time past LP lock period (1 minute on testnet)
  // ==========================================
  console.log('--- Advancing time by 120 seconds (past LP lock period) ---');
  await provider.send('evm_increaseTime', ['0x78']); // 120 seconds
  await provider.send('evm_mine', []);
  console.log('  Time advanced, block mined.');
  console.log('');

  // ==========================================
  // Step 3: Remove Liquidity (spend LP commitment → ETH + token commitment)
  // ==========================================
  console.log('--- Step 3: Remove Liquidity (Real Groth16 Proof) ---');

  // Get LP commitment info
  const lpInfo = await pair.getLPCommitmentInfo(lpCommitment);
  console.log(`  LP commitment info: shares=${ethers.formatEther(lpInfo.shares)}, locked=${lpInfo.isLocked}`);

  // Calculate what we get back
  const [ethResRM, tokResRM] = await pair.getReserves();
  const totalLPRM = await pair.totalLPShares();
  const ethOut = (calculatedLpShares * ethResRM) / totalLPRM;
  const tokensOut = (calculatedLpShares * tokResRM) / totalLPRM;

  console.log(`  Will receive: ${ethers.formatEther(ethOut)} ETH + ${ethers.formatEther(tokensOut)} R00T`);

  // Create token commitment for received tokens
  const newTokenNullifier = randomFieldElement();
  const newTokenSecret = randomFieldElement();
  const newTokenCommitment = hashCommitment(newTokenNullifier, newTokenSecret, tokensOut);

  // Full withdrawal — no change LP commitment
  const changeLPCommitment = 0n;

  // Get merkle proof for LP commitment
  const lpMerkleProof = lpTree.getProof(lpLeafIndex);
  const lpNullifierHash = hashNullifier(lpNullifier, lpLeafIndex);

  // Verify LP merkle root is known on-chain
  const isKnownLP = await pair.isKnownLPRoot(lpMerkleProof.root);
  console.log(`  LP merkle root known on-chain: ${isKnownLP}`);

  // Build circuit inputs for removeLiquidity
  const removeLiqInputs = {
    // Public inputs
    lpMerkleRoot: lpMerkleProof.root.toString(),
    nullifierHash: lpNullifierHash.toString(),
    commitment: lpCommitment.toString(),
    withdrawShares: calculatedLpShares.toString(),
    minEthOut: '0',
    recipient: BigInt(wallet.address).toString(),
    changeCommitment: changeLPCommitment.toString(),
    tokenCommitment: newTokenCommitment.toString(),
    tokensOut: tokensOut.toString(),
    // Private inputs
    nullifier: lpNullifier.toString(),
    secret: lpSecret.toString(),
    totalShares: calculatedLpShares.toString(), // same as withdrawShares (full withdrawal)
    pathElements: lpMerkleProof.pathElements.map(e => e.toString()),
    pathIndices: lpMerkleProof.pathIndices,
    changeNullifier: '0',
    changeSecret: '0',
    tokenNullifier: newTokenNullifier.toString(),
    tokenSecret: newTokenSecret.toString(),
  };

  console.log('  Generating removeLiquidity proof...');
  const { proof: removeProof, publicSignals: removePubSignals } = await snarkjs.groth16.fullProve(
    removeLiqInputs, removeLiqWasm, removeLiqZkey
  );
  console.log(`  Proof generated! (${removePubSignals.length} public signals)`);

  const removeSolidityProof = formatProofForSolidity(removeProof);
  const removePubBinding = BigInt(removePubSignals[0]);

  // Verify the binding matches expected
  const expectedRemoveBinding = poseidon7([
    lpCommitment, calculatedLpShares, 0n, BigInt(wallet.address), changeLPCommitment, newTokenCommitment, tokensOut
  ]);
  console.log(`  Binding hash match: ${removePubBinding === expectedRemoveBinding}`);

  console.log('  Submitting removeLiquidityPrivate transaction...');
  const removeLiqTx = await router.removeLiquidityPrivate(
    removeSolidityProof,
    lpMerkleProof.root,
    lpNullifierHash,
    lpCommitment,
    calculatedLpShares,
    0n, // minEthOut
    wallet.address, // recipient
    newTokenCommitment,
    changeLPCommitment,
    tokensOut,
    removePubBinding,
    deadline,
    '0x', // tokenNote
    '0x', // changeNote
  );
  const removeLiqReceipt = await removeLiqTx.wait();
  txCount++;

  for (const log of removeLiqReceipt.logs) {
    try {
      const parsed = router.interface.parseLog(log);
      if (parsed?.name === 'LiquidityRemovedPrivate') {
        console.log(`  Removed: ${ethers.formatEther(parsed.args.ethOut)} ETH + ${ethers.formatEther(parsed.args.tokensOut)} R00T`);
      }
    } catch {}
    try {
      const parsed = pair.interface.parseLog(log);
      if (parsed?.name === 'NewCommitment') {
        console.log(`  New token commitment at leaf #${parsed.args.leafIndex}`);
      }
    } catch {}
  }
  console.log(`  TX: ${removeLiqTx.hash}`);
  console.log('');

  // ==========================================
  // Summary
  // ==========================================
  const [ethResFinal, tokResFinal] = await pair.getReserves();
  const totalLPFinal = await pair.totalLPShares();
  const fees = await pair.accumulatedProtocolFees();

  console.log('==========================================================');
  console.log('   LP SIMULATION COMPLETE');
  console.log('==========================================================');
  console.log('');
  console.log(`  Transactions: ${txCount}`);
  console.log(`  1. Buy R00T tokens (commitment created)`);
  console.log(`  2. Add liquidity (Groth16 proof verified on-chain)`);
  console.log(`  3. Remove liquidity (Groth16 proof verified on-chain)`);
  console.log('');
  console.log(`  Reserves: ${ethers.formatEther(ethResFinal)} ETH / ${ethers.formatEther(tokResFinal)} R00T`);
  console.log(`  Total LP shares: ${ethers.formatEther(totalLPFinal)}`);
  console.log(`  Protocol fees: ${ethers.formatEther(fees)} ETH`);
  console.log(`  Price: 1 ETH = ${(Number(tokResFinal) / Number(ethResFinal)).toFixed(0)} R00T`);
  console.log('');
}

main().catch(console.error);
