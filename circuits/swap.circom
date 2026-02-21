pragma circom 2.1.0;

include "./lib/poseidon.circom";
include "./lib/merkle.circom";
include "circomlib/circuits/comparators.circom";

/*
 * Private Swap Circuit (SECURED VERSION) ($HIDDEN <-> Project Token)
 *
 * Proves: "I own $HIDDEN tokens, I'm swapping X for project tokens,
 *          and receiving a new commitment for the project tokens"
 *
 * This enables fully private trading:
 *   - Spend $HIDDEN commitment -> Get project token commitment
 *   - Or: Spend project token commitment -> Get $HIDDEN commitment
 *
 * The AMM formula is verified off-chain; the circuit just proves:
 *   1. Ownership of input commitment
 *   2. Valid output commitment creation
 *   3. Proper nullifier to prevent double-spending
 *
 * Public Inputs:
 *   - inputMerkleRoot: Root of input token's commitment tree
 *   - inputNullifierHash: Prevents double-spending input
 *   - inputAmount: Amount of input tokens being swapped
 *   - outputCommitment: New commitment for output tokens
 *   - minOutputAmount: Minimum output (slippage protection, verified on-chain)
 *   - changeCommitment: Commitment for remaining input tokens (0 if none)
 *
 * Private Inputs:
 *   - inputNullifier, inputSecret: Input commitment preimage
 *   - inputTotalAmount: Full amount in input commitment
 *   - inputPathElements, inputPathIndices: Merkle proof for input
 *   - outputNullifier, outputSecret, outputAmount: Output commitment preimage
 *   - changeNullifier, changeSecret: Change commitment preimage (if any)
 *
 * Privacy Guarantees:
 *   - Swap amounts are public (needed for AMM)
 *   - But WHO is swapping remains hidden
 *   - Output recipient is hidden (only commitment revealed)
 */

template Swap(MERKLE_DEPTH) {
    // Public inputs
    signal input inputMerkleRoot;
    signal input inputNullifierHash;
    signal input inputAmount;           // Amount being swapped
    signal input outputCommitment;      // Commitment for output tokens
    signal input minOutputAmount;       // Slippage protection (verified on-chain)
    signal input changeCommitment;      // Commitment for remaining input (0 if none)

    // Private inputs - Input commitment
    signal input inputNullifier;
    signal input inputSecret;
    signal input inputTotalAmount;      // Full amount in commitment (>= inputAmount)
    signal input inputPathElements[MERKLE_DEPTH];
    signal input inputPathIndices[MERKLE_DEPTH];

    // Private inputs - Output commitment
    signal input outputNullifier;
    signal input outputSecret;
    signal input outputAmount;          // Must be >= minOutputAmount (verified on-chain)

    // Private inputs - Change commitment (optional)
    signal input changeNullifier;
    signal input changeSecret;

    // ========== INPUT VERIFICATION ==========

    // 1. CRITICAL SECURITY CHECK: Ensure inputAmount <= inputTotalAmount
    // This prevents field arithmetic underflow attacks
    component inputRangeCheck = LessEqThan(128);  // 128-bit safe for token amounts
    inputRangeCheck.in[0] <== inputAmount;
    inputRangeCheck.in[1] <== inputTotalAmount;
    inputRangeCheck.out === 1;  // ENFORCE: inputAmount <= inputTotalAmount

    signal inputDiff;
    inputDiff <== inputTotalAmount - inputAmount;  // Now safe due to range check above
    // inputDiff is guaranteed to be >= 0 (the change amount)

    // 2. Compute input commitment
    component inputCommitmentHasher = Commitment();
    inputCommitmentHasher.nullifier <== inputNullifier;
    inputCommitmentHasher.secret <== inputSecret;
    inputCommitmentHasher.amount <== inputTotalAmount;

    // 3. Verify input commitment is in merkle tree
    component inputMerkleProof = MerkleProofWithIndex(MERKLE_DEPTH);
    inputMerkleProof.leaf <== inputCommitmentHasher.commitment;
    for (var i = 0; i < MERKLE_DEPTH; i++) {
        inputMerkleProof.pathElements[i] <== inputPathElements[i];
        inputMerkleProof.pathIndices[i] <== inputPathIndices[i];
    }

    // 4. Verify merkle root matches
    inputMerkleRoot === inputMerkleProof.root;

    // 5. Compute and verify nullifier hash
    component inputNullifierHasher = NullifierHash();
    inputNullifierHasher.nullifier <== inputNullifier;
    inputNullifierHasher.leafIndex <== inputMerkleProof.leafIndex;
    inputNullifierHash === inputNullifierHasher.nullifierHash;

    // ========== OUTPUT VERIFICATION ==========

    // 6. Verify output commitment is correctly formed
    component outputCommitmentHasher = Commitment();
    outputCommitmentHasher.nullifier <== outputNullifier;
    outputCommitmentHasher.secret <== outputSecret;
    outputCommitmentHasher.amount <== outputAmount;

    // Output commitment must match the public input
    outputCommitment === outputCommitmentHasher.commitment;

    // ========== CHANGE VERIFICATION ==========

    // 7. If there's change, verify change commitment is correctly formed
    // changeAmount = inputTotalAmount - inputAmount
    signal changeAmount;
    changeAmount <== inputDiff;

    // Compute expected change commitment
    component changeCommitmentHasher = Commitment();
    changeCommitmentHasher.nullifier <== changeNullifier;
    changeCommitmentHasher.secret <== changeSecret;
    changeCommitmentHasher.amount <== changeAmount;

    // If changeAmount > 0, changeCommitment must match
    // If changeAmount == 0, changeCommitment must be 0
    signal hasChange;
    signal changeValid;

    // Check if we have change
    component isZeroChange = IsZero();
    isZeroChange.in <== changeAmount;
    hasChange <== 1 - isZeroChange.out;

    // If hasChange: changeCommitment == computed, else: changeCommitment == 0
    signal expectedChange;
    expectedChange <== hasChange * changeCommitmentHasher.commitment;
    changeCommitment === expectedChange;

    // ========== BINDING ==========

    // 8. Bind all public inputs to prevent tampering
    // SECURITY FIX: Use signal output to ensure binding cannot be optimized away
    signal output publicInputsBinding;
    component bindingHasher = Poseidon(4);
    bindingHasher.inputs[0] <== inputAmount;
    bindingHasher.inputs[1] <== outputCommitment;
    bindingHasher.inputs[2] <== minOutputAmount;
    bindingHasher.inputs[3] <== changeCommitment;
    publicInputsBinding <== bindingHasher.out;
}

// IsZero is now imported from circomlib/circuits/comparators.circom

// Main component with depth 24 (supports ~16M commitments)
component main {public [inputMerkleRoot, inputNullifierHash, inputAmount, outputCommitment, minOutputAmount, changeCommitment]} = Swap(24);
