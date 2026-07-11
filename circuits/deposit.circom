pragma circom 2.1.0;

include "./lib/poseidon.circom";

/*
 * Deposit Circuit — FIX for the CRITICAL value-forgery vulnerability.
 *
 * Problem: today depositPublic()/buyPrivate() insert an opaque commitment
 *   Poseidon(nullifier, secret, amount) WITHOUT proving that the amount baked
 *   inside equals the R00T actually deposited. A malicious depositor can insert
 *   a note claiming 10M R00T while depositing 1, then withdraw 10M and drain the
 *   pool (steals every other depositor's + LP's funds).
 *
 * Fix: require this proof at deposit time. It proves that the PUBLIC `amount`
 *   (the R00T the contract actually pulls / the curve's tokensOut) is exactly the
 *   amount inside the PUBLIC `commitment`. The contract verifies the proof before
 *   inserting the commitment, so a note's value can never exceed its real deposit.
 *
 * Public Inputs:
 *   - amount:     the R00T deposited (contract-enforced: == transferred / tokensOut)
 *   - commitment: the note being inserted into the merkle tree
 *
 * Public Output:
 *   - binding: Poseidon(amount, commitment) — anti-malleability binding
 *
 * Private Inputs:
 *   - nullifier, secret: the note's hiding values (never revealed)
 */
template Deposit() {
    // Public
    signal input amount;
    signal input commitment;
    signal output binding;

    // Private
    signal input nullifier;
    signal input secret;

    // 1. Recompute the commitment from the claimed amount + hiding values.
    component c = Commitment();               // Poseidon(nullifier, secret, amount)
    c.nullifier <== nullifier;
    c.secret    <== secret;
    c.amount    <== amount;

    // 2. It MUST equal the public commitment being inserted → binds note value
    //    to the real deposit. This is the whole fix.
    commitment === c.commitment;

    // 3. Anti-malleability binding of the public inputs.
    component b = Poseidon(2);
    b.inputs[0] <== amount;
    b.inputs[1] <== commitment;
    binding <== b.out;
}

component main {public [amount, commitment]} = Deposit();
