pragma circom 2.1.0;

include "./poseidon.circom";

// Selects left or right input based on selector bit
// If selector == 0: out = [in0, in1]
// If selector == 1: out = [in1, in0]
template DualMux() {
    signal input in[2];
    signal input selector;
    signal output out[2];

    // Ensure selector is binary
    selector * (1 - selector) === 0;

    out[0] <== (in[1] - in[0]) * selector + in[0];
    out[1] <== (in[0] - in[1]) * selector + in[1];
}

// Computes a single level of the merkle tree
template MerkleTreeLevel() {
    signal input leaf;
    signal input sibling;
    signal input pathIndex; // 0 = leaf is left child, 1 = leaf is right child
    signal output parent;

    component mux = DualMux();
    mux.in[0] <== leaf;
    mux.in[1] <== sibling;
    mux.selector <== pathIndex;

    component hasher = Poseidon2();
    hasher.in[0] <== mux.out[0];
    hasher.in[1] <== mux.out[1];

    parent <== hasher.out;
}

// Verifies a merkle proof for a leaf at a given path
// DEPTH = 24 supports ~16M leaves
template MerkleProof(DEPTH) {
    signal input leaf;
    signal input pathElements[DEPTH];
    signal input pathIndices[DEPTH];
    signal output root;

    component levels[DEPTH];

    signal intermediateHashes[DEPTH + 1];
    intermediateHashes[0] <== leaf;

    for (var i = 0; i < DEPTH; i++) {
        levels[i] = MerkleTreeLevel();
        levels[i].leaf <== intermediateHashes[i];
        levels[i].sibling <== pathElements[i];
        levels[i].pathIndex <== pathIndices[i];
        intermediateHashes[i + 1] <== levels[i].parent;
    }

    root <== intermediateHashes[DEPTH];
}

// Computes the leaf index from path indices (binary to decimal)
template LeafIndex(DEPTH) {
    signal input pathIndices[DEPTH];
    signal output index;

    signal powers[DEPTH];
    signal acc[DEPTH + 1];

    acc[0] <== 0;

    for (var i = 0; i < DEPTH; i++) {
        // pathIndices[i] must be binary
        pathIndices[i] * (1 - pathIndices[i]) === 0;

        // powers[i] = 2^i
        if (i == 0) {
            powers[i] <== 1;
        } else {
            powers[i] <== powers[i-1] * 2;
        }

        acc[i + 1] <== acc[i] + pathIndices[i] * powers[i];
    }

    index <== acc[DEPTH];
}

// Combined merkle proof verification with leaf index computation
template MerkleProofWithIndex(DEPTH) {
    signal input leaf;
    signal input pathElements[DEPTH];
    signal input pathIndices[DEPTH];
    signal output root;
    signal output leafIndex;

    // Verify merkle proof
    component proof = MerkleProof(DEPTH);
    proof.leaf <== leaf;
    for (var i = 0; i < DEPTH; i++) {
        proof.pathElements[i] <== pathElements[i];
        proof.pathIndices[i] <== pathIndices[i];
    }
    root <== proof.root;

    // Compute leaf index from path
    component indexer = LeafIndex(DEPTH);
    for (var i = 0; i < DEPTH; i++) {
        indexer.pathIndices[i] <== pathIndices[i];
    }
    leafIndex <== indexer.index;
}
