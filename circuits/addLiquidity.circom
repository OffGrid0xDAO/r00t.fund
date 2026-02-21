pragma circom 2.1.0;

include "./lib/poseidon.circom";
include "./lib/merkle.circom";
include "circomlib/circuits/comparators.circom";

/*
 * Add Liquidity Circuit (Dual-Sided LP)
 *
 * Proves: "I own X tokens and want to add them + ETH as LP"
 *
 * This circuit proves:
 *   1. User owns a token commitment in the merkle tree
 *   2. User is spending that commitment (nullifier)
 *   3. Token amount matches what's being deposited
 *   4. LP commitment is correctly formed
 *   5. Change commitment (if any) is correctly formed
 *
 * Public Inputs:
 *   - merkleRoot: Root of token commitment merkle tree
 *   - nullifierHash: Hash of nullifier (to prevent double-spend)
 *   - tokenAmount: Amount of tokens being deposited to LP
 *   - lpCommitment: The LP commitment being created
 *   - changeCommitment: Change token commitment (0 if exact amount)
 *
 * Private Inputs:
 *   - nullifier: Random value from original token commitment
 *   - secret: Random value from original token commitment
 *   - amount: Original token amount in commitment
 *   - pathElements[24]: Merkle proof path
 *   - pathIndices[24]: Merkle proof indices
 *   - lpNullifier: New random value for LP commitment
 *   - lpSecret: New random value for LP commitment
 *   - lpShares: LP shares being minted (verified on-chain)
 *   - changeNullifier: Nullifier for change (0 if no change)
 *   - changeSecret: Secret for change (0 if no change)
 *
 * Security:
 *   - Token commitment is spent (nullifier recorded)
 *   - LP commitment replaces token exposure
 *   - Change returned if tokenAmount < amount
 */

template AddLiquidity(depth) {
    // Public inputs
    signal input merkleRoot;
    signal input nullifierHash;
    signal input tokenAmount;      // Tokens going into LP
    signal input lpCommitment;     // New LP commitment
    signal input changeCommitment; // Change back to user (0 if none)

    // Private inputs - original token commitment
    signal input nullifier;
    signal input secret;
    signal input amount;           // Original token amount
    signal input pathElements[depth];
    signal input pathIndices[depth];

    // Private inputs - new LP commitment
    signal input lpNullifier;
    signal input lpSecret;
    signal input lpShares;

    // Private inputs - change commitment (optional)
    signal input changeNullifier;
    signal input changeSecret;

    // ============ 1. Verify Original Token Commitment ============

    // Compute original commitment = Poseidon(nullifier, secret, amount)
    component originalCommitment = Poseidon(3);
    originalCommitment.inputs[0] <== nullifier;
    originalCommitment.inputs[1] <== secret;
    originalCommitment.inputs[2] <== amount;

    // Verify merkle proof WITH leaf index extraction
    // SECURITY FIX: Use MerkleProofWithIndex to get leafIndex for nullifier
    component merkleProof = MerkleProofWithIndex(depth);
    merkleProof.leaf <== originalCommitment.out;
    for (var i = 0; i < depth; i++) {
        merkleProof.pathElements[i] <== pathElements[i];
        merkleProof.pathIndices[i] <== pathIndices[i];
    }
    // Verify computed root matches expected root
    merkleRoot === merkleProof.root;

    // ============ 2. Verify Nullifier Hash ============
    // SECURITY FIX: Use standard NullifierHash with leafIndex to prevent
    // double-spend attacks when same commitment exists at multiple tree positions
    component nullifierHasher = NullifierHash();
    nullifierHasher.nullifier <== nullifier;
    nullifierHasher.leafIndex <== merkleProof.leafIndex;
    nullifierHash === nullifierHasher.nullifierHash;

    // ============ 3. Verify Token Amount Constraints ============

    // tokenAmount must be > 0
    component tokenIsZero = IsZero();
    tokenIsZero.in <== tokenAmount;
    tokenIsZero.out === 0;

    // tokenAmount must be <= amount (can't deposit more than you have)
    component tokenLessOrEqual = LessEqThan(252);
    tokenLessOrEqual.in[0] <== tokenAmount;
    tokenLessOrEqual.in[1] <== amount;
    tokenLessOrEqual.out === 1;

    // ============ 4. Verify LP Shares > 0 ============

    component sharesIsZero = IsZero();
    sharesIsZero.in <== lpShares;
    sharesIsZero.out === 0;

    // ============ 5. Verify LP Commitment ============

    // lpCommitment = Poseidon(lpNullifier, lpSecret, lpShares)
    component lpCommitmentHasher = Poseidon(3);
    lpCommitmentHasher.inputs[0] <== lpNullifier;
    lpCommitmentHasher.inputs[1] <== lpSecret;
    lpCommitmentHasher.inputs[2] <== lpShares;
    lpCommitment === lpCommitmentHasher.out;

    // ============ 6. Verify Change Commitment ============

    // Calculate change amount
    signal changeAmount;
    changeAmount <== amount - tokenAmount;

    // Compute expected change commitment
    component changeCommitmentHasher = Poseidon(3);
    changeCommitmentHasher.inputs[0] <== changeNullifier;
    changeCommitmentHasher.inputs[1] <== changeSecret;
    changeCommitmentHasher.inputs[2] <== changeAmount;

    // If changeAmount > 0, changeCommitment must match
    // If changeAmount == 0, changeCommitment must be 0
    component changeIsZero = IsZero();
    changeIsZero.in <== changeAmount;

    // When changeAmount > 0: changeCommitment === changeCommitmentHasher.out
    // When changeAmount == 0: changeCommitment === 0
    signal expectedChange;
    expectedChange <== (1 - changeIsZero.out) * changeCommitmentHasher.out;
    changeCommitment === expectedChange;

    // ============ 7. Binding Output ============
    // Creates a unique fingerprint of all public inputs to prevent malleability

    signal output publicInputsBinding;
    component bindingHasher = Poseidon(5);
    bindingHasher.inputs[0] <== merkleRoot;
    bindingHasher.inputs[1] <== nullifierHash;
    bindingHasher.inputs[2] <== tokenAmount;
    bindingHasher.inputs[3] <== lpCommitment;
    bindingHasher.inputs[4] <== changeCommitment;
    publicInputsBinding <== bindingHasher.out;
}

component main {public [merkleRoot, nullifierHash, tokenAmount, lpCommitment, changeCommitment]} = AddLiquidity(24);
