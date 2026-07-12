# PHASE B — Wire deposit-binding into the zkAMM + unify nullifiers (closes CRITICAL-1 & -2)

**Owner:** session B. **Depends on:** A's `IDepositVerifier`. **Blocks:** C, D.
Read `docs/REMEDIATION_PLAN.md` + `AUDIT_ZK.md` first.

## Goal
Make it impossible to insert a note worth more than what was deposited, and make
the nullifier set shareable so the pledge rail (C) can't double-spend.

## Tasks
1. Add `depositVerifier` slot to `ZkAMMAdmin` (like the other verifiers:
   constructor/`setVerifierInitial`/timelocked change). Deploy wires it.
2. **`depositPublic` (ZkAMMPair via Router):** require a deposit proof.
   - pubSignals = `[binding, amount, commitment]`; `amount == transferred R00T`,
     `commitment == inserted commitment`. Revert if `verifyProof` false.
   - Add a foundry test: a note with `Poseidon(n,s,BIG)` but `amount=1` is REJECTED
     (this is the exact drain exploit — must fail).
3. **`buyPrivate` (Router):** the hard one. `tokensOut` is contract-computed from
   curve state at execution, so the proof must bind to THAT value:
   - Pattern: caller passes proof for `commitment` with `amount == tokensOut`; but
     tokensOut isn't known until execution. Use one of:
     (a) exact-out: caller specifies `tokensOut`, contract requires the curve to
         deliver exactly it (revert otherwise) + proof binds to it; or
     (b) commit→settle: quote at block N, prove for that quote, execute within a
         bounded slippage/deadline.
   - Pick (a) unless UX demands (b). Document the choice. Test: mismatched
     `tokensOut` vs proof `amount` REJECTED.
4. **Nullifier unification:** ensure sell/withdraw/merge AND the future pledge use
   ONE `NullifierRegistry.checkAndMark`. Confirm the pair authorizes the registry
   and that C can call it. No separate `nullifiers` mapping paths that bypass it.
5. `/security-review` the diff. Then redeploy the DEX (`DeployRobinhood.s.sol` —
   extend to deploy + wire `DepositVerifier`), re-bootstrap, restore 3% fee.
6. **Handoff:** write the new Pair/Router/Admin/NullifierRegistry addresses into
   `docs/REMEDIATION_PLAN.md` §Shared state + `frontend/src/config.ts` +
   `indexer/ponder.config.ts` + `scripts/bootstrap-robinhood.mjs`.

## Done when
Drain-exploit test FAILS to drain (reverts), 20+ tests green, security-review
clean, redeployed + rewired, addresses handed off. Branch `feat/phase-b-deposit-binding`.

## Status
- [x] admin verifier slot  [x] depositPublic bind + reject-test  [x] buyPrivate bind + reject-test
- [x] nullifier unify  [ ] security-review  [ ] redeploy+rewire  [ ] handoff

### Notes / decisions (session B)
- **buyPrivate = EXACT-OUT (pattern (a)).** Caller commits to an exact `tokensOut`, builds
  `newCommitment = Poseidon(nullifier, secret, tokensOut)`, and submits a deposit proof binding
  the note to that value. Contract reverse-computes the ETH needed to release exactly `tokensOut`
  off the current curve (+fees), pulls it from `msg.value`, and refunds the remainder. `msg.value`
  is the max-in/slippage bound. Chosen over commit→settle (b): atomic, no quote-block trust, no
  second tx. `minTokensOut` slippage arg is gone (superseded by exact-out + max-in).
- **Nullifier unification.** Added `INullifierRegistry` + one-time `setNullifierRegistry` to the
  Router. ALL note spends (sell, sellToRailgun, transfer, merge×2, withdraw, addLiquidity input,
  atomic-swap ephemeral) now go through `NullifierRegistry.checkAndMark` — no Pair-local
  `nullifiers` path remains for token notes. LP nullifiers + fee-claim nullifiers are a separate
  domain and intentionally stay in the Pair. Registry set is immutable-once; spends fail closed if
  unset. Phase C's pledge/claim must use this SAME registry (checkAndMark) — that closes CRITICAL-2.
- **ABI changes (breaking — D must re-wire):**
  - `depositPublic(uint256 amount, uint256 commitment, bytes32 depositorBinding, uint256 binding, uint256[8] depositProof, bytes encryptedNote)`
  - `buyPrivate(uint256 newCommitment, uint256 tokensOut, uint256 binding, uint256[8] depositProof, uint256 deadline, bytes encryptedNote)`
- Regression tests: `contracts/test/ZkAMMDepositBinding.t.sol` (9, incl. the drain-exploit
  `test_depositPublic_valueForgery_reverts` + `buyPrivate` mismatch + shared-nullifier double-spend).
