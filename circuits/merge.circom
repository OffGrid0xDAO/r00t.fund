pragma circom 2.1.0;

include "./lib/poseidon.circom";
include "./lib/merkle.circom";
include "circomlib/circuits/comparators.circom";

/*
 * Merge Circuit - Privacy-Preserving Commitment Consolidation
 *
 * Proves: "I own N commitments in the merkle tree, and I want to merge them
 *          into a single output commitment with the combined amount"
 *
 * SECURITY FEATURES:
 *   - Each input commitment verified via merkle proof
 *   - Each input has unique nullifier hash (prevents double-spending)
 *   - All nullifier hashes include leafIndex (prevents grinding attacks)
 *   - Range checks on all amounts (prevents underflow)
 *   - Non-zero validation on inputs (prevents empty merges)
 *   - Public inputs binding hash (prevents malleability attacks)
 *   - All inputs must share the same merkle root (same tree state)
 *
 * Public Inputs:
 *   - merkleRoot: The root of the commitment merkle tree (same for all inputs)
 *   - nullifierHash1: Hash to prevent double-spending input 1
 *   - nullifierHash2: Hash to prevent double-spending input 2
 *   - outputCommitment: New commitment with combined amount
 *   - publicInputsBinding: Hash of all public inputs (malleability protection)
 *
 * Private Inputs:
 *   - nullifier1, secret1, amount1: Input commitment 1 details
 *   - pathElements1, pathIndices1: Merkle proof for input 1
 *   - nullifier2, secret2, amount2: Input commitment 2 details
 *   - pathElements2, pathIndices2: Merkle proof for input 2
 *   - outputNullifier, outputSecret: Secrets for output commitment
 */

template Merge(MERKLE_DEPTH) {
    // ==================== PUBLIC INPUTS ====================
    signal input merkleRoot;
    signal input nullifierHash1;
    signal input nullifierHash2;
    signal input outputCommitment;

    // Output: binding hash to prevent public input manipulation
    signal output publicInputsBinding;

    // ==================== PRIVATE INPUTS - INPUT 1 ====================
    signal input nullifier1;
    signal input secret1;
    signal input amount1;
    signal input pathElements1[MERKLE_DEPTH];
    signal input pathIndices1[MERKLE_DEPTH];

    // ==================== PRIVATE INPUTS - INPUT 2 ====================
    signal input nullifier2;
    signal input secret2;
    signal input amount2;
    signal input pathElements2[MERKLE_DEPTH];
    signal input pathIndices2[MERKLE_DEPTH];

    // ==================== PRIVATE INPUTS - OUTPUT ====================
    signal input outputNullifier;
    signal input outputSecret;

    // ==================== SECURITY CHECK 1: Non-zero amounts ====================
    // Both input amounts must be positive (can't merge empty commitments)
    component amount1IsZero = IsZero();
    amount1IsZero.in <== amount1;
    amount1IsZero.out === 0; // amount1 must NOT be zero

    component amount2IsZero = IsZero();
    amount2IsZero.in <== amount2;
    amount2IsZero.out === 0; // amount2 must NOT be zero

    // ==================== SECURITY CHECK 2: Range checks ====================
    // Ensure amounts are within safe range to prevent overflow
    component rangeCheck1 = LessEqThan(128);
    rangeCheck1.in[0] <== amount1;
    rangeCheck1.in[1] <== (1 << 128) - 1; // Max 128-bit value
    rangeCheck1.out === 1;

    component rangeCheck2 = LessEqThan(128);
    rangeCheck2.in[0] <== amount2;
    rangeCheck2.in[1] <== (1 << 128) - 1;
    rangeCheck2.out === 1;

    // ==================== INPUT 1: Commitment Verification ====================
    // Compute input commitment 1 from private inputs
    component inputCommitment1 = Commitment();
    inputCommitment1.nullifier <== nullifier1;
    inputCommitment1.secret <== secret1;
    inputCommitment1.amount <== amount1;

    // Verify input commitment 1 is in the merkle tree
    component merkleProof1 = MerkleProofWithIndex(MERKLE_DEPTH);
    merkleProof1.leaf <== inputCommitment1.commitment;
    for (var i = 0; i < MERKLE_DEPTH; i++) {
        merkleProof1.pathElements[i] <== pathElements1[i];
        merkleProof1.pathIndices[i] <== pathIndices1[i];
    }

    // Verify merkle root matches for input 1
    merkleRoot === merkleProof1.root;

    // Compute and verify nullifier hash 1 (includes leafIndex for security)
    component nullifierHasher1 = NullifierHash();
    nullifierHasher1.nullifier <== nullifier1;
    nullifierHasher1.leafIndex <== merkleProof1.leafIndex;
    nullifierHash1 === nullifierHasher1.nullifierHash;

    // ==================== INPUT 2: Commitment Verification ====================
    // Compute input commitment 2 from private inputs
    component inputCommitment2 = Commitment();
    inputCommitment2.nullifier <== nullifier2;
    inputCommitment2.secret <== secret2;
    inputCommitment2.amount <== amount2;

    // Verify input commitment 2 is in the merkle tree
    component merkleProof2 = MerkleProofWithIndex(MERKLE_DEPTH);
    merkleProof2.leaf <== inputCommitment2.commitment;
    for (var i = 0; i < MERKLE_DEPTH; i++) {
        merkleProof2.pathElements[i] <== pathElements2[i];
        merkleProof2.pathIndices[i] <== pathIndices2[i];
    }

    // CRITICAL: Verify SAME merkle root for input 2 (both from same tree state)
    merkleRoot === merkleProof2.root;

    // Compute and verify nullifier hash 2
    component nullifierHasher2 = NullifierHash();
    nullifierHasher2.nullifier <== nullifier2;
    nullifierHasher2.leafIndex <== merkleProof2.leafIndex;
    nullifierHash2 === nullifierHasher2.nullifierHash;

    // ==================== SECURITY CHECK 3: Distinct inputs ====================
    // Ensure we're not merging the same commitment with itself
    // This is done by checking nullifier hashes are different
    component sameNullifier = IsZero();
    sameNullifier.in <== nullifierHash1 - nullifierHash2;
    sameNullifier.out === 0; // nullifierHash1 must NOT equal nullifierHash2

    // ==================== OUTPUT: Combined Commitment ====================
    // Calculate total amount (safe now due to range checks)
    signal totalAmount;
    totalAmount <== amount1 + amount2;

    // Verify total amount is reasonable (prevents overflow wrap-around)
    component totalRangeCheck = LessEqThan(128);
    totalRangeCheck.in[0] <== totalAmount;
    totalRangeCheck.in[1] <== (1 << 128) - 1;
    totalRangeCheck.out === 1;

    // Compute and verify output commitment
    component outputCommitmentHasher = Commitment();
    outputCommitmentHasher.nullifier <== outputNullifier;
    outputCommitmentHasher.secret <== outputSecret;
    outputCommitmentHasher.amount <== totalAmount;
    outputCommitment === outputCommitmentHasher.commitment;

    // ==================== PUBLIC INPUTS BINDING ====================
    // Hash all public inputs together to prevent malleability attacks
    // This ensures the proof is bound to specific public values
    component bindingHasher = Poseidon(4);
    bindingHasher.inputs[0] <== merkleRoot;
    bindingHasher.inputs[1] <== nullifierHash1;
    bindingHasher.inputs[2] <== nullifierHash2;
    bindingHasher.inputs[3] <== outputCommitment;
    publicInputsBinding <== bindingHasher.out;
}

// Main component with depth 24 (supports ~16M commitments)
// Public inputs: merkleRoot, nullifierHash1, nullifierHash2, outputCommitment
// Output: publicInputsBinding (verified on-chain)
component main {public [merkleRoot, nullifierHash1, nullifierHash2, outputCommitment]} = Merge(24);
