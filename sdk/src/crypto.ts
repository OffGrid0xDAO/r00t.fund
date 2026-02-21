import { ethers } from 'ethers';

/**
 * Cryptographic utilities for note encryption/decryption
 * Uses ECDH for key exchange and AES-GCM for encryption
 */

// BN254 scalar field prime
export const FIELD_PRIME = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;

/**
 * Derive spending and viewing keys from a seed phrase
 */
export function deriveKeys(seedPhrase: string): {
  spendingKey: Uint8Array;
  viewingKey: Uint8Array;
  viewingPublicKey: string;
} {
  // Hash seed to get spending key
  const seedBytes = ethers.toUtf8Bytes(seedPhrase);
  const spendingKeyHash = ethers.keccak256(seedBytes);
  const spendingKey = ethers.getBytes(spendingKeyHash);

  // Derive viewing key from spending key
  const viewingKeyHash = ethers.keccak256(
    ethers.concat([spendingKeyHash, ethers.toUtf8Bytes('viewing')])
  );
  const viewingKey = ethers.getBytes(viewingKeyHash);

  // Get public key for receiving notes
  const wallet = new ethers.Wallet(viewingKeyHash);
  const viewingPublicKey = wallet.signingKey.compressedPublicKey;

  return { spendingKey, viewingKey, viewingPublicKey };
}

/**
 * Generate ephemeral keypair for note encryption
 */
export function generateEphemeralKeypair(): {
  privateKey: Uint8Array;
  publicKey: string;
} {
  const wallet = ethers.Wallet.createRandom();
  return {
    privateKey: ethers.getBytes(wallet.privateKey),
    publicKey: wallet.signingKey.compressedPublicKey,
  };
}

/**
 * Derive shared secret using ECDH
 */
export function deriveSharedSecret(
  privateKey: Uint8Array,
  publicKey: string
): Uint8Array {
  const wallet = new ethers.Wallet(ethers.hexlify(privateKey));

  // Compute ECDH shared secret
  // shared = privateKey * publicKey (EC point multiplication)
  const sharedPoint = wallet.signingKey.computeSharedSecret(publicKey);

  // Hash to get symmetric key
  const sharedSecret = ethers.getBytes(ethers.keccak256(sharedPoint));

  return sharedSecret.slice(0, 32); // 256-bit key for AES-256
}

/**
 * Encrypt note data (nullifier, secret, amount) for a recipient
 */
export async function encryptNote(
  nullifier: bigint,
  secret: bigint,
  amount: bigint,
  recipientPublicKey: string
): Promise<string> {
  // Generate ephemeral keypair
  const ephemeral = generateEphemeralKeypair();

  // Derive shared secret
  const sharedSecret = deriveSharedSecret(ephemeral.privateKey, recipientPublicKey);

  // Prepare plaintext: nullifier (32) + secret (32) + amount (32) = 96 bytes
  const plaintext = new Uint8Array(96);
  const nullifierBytes = bigintToBytes32(nullifier);
  const secretBytes = bigintToBytes32(secret);
  const amountBytes = bigintToBytes32(amount);

  plaintext.set(nullifierBytes, 0);
  plaintext.set(secretBytes, 32);
  plaintext.set(amountBytes, 64);

  // Generate random nonce (12 bytes for AES-GCM)
  const nonce = crypto.getRandomValues(new Uint8Array(12));

  // Encrypt using AES-GCM
  const key = await crypto.subtle.importKey(
    'raw',
    sharedSecret,
    { name: 'AES-GCM' },
    false,
    ['encrypt']
  );

  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonce },
    key,
    plaintext
  );

  // Format: ephemeralPubKey (33) + nonce (12) + ciphertext (96 + 16 tag) = 157 bytes
  const ephemeralPubKeyBytes = ethers.getBytes(ephemeral.publicKey);
  const result = new Uint8Array(33 + 12 + ciphertext.byteLength);
  result.set(ephemeralPubKeyBytes, 0);
  result.set(nonce, 33);
  result.set(new Uint8Array(ciphertext), 45);

  return ethers.hexlify(result);
}

/**
 * Decrypt note data using viewing key
 */
export async function decryptNote(
  encryptedNote: string,
  viewingKey: Uint8Array
): Promise<{ nullifier: bigint; secret: bigint; amount: bigint } | null> {
  try {
    const data = ethers.getBytes(encryptedNote);

    if (data.length < 157) {
      return null; // Invalid note length
    }

    // Parse components
    const ephemeralPubKey = ethers.hexlify(data.slice(0, 33));
    const nonce = data.slice(33, 45);
    const ciphertext = data.slice(45);

    // Derive shared secret
    const sharedSecret = deriveSharedSecret(viewingKey, ephemeralPubKey);

    // Decrypt using AES-GCM
    const key = await crypto.subtle.importKey(
      'raw',
      sharedSecret,
      { name: 'AES-GCM' },
      false,
      ['decrypt']
    );

    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: nonce },
      key,
      ciphertext
    );

    const plaintextBytes = new Uint8Array(plaintext);

    if (plaintextBytes.length !== 96) {
      return null;
    }

    return {
      nullifier: bytes32ToBigint(plaintextBytes.slice(0, 32)),
      secret: bytes32ToBigint(plaintextBytes.slice(32, 64)),
      amount: bytes32ToBigint(plaintextBytes.slice(64, 96)),
    };
  } catch {
    return null; // Decryption failed - note is not for us
  }
}

/**
 * Convert bigint to 32-byte array (big-endian)
 */
export function bigintToBytes32(value: bigint): Uint8Array {
  const hex = value.toString(16).padStart(64, '0');
  return ethers.getBytes('0x' + hex);
}

/**
 * Convert 32-byte array to bigint (big-endian)
 */
export function bytes32ToBigint(bytes: Uint8Array): bigint {
  return BigInt(ethers.hexlify(bytes));
}

/**
 * Generate a random field element (for nullifier/secret)
 */
export function randomFieldElement(): bigint {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let value = 0n;
  for (const byte of bytes) {
    value = (value << 8n) | BigInt(byte);
  }
  return value % FIELD_PRIME;
}
