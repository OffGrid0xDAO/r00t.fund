#!/usr/bin/env npx tsx
/**
 * Complete test: Buy tokens privately, then sell them with ZK proof
 * Tests the full flow on Base mainnet
 */

import { ethers } from 'ethers';
import { poseidon2, poseidon3 } from 'poseidon-lite';
import * as snarkjs from 'snarkjs';
import * as fs from 'fs';
import * as path from 'path';

// Contract addresses from deployment
const ZKAMM_ADDRESS = '0x8d7472b0091495E47Fd4c55BBea9988cA1388E41';
const TOKEN_POOL_ADDRESS = '0x6426a21D088076AD85896bBbb160077e6344BC75';

// BN254 field prime
const FIELD_PRIME = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;

// ABIs
const ZKAMM_ABI = [
  'function buyPrivate(uint256 newCommitment, uint256 minTokensOut, bytes encryptedNote) payable',
  'function sellPrivate(uint256[8] proof, uint256 merkleRoot, uint256 nullifierHash, uint256 tokenAmount, uint256 minEthOut, address recipient, address relayer, uint256 fee, uint256 changeCommitment, bytes changeNote)',
  'function getAmountOut(uint256 amountIn, uint256 reserveIn, uint256 reserveOut) view returns (uint256)',
  'function ethReserve() view returns (uint256)',
  'function tokenReserve() view returns (uint256)',
  'event NewCommitment(uint256 indexed commitment, uint256 indexed leafIndex, bytes encryptedNote)',
  'event TokensPurchased(uint256 ethIn, uint256 tokensOut)',
  'event TokensSold(uint256 tokensIn, uint256 ethOut)',
];

const TOKEN_POOL_ABI = [
  'function root() view returns (uint256)',
  'function nextIndex() view returns (uint256)',
  'function filledSubtrees(uint256) view returns (uint256)',
  'function zeros(uint256) view returns (uint256)',
  'function TREE_DEPTH() view returns (uint256)',
];

// Generate random field element
function randomFieldElement(): bigint {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let value = 0n;
  for (let i = 0; i < 32; i++) {
    value = (value << 8n) | BigInt(bytes[i]);
  }
  return value % FIELD_PRIME;
}

// Poseidon hash for commitment: H(nullifier, secret, amount)
function hashCommitment(nullifier: bigint, secret: bigint, amount: bigint): bigint {
  return poseidon3([nullifier, secret, amount]);
}

// Poseidon hash for nullifier hash: H(nullifier, leafIndex)
function hashNullifier(nullifier: bigint, leafIndex: number): bigint {
  return poseidon2([nullifier, BigInt(leafIndex)]);
}

// Poseidon hash for merkle tree
function hashPair(left: bigint, right: bigint): bigint {
  return poseidon2([left, right]);
}

// Get merkle proof from on-chain data
async function getMerkleProof(
  tokenPool: ethers.Contract,
  leafIndex: number,
  commitment: bigint
): Promise<{ pathElements: bigint[]; pathIndices: number[]; root: bigint }> {
  const TREE_DEPTH = 24;

  // The pathIndices indicate whether the current node is left (0) or right (1)
  // pathElements are the siblings at each level

  const pathElements: bigint[] = [];
  const pathIndices: number[] = [];

  let currentIndex = leafIndex;
  let currentHash = commitment;

  for (let level = 0; level < TREE_DEPTH; level++) {
    // Is this node a left child (even) or right child (odd)?
    const isLeftChild = currentIndex % 2 === 0;

    // pathIndices: 0 = leaf is on LEFT, sibling on right
    //              1 = leaf is on RIGHT, sibling on left
    pathIndices.push(isLeftChild ? 0 : 1);

    // Get sibling based on tree structure
    let sibling: bigint;
    if (isLeftChild) {
      // Current is left child, sibling is the zero hash at this level (empty right subtree)
      sibling = BigInt(await tokenPool.zeros(level));
    } else {
      // Current is right child, sibling is the filled subtree at this level
      sibling = BigInt(await tokenPool.filledSubtrees(level));
    }

    pathElements.push(sibling);

    // Compute parent hash (left, right order)
    if (isLeftChild) {
      currentHash = hashPair(currentHash, sibling);
    } else {
      currentHash = hashPair(sibling, currentHash);
    }

    // Move to parent level
    currentIndex = Math.floor(currentIndex / 2);
  }

  const root = BigInt(await tokenPool.root());

  console.log('Computed root:', currentHash.toString().slice(0, 20) + '...');
  console.log('On-chain root:', root.toString().slice(0, 20) + '...');
  console.log('Roots match:', currentHash === root);

  return { pathElements, pathIndices, root };
}

// Format proof for Solidity
function formatProofForSolidity(proof: any): bigint[] {
  return [
    BigInt(proof.pi_a[0]),
    BigInt(proof.pi_a[1]),
    BigInt(proof.pi_b[0][1]), // Note: pi_b coordinates are swapped for Solidity
    BigInt(proof.pi_b[0][0]),
    BigInt(proof.pi_b[1][1]),
    BigInt(proof.pi_b[1][0]),
    BigInt(proof.pi_c[0]),
    BigInt(proof.pi_c[1]),
  ];
}

async function main() {
  const rpcUrl = process.env.BASE_MAINNET_RPC_URL;
  const privateKey = process.env.PRIVATE_KEY;

  if (!rpcUrl || !privateKey) {
    console.error('Missing BASE_MAINNET_RPC_URL or PRIVATE_KEY');
    process.exit(1);
  }

  // Connect
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const wallet = new ethers.Wallet(privateKey, provider);
  const zkAMM = new ethers.Contract(ZKAMM_ADDRESS, ZKAMM_ABI, wallet);
  const tokenPool = new ethers.Contract(TOKEN_POOL_ADDRESS, TOKEN_POOL_ABI, provider);

  console.log('=== ZkAMM Buy + Sell Test ===\n');
  console.log('Wallet:', wallet.address);

  const balance = await provider.getBalance(wallet.address);
  console.log('ETH Balance:', ethers.formatEther(balance), 'ETH\n');

  // === STEP 1: Create commitment and buy ===
  console.log('--- STEP 1: Buy Tokens ---\n');

  const buyAmount = ethers.parseEther('0.0001');

  // Get expected tokens
  const ethReserve = await zkAMM.ethReserve();
  const tokenReserve = await zkAMM.tokenReserve();
  const expectedTokens = await zkAMM.getAmountOut(buyAmount, ethReserve, tokenReserve);

  console.log('Buying with:', ethers.formatEther(buyAmount), 'ETH');
  console.log('Expected tokens:', ethers.formatEther(expectedTokens), 'ROOT');

  // Create commitment with secrets
  const nullifier = randomFieldElement();
  const secret = randomFieldElement();
  const tokenAmount = expectedTokens; // Use exact expected amount
  const commitment = hashCommitment(nullifier, secret, tokenAmount);

  console.log('\nCreated commitment:');
  console.log('  Nullifier:', nullifier.toString().slice(0, 20) + '...');
  console.log('  Secret:', secret.toString().slice(0, 20) + '...');
  console.log('  Amount:', ethers.formatEther(tokenAmount), 'ROOT');
  console.log('  Commitment:', commitment.toString().slice(0, 20) + '...');

  // Execute buy
  console.log('\nSending buyPrivate transaction...');
  const buyTx = await zkAMM.buyPrivate(commitment, 0n, '0x', { value: buyAmount });
  console.log('TX:', buyTx.hash);

  const buyReceipt = await buyTx.wait();
  console.log('Confirmed in block:', buyReceipt.blockNumber);

  // Parse NewCommitment event to get leaf index
  let leafIndex = 0;
  for (const log of buyReceipt.logs) {
    try {
      const parsed = zkAMM.interface.parseLog(log);
      if (parsed?.name === 'NewCommitment') {
        leafIndex = Number(parsed.args.leafIndex);
        console.log('Leaf index:', leafIndex);
      }
      if (parsed?.name === 'TokensPurchased') {
        console.log('Actual tokens received:', ethers.formatEther(parsed.args.tokensOut), 'ROOT');
      }
    } catch {}
  }

  console.log('\n✅ Buy successful!\n');

  // === STEP 2: Generate ZK proof and sell ===
  console.log('--- STEP 2: Sell Tokens with ZK Proof ---\n');

  // Get merkle proof
  console.log('Getting merkle proof...');
  const merkleProof = await getMerkleProof(tokenPool, leafIndex, commitment);
  console.log('Merkle root:', merkleProof.root.toString().slice(0, 20) + '...');

  // Compute nullifier hash
  const nullifierHash = hashNullifier(nullifier, leafIndex);
  console.log('Nullifier hash:', nullifierHash.toString().slice(0, 20) + '...');

  // Sell amount (sell all tokens)
  const sellAmount = tokenAmount;
  const minEthOut = 0n; // No slippage protection for test

  // No change commitment (selling everything)
  const changeCommitment = 0n;
  const changeNullifier = 0n;
  const changeSecret = 0n;

  // Load circuit artifacts
  const circuitPath = path.join(__dirname, '../circuits/build/sell');
  const wasm = path.join(circuitPath, 'sell_js/sell.wasm');
  const zkey = path.join(circuitPath, 'sell_final.zkey');

  console.log('\nGenerating ZK proof...');
  console.log('(This may take a few seconds...)\n');

  // Prepare circuit inputs
  const circuitInputs = {
    // Public inputs
    merkleRoot: merkleProof.root.toString(),
    nullifierHash: nullifierHash.toString(),
    tokenAmount: sellAmount.toString(),
    minEthOut: minEthOut.toString(),
    recipient: BigInt(wallet.address).toString(),
    relayer: BigInt(wallet.address).toString(), // Self-relay
    fee: '0',
    changeCommitment: changeCommitment.toString(),

    // Private inputs
    nullifier: nullifier.toString(),
    secret: secret.toString(),
    amount: tokenAmount.toString(),
    pathElements: merkleProof.pathElements.map(e => e.toString()),
    pathIndices: merkleProof.pathIndices,
    changeNullifier: changeNullifier.toString(),
    changeSecret: changeSecret.toString(),
  };

  try {
    const { proof, publicSignals } = await snarkjs.groth16.fullProve(
      circuitInputs,
      wasm,
      zkey
    );

    console.log('Proof generated!');
    console.log('Public signals:', publicSignals.length, 'values');

    // Format proof for Solidity
    const solidityProof = formatProofForSolidity(proof);

    // Execute sell
    console.log('\nSending sellPrivate transaction...');
    const sellTx = await zkAMM.sellPrivate(
      solidityProof,
      merkleProof.root,
      nullifierHash,
      sellAmount,
      minEthOut,
      wallet.address, // recipient
      wallet.address, // relayer (self)
      0n, // no fee
      changeCommitment,
      '0x' // no change note
    );

    console.log('TX:', sellTx.hash);
    const sellReceipt = await sellTx.wait();
    console.log('Confirmed in block:', sellReceipt.blockNumber);

    // Parse events
    for (const log of sellReceipt.logs) {
      try {
        const parsed = zkAMM.interface.parseLog(log);
        if (parsed?.name === 'TokensSold') {
          console.log('\nTokens sold:', ethers.formatEther(parsed.args.tokensIn), 'ROOT');
          console.log('ETH received:', ethers.formatEther(parsed.args.ethOut), 'ETH');
        }
      } catch {}
    }

    console.log('\n✅ Sell successful!');
    console.log('\nFull cycle complete: Buy -> Sell with ZK proof');

  } catch (error: any) {
    console.error('\n❌ Proof generation or sell failed:', error.message);
    if (error.message.includes('Assert Failed')) {
      console.log('\nThis usually means the circuit inputs are invalid.');
      console.log('Check that:');
      console.log('  1. The commitment matches the merkle tree');
      console.log('  2. The nullifier/secret/amount hash to the commitment');
      console.log('  3. The merkle proof is correct');
    }
    process.exit(1);
  }
}

main().catch(console.error);
