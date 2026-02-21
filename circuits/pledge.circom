pragma circom 2.1.0;

include "./lib/poseidon.circom";
include "./lib/merkle.circom";

/*
 * Pledge Circuit (PRODUCTION VERSION)
 *
 * Proves: "I own a commitment in the R00T merkle tree worth X tokens,
 *          and I'm pledging them to create a proposal"
 *
 * This is used when creating a proposal in LaunchpadGovernance.
 * The pledged R00T tokens are locked until the proposal is executed or rejected.
 *
 * Public Inputs:
 *   - merkleRoot: The root of the R00T pool commitment merkle tree
 *   - nullifierHash: Hash to prevent double-spending the pledged R00T
 *   - pledgeAmount: Amount of R00T being pledged
 *   - creator: Address of the proposal creator (binds proof to caller)
 *
 * Public Outputs:
 *   - publicInputsBinding: Cryptographic binding of all public inputs to prevent proof reuse
 *
 * Private Inputs:
 *   - nullifier: Random value for this commitment
 *   - secret: Random value for hiding
 *   - pathElements[24]: Merkle proof siblings
 *   - pathIndices[24]: Merkle proof path (0=left, 1=right)
 */

template Pledge(MERKLE_DEPTH) {
    // Public inputs
    signal input merkleRoot;
    signal input nullifierHash;
    signal input pledgeAmount;
    signal input creator;

    // Public output - binding to prevent proof reuse/malleability
    signal output publicInputsBinding;

    // Private inputs
    signal input nullifier;
    signal input secret;
    signal input pathElements[MERKLE_DEPTH];
    signal input pathIndices[MERKLE_DEPTH];

    // 1. Compute commitment from private inputs
    // commitment = Poseidon(nullifier, secret, pledgeAmount)
    component commitmentHasher = Commitment();
    commitmentHasher.nullifier <== nullifier;
    commitmentHasher.secret <== secret;
    commitmentHasher.amount <== pledgeAmount;

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

    // 5. SECURITY: Compute publicInputsBinding to prevent proof malleability
    // This binds all public inputs together cryptographically
    component bindingHasher = Poseidon(4);
    bindingHasher.inputs[0] <== merkleRoot;
    bindingHasher.inputs[1] <== nullifierHash;
    bindingHasher.inputs[2] <== pledgeAmount;
    bindingHasher.inputs[3] <== creator;
    publicInputsBinding <== bindingHasher.out;
}

// Main component with depth 24 (supports ~16M commitments)
component main {public [merkleRoot, nullifierHash, pledgeAmount, creator]} = Pledge(24);
