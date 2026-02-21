#!/usr/bin/env npx tsx
/**
 * Check agent balances and send ETH to target address
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
  TARGET_ADDRESS: '0x42069c220DD72541C2C7Cb7620f2094f1601430A',
  SEND_AMOUNT: ethers.parseEther('1'), // Send 1 ETH total
  MIN_KEEP: ethers.parseEther('0.01'), // Keep some for gas
};

async function main() {
  const provider = new ethers.JsonRpcProvider(CONFIG.RPC_URL);
  const funderKey = process.env.PRIVATE_KEY;

  if (!funderKey) {
    console.error('ERROR: PRIVATE_KEY not found in environment');
    process.exit(1);
  }

  console.log('\n=== Checking Agent Balances ===\n');
  console.log('Target:', CONFIG.TARGET_ADDRESS);
  console.log('');

  // Check all agents and find ones with funds
  const agentsWithFunds: { id: number; wallet: Wallet; balance: bigint }[] = [];

  for (let i = 1; i <= CONFIG.NUM_AGENTS; i++) {
    const derivedKey = ethers.keccak256(
      ethers.solidityPacked(['bytes32', 'uint256'], [funderKey, i])
    );
    const wallet = new Wallet(derivedKey, provider);
    const balance = await provider.getBalance(wallet.address);

    if (balance > CONFIG.MIN_KEEP) {
      agentsWithFunds.push({ id: i, wallet, balance });
      console.log(`Agent ${i}: ${wallet.address.slice(0, 10)}... - ${ethers.formatEther(balance)} ETH`);
    }
  }

  // Also check deployer balance
  const deployerWallet = new Wallet(funderKey, provider);
  const deployerBalance = await provider.getBalance(deployerWallet.address);
  console.log(`\nDeployer: ${deployerWallet.address.slice(0, 10)}... - ${ethers.formatEther(deployerBalance)} ETH`);

  const totalAvailable = agentsWithFunds.reduce((sum, a) => sum + a.balance, 0n) + deployerBalance;
  console.log(`\nTotal available: ${ethers.formatEther(totalAvailable)} ETH`);
  console.log(`Agents with funds: ${agentsWithFunds.length}`);

  // Send 1 ETH to target - prefer from deployer first, then agents
  console.log(`\n=== Sending 1 ETH to ${CONFIG.TARGET_ADDRESS} ===\n`);

  let remaining = CONFIG.SEND_AMOUNT;

  // Try deployer first
  if (deployerBalance > CONFIG.MIN_KEEP + ethers.parseEther('0.005')) {
    const sendAmount = deployerBalance - CONFIG.MIN_KEEP > remaining
      ? remaining
      : deployerBalance - CONFIG.MIN_KEEP - ethers.parseEther('0.005'); // Keep extra for gas

    if (sendAmount > 0n) {
      try {
        console.log(`Sending ${ethers.formatEther(sendAmount)} ETH from deployer...`);
        const tx = await deployerWallet.sendTransaction({
          to: CONFIG.TARGET_ADDRESS,
          value: sendAmount,
          gasLimit: 21000,
        });
        await tx.wait();
        console.log(`  ✓ Sent! TX: ${tx.hash}`);
        remaining -= sendAmount;
      } catch (err: any) {
        console.log(`  ✗ Failed: ${err.message?.slice(0, 50)}`);
      }
    }
  }

  // If still need more, send from agents
  for (const agent of agentsWithFunds) {
    if (remaining <= 0n) break;

    const available = agent.balance - CONFIG.MIN_KEEP - ethers.parseEther('0.005');
    if (available <= 0n) continue;

    const sendAmount = available > remaining ? remaining : available;

    try {
      console.log(`Sending ${ethers.formatEther(sendAmount)} ETH from Agent ${agent.id}...`);
      const tx = await agent.wallet.sendTransaction({
        to: CONFIG.TARGET_ADDRESS,
        value: sendAmount,
        gasLimit: 21000,
      });
      await tx.wait();
      console.log(`  ✓ Sent! TX: ${tx.hash}`);
      remaining -= sendAmount;
    } catch (err: any) {
      console.log(`  ✗ Failed: ${err.message?.slice(0, 50)}`);
    }
  }

  if (remaining > 0n) {
    console.log(`\n⚠️  Could not send full amount. Remaining: ${ethers.formatEther(remaining)} ETH`);
  } else {
    console.log(`\n✓ Successfully sent 1 ETH to ${CONFIG.TARGET_ADDRESS}`);
  }

  // Final balance check
  const targetBalance = await provider.getBalance(CONFIG.TARGET_ADDRESS);
  console.log(`\nTarget balance: ${ethers.formatEther(targetBalance)} ETH`);
}

main().catch(console.error);
