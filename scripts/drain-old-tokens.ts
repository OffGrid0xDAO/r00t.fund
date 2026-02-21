#!/usr/bin/env npx tsx
/**
 * Check and Drain Market Maker Wallets
 *
 * This script:
 * 1. Checks all 33 agent wallets for ETH balances
 * 2. Consolidates ETH back to the funder wallet
 *
 * Note: Old contract tokens cannot be recovered if contracts are no longer deployed.
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
  console.log('Loaded environment from contracts/.env');
}

const CONFIG = {
  RPC_URL: process.env.SEPOLIA_RPC_URL || 'https://eth-sepolia.g.alchemy.com/v2/demo',
  NUM_AGENTS: 33,
};

interface CommitmentNote {
  commitment: string;
  nullifier: string;
  secret: string;
  amount: string;
  leafIndex: number;
  spent: boolean;
}

async function main() {
  console.log('\n==============================================');
  console.log('   Check Market Maker Wallet Balances');
  console.log('==============================================\n');

  const provider = new ethers.JsonRpcProvider(CONFIG.RPC_URL);

  // Get funder wallet
  const funderKey = process.env.PRIVATE_KEY;
  if (!funderKey) {
    console.error('ERROR: PRIVATE_KEY environment variable required');
    process.exit(1);
  }

  const funder = new Wallet(funderKey, provider);
  const funderBalance = await provider.getBalance(funder.address);
  console.log('Funder:', funder.address);
  console.log('Funder Balance:', ethers.formatEther(funderBalance), 'ETH\n');

  // Derive all agent wallets and check balances
  console.log('--- Agent Wallet Status ---\n');
  console.log('Agent | Address                                    | ETH Balance    | Unspent Notes (OLD contract - unrecoverable)');
  console.log('------|----------------------------------------------|----------------|----------------------------------------------');

  let totalEth = 0n;
  let totalUnspentNotes = 0;
  let totalUnspentTokens = 0n;

  interface AgentData {
    id: number;
    wallet: Wallet;
    ethBalance: bigint;
    notes: CommitmentNote[];
  }
  const agentsWithBalance: AgentData[] = [];

  for (let i = 0; i < CONFIG.NUM_AGENTS; i++) {
    const derivedKey = ethers.keccak256(
      ethers.solidityPacked(['bytes32', 'uint256'], [funderKey, i + 1])
    );
    const wallet = new Wallet(derivedKey, provider);

    // Check ETH balance
    const ethBalance = await provider.getBalance(wallet.address);
    totalEth += ethBalance;

    // Load notes from file (just for reporting)
    const notesFile = path.join(__dirname, `.notes-agent-${i + 1}.json`);
    let notes: CommitmentNote[] = [];
    let unspentCount = 0;
    let unspentTokens = 0n;

    if (fs.existsSync(notesFile)) {
      const fileContent = fs.readFileSync(notesFile, 'utf-8');
      notes = JSON.parse(fileContent) as CommitmentNote[];

      for (const note of notes) {
        if (!note.spent) {
          unspentCount++;
          unspentTokens += BigInt(note.amount);
        }
      }
      totalUnspentNotes += unspentCount;
      totalUnspentTokens += unspentTokens;
    }

    if (ethBalance > 0n || unspentCount > 0) {
      agentsWithBalance.push({ id: i + 1, wallet, ethBalance, notes });
      console.log(
        `${String(i + 1).padStart(5)} | ` +
        `${wallet.address} | ` +
        `${ethers.formatEther(ethBalance).padStart(14)} | ` +
        `${unspentCount} notes (${Number(ethers.formatEther(unspentTokens)).toFixed(2)} tokens)`
      );
    }
  }

  console.log(`\n--- Summary ---`);
  console.log(`Total ETH in agent wallets: ${ethers.formatEther(totalEth)} ETH`);
  console.log(`Total unspent notes (OLD contract - lost): ${totalUnspentNotes}`);
  console.log(`Total unspent tokens (OLD contract - lost): ${ethers.formatEther(totalUnspentTokens)} ROOT`);

  if (agentsWithBalance.length === 0) {
    console.log('\nNo ETH found in any agent wallets.');
    return;
  }

  // Ask for confirmation before consolidating
  console.log(`\nFound ${agentsWithBalance.length} wallets with ETH.`);
  console.log('Consolidating ETH balances to funder...\n');

  let totalConsolidated = 0n;

  for (const agent of agentsWithBalance) {
    if (agent.ethBalance > ethers.parseEther('0.0005')) {
      try {
        const gasPrice = await provider.getFeeData();
        const gasLimit = 21000n;
        const gasCost = gasLimit * (gasPrice.gasPrice || ethers.parseUnits('20', 'gwei'));
        const sendAmount = agent.ethBalance - gasCost;

        if (sendAmount > 0n) {
          console.log(`  Agent ${agent.id}: Sending ${ethers.formatEther(sendAmount)} ETH to funder...`);
          const tx = await agent.wallet.sendTransaction({
            to: funder.address,
            value: sendAmount,
            gasLimit: gasLimit,
          });
          await tx.wait();
          console.log(`    ✓ Done: ${tx.hash}`);
          totalConsolidated += sendAmount;
        }
      } catch (error: any) {
        console.error(`    ✗ Error: ${error.message?.slice(0, 80)}`);
      }
    } else {
      console.log(`  Agent ${agent.id}: Balance too low to consolidate (${ethers.formatEther(agent.ethBalance)} ETH)`);
    }
  }

  const finalFunderBalance = await provider.getBalance(funder.address);
  console.log(`\n--- Final Status ---`);
  console.log(`Total consolidated: ${ethers.formatEther(totalConsolidated)} ETH`);
  console.log(`Funder final balance: ${ethers.formatEther(finalFunderBalance)} ETH`);
  console.log('\n=== Done! ===\n');
}

main().catch(console.error);
