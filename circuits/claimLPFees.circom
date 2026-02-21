pragma circom 2.1.0;

include "./lib/poseidon.circom";
include "./lib/merkle.circom";
include "circomlib/circuits/comparators.circom";

/*
 * Claim LP Fees Circuit (SECURED VERSION)
 *
 * Proves: "I own an LP commitment in the LP merkle tree with X LP shares,
 *          and I want to claim my accumulated fees without removing liquidity"
 *
 * Key Property: This does NOT spend the LP commitment (LP position retained).
 * The user keeps their LP position and can claim fees once per epoch.
 * Fee amounts are calculated on-chain based on feePerShare growth.
 *
 * SECURITY FIXES:
 * - Added claimNullifier to prevent claiming same epoch's fees multiple times
 * - Uses MerkleProofWithIndex for proper leaf index extraction
 * - Nullifier includes feeEpoch and leafIndex for unique claim tracking
 *
 * Public Inputs:
 *   - lpMerkleRoot: Root of the LP commitment merkle tree
 *   - claimNullifier: Unique nullifier for this claim (prevents double-claim per epoch)
 *   - feeEpoch: Current fee epoch (increments when fees are distributed)
 *   - lpShares: Number of LP shares (for fee calculation on-chain)
 *   - recipient: Address to receive ETH fees
 *
 * Private Inputs:
 *   - nullifier: Random value for LP commitment
 *   - secret: Random value for hiding
 *   - pathElements[24]: Merkle proof siblings
 *   - pathIndices[24]: Merkle proof path
 */

template ClaimLPFees(MERKLE_DEPTH) {
    // Public inputs
    signal input lpMerkleRoot;
    signal input claimNullifier;  // SECURITY FIX: Nullifier for this specific claim
    signal input feeEpoch;        // SECURITY FIX: Current fee epoch
    signal input lpShares;
    signal input recipient;

    // Private inputs
    signal input nullifier;
    signal input secret;
    signal input pathElements[MERKLE_DEPTH];
    signal input pathIndices[MERKLE_DEPTH];

    // 1. Verify lpShares > 0 (can't claim with zero shares)
    component sharesIsZero = IsZero();
    sharesIsZero.in <== lpShares;
    sharesIsZero.out === 0;  // ENFORCE: lpShares != 0

    // 2. Compute LP commitment from private inputs
    // commitment = Poseidon(nullifier, secret, lpShares)
    component commitmentHasher = Poseidon(3);
    commitmentHasher.inputs[0] <== nullifier;
    commitmentHasher.inputs[1] <== secret;
    commitmentHasher.inputs[2] <== lpShares;

    // Compute the LP commitment (internal use only, not exposed publicly for privacy)
    signal lpCommitment;
    lpCommitment <== commitmentHasher.out;

    // 3. Verify LP commitment is in the merkle tree
    // SECURITY FIX: Use MerkleProofWithIndex to get leafIndex for claim nullifier
    component merkleProof = MerkleProofWithIndex(MERKLE_DEPTH);
    merkleProof.leaf <== lpCommitment;
    for (var i = 0; i < MERKLE_DEPTH; i++) {
        merkleProof.pathElements[i] <== pathElements[i];
        merkleProof.pathIndices[i] <== pathIndices[i];
    }

    // 4. Verify merkle root matches
    lpMerkleRoot === merkleProof.root;

    // 5. SECURITY FIX: Verify claim nullifier
    // claimNullifier = Poseidon(nullifier, feeEpoch, leafIndex)
    // This ensures each LP position can only claim fees once per epoch
    // - Different epochs generate different nullifiers (can claim each epoch)
    // - Same epoch, same position = same nullifier (prevents double-claim)
    component claimNullifierHasher = Poseidon(3);
    claimNullifierHasher.inputs[0] <== nullifier;
    claimNullifierHasher.inputs[1] <== feeEpoch;
    claimNullifierHasher.inputs[2] <== merkleProof.leafIndex;
    claimNullifier === claimNullifierHasher.out;

    // 6. Bind public inputs to prevent malleability
    // SECURITY FIX: Use signal output to ensure binding cannot be optimized away
    signal output publicInputsBinding;
    component pubHasher = Poseidon(4);
    pubHasher.inputs[0] <== claimNullifier;
    pubHasher.inputs[1] <== feeEpoch;
    pubHasher.inputs[2] <== lpShares;
    pubHasher.inputs[3] <== recipient;
    publicInputsBinding <== pubHasher.out;
}

// Main component with depth 24 (supports ~16M commitments)
// SECURITY FIX: Added claimNullifier and feeEpoch to public signals
// Note: commitment is NOT public to preserve LP position privacy
component main {public [lpMerkleRoot, claimNullifier, feeEpoch, lpShares, recipient]} = ClaimLPFees(24);
