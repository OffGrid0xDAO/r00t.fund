#!/usr/bin/env npx tsx
/**
 * Fund agent wallets that are below minimum balance
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

  console.log('\n💰 Funding Agent Wallets\n');
  console.log(`Funder: ${funder.address}`);
  const funderBal = await provider.getBalance(funder.address);
  console.log(`Funder Balance: ${ethers.formatEther(funderBal)} ETH\n`);

  const minBalance = CONFIG.MIN_TRADE_ETH + CONFIG.GAS_BUFFER;
  const needsFunding: { id: number; address: string; balance: bigint }[] = [];

  // Check which agents need funding
  for (let i = 0; i < CONFIG.NUM_AGENTS; i++) {
    const derivedKey = ethers.keccak256(
      ethers.solidityPacked(['bytes32', 'uint256'], [privateKey, i + 1])
    );
    const wallet = new ethers.Wallet(derivedKey);
    const balance = await provider.getBalance(wallet.address);

    if (balance < minBalance) {
      needsFunding.push({ id: i + 1, address: wallet.address, balance });
    }
  }

  if (needsFunding.length === 0) {
    console.log('✅ All agents have sufficient balance!');
    return;
  }

  const totalNeeded = BigInt(needsFunding.length) * CONFIG.FUND_AMOUNT;
  console.log(`${needsFunding.length} agents need funding`);
  console.log(`Total needed: ${ethers.formatEther(totalNeeded)} ETH`);

  if (funderBal < totalNeeded) {
    console.error(`\n❌ Insufficient funder balance!`);
    console.log(`Need: ${ethers.formatEther(totalNeeded)} ETH`);
    console.log(`Have: ${ethers.formatEther(funderBal)} ETH`);
    process.exit(1);
  }

  console.log('\nFunding agents...\n');

  for (const { id, address, balance } of needsFunding) {
    console.log(`Agent ${id}: ${ethers.formatEther(balance)} -> +${ethers.formatEther(CONFIG.FUND_AMOUNT)} ETH`);

    const tx = await funder.sendTransaction({
      to: address,
      value: CONFIG.FUND_AMOUNT,
    });
    await tx.wait();
    console.log(`  ✓ ${tx.hash.slice(0, 20)}...`);
  }

  console.log('\n✅ Funding complete!');
}

main().catch(console.error);
