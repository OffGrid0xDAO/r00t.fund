#!/usr/bin/env node
/**
 * Phase C — generate REAL groth16 proof fixtures for the anonymous pledge + claim rails.
 *
 * Produces TWO fixtures that are internally consistent so an on-chain test can run the
 * full flow against the REAL PledgeVault + its TokenPool:
 *
 *   contracts/test/fixtures/pledge_proof.json  — spend a shielded R00T note, mint a
 *       parcel-/value-bound pledge commitment. pubSignals =
 *       [pledgeCommitment, publicInputsBinding, merkleRoot, nullifierHash, pledgeAmount, parcelId, creator]
 *
 *   contracts/test/fixtures/claim_proof.json   — open that SAME pledge commitment (leaf 0
 *       of a fresh pledge tree) and release parcel tokens to any wallet. pubSignals =
 *       [recipientBinding, merkleRoot, nullifierHash, parcelId, amount, recipient]
 *
 * Consistency guarantees the test relies on:
 *   - claim.merkleRoot == the TokenPool root after inserting `pledgeCommitment` at leaf 0
 *     (both use Poseidon2 / ZERO_VALUE / depth-24 — identical to contracts/src/TokenPool.sol).
 *   - the pledge SPEND nullifierHash is exported so the CRITICAL-2 regression test can mark
 *     it via a mock zkAMM sell and prove the pledge is then rejected by the SHARED registry.
 *
 * Both proofs are off-chain groth16-verified before they are written.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { buildPoseidon } from "circomlibjs";
import * as snarkjs from "snarkjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const OUT_DIR = resolve(ROOT, "contracts/test/fixtures");

// Must match contracts/src/TokenPool.sol
const ZERO_VALUE =
  21663839004416932945382355908790599225266501822907911457504978515578255421292n;
const DEPTH = 24;

const P = (c) => ({
  wasm: resolve(ROOT, `circuits/build/${c}/${c}_js/${c}.wasm`),
  zkey: resolve(ROOT, `circuits/build/${c}/${c}_final.zkey`),
  vkey: resolve(ROOT, `circuits/build/${c}/${c}_verification_key.json`),
});

function packProof(proof) {
  // snarkjs G2 inner pairs are swapped relative to the Solidity verifier.
  return [
    proof.pi_a[0],
    proof.pi_a[1],
    proof.pi_b[0][1],
    proof.pi_b[0][0],
    proof.pi_b[1][1],
    proof.pi_b[1][0],
    proof.pi_c[0],
    proof.pi_c[1],
  ].map((x) => x.toString());
}

async function proveAndVerify(circuit, input) {
  const { wasm, zkey, vkey } = P(circuit);
  const { proof, publicSignals } = await snarkjs.groth16.fullProve(input, wasm, zkey);
  const ok = await snarkjs.groth16.verify(JSON.parse(readFileSync(vkey, "utf8")), publicSignals, proof);
  if (!ok) throw new Error(`${circuit}: off-chain groth16 verify FAILED — bad fixture`);
  return { proof: packProof(proof), publicSignals };
}

function to32(x) {
  return "0x" + BigInt(x).toString(16).padStart(64, "0");
}

async function main() {
  const poseidon = await buildPoseidon();
  const F = poseidon.F;
  const h = (arr) => F.toObject(poseidon(arr)); // Poseidon of arity arr.length

  // Precompute the empty-subtree "zeros" (zeros[0] = ZERO_VALUE, zeros[i] = H(zeros[i-1], zeros[i-1])).
  const zeros = [ZERO_VALUE];
  for (let i = 1; i < DEPTH; i++) zeros.push(h([zeros[i - 1], zeros[i - 1]]));

  // Merkle path for a single leaf inserted at index 0 (all left children → siblings are zeros).
  function treeForLeaf0(leaf) {
    const pathElements = zeros.slice(0, DEPTH);
    const pathIndices = new Array(DEPTH).fill(0);
    let cur = leaf;
    for (let i = 0; i < DEPTH; i++) cur = h([cur, zeros[i]]);
    return { root: cur, pathElements, pathIndices };
  }

  // ── Shared parameters ──
  const parcelId = 77777777n;                 // field-safe parcel id (< SNARK field)
  const pledgeAmount = 1000000000000000000000n; // 1000e18 R00T
  const funder = BigInt("0x000000000000000000000000000000000000b0b"); // pledge tx sender (creator binding)
  const claimRecipient = BigInt("0x000000000000000000000000000000000000cafe"); // unlinked claim wallet

  // ── PLEDGE: spend a whole shielded R00T note ──
  const nullifier = 11111111111111111111n;
  const secret = 22222222222222222222n;
  const srcCommitment = h([nullifier, secret, pledgeAmount]); // Poseidon(nullifier, secret, amount)
  const src = treeForLeaf0(srcCommitment);
  const spendNullifierHash = h([nullifier, 0n]); // Poseidon(nullifier, leafIndex=0)

  // secrets of the new pledge commitment (only the claimer knows these)
  const pledgeNullifier = 33333333333333333333n;
  const pledgeSecret = 44444444444444444444n;
  const pledgeCommitment = h([pledgeNullifier, pledgeSecret, parcelId, pledgeAmount]); // Poseidon4

  const pledgeInput = {
    merkleRoot: src.root.toString(),
    nullifierHash: spendNullifierHash.toString(),
    pledgeAmount: pledgeAmount.toString(),
    parcelId: parcelId.toString(),
    creator: funder.toString(),
    nullifier: nullifier.toString(),
    secret: secret.toString(),
    pathElements: src.pathElements.map((x) => x.toString()),
    pathIndices: src.pathIndices.map((x) => x.toString()),
    pledgeNullifier: pledgeNullifier.toString(),
    pledgeSecret: pledgeSecret.toString(),
  };
  const pledge = await proveAndVerify("pledge", pledgeInput);
  // publicSignals = [pledgeCommitment, publicInputsBinding, merkleRoot, nullifierHash, pledgeAmount, parcelId, creator]
  const ps = pledge.publicSignals;
  const expect = (got, want, label) => {
    if (got !== want.toString()) throw new Error(`pledge ${label}: circuit=${got} expected=${want}`);
  };
  expect(ps[0], pledgeCommitment, "pledgeCommitment");
  expect(ps[2], src.root, "merkleRoot");
  expect(ps[3], spendNullifierHash, "nullifierHash");
  expect(ps[4], pledgeAmount, "pledgeAmount");
  expect(ps[5], parcelId, "parcelId");
  expect(ps[6], funder, "creator");

  // ── CLAIM: open the SAME pledge commitment (leaf 0 of a fresh pledge tree) ──
  const pledgeTree = treeForLeaf0(pledgeCommitment);
  const claimNullifierHash = h([pledgeNullifier, 0n]); // Poseidon(pledgeNullifier, leafIndex=0)
  const claimInput = {
    merkleRoot: pledgeTree.root.toString(),
    nullifierHash: claimNullifierHash.toString(),
    parcelId: parcelId.toString(),
    amount: pledgeAmount.toString(),
    recipient: claimRecipient.toString(),
    nullifier: pledgeNullifier.toString(),
    secret: pledgeSecret.toString(),
    pathElements: pledgeTree.pathElements.map((x) => x.toString()),
    pathIndices: pledgeTree.pathIndices.map((x) => x.toString()),
  };
  const claim = await proveAndVerify("claim", claimInput);
  // publicSignals = [recipientBinding, merkleRoot, nullifierHash, parcelId, amount, recipient]
  const cs = claim.publicSignals;
  if (cs[1] !== pledgeTree.root.toString()) throw new Error(`claim merkleRoot mismatch: ${cs[1]}`);
  if (cs[2] !== claimNullifierHash.toString()) throw new Error(`claim nullifierHash mismatch: ${cs[2]}`);
  if (cs[3] !== parcelId.toString()) throw new Error(`claim parcelId mismatch: ${cs[3]}`);
  if (cs[4] !== pledgeAmount.toString()) throw new Error(`claim amount mismatch: ${cs[4]}`);
  if (cs[5] !== claimRecipient.toString()) throw new Error(`claim recipient mismatch: ${cs[5]}`);

  mkdirSync(OUT_DIR, { recursive: true });

  writeFileSync(
    resolve(OUT_DIR, "pledge_proof.json"),
    JSON.stringify(
      {
        _comment:
          "Phase C pledge real groth16 proof. proof[] packed for Solidity (G2 inner pairs swapped). " +
          "pubSignals = [pledgeCommitment, publicInputsBinding, merkleRoot, nullifierHash, pledgeAmount, parcelId, creator].",
        proof: pledge.proof,
        pubSignals: ps,
        pledgeCommitment: ps[0],
        publicInputsBinding: ps[1],
        merkleRoot: ps[2],
        nullifierHash: ps[3],
        pledgeAmount: ps[4],
        parcelId: ps[5],
        parcelIdBytes32: to32(ps[5]),
        creator: to32(ps[6]),
      },
      null,
      2
    ) + "\n"
  );

  writeFileSync(
    resolve(OUT_DIR, "claim_proof.json"),
    JSON.stringify(
      {
        _comment:
          "Phase C claim real groth16 proof against the pledge tree (pledge commitment at leaf 0). " +
          "pubSignals = [recipientBinding, merkleRoot, nullifierHash, parcelId, amount, recipient]. " +
          "merkleRoot == TokenPool root after inserting pledgeCommitment at leaf 0.",
        proof: claim.proof,
        pubSignals: cs,
        recipientBinding: cs[0],
        merkleRoot: cs[1],
        nullifierHash: cs[2],
        parcelId: cs[3],
        parcelIdBytes32: to32(cs[3]),
        amount: cs[4],
        recipient: to32(cs[5]),
      },
      null,
      2
    ) + "\n"
  );

  console.log("✅ wrote pledge_proof.json + claim_proof.json (both off-chain groth16 verified)");
  console.log("   parcelId          :", parcelId.toString(), to32(parcelId));
  console.log("   pledgeAmount      :", pledgeAmount.toString());
  console.log("   spendNullifierHash:", spendNullifierHash.toString());
  console.log("   pledgeCommitment  :", pledgeCommitment.toString());
  console.log("   pledgeTree.root   :", pledgeTree.root.toString());
  console.log("   claimNullifierHash:", claimNullifierHash.toString());
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
