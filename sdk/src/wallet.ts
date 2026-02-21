import { ethers } from 'ethers';
import type { OwnedCommitment } from './types';
import { deriveKeys, decryptNote, encryptNote, randomFieldElement } from './crypto';
import { hashCommitment, hashNullifier } from './poseidon';
import { MerkleTree } from './merkle';

const ZKAMM_ABI = [
  'event NewCommitment(uint256 indexed commitment, uint256 indexed leafIndex, bytes encryptedNote)',
  'event NullifierSpent(uint256 indexed nullifierHash)',
  'function tokenPool() view returns (address)',
];

const TOKEN_POOL_ABI = [
  'function root() view returns (uint256)',
  'function nextIndex() view returns (uint256)',
  'function isKnownRoot(uint256 _root) view returns (bool)',
];

/**
 * Private wallet for managing ZK-AMM token commitments
 * Only the wallet owner can see their balance
 */
export class PrivateWallet {
  private provider: ethers.Provider;
  private zkAMMAddress: string;
  private zkAMMContract: ethers.Contract;

  // Keys derived from seed
  private spendingKey: Uint8Array;
  private viewingKey: Uint8Array;
  private viewingPublicKey: string;

  // Local state
  private merkleTree: MerkleTree;
  private commitments: Map<string, OwnedCommitment> = new Map();
  private spentNullifiers: Set<string> = new Set();
  private lastScannedBlock: number = 0;

  constructor(
    provider: ethers.Provider,
    zkAMMAddress: string,
    seedPhrase: string
  ) {
    this.provider = provider;
    this.zkAMMAddress = zkAMMAddress;
    this.zkAMMContract = new ethers.Contract(zkAMMAddress, ZKAMM_ABI, provider);
    this.merkleTree = new MerkleTree();

    // Derive keys from seed
    const keys = deriveKeys(seedPhrase);
    this.spendingKey = keys.spendingKey;
    this.viewingKey = keys.viewingKey;
    this.viewingPublicKey = keys.viewingPublicKey;
  }

  /**
   * Get the public key for receiving transfers
   */
  getPublicKey(): string {
    return this.viewingPublicKey;
  }

  /**
   * Get total private balance (sum of unspent commitments)
   */
  getBalance(): bigint {
    let total = 0n;
    for (const commitment of this.commitments.values()) {
      if (!commitment.spent) {
        total += commitment.amount;
      }
    }
    return total;
  }

  /**
   * Get all unspent commitments
   */
  getUnspentCommitments(): OwnedCommitment[] {
    return Array.from(this.commitments.values()).filter((c) => !c.spent);
  }

  /**
   * Get all commitments (including spent)
   */
  getAllCommitments(): OwnedCommitment[] {
    return Array.from(this.commitments.values());
  }

  /**
   * Find a commitment that can cover the given amount
   */
  findCommitmentForAmount(amount: bigint): OwnedCommitment | null {
    const unspent = this.getUnspentCommitments();

    // Sort by amount descending to find best fit
    unspent.sort((a, b) => (b.amount > a.amount ? 1 : -1));

    // Find first commitment that covers the amount
    for (const commitment of unspent) {
      if (commitment.amount >= amount) {
        return commitment;
      }
    }

    return null;
  }

  /**
   * Create a new commitment for buying tokens
   */
  async createBuyCommitment(tokenAmount: bigint): Promise<{
    nullifier: bigint;
    secret: bigint;
    amount: bigint;
    commitment: bigint;
    encryptedNote: string;
  }> {
    const nullifier = randomFieldElement();
    const secret = randomFieldElement();
    const commitment = hashCommitment(nullifier, secret, tokenAmount);

    // Encrypt note for ourselves
    const encryptedNote = await encryptNote(
      nullifier,
      secret,
      tokenAmount,
      this.viewingPublicKey
    );

    return {
      nullifier,
      secret,
      amount: tokenAmount,
      commitment,
      encryptedNote,
    };
  }

  /**
   * Create commitment for a transfer recipient
   */
  async createTransferCommitment(
    amount: bigint,
    recipientPublicKey: string
  ): Promise<{
    nullifier: bigint;
    secret: bigint;
    commitment: bigint;
    encryptedNote: string;
  }> {
    const nullifier = randomFieldElement();
    const secret = randomFieldElement();
    const commitment = hashCommitment(nullifier, secret, amount);

    const encryptedNote = await encryptNote(
      nullifier,
      secret,
      amount,
      recipientPublicKey
    );

    return { nullifier, secret, commitment, encryptedNote };
  }

  /**
   * Get merkle proof for a commitment
   */
  getMerkleProof(leafIndex: number): {
    pathElements: bigint[];
    pathIndices: number[];
    root: bigint;
  } {
    return this.merkleTree.getProof(leafIndex);
  }

  /**
   * Get current merkle root
   */
  getMerkleRoot(): bigint {
    return this.merkleTree.getRoot();
  }

  /**
   * Scan blockchain for new commitments
   * Returns newly discovered commitments
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

    const newCommitments: OwnedCommitment[] = [];
    const spentCommitments: OwnedCommitment[] = [];

    // Scan in chunks
    const CHUNK_SIZE = 5000;

    for (let from = startBlock; from <= currentBlock; from += CHUNK_SIZE) {
      const to = Math.min(from + CHUNK_SIZE - 1, currentBlock);

      // Fetch NewCommitment events
      const commitmentFilter = this.zkAMMContract.filters.NewCommitment();
      const commitmentLogs = await this.zkAMMContract.queryFilter(
        commitmentFilter,
        from,
        to
      );

      for (const log of commitmentLogs) {
        await this.processCommitmentEvent(log, newCommitments);
      }

      // Fetch NullifierSpent events
      const nullifierFilter = this.zkAMMContract.filters.NullifierSpent();
      const nullifierLogs = await this.zkAMMContract.queryFilter(
        nullifierFilter,
        from,
        to
      );

      for (const log of nullifierLogs) {
        this.processNullifierEvent(log, spentCommitments);
      }
    }

    this.lastScannedBlock = currentBlock;

    return { newCommitments, spentCommitments };
  }

  /**
   * Process a NewCommitment event
   */
  private async processCommitmentEvent(
    log: ethers.Log | ethers.EventLog,
    newCommitments: OwnedCommitment[]
  ): Promise<void> {
    const parsed = this.zkAMMContract.interface.parseLog({
      topics: log.topics as string[],
      data: log.data,
    });

    if (!parsed) return;

    const commitmentHash = BigInt(parsed.args[0]);
    const leafIndex = Number(parsed.args[1]);
    const encryptedNote = parsed.args[2] as string;

    // Add to merkle tree regardless of ownership
    this.merkleTree.insert(commitmentHash);

    // Try to decrypt note
    if (!encryptedNote || encryptedNote === '0x') return;

    const decrypted = await decryptNote(encryptedNote, this.viewingKey);
    if (!decrypted) return;

    // Verify commitment matches
    const expectedCommitment = hashCommitment(
      decrypted.nullifier,
      decrypted.secret,
      decrypted.amount
    );

    if (expectedCommitment !== commitmentHash) {
      console.warn('Commitment hash mismatch');
      return;
    }

    // This is our commitment!
    const commitment: OwnedCommitment = {
      nullifier: decrypted.nullifier,
      secret: decrypted.secret,
      amount: decrypted.amount,
      commitment: commitmentHash,
      leafIndex,
      blockNumber: log.blockNumber,
      spent: false,
    };

    this.commitments.set(commitmentHash.toString(), commitment);
    newCommitments.push(commitment);
  }

  /**
   * Process a NullifierSpent event
   */
  private processNullifierEvent(
    log: ethers.Log | ethers.EventLog,
    spentCommitments: OwnedCommitment[]
  ): void {
    const parsed = this.zkAMMContract.interface.parseLog({
      topics: log.topics as string[],
      data: log.data,
    });

    if (!parsed) return;

    const nullifierHash = BigInt(parsed.args[0]);
    this.spentNullifiers.add(nullifierHash.toString());

    // Check if any of our commitments were spent
    for (const commitment of this.commitments.values()) {
      if (commitment.spent) continue;

      const expectedNullifierHash = hashNullifier(
        commitment.nullifier,
        commitment.leafIndex
      );

      if (expectedNullifierHash === nullifierHash) {
        commitment.spent = true;
        commitment.nullifierHash = nullifierHash;
        spentCommitments.push(commitment);
      }
    }
  }

  /**
   * Export wallet state for persistence
   */
  exportState(): string {
    const state = {
      commitments: Array.from(this.commitments.entries()).map(([key, value]) => ({
        key,
        ...value,
        nullifier: value.nullifier.toString(),
        secret: value.secret.toString(),
        amount: value.amount.toString(),
        commitment: value.commitment.toString(),
        nullifierHash: value.nullifierHash?.toString(),
      })),
      spentNullifiers: Array.from(this.spentNullifiers),
      lastScannedBlock: this.lastScannedBlock,
    };
    return JSON.stringify(state);
  }

  /**
   * Import wallet state from persistence
   */
  importState(stateJson: string): void {
    const state = JSON.parse(stateJson);

    this.commitments.clear();
    for (const item of state.commitments) {
      const commitment: OwnedCommitment = {
        nullifier: BigInt(item.nullifier),
        secret: BigInt(item.secret),
        amount: BigInt(item.amount),
        commitment: BigInt(item.commitment),
        leafIndex: item.leafIndex,
        blockNumber: item.blockNumber,
        spent: item.spent,
        nullifierHash: item.nullifierHash ? BigInt(item.nullifierHash) : undefined,
      };
      this.commitments.set(item.key, commitment);
    }

    this.spentNullifiers = new Set(state.spentNullifiers);
    this.lastScannedBlock = state.lastScannedBlock;
  }
}
