/**
 * Simple Event Watcher
 *
 * Listens to ZkAMM contract events and posts them to the API.
 * Run this as a background service (e.g., on a VPS, Railway, or as a cron job).
 *
 * Usage: pnpm exec tsx scripts/event-watcher.ts
 */

import { createPublicClient, http, formatEther, formatUnits, parseAbiItem } from 'viem';
import { sepolia } from 'viem/chains';

// Configuration
const ZKAMM_ADDRESS = '0xE61d0191A5B58D0e1258726FF30493db6071b196';
const RPC_URL = process.env.SEPOLIA_RPC_URL || 'https://eth-sepolia.g.alchemy.com/v2/demo';
const API_URL = process.env.API_URL || 'http://localhost:3000/api/trades';

// Event ABIs
const TokensPurchasedEvent = parseAbiItem('event TokensPurchased(uint256 ethIn, uint256 tokensOut)');
const TokensSoldEvent = parseAbiItem('event TokensSold(uint256 tokensIn, uint256 ethOut)');

// Create client
const client = createPublicClient({
  chain: sepolia,
  transport: http(RPC_URL),
});

async function postTrade(trade: {
  type: 'buy' | 'sell';
  ethAmount: string;
  tokenAmount: string;
  price: string;
  blockNumber: number;
  timestamp: number;
  transactionHash: string;
}) {
  try {
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: `${trade.transactionHash}-${trade.type}`,
        ...trade,
      }),
    });

    if (response.ok) {
      console.log(`[${new Date().toISOString()}] Posted ${trade.type}: ${trade.ethAmount} ETH @ ${trade.price}`);
    } else {
      console.error(`[${new Date().toISOString()}] Failed to post trade:`, await response.text());
    }
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Error posting trade:`, error);
  }
}

async function main() {
  console.log('='.repeat(60));
  console.log('ZkAMM Event Watcher');
  console.log('='.repeat(60));
  console.log(`Contract: ${ZKAMM_ADDRESS}`);
  console.log(`RPC: ${RPC_URL}`);
  console.log(`API: ${API_URL}`);
  console.log('='.repeat(60));
  console.log('Watching for events...\n');

  // Watch for TokensPurchased events
  const unwatch1 = client.watchEvent({
    address: ZKAMM_ADDRESS as `0x${string}`,
    event: TokensPurchasedEvent,
    onLogs: async (logs) => {
      for (const log of logs) {
        const ethIn = formatEther(log.args.ethIn || 0n);
        const tokensOut = formatUnits(log.args.tokensOut || 0n, 18);
        const price = (parseFloat(tokensOut) / parseFloat(ethIn)).toString();

        // Get block timestamp
        const block = await client.getBlock({ blockNumber: log.blockNumber! });

        await postTrade({
          type: 'buy',
          ethAmount: ethIn,
          tokenAmount: tokensOut,
          price,
          blockNumber: Number(log.blockNumber),
          timestamp: Number(block.timestamp) * 1000,
          transactionHash: log.transactionHash!,
        });
      }
    },
    onError: (error) => {
      console.error('[TokensPurchased] Error:', error);
    },
  });

  // Watch for TokensSold events
  const unwatch2 = client.watchEvent({
    address: ZKAMM_ADDRESS as `0x${string}`,
    event: TokensSoldEvent,
    onLogs: async (logs) => {
      for (const log of logs) {
        const tokensIn = formatUnits(log.args.tokensIn || 0n, 18);
        const ethOut = formatEther(log.args.ethOut || 0n);
        const price = (parseFloat(tokensIn) / parseFloat(ethOut)).toString();

        // Get block timestamp
        const block = await client.getBlock({ blockNumber: log.blockNumber! });

        await postTrade({
          type: 'sell',
          ethAmount: ethOut,
          tokenAmount: tokensIn,
          price,
          blockNumber: Number(log.blockNumber),
          timestamp: Number(block.timestamp) * 1000,
          transactionHash: log.transactionHash!,
        });
      }
    },
    onError: (error) => {
      console.error('[TokensSold] Error:', error);
    },
  });

  // Keep the process running
  process.on('SIGINT', () => {
    console.log('\nStopping event watcher...');
    unwatch1();
    unwatch2();
    process.exit(0);
  });

  // Heartbeat
  setInterval(() => {
    console.log(`[${new Date().toISOString()}] Heartbeat - still watching...`);
  }, 60000);
}

main().catch(console.error);
