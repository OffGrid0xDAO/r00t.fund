#!/usr/bin/env npx tsx
/**
 * Note Recovery via Decryption
 * Tries to decrypt all on-chain encrypted notes using derived viewing keys
 */

import { ethers } from 'ethers';
import { poseidon3 } from 'poseidon-lite';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import * as crypto from 'crypto';

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
  PRIVATE_KEY: process.env.PRIVATE_KEY!,
  INDEXER: 'https://ponder-indexer-production-50c3.up.railway.app',
  PAIR: '0xdacF977d96840748EB5624508BF98fc5E8CC84E1',
};

// Crypto helpers
function bigintToBytes32(value: bigint): Uint8Array {
  const hex = value.toString(16).padStart(64, '0');
  return ethers.getBytes('0x' + hex);
}

function bytes32ToBigint(bytes: Uint8Array): bigint {
  return BigInt(ethers.hexlify(bytes));
}

function deriveSharedSecret(privateKey: Uint8Array, publicKey: string): Uint8Array {
  const wallet = new ethers.Wallet(ethers.hexlify(privateKey));
  const sharedPoint = wallet.signingKey.computeSharedSecret(publicKey);
  const sharedSecret = ethers.getBytes(ethers.keccak256(sharedPoint));
  return sharedSecret.slice(0, 32);
}

async function decryptNote(
  encryptedNote: string,
  viewingKey: Uint8Array
): Promise<{ nullifier: bigint; secret: bigint; amount: bigint } | null> {
  try {
    const data = ethers.getBytes(encryptedNote);

    if (data.length < 157) {
      return null;
    }

    const ephemeralPubKey = ethers.hexlify(data.slice(0, 33));
    const nonce = data.slice(33, 45);
    const ciphertext = data.slice(45);

    const sharedSecret = deriveSharedSecret(viewingKey, ephemeralPubKey);

    // Use Node.js crypto for AES-GCM
    const decipher = crypto.createDecipheriv('aes-256-gcm', sharedSecret, nonce);

    // GCM tag is last 16 bytes
    const tag = ciphertext.slice(ciphertext.length - 16);
    const encrypted = ciphertext.slice(0, ciphertext.length - 16);

    decipher.setAuthTag(tag);

    const decrypted = Buffer.concat([
      decipher.update(encrypted),
      decipher.final()
    ]);

    if (decrypted.length !== 96) {
      return null;
    }

    return {
      nullifier: bytes32ToBigint(new Uint8Array(decrypted.slice(0, 32))),
      secret: bytes32ToBigint(new Uint8Array(decrypted.slice(32, 64))),
      amount: bytes32ToBigint(new Uint8Array(decrypted.slice(64, 96))),
    };
  } catch {
    return null;
  }
}

// Derive viewing keys from various sources
function deriveViewingKeys(privateKey: string): Uint8Array[] {
  const keys: Uint8Array[] = [];

  // Method 1: Direct from private key
  keys.push(ethers.getBytes(privateKey));

  // Method 2: keccak256(privateKey + "viewing")
  const viewingKeyHash = ethers.keccak256(
    ethers.concat([privateKey, ethers.toUtf8Bytes('viewing')])
  );
  keys.push(ethers.getBytes(viewingKeyHash));

  // Method 3: keccak256(keccak256(privateKey) + "viewing") - SDK style
  const spendingKeyHash = ethers.keccak256(privateKey);
  const viewingKeyHash2 = ethers.keccak256(
    ethers.concat([spendingKeyHash, ethers.toUtf8Bytes('viewing')])
  );
  keys.push(ethers.getBytes(viewingKeyHash2));

  // Method 4: Derived agent keys
  for (let i = 0; i <= 5; i++) {
    const dk = ethers.keccak256(ethers.solidityPacked(['bytes32', 'uint256'], [privateKey, i]));
    keys.push(ethers.getBytes(dk));

    // Also try viewing derivation from agent key
    const viewingFromAgent = ethers.keccak256(
      ethers.concat([dk, ethers.toUtf8Bytes('viewing')])
    );
    keys.push(ethers.getBytes(viewingFromAgent));
  }

  return keys;
}

interface Commitment {
  commitment: string;
  leafIndex: number;
  encryptedNote: string;
  blockNumber: number;
}

async function fetchCommitmentsWithNotes(): Promise<Commitment[]> {
  const all: Commitment[] = [];
  let cursor: string | null = null;
  const addr = CONFIG.PAIR.toLowerCase();

  console.log('Fetching commitments with encrypted notes...');

  for (let page = 0; page < 20; page++) {
    const afterClause = cursor ? `,after:"${cursor}"` : '';
    const resp = await fetch(`${CONFIG.INDEXER}/graphql`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: `{commitmentss(limit:1000,where:{address:"${addr}"}${afterClause}){pageInfo{endCursor hasNextPage}items{leafIndex commitment encryptedNote blockNumber}}}`
      }),
    });

    const j = await resp.json() as any;
    const items = j.data?.commitmentss?.items;
    if (!items) break;

    for (const it of items) {
      if (it.encryptedNote && it.encryptedNote !== '0x') {
        all.push({
          commitment: it.commitment,
          leafIndex: Number(it.leafIndex),
          encryptedNote: it.encryptedNote,
          blockNumber: Number(it.blockNumber),
        });
      }
    }

    const pageInfo = j.data?.commitmentss?.pageInfo;
    if (!pageInfo?.hasNextPage) break;
    cursor = pageInfo.endCursor;
    process.stdout.write(`\r  Page ${page + 1}: ${all.length} notes with encrypted data`);
  }

  console.log(`\n  Total: ${all.length} encrypted notes\n`);
  return all;
}

async function fetchSpentNullifiers(): Promise<Set<string>> {
  const spent = new Set<string>();
  let cursor: string | null = null;

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
      spent.add(it.id);
    }

    const pageInfo = j.data?.nullifierss?.pageInfo;
    if (!pageInfo?.hasNextPage) break;
    cursor = pageInfo.endCursor;
  }

  return spent;
}

async function main() {
  console.log('\n=== NOTE RECOVERY VIA DECRYPTION ===\n');

  const deployerWallet = new ethers.Wallet(CONFIG.PRIVATE_KEY);
  console.log('Deployer:', deployerWallet.address);

  // Get all possible viewing keys
  const viewingKeys = deriveViewingKeys(CONFIG.PRIVATE_KEY);
  console.log(`Generated ${viewingKeys.length} possible viewing keys to try\n`);

  // Fetch encrypted notes
  const commitments = await fetchCommitmentsWithNotes();

  if (commitments.length === 0) {
    console.log('No encrypted notes found!');
    return;
  }

  // Fetch spent nullifiers
  console.log('Fetching spent nullifiers...');
  const spentNullifiers = await fetchSpentNullifiers();
  console.log(`  Total: ${spentNullifiers.size} spent\n`);

  // Try to decrypt each note with each key
  console.log('Attempting decryption...\n');

  const recoveredNotes: any[] = [];
  let processed = 0;

  for (const comm of commitments) {
    processed++;
    if (processed % 100 === 0) {
      process.stdout.write(`\rProcessed ${processed}/${commitments.length} (recovered: ${recoveredNotes.length})`);
    }

    for (const viewingKey of viewingKeys) {
      const decrypted = await decryptNote(comm.encryptedNote, viewingKey);

      if (decrypted) {
        // Verify commitment matches
        const computed = poseidon3([decrypted.nullifier, decrypted.secret, decrypted.amount]);

        if (computed.toString() === comm.commitment) {
          // Check if spent
          const FIELD_PRIME = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
          const { poseidon2 } = await import('poseidon-lite');
          const nullifierHash = poseidon2([decrypted.nullifier, BigInt(comm.leafIndex)]);
          const isSpent = spentNullifiers.has(nullifierHash.toString());

          recoveredNotes.push({
            commitment: comm.commitment,
            leafIndex: comm.leafIndex,
            nullifier: decrypted.nullifier.toString(),
            secret: decrypted.secret.toString(),
            amount: decrypted.amount.toString(),
            amountFormatted: (Number(decrypted.amount) / 1e18).toFixed(4),
            spent: isSpent,
            blockNumber: comm.blockNumber,
          });

          const status = isSpent ? '(SPENT)' : '✓ UNSPENT';
          console.log(`\n  Recovered: ${(Number(decrypted.amount) / 1e18).toFixed(2)} ROOT at leaf ${comm.leafIndex} ${status}`);

          break; // Found the key, move to next note
        }
      }
    }
  }

  console.log(`\n\n=== RECOVERY COMPLETE ===`);
  console.log(`Total recovered: ${recoveredNotes.length}`);

  const unspent = recoveredNotes.filter(n => !n.spent);
  const unspentTotal = unspent.reduce((s, n) => s + BigInt(n.amount), 0n);

  console.log(`Unspent notes: ${unspent.length}`);
  console.log(`Unspent value: ${(Number(unspentTotal) / 1e18).toFixed(4)} ROOT`);

  // Save
  const outputFile = path.join(__dirname, '.recovered-notes-decrypt.json');
  fs.writeFileSync(outputFile, JSON.stringify(recoveredNotes, null, 2));
  console.log(`\nSaved to: ${outputFile}`);

  if (unspent.length > 0) {
    console.log('\n=== UNSPENT NOTES ===');
    for (const n of unspent) {
      console.log(`  Leaf ${n.leafIndex}: ${n.amountFormatted} ROOT`);
    }
  }
}

main().catch(console.error);
