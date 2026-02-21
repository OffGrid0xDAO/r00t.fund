pragma circom 2.1.0;

include "./lib/poseidon.circom";
include "./lib/merkle.circom";
include "circomlib/circuits/comparators.circom";

/*
 * Remove Liquidity Circuit (SECURED VERSION)
 *
 * Proves: "I own an LP commitment in the LP merkle tree with X LP shares,
 *          I want to withdraw Y shares (Y <= X) and optionally create
 *          a change commitment for the remainder"
 *
 * SECURITY: Includes range checks to prevent underflow attacks.
 * SECURITY FIX: commitment is now a public output to bind proof to specific LP position
 * SECURITY FIX: tokenCommitment now verified to contain correct tokensOut amount
 *
 * Public Inputs:
 *   - lpMerkleRoot: Root of the LP commitment merkle tree
 *   - nullifierHash: Hash to prevent double-spending LP position
 *   - commitment: The LP commitment being spent (SECURITY FIX: prevents lock bypass)
 *   - withdrawShares: Number of LP shares to withdraw
 *   - minEthOut: Minimum ETH to receive (slippage protection, verified on-chain)
 *   - recipient: Address to receive ETH
 *   - changeCommitment: New LP commitment for remaining shares (or 0)
 *   - tokenCommitment: Commitment for returned tokens (SECURITY FIX: verified in circuit)
 *   - tokensOut: Amount of tokens returned (provided by contract, verified in commitment)
 *
 * Public Outputs:
 *   - publicInputsBinding: Hash binding all public inputs to prevent malleability
 *
 * Private Inputs:
 *   - nullifier: Random value for LP commitment
 *   - secret: Random value for hiding
 *   - totalShares: Full LP shares in the commitment
 *   - pathElements[20]: Merkle proof siblings
 *   - pathIndices[20]: Merkle proof path
 *   - changeNullifier: Nullifier for change commitment
 *   - changeSecret: Secret for change commitment
 *   - tokenNullifier: Nullifier for token commitment
 *   - tokenSecret: Secret for token commitment
 */

template RemoveLiquidity(MERKLE_DEPTH) {
    // Public inputs
    signal input lpMerkleRoot;
    signal input nullifierHash;
    signal input commitment;        // SECURITY FIX: LP commitment being spent (binds proof to specific position)
    signal input withdrawShares;
    signal input minEthOut;
    signal input recipient;
    signal input changeCommitment;
    signal input tokenCommitment;   // SECURITY FIX: Token commitment (verified in circuit)
    signal input tokensOut;         // SECURITY FIX: Tokens to return (provided by contract)

    // Private inputs
    signal input nullifier;
    signal input secret;
    signal input totalShares;
    signal input pathElements[MERKLE_DEPTH];
    signal input pathIndices[MERKLE_DEPTH];
    signal input changeNullifier;
    signal input changeSecret;
    signal input tokenNullifier;    // SECURITY FIX: Nullifier for token commitment
    signal input tokenSecret;       // SECURITY FIX: Secret for token commitment

    // 1. CRITICAL SECURITY CHECK: withdrawShares <= totalShares
    // Prevents field arithmetic underflow attacks
    component rangeCheck = LessEqThan(128);
    rangeCheck.in[0] <== withdrawShares;
    rangeCheck.in[1] <== totalShares;
    rangeCheck.out === 1;  // ENFORCE: withdrawShares <= totalShares

    // 2. Verify withdrawShares > 0
    component withdrawIsZero = IsZero();
    withdrawIsZero.in <== withdrawShares;
    withdrawIsZero.out === 0;  // ENFORCE: withdrawShares != 0

    // 3. Compute LP commitment from private inputs
    // commitment = Poseidon(nullifier, secret, totalShares)
    component commitmentHasher = Poseidon(3);
    commitmentHasher.inputs[0] <== nullifier;
    commitmentHasher.inputs[1] <== secret;
    commitmentHasher.inputs[2] <== totalShares;

    // 4. SECURITY FIX: Verify public commitment matches computed commitment
    // This binds the proof to a specific LP position, preventing lock bypass attacks
    commitment === commitmentHasher.out;

    // 5. Verify LP commitment is in the merkle tree
    component merkleProof = MerkleProofWithIndex(MERKLE_DEPTH);
    merkleProof.leaf <== commitmentHasher.out;
    for (var i = 0; i < MERKLE_DEPTH; i++) {
        merkleProof.pathElements[i] <== pathElements[i];
        merkleProof.pathIndices[i] <== pathIndices[i];
    }

    // 6. Verify merkle root matches
    lpMerkleRoot === merkleProof.root;

    // 7. Compute and verify nullifier hash
    // nullifierHash = Poseidon(nullifier, leafIndex)
    component nullifierHasher = NullifierHash();
    nullifierHasher.nullifier <== nullifier;
    nullifierHasher.leafIndex <== merkleProof.leafIndex;
    nullifierHash === nullifierHasher.nullifierHash;

    // 8. Handle change commitment for partial withdrawal
    signal remainingShares;
    remainingShares <== totalShares - withdrawShares;  // Safe due to range check

    // Compute expected change commitment
    component changeCommitmentHasher = Poseidon(3);
    changeCommitmentHasher.inputs[0] <== changeNullifier;
    changeCommitmentHasher.inputs[1] <== changeSecret;
    changeCommitmentHasher.inputs[2] <== remainingShares;

    // If remainingShares > 0: changeCommitment must match computed value
    // If remainingShares == 0: changeCommitment must be 0
    component remainingIsZero = IsZero();
    remainingIsZero.in <== remainingShares;

    signal hasChange;
    hasChange <== 1 - remainingIsZero.out;

    // When hasChange == 1: changeCommitment must equal computed
    // When hasChange == 0: changeCommitment must be 0
    signal expectedChange;
    expectedChange <== hasChange * changeCommitmentHasher.out;
    changeCommitment === expectedChange;

    // 9. SECURITY FIX: Verify token commitment contains correct tokensOut amount
    // This ensures the tokens returned to the user are spendable (amount > 0)
    component tokenCommitmentHasher = Poseidon(3);
    tokenCommitmentHasher.inputs[0] <== tokenNullifier;
    tokenCommitmentHasher.inputs[1] <== tokenSecret;
    tokenCommitmentHasher.inputs[2] <== tokensOut;
    tokenCommitment === tokenCommitmentHasher.out;

    // 10. Verify tokensOut > 0 (must receive some tokens)
    component tokensOutIsZero = IsZero();
    tokensOutIsZero.in <== tokensOut;
    tokensOutIsZero.out === 0;  // ENFORCE: tokensOut != 0

    // 11. Bind public inputs to prevent malleability
    // SECURITY FIX: Use signal output to ensure binding cannot be optimized away
    // SECURITY FIX: Now includes commitment, tokenCommitment, and tokensOut in the binding
    signal output publicInputsBinding;
    component pubHasher = Poseidon(7);  // Updated from 5 to 7 to include tokenCommitment and tokensOut
    pubHasher.inputs[0] <== commitment;         // LP commitment being spent
    pubHasher.inputs[1] <== withdrawShares;
    pubHasher.inputs[2] <== minEthOut;
    pubHasher.inputs[3] <== recipient;
    pubHasher.inputs[4] <== changeCommitment;
    pubHasher.inputs[5] <== tokenCommitment;    // SECURITY FIX: Include token commitment in binding
    pubHasher.inputs[6] <== tokensOut;          // SECURITY FIX: Include tokensOut in binding
    publicInputsBinding <== pubHasher.out;
}

// Main component with depth 24 (supports ~16M LP commitments)
// SECURITY FIX: commitment added to public signals to bind proof to specific LP position
// SECURITY FIX: tokenCommitment and tokensOut added to verify token commitment integrity
component main {public [lpMerkleRoot, nullifierHash, commitment, withdrawShares, minEthOut, recipient, changeCommitment, tokenCommitment, tokensOut]} = RemoveLiquidity(24);
