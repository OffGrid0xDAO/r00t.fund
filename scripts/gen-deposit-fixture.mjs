#!/usr/bin/env node
/**
 * Phase A — generate a REAL groth16 proof fixture for the deposit-binding circuit.
 *
 * Emits contracts/test/fixtures/deposit_proof.json with:
 *   - proof:      uint256[8] in the packed [a0,a1, b00,b01,b10,b11, c0,c1] order the
 *                 RealDepositVerifier wrapper expects (b coords swapped for Solidity).
 *   - pubSignals: [binding, amount, commitment]  (Circom output first)
 *   - amount / commitment / binding: decimal strings for readability
 *
 * The foundry test asserts: matching amount -> verifyProof true; a tampered `amount`
 * public signal -> false (CRITICAL-1: a note can't claim more than it deposited).
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { buildPoseidon } from "circomlibjs";
import * as snarkjs from "snarkjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const WASM = resolve(ROOT, "circuits/build/deposit/deposit_js/deposit.wasm");
const ZKEY = resolve(ROOT, "circuits/build/deposit/deposit_final.zkey");
const VKEY = resolve(ROOT, "circuits/build/deposit/deposit_verification_key.json");
const OUT_DIR = resolve(ROOT, "contracts/test/fixtures");
const OUT = resolve(OUT_DIR, "deposit_proof.json");

async function main() {
  const poseidon = await buildPoseidon();
  const F = poseidon.F;

  // A concrete note. amount = 1_000e18 R00T. nullifier/secret are arbitrary field elements.
  const nullifier = 12345678901234567890n;
  const secret = 98765432109876543210n;
  const amount = 1000000000000000000000n; // 1000e18

  // commitment = Poseidon(nullifier, secret, amount)  — must match lib/poseidon.circom Commitment()
  const commitment = F.toObject(poseidon([nullifier, secret, amount]));
  // binding = Poseidon(amount, commitment)  — circuit's public output
  const binding = F.toObject(poseidon([amount, commitment]));

  const input = {
    amount: amount.toString(),
    commitment: commitment.toString(),
    nullifier: nullifier.toString(),
    secret: secret.toString(),
  };

  const { proof, publicSignals } = await snarkjs.groth16.fullProve(input, WASM, ZKEY);

  // Sanity: off-chain verify against the VK before we trust it on-chain.
  const vkey = JSON.parse(readFileSync(VKEY, "utf8"));
  const ok = await snarkjs.groth16.verify(vkey, publicSignals, proof);
  if (!ok) throw new Error("off-chain groth16 verify FAILED — bad fixture");

  // publicSignals order = [binding, amount, commitment] (output first, then inputs in decl order)
  if (publicSignals[1] !== amount.toString() || publicSignals[2] !== commitment.toString()) {
    throw new Error(
      `unexpected public signal order: ${JSON.stringify(publicSignals)} ` +
        `(expected [binding, ${amount}, ${commitment}])`
    );
  }
  if (publicSignals[0] !== binding.toString()) {
    throw new Error(`binding mismatch: circuit=${publicSignals[0]} js=${binding}`);
  }

  // Pack proof for the Solidity verifier. snarkjs G2 coords are [x_c1, x_c0] style;
  // the solidity verifier expects b = [[x_c1, x_c0],[y_c1, y_c0]] i.e. inner pairs SWAPPED.
  const packed = [
    proof.pi_a[0],
    proof.pi_a[1],
    proof.pi_b[0][1],
    proof.pi_b[0][0],
    proof.pi_b[1][1],
    proof.pi_b[1][0],
    proof.pi_c[0],
    proof.pi_c[1],
  ].map((x) => x.toString());

  const fixture = {
    _comment:
      "Phase A deposit-binding real groth16 proof. proof[] is packed for Solidity " +
      "(G2 inner pairs swapped). pubSignals = [binding, amount, commitment].",
    proof: packed,
    pubSignals: publicSignals,
    amount: amount.toString(),
    commitment: commitment.toString(),
    binding: binding.toString(),
  };

  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(OUT, JSON.stringify(fixture, null, 2) + "\n");
  console.log("✅ wrote", OUT);
  console.log("   off-chain groth16 verify: PASS");
  console.log("   pubSignals:", publicSignals);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
