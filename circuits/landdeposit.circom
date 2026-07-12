pragma circom 2.1.0;

include "./lib/poseidon.circom";

/*
 * LandDeposit Circuit — value+parcel binding for LandVault funding.
 *
 * The funder pays ETH/USDC and inserts a shielded commitment they can later CLAIM
 * (as R00T or the parcel token) to ANY wallet. This circuit proves that the public
 * `amount` (R00T-equivalent bought at the OTC rate, contract-enforced) and the
 * public `parcelId` are exactly the values baked into the public `commitment`.
 *
 * It is the 4-input sibling of deposit.circom and pairs with the already-VK-verified
 * claim circuit, whose commitment is Poseidon(nullifier, secret, parcelId, amount).
 * Because amount AND parcelId are bound into the leaf, a commitment can never be
 * claimed for more R00T than paid, nor for a different parcel.
 *
 * Public Inputs:  parcelId, amount, commitment
 * Public Output:  binding = Poseidon(parcelId, amount, commitment)  (anti-malleability)
 * Private Inputs: nullifier, secret
 */
template LandDeposit() {
    signal input parcelId;
    signal input amount;
    signal input commitment;
    signal output binding;

    signal input nullifier;
    signal input secret;

    // commitment == Poseidon(nullifier, secret, parcelId, amount) — the whole binding.
    component c = Poseidon(4);
    c.inputs[0] <== nullifier;
    c.inputs[1] <== secret;
    c.inputs[2] <== parcelId;
    c.inputs[3] <== amount;
    commitment === c.out;

    component b = Poseidon(3);
    b.inputs[0] <== parcelId;
    b.inputs[1] <== amount;
    b.inputs[2] <== commitment;
    binding <== b.out;
}

component main {public [parcelId, amount, commitment]} = LandDeposit();
