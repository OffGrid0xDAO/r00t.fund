pragma circom 2.1.0;

include "./lib/poseidon.circom";
include "./lib/merkle.circom";
include "circomlib/circuits/poseidon.circom";

/*
 * Pledge Circuit (PHASE C — anonymous plot funding)
 *
 * Proves: "I own a shielded R00T note worth `pledgeAmount` in the zkAMM token
 *          tree, I spend it (revealing its nullifier), and in exchange I mint a
 *          value- and parcel-bound PLEDGE commitment into the pledge tree so I can
 *          later CLAIM `pledgeAmount` of parcel tokens to ANY wallet."
 *
 * CHANGE-OUTPUT DECISION (documented in docs/PHASE_C.md):
 *   PRE-SPLIT, not change. The note is spent WHOLE (its inner amount == the public
 *   `pledgeAmount`). A funder who wants to pledge less than a note holds first
 *   right-sizes it with the existing zkAMM transfer/merge rails, then pledges the
 *   exact note. Rationale: a change output would require the pledge contract to
 *   hold WRITE authority on the zkAMM's commitment tree (to re-insert the remainder)
 *   — a broad cross-domain privilege we deliberately avoid. Pre-split keeps the
 *   trust boundary tight: the pledge rail only READS the zkAMM root and SPENDS a
 *   nullifier in the shared registry; it never mutates the zkAMM tree.
 *
 * SECURITY — over-claim prevention:
 *   The output `pledgeCommitment = Poseidon(pledgeNullifier, pledgeSecret,
 *   parcelId, pledgeAmount)` binds the claimable amount AND the parcel into the
 *   commitment (deposit-binding, same primitive as circuits/deposit.circom). The
 *   claim circuit (claim.circom) can therefore only ever release exactly
 *   `pledgeAmount` of the exact `parcelId` — no over-claim, no cross-parcel claim.
 *
 * Public Inputs:
 *   - merkleRoot:    root of the zkAMM R00T commitment tree (source of funds)
 *   - nullifierHash: spend nullifier for the R00T note (marked in the SHARED
 *                    NullifierRegistry — closes CRITICAL-2 cross-domain double-spend)
 *   - pledgeAmount:  R00T pledged; 100% credited to the land treasury AND the exact
 *                    amount later claimable as parcel tokens
 *   - parcelId:      the parcel being funded (field element of bytes32 parcelId)
 *   - creator:       msg.sender of the pledge tx (binds the proof to the funder;
 *                    NOT linked to the future claim wallet — that unlinkability is
 *                    the whole point)
 *
 * Public Outputs (snarkjs emits OUTPUTS FIRST in the public-signals array):
 *   - pledgeCommitment:    Poseidon(pledgeNullifier, pledgeSecret, parcelId, pledgeAmount)
 *   - publicInputsBinding: Poseidon(merkleRoot, nullifierHash, pledgeAmount, parcelId, creator)
 *
 * Private Inputs:
 *   - nullifier, secret:               hiding values of the spent R00T note
 *   - pathElements[24], pathIndices[24]: merkle proof of the R00T note
 *   - pledgeNullifier, pledgeSecret:   hiding values of the new pledge commitment
 */

template Pledge(MERKLE_DEPTH) {
    // ── public inputs ──
    signal input merkleRoot;
    signal input nullifierHash;
    signal input pledgeAmount;
    signal input parcelId;
    signal input creator;

    // ── public outputs ──
    signal output pledgeCommitment;
    signal output publicInputsBinding;

    // ── private inputs ──
    signal input nullifier;
    signal input secret;
    signal input pathElements[MERKLE_DEPTH];
    signal input pathIndices[MERKLE_DEPTH];
    signal input pledgeNullifier;
    signal input pledgeSecret;

    // 1. Recompute the spent note's commitment = Poseidon(nullifier, secret, pledgeAmount).
    //    Spending the WHOLE note binds its inner amount to the public pledgeAmount.
    component commitmentHasher = Commitment();
    commitmentHasher.nullifier <== nullifier;
    commitmentHasher.secret <== secret;
    commitmentHasher.amount <== pledgeAmount;

    // 2. Prove the note is in the zkAMM tree.
    component merkleProof = MerkleProofWithIndex(MERKLE_DEPTH);
    merkleProof.leaf <== commitmentHasher.commitment;
    for (var i = 0; i < MERKLE_DEPTH; i++) {
        merkleProof.pathElements[i] <== pathElements[i];
        merkleProof.pathIndices[i] <== pathIndices[i];
    }

    // 3. Root must match the public merkleRoot.
    merkleRoot === merkleProof.root;

    // 4. Spend nullifier = Poseidon(nullifier, leafIndex) (grinding-resistant).
    component nullifierHasher = NullifierHash();
    nullifierHasher.nullifier <== nullifier;
    nullifierHasher.leafIndex <== merkleProof.leafIndex;
    nullifierHash === nullifierHasher.nullifierHash;

    // 5. Mint the parcel- and value-bound pledge commitment (deposit-binding on the
    //    pledge tree). This is what makes the later claim un-over-claimable.
    component pledgeHasher = Poseidon(4);
    pledgeHasher.inputs[0] <== pledgeNullifier;
    pledgeHasher.inputs[1] <== pledgeSecret;
    pledgeHasher.inputs[2] <== parcelId;
    pledgeHasher.inputs[3] <== pledgeAmount;
    pledgeCommitment <== pledgeHasher.out;

    // 6. Bind all public inputs together (anti-malleability). Output signal so it
    //    cannot be optimized away.
    component bindingHasher = Poseidon(5);
    bindingHasher.inputs[0] <== merkleRoot;
    bindingHasher.inputs[1] <== nullifierHash;
    bindingHasher.inputs[2] <== pledgeAmount;
    bindingHasher.inputs[3] <== parcelId;
    bindingHasher.inputs[4] <== creator;
    publicInputsBinding <== bindingHasher.out;
}

// Depth 24 (supports ~16M commitments), matching every other r00t circuit + TokenPool.
component main {public [merkleRoot, nullifierHash, pledgeAmount, parcelId, creator]} = Pledge(24);
