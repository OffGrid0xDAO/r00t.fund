#!/usr/bin/env npx tsx
/**
 * Send 1 ETH total from all 33 agents to a target address
 * Sends whatever each agent has available (minus gas costs)
 */

import { ethers, Wallet } from 'ethers';
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
}

const CONFIG = {
  RPC_URL: process.env.SEPOLIA_RPC_URL || 'https://eth-sepolia.g.alchemy.com/v2/demo',
  NUM_AGENTS: 33,
  TARGET_ADDRESS: '0x42069c220DD72541C2C7Cb7620f2094f1601430A', // Deployer
  TARGET_TOTAL: ethers.parseEther('0.2'), // Target 0.2 ETH for deployment
  MIN_SEND: ethers.parseEther('0.001'), // Minimum to bother sending
};

async function main() {
  const provider = new ethers.JsonRpcProvider(CONFIG.RPC_URL);
  const funderKey = process.env.PRIVATE_KEY;

  if (!funderKey) {
    console.error('ERROR: PRIVATE_KEY not found in environment');
    process.exit(1);
  }

  console.log('\n=== Sending ~1 ETH Total from All 33 Agents ===\n');
  console.log('Target:', CONFIG.TARGET_ADDRESS);

  // Get gas price
  const feeData = await provider.getFeeData();
  const gasPrice = feeData.gasPrice || ethers.parseUnits('20', 'gwei');
  const estimatedGas = 21000n;
  const gasCost = gasPrice * estimatedGas;
  console.log(`Gas cost per tx: ${ethers.formatEther(gasCost)} ETH`);
  console.log('');

  // First, check all balances and calculate what we can send
  console.log('Checking balances...');
  const agents: { id: number; wallet: Wallet; balance: bigint; canSend: bigint }[] = [];
  let totalCanSend = 0n;

  for (let i = 1; i <= CONFIG.NUM_AGENTS; i++) {
    const derivedKey = ethers.keccak256(
      ethers.solidityPacked(['bytes32', 'uint256'], [funderKey, i])
    );
    const wallet = new Wallet(derivedKey, provider);
    const balance = await provider.getBalance(wallet.address);

    // What can this agent send? Balance minus gas cost, but at least 0
    const canSend = balance > gasCost ? balance - gasCost : 0n;

    agents.push({ id: i, wallet, balance, canSend });
    totalCanSend += canSend;
  }

  console.log(`Total available to send: ${ethers.formatEther(totalCanSend)} ETH`);
  console.log(`Target: 1 ETH\n`);

  // Calculate what portion of remaining target each agent should send
  let remaining = CONFIG.TARGET_TOTAL;
  let successCount = 0;
  let totalSent = 0n;
  const failedAgents: number[] = [];

  // Sort by balance descending to send from richest agents first
  agents.sort((a, b) => (b.canSend > a.canSend ? 1 : -1));

  for (const agent of agents) {
    if (remaining <= 0n) {
      console.log(`Agent ${agent.id.toString().padStart(2)}: Skipped (target reached)`);
      continue;
    }

    if (agent.canSend < CONFIG.MIN_SEND) {
      console.log(`Agent ${agent.id.toString().padStart(2)}: ${agent.wallet.address.slice(0, 10)}... - Skip (only ${ethers.formatEther(agent.balance)} ETH)`);
      continue;
    }

    // Send either what's remaining or what this agent can afford
    const toSend = agent.canSend > remaining ? remaining : agent.canSend;

    try {
      process.stdout.write(`Agent ${agent.id.toString().padStart(2)}: ${agent.wallet.address.slice(0, 10)}... - Sending ${ethers.formatEther(toSend)} ETH... `);

      const tx = await agent.wallet.sendTransaction({
        to: CONFIG.TARGET_ADDRESS,
        value: toSend,
        gasLimit: estimatedGas,
        gasPrice: gasPrice,
      });

      await tx.wait();
      console.log(`✓ ${tx.hash.slice(0, 14)}...`);
      successCount++;
      totalSent += toSend;
      remaining -= toSend;
    } catch (err: any) {
      console.log(`✗ ${err.message?.slice(0, 40) || 'Failed'}`);
      failedAgents.push(agent.id);
    }
  }

  console.log('\n=== Summary ===');
  console.log(`Successful: ${successCount}/${CONFIG.NUM_AGENTS}`);
  console.log(`Total sent: ${ethers.formatEther(totalSent)} ETH`);
  console.log(`Remaining: ${ethers.formatEther(remaining)} ETH`);

  if (failedAgents.length > 0) {
    console.log(`Failed agents: ${failedAgents.join(', ')}`);
  }

  // Check target balance
  const targetBalance = await provider.getBalance(CONFIG.TARGET_ADDRESS);
  console.log(`\nTarget balance: ${ethers.formatEther(targetBalance)} ETH`);
}

main().catch(console.error);
