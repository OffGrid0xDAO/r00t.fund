pragma circom 2.1.0;

include "./lib/poseidon.circom";
include "./lib/merkle.circom";

/*
 * Withdraw Circuit
 *
 * Proves: "I own a commitment in the merkle tree worth X tokens,
 *          withdraw them to a public address"
 *
 * This is simpler than sell - no change commitment, just full withdrawal
 * to exit the privacy pool and get public ERC20 tokens.
 *
 * Public Inputs:
 *   - merkleRoot: The root of the commitment merkle tree
 *   - nullifierHash: Hash to prevent double-spending
 *   - amount: Amount of tokens to withdraw
 *   - recipient: Address to receive tokens (public!)
 *
 * Private Inputs:
 *   - nullifier: Random value for this commitment
 *   - secret: Random value for hiding
 *   - pathElements[20]: Merkle proof siblings
 *   - pathIndices[20]: Merkle proof path (0=left, 1=right)
 *
 * Privacy Note:
 *   - The recipient address and amount are PUBLIC (revealed on-chain)
 *   - The link between buyer and recipient is BROKEN (ZK proof hides origin)
 *   - User should withdraw to a fresh wallet for maximum privacy
 */

template Withdraw(MERKLE_DEPTH) {
    // Public inputs
    signal input merkleRoot;
    signal input nullifierHash;
    signal input amount;
    signal input recipient;

    // Private inputs
    signal input nullifier;
    signal input secret;
    signal input pathElements[MERKLE_DEPTH];
    signal input pathIndices[MERKLE_DEPTH];

    // 1. Compute commitment from private inputs
    // commitment = Poseidon(nullifier, secret, amount)
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
    // nullifierHash = Poseidon(nullifier, leafIndex)
    component nullifierHasher = NullifierHash();
    nullifierHasher.nullifier <== nullifier;
    nullifierHasher.leafIndex <== merkleProof.leafIndex;
    nullifierHash === nullifierHasher.nullifierHash;

    // 5. Bind recipient to prevent front-running
    // (recipient is already a public input, this just creates a dependency)
    // SECURITY FIX: Use signal output to ensure binding cannot be optimized away
    signal output recipientBinding;
    component recipientHasher = Poseidon(2);
    recipientHasher.inputs[0] <== amount;
    recipientHasher.inputs[1] <== recipient;
    recipientBinding <== recipientHasher.out;
}

// Main component with depth 24 (supports ~16M commitments)
component main {public [merkleRoot, nullifierHash, amount, recipient]} = Withdraw(24);
