import { ethers } from 'ethers';
import type { OwnedCommitment, NewCommitmentEvent, NullifierSpentEvent, EncryptedNote, DecryptedNote } from './types';
import { hashCommitment, hashNullifier } from './poseidon';
import { MerkleTree } from './merkle';

// ZkAMM contract events ABI
const ZKAMM_EVENTS_ABI = [
  'event NewCommitment(uint256 indexed commitment, uint256 indexed leafIndex, bytes encryptedNote)',
  'event NullifierSpent(uint256 indexed nullifierHash)',
];

/**
 * Blockchain scanner for tracking private token commitments
 */
export class CommitmentScanner {
  private provider: ethers.Provider;
  private zkAMMAddress: string;
  private zkAMMContract: ethers.Contract;

  // Local state
  private merkleTree: MerkleTree;
  private ownedCommitments: Map<bigint, OwnedCommitment>;
  private spentNullifiers: Set<string>;
  private lastScannedBlock: number;

  // User's viewing keys (derived from seed)
  private viewingKey: Uint8Array;

  constructor(config: {
    provider: ethers.Provider;
    zkAMMAddress: string;
    viewingKey: Uint8Array;
  }) {
    this.provider = config.provider;
    this.zkAMMAddress = config.zkAMMAddress;
    this.viewingKey = config.viewingKey;

    this.zkAMMContract = new ethers.Contract(
      config.zkAMMAddress,
      ZKAMM_EVENTS_ABI,
      config.provider
    );

    this.merkleTree = new MerkleTree();
    this.ownedCommitments = new Map();
    this.spentNullifiers = new Set();
    this.lastScannedBlock = 0;
  }

  /**
   * Scan blockchain for new commitments and spent nullifiers
   */
  async scan(fromBlock?: number): Promise<{
    newCommitments: OwnedCommitment[];
    spentCommitments: OwnedCommitment[];
  }> {
    const startBlock = fromBlock ?? this.lastScannedBlock + 1;
    const currentBlock = await this.provider.getBlockNumber();

    if (startBlock > currentBlock) {
      return { newCommitments: [], spentCommitments: [] };
    }

    // Scan in chunks to avoid RPC limits
    const CHUNK_SIZE = 10000;
    const newCommitments: OwnedCommitment[] = [];
    const spentCommitments: OwnedCommitment[] = [];

    for (let from = startBlock; from <= currentBlock; from += CHUNK_SIZE) {
      const to = Math.min(from + CHUNK_SIZE - 1, currentBlock);

      // Fetch NewCommitment events
      const commitmentEvents = await this.fetchCommitmentEvents(from, to);
      for (const event of commitmentEvents) {
        await this.processCommitmentEvent(event, newCommitments);
      }

      // Fetch NullifierSpent events
      const nullifierEvents = await this.fetchNullifierEvents(from, to);
      for (const event of nullifierEvents) {
        this.processNullifierEvent(event, spentCommitments);
      }
    }

    this.lastScannedBlock = currentBlock;

    return { newCommitments, spentCommitments };
  }

  /**
   * Fetch NewCommitment events
   */
  private async fetchCommitmentEvents(fromBlock: number, toBlock: number): Promise<NewCommitmentEvent[]> {
    const filter = this.zkAMMContract.filters.NewCommitment();
    const logs = await this.zkAMMContract.queryFilter(filter, fromBlock, toBlock);

    return logs.map((log) => {
      const parsed = this.zkAMMContract.interface.parseLog({
        topics: log.topics as string[],
        data: log.data,
      });

      if (!parsed) throw new Error('Failed to parse NewCommitment event');

      return {
        commitment: BigInt(parsed.args[0]),
        leafIndex: Number(parsed.args[1]),
        encryptedNote: parsed.args[2] as string,
        blockNumber: log.blockNumber,
        transactionHash: log.transactionHash,
      };
    });
  }

  /**
   * Fetch NullifierSpent events
   */
  private async fetchNullifierEvents(fromBlock: number, toBlock: number): Promise<NullifierSpentEvent[]> {
    const filter = this.zkAMMContract.filters.NullifierSpent();
    const logs = await this.zkAMMContract.queryFilter(filter, fromBlock, toBlock);

    return logs.map((log) => {
      const parsed = this.zkAMMContract.interface.parseLog({
        topics: log.topics as string[],
        data: log.data,
      });

      if (!parsed) throw new Error('Failed to parse NullifierSpent event');

      return {
        nullifierHash: BigInt(parsed.args[0]),
        blockNumber: log.blockNumber,
        transactionHash: log.transactionHash,
      };
    });
  }

  /**
   * Process a NewCommitment event
   */
  private async processCommitmentEvent(
    event: NewCommitmentEvent,
    newCommitments: OwnedCommitment[]
  ): Promise<void> {
    // Add to merkle tree
    this.merkleTree.insert(event.commitment);

    // Try to decrypt the note
    const decrypted = this.tryDecryptNote(event.encryptedNote);
    if (!decrypted) return;

    // Verify the commitment matches
    const expectedCommitment = hashCommitment(
      decrypted.nullifier,
      decrypted.secret,
      decrypted.amount
    );

    if (expectedCommitment !== event.commitment) {
      console.warn('Commitment mismatch after decryption');
      return;
    }

    // This is our commitment!
    const ownedCommitment: OwnedCommitment = {
      nullifier: decrypted.nullifier,
      secret: decrypted.secret,
      amount: decrypted.amount,
      commitment: event.commitment,
      leafIndex: event.leafIndex,
      blockNumber: event.blockNumber,
      spent: false,
    };

    this.ownedCommitments.set(event.commitment, ownedCommitment);
    newCommitments.push(ownedCommitment);
  }

  /**
   * Process a NullifierSpent event
   */
  private processNullifierEvent(
    event: NullifierSpentEvent,
    spentCommitments: OwnedCommitment[]
  ): void {
    this.spentNullifiers.add(event.nullifierHash.toString());

    // Check if any of our commitments were spent
    for (const [_, commitment] of this.ownedCommitments) {
      if (commitment.spent) continue;

      const nullifierHash = hashNullifier(commitment.nullifier, commitment.leafIndex);
      if (nullifierHash === event.nullifierHash) {
        commitment.spent = true;
        commitment.nullifierHash = nullifierHash;
        spentCommitments.push(commitment);
      }
    }
  }

  /**
   * Try to decrypt an encrypted note with our viewing key
   */
  private tryDecryptNote(encryptedNoteHex: string): DecryptedNote | null {
    try {
      const noteBytes = ethers.getBytes(encryptedNoteHex);
      if (noteBytes.length === 0) return null;

      // Parse encrypted note structure
      const parsed = this.parseEncryptedNote(noteBytes);
      if (!parsed) return null;

      // Derive shared secret using ECDH
      const sharedSecret = this.deriveSharedSecret(parsed.ephemeralPublicKey);

      // Decrypt using ChaCha20-Poly1305 or AES-GCM
      const decrypted = this.decrypt(parsed.ciphertext, sharedSecret, parsed.nonce);
      if (!decrypted) return null;

      // Parse decrypted data: [nullifier (32), secret (32), amount (32)]
      if (decrypted.length !== 96) return null;

      return {
        nullifier: this.bytesToBigInt(decrypted.slice(0, 32)),
        secret: this.bytesToBigInt(decrypted.slice(32, 64)),
        amount: this.bytesToBigInt(decrypted.slice(64, 96)),
      };
    } catch {
      return null;
    }
  }

  /**
   * Parse encrypted note structure
   */
  private parseEncryptedNote(data: Uint8Array): EncryptedNote | null {
    // Format: ephemeralPubKey (33) + nonce (12) + ciphertext (96 + 16 tag)
    if (data.length < 33 + 12 + 96 + 16) return null;

    return {
      ephemeralPublicKey: ethers.hexlify(data.slice(0, 33)),
      nonce: ethers.hexlify(data.slice(33, 45)),
      ciphertext: ethers.hexlify(data.slice(45)),
    };
  }

  /**
   * Derive shared secret using ECDH
   */
  private deriveSharedSecret(_ephemeralPublicKey: string): Uint8Array {
    // TODO: Implement ECDH with secp256k1
    // sharedSecret = ECDH(viewingKey, ephemeralPublicKey)
    // For now, return a placeholder
    return new Uint8Array(32);
  }

  /**
   * Decrypt ciphertext using shared secret
   */
  private decrypt(
    _ciphertext: string,
    _sharedSecret: Uint8Array,
    _nonce: string
  ): Uint8Array | null {
    // TODO: Implement AES-GCM or ChaCha20-Poly1305 decryption
    // For now, return null (no notes will be decrypted)
    return null;
  }

  /**
   * Convert bytes to bigint
   */
  private bytesToBigInt(bytes: Uint8Array): bigint {
    let value = 0n;
    for (const byte of bytes) {
      value = (value << 8n) | BigInt(byte);
    }
    return value;
  }

  /**
   * Get all unspent owned commitments
   */
  getUnspentCommitments(): OwnedCommitment[] {
    return Array.from(this.ownedCommitments.values()).filter((c) => !c.spent);
  }

  /**
   * Get total private balance
   */
  getBalance(): bigint {
    return this.getUnspentCommitments().reduce((sum, c) => sum + c.amount, 0n);
  }

  /**
   * Get merkle proof for a commitment
   */
  getMerkleProof(leafIndex: number) {
    return this.merkleTree.getProof(leafIndex);
  }

  /**
   * Get current merkle root
   */
  getMerkleRoot(): bigint {
    return this.merkleTree.getRoot();
  }

  /**
   * Check if a nullifier has been spent
   */
  isNullifierSpent(nullifierHash: bigint): boolean {
    return this.spentNullifiers.has(nullifierHash.toString());
  }
}
