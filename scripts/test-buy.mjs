#!/usr/bin/env node
/**
 * Test buyPrivate on Base mainnet
 * Uses Poseidon hash to create commitment
 */

import { ethers } from 'ethers';
import { poseidon3 } from 'poseidon-lite';

// Contract addresses from deployment
const ZKAMM_ADDRESS = '0x8d7472b0091495E47Fd4c55BBea9988cA1388E41';

// ZkAMM ABI (only what we need)
const ZKAMM_ABI = [
  'function buyPrivate(uint256 newCommitment, uint256 minTokensOut, bytes encryptedNote) payable',
  'function getAmountOut(uint256 amountIn, uint256 reserveIn, uint256 reserveOut) view returns (uint256)',
  'function ethReserve() view returns (uint256)',
  'function tokenReserve() view returns (uint256)',
  'function getTokenPrice() view returns (uint256)',
  'event NewCommitment(uint256 indexed commitment, uint256 indexed leafIndex, bytes encryptedNote)',
  'event TokensPurchased(uint256 ethIn, uint256 tokensOut)',
];

// BN254 field prime
const FIELD_PRIME = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;

// Generate random field element
function randomFieldElement() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let value = 0n;
  for (let i = 0; i < 32; i++) {
    value = (value << 8n) | BigInt(bytes[i]);
  }
  return value % FIELD_PRIME;
}

// Create commitment: Poseidon(nullifier, secret, amount)
function createCommitment(amount) {
  const nullifier = randomFieldElement();
  const secret = randomFieldElement();
  const commitment = poseidon3([nullifier, secret, amount]);
  return { nullifier, secret, amount, commitment };
}

async function main() {
  // Load env vars
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

  console.log('Wallet:', wallet.address);

  // Get balance
  const balance = await provider.getBalance(wallet.address);
  console.log('ETH Balance:', ethers.formatEther(balance), 'ETH');

  // Get pool state
  const ethReserve = await zkAMM.ethReserve();
  const tokenReserve = await zkAMM.tokenReserve();
  const tokenPrice = await zkAMM.getTokenPrice();

  console.log('\nPool State:');
  console.log('  ETH Reserve:', ethers.formatEther(ethReserve), 'ETH');
  console.log('  Token Reserve:', ethers.formatEther(tokenReserve), 'ROOT');
  console.log('  Price:', ethers.formatEther(tokenPrice), 'ROOT/ETH');

  // Buy with 0.0001 ETH
  const buyAmount = ethers.parseEther('0.0001');

  // Calculate expected tokens
  const expectedTokens = await zkAMM.getAmountOut(buyAmount, ethReserve, tokenReserve);
  console.log('\nBuy Quote:');
  console.log('  ETH In:', ethers.formatEther(buyAmount), 'ETH');
  console.log('  Expected Tokens:', ethers.formatEther(expectedTokens), 'ROOT');

  // Create commitment
  const commitmentData = createCommitment(expectedTokens);
  console.log('\nCreated Commitment:');
  console.log('  Commitment:', commitmentData.commitment.toString());
  console.log('  Amount:', ethers.formatEther(commitmentData.amount), 'ROOT');
  console.log('  (Save nullifier and secret to spend later!)');
  console.log('  Nullifier:', commitmentData.nullifier.toString());
  console.log('  Secret:', commitmentData.secret.toString());

  // Apply 1% slippage tolerance
  const minTokensOut = expectedTokens * 99n / 100n;
  console.log('  Min Tokens Out (99%):', ethers.formatEther(minTokensOut), 'ROOT');

  // Execute buy
  console.log('\nExecuting buyPrivate...');
  try {
    const tx = await zkAMM.buyPrivate(
      commitmentData.commitment,
      minTokensOut,
      '0x', // Empty encrypted note (we just logged it above)
      { value: buyAmount }
    );

    console.log('TX Hash:', tx.hash);
    console.log('Waiting for confirmation...');

    const receipt = await tx.wait();
    console.log('Confirmed in block:', receipt.blockNumber);
    console.log('Gas used:', receipt.gasUsed.toString());

    // Parse events
    for (const log of receipt.logs) {
      try {
        const parsed = zkAMM.interface.parseLog(log);
        if (parsed) {
          console.log('\nEvent:', parsed.name);
          if (parsed.name === 'NewCommitment') {
            console.log('  Commitment:', parsed.args.commitment.toString());
            console.log('  Leaf Index:', parsed.args.leafIndex.toString());
          } else if (parsed.name === 'TokensPurchased') {
            console.log('  ETH In:', ethers.formatEther(parsed.args.ethIn));
            console.log('  Tokens Out:', ethers.formatEther(parsed.args.tokensOut));
          }
        }
      } catch {}
    }

    console.log('\n✅ Buy successful!');

  } catch (error) {
    console.error('\n❌ Buy failed:', error.message);
    if (error.data) {
      console.error('Revert data:', error.data);
    }
    process.exit(1);
  }
}

main().catch(console.error);
