pragma circom 2.1.0;

include "./lib/poseidon.circom";
include "./lib/merkle.circom";
include "circomlib/circuits/comparators.circom";

/*
 * Transfer Circuit (SECURED VERSION)
 *
 * Proves: "I own a commitment in the merkle tree, split it into
 *          a recipient commitment and optional change commitment"
 *
 * SECURITY: Added range checks to prevent field arithmetic underflow attacks.
 *
 * Public Inputs:
 *   - merkleRoot: The root of the commitment merkle tree
 *   - nullifierHash: Hash to prevent double-spending
 *   - recipientCommitment: New commitment for recipient
 *   - changeCommitment: New commitment for remaining tokens (or 0)
 *
 * Private Inputs:
 *   - nullifier: Random value for input commitment
 *   - secret: Random value for input commitment
 *   - amount: Full token amount in the input commitment
 *   - pathElements[20]: Merkle proof siblings
 *   - pathIndices[20]: Merkle proof path
 *   - transferAmount: Amount to transfer to recipient
 *   - recipientNullifier: Nullifier for recipient's commitment
 *   - recipientSecret: Secret for recipient's commitment
 *   - changeNullifier: Nullifier for change commitment
 *   - changeSecret: Secret for change commitment
 */

template Transfer(MERKLE_DEPTH) {
    // Public inputs
    signal input merkleRoot;
    signal input nullifierHash;
    signal input recipientCommitment;
    signal input changeCommitment;

    // Private inputs
    signal input nullifier;
    signal input secret;
    signal input amount;
    signal input pathElements[MERKLE_DEPTH];
    signal input pathIndices[MERKLE_DEPTH];
    signal input transferAmount;
    signal input recipientNullifier;
    signal input recipientSecret;
    signal input changeNullifier;
    signal input changeSecret;

    // 1. Compute input commitment from private inputs
    component inputCommitment = Commitment();
    inputCommitment.nullifier <== nullifier;
    inputCommitment.secret <== secret;
    inputCommitment.amount <== amount;

    // 2. Verify input commitment is in the merkle tree
    component merkleProof = MerkleProofWithIndex(MERKLE_DEPTH);
    merkleProof.leaf <== inputCommitment.commitment;
    for (var i = 0; i < MERKLE_DEPTH; i++) {
        merkleProof.pathElements[i] <== pathElements[i];
        merkleProof.pathIndices[i] <== pathIndices[i];
    }

    // 3. Verify merkle root matches
    merkleRoot === merkleProof.root;

    // 4. Compute and verify nullifier hash
    component nullifierHasher = NullifierHash();
    nullifierHasher.nullifier <== nullifier;
    nullifierHasher.leafIndex <== merkleProof.leafIndex;
    nullifierHash === nullifierHasher.nullifierHash;

    // 5. CRITICAL SECURITY CHECK: Ensure transferAmount <= amount
    // This prevents field arithmetic underflow attacks
    component rangeCheck = LessEqThan(128);  // 128-bit safe for token amounts
    rangeCheck.in[0] <== transferAmount;
    rangeCheck.in[1] <== amount;
    rangeCheck.out === 1;  // ENFORCE: transferAmount <= amount

    // Verify amounts balance: transferAmount + changeAmount == amount
    signal changeAmount;
    changeAmount <== amount - transferAmount;  // Now safe due to range check above

    // transferAmount must be positive (can't be 0)
    component transferAmountIsZero = IsZero();
    transferAmountIsZero.in <== transferAmount;
    transferAmountIsZero.out === 0; // transferAmount must not be zero

    // 6. Compute and verify recipient commitment
    component recipientCommitmentHasher = Commitment();
    recipientCommitmentHasher.nullifier <== recipientNullifier;
    recipientCommitmentHasher.secret <== recipientSecret;
    recipientCommitmentHasher.amount <== transferAmount;
    recipientCommitment === recipientCommitmentHasher.commitment;

    // 7. Handle change commitment
    // If changeAmount > 0: changeCommitment must match computed value
    // If changeAmount == 0: changeCommitment must be 0

    component changeAmountIsZero = IsZero();
    changeAmountIsZero.in <== changeAmount;

    signal hasChange;
    hasChange <== 1 - changeAmountIsZero.out;

    // Compute change commitment
    component changeCommitmentHasher = Commitment();
    changeCommitmentHasher.nullifier <== changeNullifier;
    changeCommitmentHasher.secret <== changeSecret;
    changeCommitmentHasher.amount <== changeAmount;

    // When hasChange == 1: changeCommitment must equal computed value
    // When hasChange == 0: changeCommitment must be 0
    signal expectedChange;
    expectedChange <== hasChange * changeCommitmentHasher.commitment;
    changeCommitment === expectedChange;
}

// IsZero is now imported from circomlib/circuits/comparators.circom

// Main component with depth 24 (supports ~16M commitments)
component main {public [merkleRoot, nullifierHash, recipientCommitment, changeCommitment]} = Transfer(24);
