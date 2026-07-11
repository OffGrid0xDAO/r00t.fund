# PHASE C — Anonymous plot funding: pledge + claim (on the now-sound base)

**Owner:** session C. **Depends on:** B (deployed, unified nullifiers) + A pattern.
**Blocks:** D (final addresses/ABIs). Read plan + `AUDIT_ZK.md` first.

## Goal
Fund a plot from any wallet → later CLAIM $R00T/parcel tokens to ANY wallet, with
no on-chain link between the funding act and the claim wallet.

## Design (reuses B's sound shielded pool — no new crypto trust)
```
Fund:  spend a shielded R00T note (pledge.circom proof) → 100% credited to the
       plot's land treasury; record a PLEDGE commitment (Poseidon(n,s,parcelId,amt))
       into a pledge TokenPool. Nullifier marked in the SHARED NullifierRegistry.
Claim: claim(proof, recipient) → verify pledge-membership + spend pledge nullifier
       → mint parcel token / credit R00T to `recipient` (any wallet).
```

## Tasks
1. **Circuit:** `pledge.circom` currently spends the WHOLE note (no change). Add a
   `changeCommitment` output (like sell/withdraw) OR require pre-split — decide +
   document. If changed: recompile + phase-2 setup + verifier + VK-verify (plan §rules).
   Add a `claim.circom` (prove membership in the pledge tree + nullifier) OR reuse
   withdraw-style proof. VK-verify everything.
2. **Contracts:** extend `Land` (or a `PledgeVault` it owns) with:
   - `pledgePrivate(parcelId, proof, pubSignals, commitment, note)` — verify against
     B's `NullifierRegistry` + zkAMM merkle root; credit treasury; insert pledge
     commitment; emit `PledgeCommitment` (see plan §Interface).
   - `claim(proof, pubSignals, recipient)` — verify + `checkAndMark` pledge nullifier
     + mint/credit to recipient; emit `PledgeClaimed`.
   - Guard: CEI, nonReentrant, field-range checks, mint-vs-credit cap so you can't
     claim more than pledged.
3. Tests: pledge→claim happy path; double-claim REJECTED (nullifier); claim-to-
   different-wallet works; over-claim REJECTED; cross-spend with a zkAMM sell of the
   same note REJECTED (shared nullifier — the CRITICAL-2 regression test).
4. `/security-review` the diff. Redeploy `Land`/`LandFactory` (+ pledge vault),
   re-wire.
5. **Handoff:** new Land/pledge addresses + the two event ABIs → plan §Shared state,
   `config.ts`, `indexer`.

## Done when
Anon pledge→claim works to an unlinked wallet, all reject-tests pass, security-review
clean, redeployed. Branch `feat/phase-c-anon-pledge`.

## Status
- [ ] circuit change-output decision  [ ] pledge/claim contracts  [ ] tests (incl. reject)
- [ ] security-review  [ ] redeploy+rewire  [ ] handoff
