pragma circom 2.1.0;

include "./lib/poseidon.circom";
include "./lib/merkle.circom";
include "circomlib/circuits/poseidon.circom";

/*
 * Claim Circuit (PHASE C — anonymous plot funding)
 *
 * Proves: "I own a PLEDGE commitment in the pledge tree for `parcelId` worth
 *          `amount`; release `amount` parcel tokens to `recipient` (ANY wallet)."
 *
 * This is the withdraw-shaped counterpart to pledge.circom, but it opens the
 * 4-input parcel-bound commitment Poseidon(nullifier, secret, parcelId, amount)
 * instead of the 3-input note commitment. Because `amount` and `parcelId` are
 * baked into the committed leaf, the contract can mint EXACTLY `amount` of EXACTLY
 * `parcelId`'s token — over-claim and cross-parcel claim are cryptographically
 * impossible. Double-claim is prevented by marking `nullifierHash` in the SHARED
 * NullifierRegistry.
 *
 * The link between the funding wallet (pledge.creator) and `recipient` is broken:
 * the pledge proof and the claim proof share no public value except `parcelId`
 * and `amount`, and the claim wallet is chosen freely at claim time.
 *
 * Public Inputs:
 *   - merkleRoot:    root of the PLEDGE commitment tree
 *   - nullifierHash: claim nullifier = Poseidon(nullifier, leafIndex) (shared registry)
 *   - parcelId:      the parcel whose token is minted (must match the commitment)
 *   - amount:        parcel tokens to mint == pledged amount (bound in the commitment)
 *   - recipient:     wallet that receives the minted parcel tokens (public)
 *
 * Public Output:
 *   - recipientBinding: Poseidon(parcelId, amount, recipient) — anti-front-run binding
 *
 * Private Inputs:
 *   - nullifier, secret:               hiding values of the pledge commitment
 *   - pathElements[24], pathIndices[24]: merkle proof in the pledge tree
 */

template Claim(MERKLE_DEPTH) {
    // ── public inputs ──
    signal input merkleRoot;
    signal input nullifierHash;
    signal input parcelId;
    signal input amount;
    signal input recipient;

    // ── public output ──
    signal output recipientBinding;

    // ── private inputs ──
    signal input nullifier;
    signal input secret;
    signal input pathElements[MERKLE_DEPTH];
    signal input pathIndices[MERKLE_DEPTH];

    // 1. Recompute the pledge commitment = Poseidon(nullifier, secret, parcelId, amount).
    //    Binds both the claimable amount AND the parcel into the leaf.
    component pledgeHasher = Poseidon(4);
    pledgeHasher.inputs[0] <== nullifier;
    pledgeHasher.inputs[1] <== secret;
    pledgeHasher.inputs[2] <== parcelId;
    pledgeHasher.inputs[3] <== amount;

    // 2. Prove the pledge commitment is in the pledge tree.
    component merkleProof = MerkleProofWithIndex(MERKLE_DEPTH);
    merkleProof.leaf <== pledgeHasher.out;
    for (var i = 0; i < MERKLE_DEPTH; i++) {
        merkleProof.pathElements[i] <== pathElements[i];
        merkleProof.pathIndices[i] <== pathIndices[i];
    }

    // 3. Root must match the public merkleRoot.
    merkleRoot === merkleProof.root;

    // 4. Claim nullifier = Poseidon(nullifier, leafIndex) (grinding-resistant).
    component nullifierHasher = NullifierHash();
    nullifierHasher.nullifier <== nullifier;
    nullifierHasher.leafIndex <== merkleProof.leafIndex;
    nullifierHash === nullifierHasher.nullifierHash;

    // 5. Bind parcelId + amount + recipient (anti-front-run). Output so it cannot be
    //    optimized away.
    component recipientHasher = Poseidon(3);
    recipientHasher.inputs[0] <== parcelId;
    recipientHasher.inputs[1] <== amount;
    recipientHasher.inputs[2] <== recipient;
    recipientBinding <== recipientHasher.out;
}

// Depth 24, matching the pledge TokenPool.
component main {public [merkleRoot, nullifierHash, parcelId, amount, recipient]} = Claim(24);
