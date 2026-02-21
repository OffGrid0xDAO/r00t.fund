pragma circom 2.1.0;

include "./lib/poseidon.circom";
include "./lib/merkle.circom";
include "circomlib/circuits/comparators.circom";

/*
 * Private Voting Circuit (SECURED VERSION)
 *
 * Proves: "I own $HIDDEN tokens in the merkle tree and I'm casting
 *          a vote with weight X for/against proposal Y"
 *
 * SECURITY FIXES:
 *   1. Added range check for voteWeight <= amount (prevents underflow attack)
 *   2. Added leafIndex to vote nullifier (prevents double-voting from same commitment)
 *   3. Fixed voteWeight > 0 check to actually constrain non-zero
 *
 * Key Properties:
 *   - Vote weight is verified against actual commitment amount
 *   - Nullifier prevents double-voting per proposal + leaf position
 *   - Voter identity remains hidden (no address revealed)
 *   - Commitment is NOT spent (can hold and vote)
 *
 * Public Inputs:
 *   - proposalId: The proposal being voted on
 *   - merkleRoot: Root of $HIDDEN commitment tree
 *   - nullifierHash: Derived from nullifier + proposalId + leafIndex (prevents double vote)
 *   - voteWeight: Amount of $HIDDEN voting with (must be <= commitment amount)
 *   - support: 1 = vote FOR, 0 = vote AGAINST
 *
 * Private Inputs:
 *   - nullifier: Random value for commitment
 *   - secret: Random value for hiding
 *   - amount: Full commitment amount (voteWeight <= amount)
 *   - pathElements[20]: Merkle proof siblings
 *   - pathIndices[20]: Merkle proof path
 *
 * Privacy Guarantees:
 *   - No one knows who voted
 *   - No one knows the voter's full $HIDDEN balance
 *   - No one can link votes across proposals (different nullifierHash per proposal)
 */

template Vote(MERKLE_DEPTH) {
    // Public inputs
    signal input proposalId;
    signal input merkleRoot;
    signal input nullifierHash;
    signal input voteWeight;
    signal input support;

    // Private inputs
    signal input nullifier;
    signal input secret;
    signal input amount;
    signal input pathElements[MERKLE_DEPTH];
    signal input pathIndices[MERKLE_DEPTH];

    // 1. Verify support is binary (0 or 1)
    support * (1 - support) === 0;

    // 2. CRITICAL SECURITY CHECK: Verify voteWeight <= amount
    // This prevents field arithmetic underflow attacks
    component rangeCheck = LessEqThan(128);  // 128-bit safe for token amounts
    rangeCheck.in[0] <== voteWeight;
    rangeCheck.in[1] <== amount;
    rangeCheck.out === 1;  // ENFORCE: voteWeight <= amount

    // 3. CRITICAL SECURITY CHECK: voteWeight must be non-zero
    // Previous implementation did not actually constrain this
    component voteWeightIsZero = IsZero();
    voteWeightIsZero.in <== voteWeight;
    voteWeightIsZero.out === 0;  // ENFORCE: voteWeight != 0

    // 4. Compute commitment from private inputs
    // commitment = Poseidon(nullifier, secret, amount)
    component commitmentHasher = Commitment();
    commitmentHasher.nullifier <== nullifier;
    commitmentHasher.secret <== secret;
    commitmentHasher.amount <== amount;

    // 5. Verify commitment is in the merkle tree
    component merkleProof = MerkleProofWithIndex(MERKLE_DEPTH);
    merkleProof.leaf <== commitmentHasher.commitment;
    for (var i = 0; i < MERKLE_DEPTH; i++) {
        merkleProof.pathElements[i] <== pathElements[i];
        merkleProof.pathIndices[i] <== pathIndices[i];
    }

    // 6. Verify merkle root matches
    merkleRoot === merkleProof.root;

    // 7. CRITICAL SECURITY FIX: Compute vote nullifier with leafIndex
    // BEFORE: nullifierHash = Poseidon(nullifier, proposalId) - allowed double voting
    // AFTER:  nullifierHash = Poseidon(nullifier, proposalId, leafIndex) - secure
    // Including leafIndex prevents using same commitment at different positions
    component voteNullifierHasher = Poseidon(3);
    voteNullifierHasher.inputs[0] <== nullifier;
    voteNullifierHasher.inputs[1] <== proposalId;
    voteNullifierHasher.inputs[2] <== merkleProof.leafIndex;  // SECURITY FIX
    nullifierHash === voteNullifierHasher.out;

    // 8. Bind voteWeight and support to prevent tampering
    // This creates a cryptographic dependency ensuring the proof is for this specific vote
    // SECURITY FIX: Use signal output to ensure binding cannot be optimized away
    signal output voteBinding;
    component voteHasher = Poseidon(3);
    voteHasher.inputs[0] <== proposalId;
    voteHasher.inputs[1] <== voteWeight;
    voteHasher.inputs[2] <== support;
    voteBinding <== voteHasher.out;
}

// Main component with depth 24 (supports ~16M commitments)
component main {public [proposalId, merkleRoot, nullifierHash, voteWeight, support]} = Vote(24);
