#!/usr/bin/env npx tsx
import { ethers } from 'ethers';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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

async function main() {
  const provider = new ethers.JsonRpcProvider(process.env.SEPOLIA_RPC_URL || 'https://eth-sepolia.g.alchemy.com/v2/demo');
  const funderKey = process.env.PRIVATE_KEY!;

  console.log('Checking agent balances...\n');

  let total = 0n;
  for (let i = 0; i < 33; i++) {
    const derivedKey = ethers.keccak256(
      ethers.solidityPacked(['bytes32', 'uint256'], [funderKey, i + 1])
    );
    const wallet = new ethers.Wallet(derivedKey);
    const balance = await provider.getBalance(wallet.address);
    total += balance;
    console.log(`Agent ${i + 1}: ${wallet.address} - ${ethers.formatEther(balance)} ETH`);
  }

  console.log(`\nTotal in agents: ${ethers.formatEther(total)} ETH`);

  const funderWallet = new ethers.Wallet(funderKey);
  const funderBalance = await provider.getBalance(funderWallet.address);
  console.log(`Funder balance: ${ethers.formatEther(funderBalance)} ETH`);
  console.log(`Grand total: ${ethers.formatEther(total + funderBalance)} ETH`);
}

main().catch(console.error);
