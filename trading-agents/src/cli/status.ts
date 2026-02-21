#!/usr/bin/env npx tsx
/**
 * Check status of all agent wallets
 */

import { ethers } from 'ethers';
import { CONFIG } from '../../config.js';

async function main() {
  const privateKey = process.env.PRIVATE_KEY;
  if (!privateKey) {
    console.error('PRIVATE_KEY required');
    process.exit(1);
  }

  const provider = new ethers.JsonRpcProvider(CONFIG.RPC_URL);
  const funder = new ethers.Wallet(privateKey, provider);

  console.log('\n📊 Agent Wallet Status\n');
  console.log(`Funder: ${funder.address}`);
  const funderBal = await provider.getBalance(funder.address);
  console.log(`Funder Balance: ${ethers.formatEther(funderBal)} ETH\n`);

  console.log('Agent | Address                                    | Balance');
  console.log('------|----------------------------------------------|---------------');

  let total = 0n;
  let ready = 0;
  const minBalance = CONFIG.MIN_TRADE_ETH + CONFIG.GAS_BUFFER;

  for (let i = 0; i < CONFIG.NUM_AGENTS; i++) {
    const derivedKey = ethers.keccak256(
      ethers.solidityPacked(['bytes32', 'uint256'], [privateKey, i + 1])
    );
    const wallet = new ethers.Wallet(derivedKey);
    const balance = await provider.getBalance(wallet.address);
    total += balance;

    if (balance >= minBalance) ready++;

    console.log(
      `${String(i + 1).padStart(5)} | ${wallet.address} | ${ethers.formatEther(balance).padStart(13)} ETH`
    );
  }

  console.log('\n--- Summary ---');
  console.log(`Total ETH in agents: ${ethers.formatEther(total)} ETH`);
  console.log(`Agents ready to trade: ${ready}/${CONFIG.NUM_AGENTS}`);
  console.log(`Min balance needed: ${ethers.formatEther(minBalance)} ETH`);
}

main().catch(console.error);
