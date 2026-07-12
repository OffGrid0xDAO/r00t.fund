# ZK Audit — findings + remediation (2026-07-11)

## 🔴 CRITICAL-1 — Deposit value forgery (drains the pool)
The shielded pool never binds a note's internal amount to the R00T actually
deposited. `depositPublic`/`buyPrivate` insert an opaque `Poseidon(nullifier,
secret, amount)` and `withdrawROOT` pays whatever the note claims (`ZkAMMPair.sol`
`depositPublic`, `withdrawROOT`; `ZkAMMRouter.buyPrivate`). No `commitment→amount`
ledger exists.

**Exploit:** deposit 1 R00T with `commitment = Poseidon(n, s, 10_000_000e18)` →
withdraw 10M → drains all other depositors'/LPs' funds.

**Fix:** `circuits/deposit.circom` (written) — proves `commitment ==
Poseidon(nullifier, secret, amount)` for the PUBLIC `amount`. Verify it on-chain
at deposit:
- `depositPublic`: require a deposit proof with `amount == transferred R00T`.
- `buyPrivate`: require a deposit proof with `amount == tokensOut` (contract-
  computed). UX note: `tokensOut` depends on curve state at execution, so the
  buy must (a) quote → (b) prove for that exact `tokensOut` → (c) execute
  atomically, or use a commit/settle with a bounded re-quote. Design carefully.

## 🔴 CRITICAL-2 — Cross-domain nullifier double-spend (pledge feature)
If the pledge rail marks nullifiers in a different set than sell/withdraw, one
note can be spent twice (ETH via sell AND plot via pledge). Pledge MUST check +
mark the SAME nullifier set the zkAMM uses (`NullifierRegistry`).

## 🟠 MEDIUM — pledge has no change output
`pledge.circom` spends the whole note; add a change commitment (like sell/withdraw)
or force pre-split via merge/transfer. Usability, not fund-loss.

## ✅ Verified sound
VKs byte-match proving keys (transfer/withdraw/merge/pledge); real Groth16 pairing;
nullifier = Poseidon(nullifier, leafIndex); field-range checks; publicInputsBinding;
CEI + nonReentrant on spends. The proof plumbing is good — the hole is the deposit
value binding upstream of it.

## Remediation order (all before real funds / before pledging)
1. Compile `deposit.circom` (circom + snarkjs) with a proper trusted setup; export
   verifier; VK-verify it (diff export vs deployed).
2. Wire deposit-proof verification into `depositPublic` + `buyPrivate` (+ tests
   that a mismatched-amount note is REJECTED).
3. Unify the pledge nullifier set with the zkAMM `NullifierRegistry`.
4. `/security-review` the diff; then build pledge/claim; re-audit; redeploy all.

## Status
- `circuits/deposit.circom` — written (draft, NOT compiled/set-up/deployed).
- Everything above needs a focused, tested implementation pass. Do NOT take
  third-party deposits into the live private DEX until CRITICAL-1 is fixed +
  re-audited.
