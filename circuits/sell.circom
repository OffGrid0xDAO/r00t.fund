pragma circom 2.1.0;

include "./lib/poseidon.circom";
include "./lib/merkle.circom";
include "circomlib/circuits/comparators.circom";

/*
 * Sell Circuit (SECURED VERSION)
 *
 * Proves: "I own a commitment in the merkle tree worth at least X tokens,
 *          give me ETH and create change commitment if any"
 *
 * SECURITY: Added range checks to prevent field arithmetic underflow attacks.
 *           tokenAmount must be <= amount (enforced by constraint).
 *
 * Public Inputs:
 *   - merkleRoot: The root of the commitment merkle tree
 *   - nullifierHash: Hash to prevent double-spending
 *   - tokenAmount: Amount of tokens being sold
 *   - minEthOut: Minimum ETH to receive (slippage protection)
 *   - recipient: Address to receive ETH
 *   - relayer: Address of relayer (for fee)
 *   - fee: Fee amount for relayer
 *   - changeCommitment: New commitment for remaining tokens (or 0)
 *
 * Private Inputs:
 *   - nullifier: Random value for this commitment
 *   - secret: Random value for hiding
 *   - amount: Full token amount in the commitment
 *   - pathElements[20]: Merkle proof siblings
 *   - pathIndices[20]: Merkle proof path (0=left, 1=right)
 *   - changeNullifier: Nullifier for change commitment
 *   - changeSecret: Secret for change commitment
 */

template Sell(MERKLE_DEPTH) {
    // Public inputs
    signal input merkleRoot;
    signal input nullifierHash;
    signal input tokenAmount;
    signal input minEthOut;
    signal input recipient;
    signal input relayer;
    signal input fee;
    signal input changeCommitment;

    // Private inputs
    signal input nullifier;
    signal input secret;
    signal input amount;
    signal input pathElements[MERKLE_DEPTH];
    signal input pathIndices[MERKLE_DEPTH];
    signal input changeNullifier;
    signal input changeSecret;

    // 1. Compute commitment from private inputs
    component commitmentHasher = Commitment();
    commitmentHasher.nullifier <== nullifier;
    commitmentHasher.secret <== secret;
    commitmentHasher.amount <== amount;

    // 2. Verify commitment is in the merkle tree
    component merkleProof = MerkleProofWithIndex(MERKLE_DEPTH);
    merkleProof.leaf <== commitmentHasher.commitment;
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

    // 5. CRITICAL SECURITY CHECK: Ensure tokenAmount <= amount
    // This prevents field arithmetic underflow attacks where attacker could
    // set tokenAmount > amount, causing changeAmount to wrap around to a huge value
    component rangeCheck = LessEqThan(128);  // 128-bit safe for token amounts
    rangeCheck.in[0] <== tokenAmount;
    rangeCheck.in[1] <== amount;
    rangeCheck.out === 1;  // ENFORCE: tokenAmount <= amount

    // 6. Handle change commitment
    // If tokenAmount < amount: changeCommitment must be valid for (amount - tokenAmount)
    // If tokenAmount == amount: changeCommitment must be 0

    signal changeAmount;
    changeAmount <== amount - tokenAmount;  // Now safe due to range check above

    // Compute expected change commitment
    component changeCommitmentHasher = Commitment();
    changeCommitmentHasher.nullifier <== changeNullifier;
    changeCommitmentHasher.secret <== changeSecret;
    changeCommitmentHasher.amount <== changeAmount;

    // If changeAmount > 0, changeCommitment must match computed value
    // If changeAmount == 0, changeCommitment must be 0
    // This is done by: changeCommitment * changeAmount === computedChange * changeAmount
    // AND: (1 - hasChange) * changeCommitment === 0

    signal hasChange;
    component isZero = IsZero();
    isZero.in <== changeAmount;
    hasChange <== 1 - isZero.out;

    // When hasChange == 1: changeCommitment must equal computed change commitment
    // When hasChange == 0: changeCommitment must be 0
    signal expectedChange;
    expectedChange <== hasChange * changeCommitmentHasher.commitment;
    changeCommitment === expectedChange;

    // 7. Bind public inputs to prevent malleability
    // (These are already constrained by being public inputs, but we include
    // them in the circuit to ensure they can't be modified)
    // SECURITY FIX: Use signal output to ensure binding cannot be optimized away
    signal output publicInputsBinding;
    component pubHasher = Poseidon(5);
    pubHasher.inputs[0] <== minEthOut;
    pubHasher.inputs[1] <== recipient;
    pubHasher.inputs[2] <== relayer;
    pubHasher.inputs[3] <== fee;
    pubHasher.inputs[4] <== changeCommitment;
    publicInputsBinding <== pubHasher.out;
}

// IsZero is now imported from circomlib/circuits/comparators.circom

// Main component with depth 24 (supports ~16M commitments)
component main {public [merkleRoot, nullifierHash, tokenAmount, minEthOut, recipient, relayer, fee, changeCommitment]} = Sell(24);
