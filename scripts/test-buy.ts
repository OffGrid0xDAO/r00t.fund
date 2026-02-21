#!/usr/bin/env npx tsx
import { ethers } from 'ethers';
import { poseidon3 } from 'poseidon-lite';
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

async function main() {
  const provider = new ethers.JsonRpcProvider(process.env.SEPOLIA_RPC_URL || 'https://eth-sepolia.g.alchemy.com/v2/demo');
  const wallet = new ethers.Wallet(process.env.PRIVATE_KEY!, provider);

  // Use the indexer's contract addresses
  const ZKAMM_ROUTER = '0x0a009895B9CFA38d34a43a0f1a805E3A8A848FF2';

  const routerAbi = [
    'function buyPrivate(uint256 newCommitment, uint256 minTokensOut, uint256 deadline, bytes encryptedNote) payable',
  ];

  const router = new ethers.Contract(ZKAMM_ROUTER, routerAbi, wallet);

  console.log('Wallet:', wallet.address);
  const balance = await provider.getBalance(wallet.address);
  console.log('Balance:', ethers.formatEther(balance), 'ETH');

  // Create commitment
  const nullifier = randomFieldElement();
  const secret = randomFieldElement();
  const amount = ethers.parseEther('100000'); // Placeholder amount
  const commitment = poseidon3([nullifier, secret, amount]);

  console.log('\nCommitment:', commitment.toString().slice(0, 30) + '...');
  console.log('< FIELD_PRIME:', commitment < FIELD_PRIME);

  const deadline = BigInt(Math.floor(Date.now() / 1000) + 600);
  const ethAmount = ethers.parseEther('0.001');

  console.log('\nTrying buyPrivate with:');
  console.log('  ETH:', ethers.formatEther(ethAmount));
  console.log('  Deadline:', deadline.toString());

  try {
    // First try to estimate gas to see the error
    console.log('\nEstimating gas...');
    const gasEstimate = await router.buyPrivate.estimateGas(commitment, 0n, deadline, '0x', {
      value: ethAmount,
    });
    console.log('Gas estimate:', gasEstimate.toString());

    // If we get here, the tx should succeed
    console.log('\nSending transaction...');
    const tx = await router.buyPrivate(commitment, 0n, deadline, '0x', {
      value: ethAmount,
      gasLimit: gasEstimate * 120n / 100n, // 20% buffer
    });
    console.log('TX Hash:', tx.hash);
    const receipt = await tx.wait();
    console.log('Success! Block:', receipt.blockNumber);
  } catch (error: any) {
    console.error('\nError:', error.message);

    // Try to decode the error
    if (error.data) {
      console.error('Error data:', error.data);
    }
    if (error.reason) {
      console.error('Reason:', error.reason);
    }
    if (error.revert) {
      console.error('Revert:', error.revert);
    }
  }
}

main().catch(console.error);
