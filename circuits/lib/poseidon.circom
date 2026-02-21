pragma circom 2.1.0;

include "circomlib/circuits/poseidon.circom";

// Wrapper for 2-input Poseidon hash (used for merkle tree nodes)
template Poseidon2() {
    signal input in[2];
    signal output out;

    component hasher = Poseidon(2);
    hasher.inputs[0] <== in[0];
    hasher.inputs[1] <== in[1];

    out <== hasher.out;
}

// Wrapper for 3-input Poseidon hash (used for commitments: nullifier, secret, amount)
template Poseidon3() {
    signal input in[3];
    signal output out;

    component hasher = Poseidon(3);
    hasher.inputs[0] <== in[0];
    hasher.inputs[1] <== in[1];
    hasher.inputs[2] <== in[2];

    out <== hasher.out;
}

// Commitment = Poseidon(nullifier, secret, amount)
template Commitment() {
    signal input nullifier;
    signal input secret;
    signal input amount;
    signal output commitment;

    component hasher = Poseidon(3);
    hasher.inputs[0] <== nullifier;
    hasher.inputs[1] <== secret;
    hasher.inputs[2] <== amount;

    commitment <== hasher.out;
}

// NullifierHash = Poseidon(nullifier, leafIndex)
// Including leafIndex prevents nullifier grinding attacks
template NullifierHash() {
    signal input nullifier;
    signal input leafIndex;
    signal output nullifierHash;

    component hasher = Poseidon(2);
    hasher.inputs[0] <== nullifier;
    hasher.inputs[1] <== leafIndex;

    nullifierHash <== hasher.out;
}
