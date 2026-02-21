#!/usr/bin/env npx tsx
/**
 * Note Recovery via Frontend Key Derivation
 * Signs the same message the frontend uses to derive viewing keys
 * Then attempts to decrypt encrypted notes from the chain
 */

import { ethers, Wallet } from 'ethers';
import { poseidon2, poseidon3 } from 'poseidon-lite';
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

// The EXACT message used in the frontend (from SwapPanel.tsx)
const SIGN_MESSAGE = `Sign this message to access your r00t.fund private balance.

This signature is used to derive your viewing key locally.
It never leaves your browser.`;

// Crypto helpers
function deriveSharedSecret(privateKey: Uint8Array, publicKey: string): Uint8Array {
  const wallet = new Wallet(ethers.hexlify(privateKey));
  const sharedPoint = wallet.signingKey.computeSharedSecret(publicKey);
  const sharedSecret = ethers.getBytes(ethers.keccak256(sharedPoint));
  return sharedSecret.slice(0, 32);
}

function bytes32ToBigint(bytes: Uint8Array): bigint {
  return BigInt(ethers.hexlify(bytes));
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

    const decipher = crypto.createDecipheriv('aes-256-gcm', sharedSecret, nonce);
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

// Derive viewing keys using the FRONTEND method
async function deriveFrontendViewingKeys(privateKey: string): Promise<{ key: Uint8Array; name: string; pubKey: string }[]> {
  const wallet = new Wallet(privateKey);
  const keys: { key: Uint8Array; name: string; pubKey: string }[] = [];

  console.log('Deriving viewing keys using frontend method...\n');
  console.log('Deployer address:', wallet.address);

  // Method 1: Sign the frontend message and derive key
  // This is what happens when a user clicks "unlock" in the frontend
  const signature = await wallet.signMessage(SIGN_MESSAGE);
  console.log('Signature:', signature.slice(0, 40) + '...');

  // Frontend derivation: viewingKey = keccak256(signature)
  const viewingKey = ethers.keccak256(ethers.toUtf8Bytes(signature));
  console.log('viewingKey (keccak256 of signature):', viewingKey);

  const vkWallet = new Wallet(viewingKey);
  const pubKey1 = vkWallet.signingKey.compressedPublicKey;
  console.log('Derived pubKey:', pubKey1);

  keys.push({
    key: ethers.getBytes(viewingKey),
    name: 'frontend_direct',
    pubKey: pubKey1,
  });

  // Method 2: Alternative - seedPhrase = signature itself (as raw hex)
  const viewingKey2 = ethers.keccak256(
    ethers.concat([ethers.keccak256(ethers.toUtf8Bytes(signature)), ethers.toUtf8Bytes('viewing')])
  );
  const vkWallet2 = new Wallet(viewingKey2);
  const pubKey2 = vkWallet2.signingKey.compressedPublicKey;
  console.log('Alt viewingKey2:', viewingKey2);
  console.log('Alt pubKey2:', pubKey2);

  keys.push({
    key: ethers.getBytes(viewingKey2),
    name: 'frontend_with_viewing_suffix',
    pubKey: pubKey2,
  });

  // Method 3: seedPhrase = signature bytes, then viewingKeyHash
  const seedBytes = ethers.getBytes(signature);
  const seedHash = ethers.keccak256(seedBytes);
  const viewingKey3 = ethers.keccak256(
    ethers.concat([seedHash, ethers.toUtf8Bytes('viewing')])
  );
  const vkWallet3 = new Wallet(viewingKey3);
  const pubKey3 = vkWallet3.signingKey.compressedPublicKey;
  console.log('Alt viewingKey3:', viewingKey3);
  console.log('Alt pubKey3:', pubKey3);

  keys.push({
    key: ethers.getBytes(viewingKey3),
    name: 'frontend_bytes_viewing',
    pubKey: pubKey3,
  });

  // Method 4: The raw private key as viewing key
  const rawPkWallet = new Wallet(privateKey);
  const pubKey4 = rawPkWallet.signingKey.compressedPublicKey;
  console.log('Raw PK pubKey:', pubKey4);

  keys.push({
    key: ethers.getBytes(privateKey),
    name: 'raw_private_key',
    pubKey: pubKey4,
  });

  // Check which pubKey matches the target
  const TARGET_PUBKEY = '0x03e464d7877c34fb4a0bdfe1dcc54330b4e7488128f5a2f4debc3e33559d89819e';
  console.log('\n--- Checking against target pubKey ---');
  console.log('Target:', TARGET_PUBKEY);

  for (const k of keys) {
    const match = k.pubKey.toLowerCase() === TARGET_PUBKEY.toLowerCase();
    console.log(`${k.name}: ${k.pubKey} ${match ? '✓ MATCH!' : ''}`);
  }

  return keys;
}

async function main() {
  console.log('\n=== NOTE RECOVERY VIA FRONTEND SIGNATURE ===\n');

  // Get viewing keys derived from frontend signing flow
  const viewingKeys = await deriveFrontendViewingKeys(CONFIG.PRIVATE_KEY);

  console.log(`\nGenerated ${viewingKeys.length} viewing key variations to try\n`);

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
    if (processed % 10 === 0) {
      process.stdout.write(`\rProcessed ${processed}/${commitments.length} (recovered: ${recoveredNotes.length})`);
    }

    for (const { key: viewingKey, name, pubKey } of viewingKeys) {
      const decrypted = await decryptNote(comm.encryptedNote, viewingKey);

      if (decrypted) {
        // Verify commitment matches
        const computed = poseidon3([decrypted.nullifier, decrypted.secret, decrypted.amount]);

        if (computed.toString() === comm.commitment) {
          // Check if spent
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
            recoveredWith: name,
            viewingPubKey: pubKey,
          });

          const status = isSpent ? '(SPENT)' : '✓ UNSPENT';
          console.log(`\n  RECOVERED: ${(Number(decrypted.amount) / 1e18).toFixed(2)} ROOT at leaf ${comm.leafIndex} ${status} [${name}]`);

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
  const outputFile = path.join(__dirname, '.recovered-notes-frontend.json');
  fs.writeFileSync(outputFile, JSON.stringify(recoveredNotes, null, 2));
  console.log(`\nSaved to: ${outputFile}`);

  if (unspent.length > 0) {
    console.log('\n=== UNSPENT NOTES ===');
    for (const n of unspent) {
      console.log(`  Leaf ${n.leafIndex}: ${n.amountFormatted} ROOT (recovered via ${n.recoveredWith})`);
    }
  }
}

main().catch(console.error);
