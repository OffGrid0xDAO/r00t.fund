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

## Change-output decision (Task 1) — PRE-SPLIT, not change
`pledge.circom` spends the note WHOLE (its inner amount == public `pledgeAmount`). A
funder who wants to pledge less than a note holds first right-sizes it with the
existing zkAMM transfer/merge rails, then pledges the exact note. Rationale: a change
output would force the pledge contract to hold WRITE authority on the zkAMM commitment
tree (to re-insert the remainder) — a broad cross-domain privilege we deliberately
avoid. Pre-split keeps the trust boundary tight: the pledge rail only READS the zkAMM
root and SPENDS a nullifier in the shared registry; it never mutates the zkAMM tree.
Over-claim is prevented by baking `parcelId`+`amount` into the pledge commitment
(deposit-binding), so `claim.circom` can only ever release exactly what was pledged.

## Phase B seam (REQUIRED before deploy)
The vault pulls the pledged R00T from the shielded pool via
`IShieldedRootPool.releaseForPledge(address to, uint256 amount)` (in `PledgeVault.sol`).
Phase B's redeployed zkAMM pair/router MUST expose this and authorize ONLY the vault to
call it (mirrors the existing `withdrawROOT` onlyRouter pattern, but callable by the
vault after a verified pledge proof + freshly-marked spend nullifier). Mocked in tests
(`MockShieldedPool`). Also: authorize the vault on the SHARED `NullifierRegistry`
(`setPoolAuthorization(vault, true)`), and wait out the auth cooldown.

## Status
- [x] circuit change-output decision (pre-split; documented above)
- [x] pledge/claim circuits compiled + phase-2 setup + verifier + VK-verified (byte-identical)
- [x] pledge/claim contracts (`PledgeVault` + `Land.setPledgeVault`/`mintParcel`)
- [x] tests (15/15; 48/48 repo): happy path, double-claim REJECTED, claim-to-different-
      wallet works, over-claim REJECTED, CRITICAL-2 cross-spend REJECTED, + guard paths
- [ ] security-review (running on the diff before any redeploy)
- [ ] redeploy Land/LandFactory + PledgeVault + rewire (BLOCKED on B deploy + seam)
- [ ] handoff addresses (BLOCKED on deploy). Event ABIs frozen + emitted:
      `PledgeCommitment(uint256,uint256,bytes32,bytes)`,
      `PledgeClaimed(uint256,address,bytes32,uint256)`.
      Proving artifacts staged for D: `frontend/public/circuits/{pledge,claim}/`.
