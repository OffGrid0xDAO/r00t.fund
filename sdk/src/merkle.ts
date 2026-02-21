import { hashPair } from './poseidon';

const DEPTH = 24;

/**
 * Zero value for empty leaves
 * This should match the contract's ZERO_VALUE
 */
export const ZERO_VALUE = 21663839004416932945382355908790599225266501822907911457504978515578255421292n;

/**
 * Precomputed zero hashes for each level
 * zeros[i] = hash of empty subtree of height i
 */
function computeZeros(): bigint[] {
  const zeros: bigint[] = [ZERO_VALUE];
  for (let i = 1; i < DEPTH; i++) {
    zeros[i] = hashPair(zeros[i - 1], zeros[i - 1]);
  }
  return zeros;
}

export const ZEROS = computeZeros();

/**
 * Client-side incremental merkle tree
 * Mirrors the on-chain TokenPool contract
 */
export class MerkleTree {
  private depth: number;
  private leaves: bigint[];
  private filledSubtrees: bigint[];
  private root: bigint;

  constructor(depth: number = DEPTH) {
    this.depth = depth;
    this.leaves = [];
    this.filledSubtrees = [...ZEROS];
    this.root = this.computeEmptyRoot();
  }

  private computeEmptyRoot(): bigint {
    let current = ZERO_VALUE;
    for (let i = 0; i < this.depth; i++) {
      current = hashPair(current, current);
    }
    return current;
  }

  /**
   * Insert a leaf and return its index
   */
  insert(leaf: bigint): number {
    const index = this.leaves.length;
    this.leaves.push(leaf);

    let currentIndex = index;
    let currentHash = leaf;

    for (let i = 0; i < this.depth; i++) {
      if (currentIndex % 2 === 0) {
        // Left child - sibling is zero hash
        this.filledSubtrees[i] = currentHash;
        currentHash = hashPair(currentHash, ZEROS[i]);
      } else {
        // Right child - sibling is filled subtree
        currentHash = hashPair(this.filledSubtrees[i], currentHash);
      }
      currentIndex = Math.floor(currentIndex / 2);
    }

    this.root = currentHash;
    return index;
  }

  /**
   * Insert a leaf at a specific index
   * Fills gaps with ZERO_VALUE
   */
  insertAt(index: number, leaf: bigint): void {
    // Fill gaps with ZERO_VALUE
    while (this.leaves.length < index) {
      this.insert(ZERO_VALUE);
    }

    if (this.leaves.length === index) {
      this.insert(leaf);
    } else {
      // Update existing leaf
      this.leaves[index] = leaf;
      this.recomputeRoot();
    }
  }

  /**
   * Recompute the entire root
   * Needed when updating an existing leaf
   */
  private recomputeRoot(): void {
    // Reset filled subtrees
    this.filledSubtrees = [...ZEROS];

    // Re-insert all leaves to update filledSubtrees and root
    // This is less efficient than a partial update but simpler for now
    let currentRoot = ZERO_VALUE;
    const tempLeaves = [...this.leaves];
    this.leaves = [];

    for (const leaf of tempLeaves) {
      this.insert(leaf);
    }
  }

  /**
   * Get merkle proof for a leaf at given index
   */
  getProof(leafIndex: number): {
    pathElements: bigint[];
    pathIndices: number[];
    root: bigint;
  } {
    if (leafIndex >= this.leaves.length) {
      throw new Error(`Leaf index ${leafIndex} out of bounds`);
    }

    const pathElements: bigint[] = [];
    const pathIndices: number[] = [];

    let currentIndex = leafIndex;

    for (let level = 0; level < this.depth; level++) {
      const siblingIndex = currentIndex % 2 === 0 ? currentIndex + 1 : currentIndex - 1;

      // Get sibling value
      let sibling: bigint;
      if (siblingIndex < this.getNodesAtLevel(level)) {
        sibling = this.getNodeAtLevel(level, siblingIndex);
      } else {
        sibling = ZEROS[level];
      }

      pathElements.push(sibling);
      pathIndices.push(currentIndex % 2);

      currentIndex = Math.floor(currentIndex / 2);
    }

    return {
      pathElements,
      pathIndices,
      root: this.root,
    };
  }

  /**
   * Get the number of nodes at a given level
   */
  private getNodesAtLevel(level: number): number {
    return Math.ceil(this.leaves.length / Math.pow(2, level));
  }

  /**
   * Get a node value at a specific level and index
   */
  private getNodeAtLevel(level: number, index: number): bigint {
    if (level === 0) {
      return index < this.leaves.length ? this.leaves[index] : ZERO_VALUE;
    }

    const leftChild = this.getNodeAtLevel(level - 1, index * 2);
    const rightChild = this.getNodeAtLevel(level - 1, index * 2 + 1);
    return hashPair(leftChild, rightChild);
  }

  /**
   * Get current root
   */
  getRoot(): bigint {
    return this.root;
  }

  /**
   * Get leaf count
   */
  getLeafCount(): number {
    return this.leaves.length;
  }

  /**
   * Get leaf at index
   */
  getLeaf(index: number): bigint | undefined {
    return this.leaves[index];
  }

  /**
   * Load pre-computed tree state (avoids expensive hash recomputation)
   * Use this when you have tree state from an indexer
   */
  loadState(leaves: bigint[], filledSubtrees: bigint[], root: bigint): void {
    this.leaves = leaves;
    this.filledSubtrees = filledSubtrees;
    this.root = root;
  }

  /**
   * Get the filled subtrees (needed for proof generation)
   */
  getFilledSubtrees(): bigint[] {
    return this.filledSubtrees;
  }

  /**
   * Verify a merkle proof
   */
  static verifyProof(
    leaf: bigint,
    pathElements: bigint[],
    pathIndices: number[],
    expectedRoot: bigint
  ): boolean {
    let currentHash = leaf;

    for (let i = 0; i < pathElements.length; i++) {
      if (pathIndices[i] === 0) {
        currentHash = hashPair(currentHash, pathElements[i]);
      } else {
        currentHash = hashPair(pathElements[i], currentHash);
      }
    }

    return currentHash === expectedRoot;
  }
}
