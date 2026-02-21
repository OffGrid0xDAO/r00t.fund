#!/usr/bin/env npx tsx
/**
 * Note Recovery Script
 * Scans the chain for buy transactions and recovers missing notes
 */

import { ethers, Wallet } from 'ethers';
import { poseidon2, poseidon3 } from 'poseidon-lite';
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

const CONFIG = {
  RPC_URL: process.env.SEPOLIA_RPC_URL || 'https://sepolia.drpc.org',
  ROUTER: '0xd1b972eb47626B67Fe700ee9F3Ab4Fe76751b630',
  PAIR: '0xdacF977d96840748EB5624508BF98fc5E8CC84E1',
  PRIVATE_KEY: process.env.PRIVATE_KEY!,
  INDEXER: 'https://ponder-indexer-production-50c3.up.railway.app',
};

const FIELD_PRIME = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;

// Crypto helpers (same as r00t-cli.ts)
const deriveNull = (pk: string, i: number): bigint =>
  BigInt(ethers.keccak256(ethers.solidityPacked(['bytes32', 'string', 'uint256'], [pk, 'nullifier', i]))) % FIELD_PRIME;

const deriveSec = (pk: string, i: number): bigint =>
  BigInt(ethers.keccak256(ethers.solidityPacked(['bytes32', 'string', 'uint256'], [pk, 'secret', i]))) % FIELD_PRIME;

const hashComm = (n: bigint, s: bigint, a: bigint): bigint => poseidon3([n, s, a]);
const hashNull = (n: bigint, i: number): bigint => poseidon2([n, BigInt(i)]);

interface Note {
  commitment: string;
  nullifier: string;
  secret: string;
  amount: string;
  leafIndex: number;
  spent: boolean;
  recoveredAt?: string;
  txHash?: string;
}

interface Commitment {
  commitment: string;
  leafIndex: number;
  blockNumber: number;
  transactionHash: string;
}

async function fetchAllCommitments(): Promise<Commitment[]> {
  const all: Commitment[] = [];
  let cursor: string | null = null;
  const addr = CONFIG.PAIR.toLowerCase();

  console.log('Fetching commitments from indexer...');

  for (let page = 0; page < 20; page++) {
    const afterClause = cursor ? `,after:"${cursor}"` : '';
    const resp = await fetch(`${CONFIG.INDEXER}/graphql`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: `{commitmentss(limit:1000,where:{address:"${addr}"}${afterClause}){pageInfo{endCursor hasNextPage}items{leafIndex commitment blockNumber transactionHash}}}`
      }),
    });

    const j = await resp.json() as any;
    const items = j.data?.commitmentss?.items;
    if (!items) break;

    for (const it of items) {
      all.push({
        commitment: it.commitment,
        leafIndex: Number(it.leafIndex),
        blockNumber: Number(it.blockNumber),
        transactionHash: it.transactionHash,
      });
    }

    const pageInfo = j.data?.commitmentss?.pageInfo;
    if (!pageInfo?.hasNextPage) break;
    cursor = pageInfo.endCursor;
    process.stdout.write(`\r  Page ${page + 1}: ${all.length} commitments`);
  }

  console.log(`\n  Total: ${all.length} commitments\n`);
  return all;
}

async function fetchSpentNullifiers(): Promise<Set<string>> {
  const spent = new Set<string>();
  let cursor: string | null = null;

  console.log('Fetching spent nullifiers...');

  for (let page = 0; page < 50; page++) {
    const afterClause = cursor ? `,after:"${cursor}"` : '';
    const resp = await fetch(`${CONFIG.INDEXER}/graphql`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: `{nullifierss(limit:1000${afterClause}){pageInfo{endCursor hasNextPage}items{id}}}`
      }),
    });

    const j = await resp.json() as any;
    const items = j.data?.nullifierss?.items;
    if (!items) break;

    for (const it of items) {
      spent.add(it.id); // id IS the nullifier hash
    }

    const pageInfo = j.data?.nullifierss?.pageInfo;
    if (!pageInfo?.hasNextPage) break;
    cursor = pageInfo.endCursor;
    process.stdout.write(`\r  Page ${page + 1}: ${spent.size} nullifiers`);
  }

  console.log(`\n  Total: ${spent.size} spent nullifiers\n`);
  return spent;
}

async function getBuyTxsFromWallet(provider: ethers.Provider, walletAddress: string, fromBlock: number): Promise<any[]> {
  const routerABI = [
    'event NewCommitment(uint256 indexed commitment, uint256 indexed leafIndex, bytes encryptedNote)',
    'event TokensPurchased(uint256 ethIn, uint256 tokensOut, uint256 newEthReserve, uint256 newTokenReserve)',
  ];

  const router = new ethers.Contract(CONFIG.ROUTER, routerABI, provider);

  // Get all NewCommitment events
  const filter = router.filters.NewCommitment();
  const events = await router.queryFilter(filter, fromBlock);

  return events;
}

async function main() {
  console.log('\n=== NOTE RECOVERY TOOL ===\n');

  const provider = new ethers.JsonRpcProvider(CONFIG.RPC_URL);
  const deployerWallet = new Wallet(CONFIG.PRIVATE_KEY, provider);

  console.log('Deployer wallet:', deployerWallet.address);
  console.log('');

  // Fetch all commitments and nullifiers
  const commitments = await fetchAllCommitments();
  const spentNullifiers = await fetchSpentNullifiers();

  // Create a map of commitment -> details
  const commMap = new Map<string, Commitment>();
  for (const c of commitments) {
    commMap.set(c.commitment, c);
  }

  // Get all derived wallet addresses
  const wallets: { address: string; pk: string; name: string }[] = [
    { address: deployerWallet.address, pk: CONFIG.PRIVATE_KEY, name: 'Deployer' }
  ];

  // Add agent wallets
  for (let i = 1; i <= 33; i++) {
    const dk = ethers.keccak256(ethers.solidityPacked(['bytes32', 'uint256'], [CONFIG.PRIVATE_KEY, i]));
    const w = new Wallet(dk);
    wallets.push({ address: w.address, pk: dk, name: `Agent#${i}` });
  }

  console.log('Scanning for recoverable notes...\n');

  const recoveredNotes: Note[] = [];
  const MAX_INDEX = 1000; // Try up to 1000 buy indices per wallet

  // For each wallet, try to find matching commitments
  for (const wallet of wallets) {
    let found = 0;

    for (let buyIndex = 0; buyIndex < MAX_INDEX; buyIndex++) {
      const nullifier = deriveNull(wallet.pk, buyIndex);
      const secret = deriveSec(wallet.pk, buyIndex);

      // Try different token amounts to find matching commitment
      // We'll check against all known commitments
      for (const [commStr, commDetails] of commMap) {
        // For each commitment, we need to figure out what amount would produce it
        // This is computationally expensive, so we'll use a different approach:
        // Get the token amount from the transaction logs

        // Skip if already recovered
        if (recoveredNotes.some(n => n.commitment === commStr)) continue;

        // We need to fetch the tx to get the actual token amount
        // For efficiency, let's just try common amounts or get from tx
      }
    }
  }

  // Alternative approach: Get buy transactions and extract amounts
  console.log('Fetching buy transactions from chain...\n');

  const routerABI = [
    'event NewCommitment(uint256 indexed commitment, uint256 indexed leafIndex, bytes encryptedNote)',
    'event TokensPurchased(uint256 ethIn, uint256 tokensOut, uint256 newEthReserve, uint256 newTokenReserve)',
  ];
  const routerIface = new ethers.Interface(routerABI);

  // Process each commitment's transaction
  let processed = 0;
  let recovered = 0;

  for (const comm of commitments) {
    processed++;
    if (processed % 100 === 0) {
      process.stdout.write(`\rProcessing ${processed}/${commitments.length} (recovered: ${recovered})`);
    }

    try {
      const receipt = await provider.getTransactionReceipt(comm.transactionHash);
      if (!receipt) continue;

      const tx = await provider.getTransaction(comm.transactionHash);
      if (!tx) continue;

      // Check if tx is from one of our wallets
      const wallet = wallets.find(w => w.address.toLowerCase() === tx.from.toLowerCase());
      if (!wallet) continue;

      // Get token amount from TokensPurchased event
      let tokenAmount: bigint | null = null;
      for (const log of receipt.logs) {
        try {
          const parsed = routerIface.parseLog({ topics: log.topics as string[], data: log.data });
          if (parsed?.name === 'TokensPurchased') {
            tokenAmount = parsed.args[1];
            break;
          }
        } catch {}
      }

      if (!tokenAmount) continue;

      // Try to find the matching index
      for (let buyIndex = 0; buyIndex < 500; buyIndex++) {
        const nullifier = deriveNull(wallet.pk, buyIndex);
        const secret = deriveSec(wallet.pk, buyIndex);
        const computedComm = hashComm(nullifier, secret, tokenAmount);

        if (computedComm.toString() === comm.commitment) {
          // Found it!
          const nullifierHash = hashNull(nullifier, comm.leafIndex);
          const isSpent = spentNullifiers.has(nullifierHash.toString());

          recoveredNotes.push({
            commitment: comm.commitment,
            nullifier: nullifier.toString(),
            secret: secret.toString(),
            amount: tokenAmount.toString(),
            leafIndex: comm.leafIndex,
            spent: isSpent,
            recoveredAt: new Date().toISOString(),
            txHash: comm.transactionHash,
          });

          recovered++;

          if (!isSpent) {
            console.log(`\n  ✓ RECOVERED UNSPENT: ${wallet.name} - ${(Number(tokenAmount) / 1e18).toFixed(2)} ROOT (index ${comm.leafIndex})`);
          }

          break;
        }
      }
    } catch (err) {
      // Skip errors silently
    }
  }

  console.log(`\n\nRecovery complete!`);
  console.log(`  Total recovered: ${recoveredNotes.length}`);
  console.log(`  Unspent notes: ${recoveredNotes.filter(n => !n.spent).length}`);

  // Calculate total unspent value
  const unspentValue = recoveredNotes
    .filter(n => !n.spent)
    .reduce((sum, n) => sum + BigInt(n.amount), 0n);
  console.log(`  Unspent value: ${(Number(unspentValue) / 1e18).toFixed(4)} ROOT`);

  // Save recovered notes
  const outputFile = path.join(__dirname, '.recovered-notes.json');
  fs.writeFileSync(outputFile, JSON.stringify(recoveredNotes, null, 2));
  console.log(`\nSaved to: ${outputFile}`);

  // Also show unspent notes
  console.log('\n=== UNSPENT NOTES ===\n');
  const unspentNotes = recoveredNotes.filter(n => !n.spent);
  if (unspentNotes.length === 0) {
    console.log('No unspent notes found.');
  } else {
    for (const note of unspentNotes) {
      console.log(`Leaf ${note.leafIndex}: ${(Number(note.amount) / 1e18).toFixed(4)} ROOT`);
    }
  }
}

main().catch(console.error);
