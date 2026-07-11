# PHASE D — Indexer + frontend for anonymous pledging (incl. Portfolio)

**Owner:** session D. **Depends on:** final ABIs (frozen in plan) now; addresses
after B+C deploy. Can start scaffolding IMMEDIATELY. Read plan first.

## Goal
"Fund privately" flow on the plot/pilot map + a "Claim to wallet" flow in Portfolio,
against the sound pledge/claim rail from C.

## Tasks (scaffold now, wire addresses after C)
1. **Indexer:** add `PledgeCommitment` + `PledgeClaimed` handlers to
   `indexer/ponder.config.ts` (same pattern as the zkAMM `NewCommitment`/nullifier
   handlers). Index the pledge merkle tree so the frontend can build claim proofs.
2. **Fund-privately UI** (plot detail / pilot map): reuse the existing shield flow
   from `usePrivateWallet` to get a shielded R00T note, then call `pledgePrivate`.
   Generate + store the encrypted pledge note (client-side secret). Show a
   confirmation that the deposit wallet is NOT linked to future claims.
3. **Portfolio page:** new "Private pledges" section listing pending/claimable
   pledges (from the encrypted notes + indexer), each with a **"Claim to wallet…"**
   action: input a recipient address → build claim proof (snarkjs, wasm+zkey from
   `frontend/public/circuits/`) → `claim(proof, pubSignals, recipient)`.
4. Reuse patterns already in the repo: `SwapPanel`/`LiquidityPanel` for proof-gen +
   indexer GraphQL; `useZkProver`, `usePrivateWallet`, `queryPonder`.
5. Copy new circuit artifacts into `frontend/public/circuits/{pledge,claim}/`.
6. Typecheck clean. Manual test against the redeployed contracts (indexer running,
   `PONDER_NETWORK=robinhood`).

## Wiring (after C hands off)
- Update `frontend/src/config.ts` land/pledge addresses + `indexer` start block.

## Done when
Fund-privately + Portfolio claim-to-wallet work end-to-end against C's contracts;
indexer serves pledge commitments/nullifiers. Branch `feat/phase-d-frontend-pledge`.

## Status
- [x] indexer handlers  [x] fund-privately UI  [x] portfolio claim UI  [x] artifacts  [ ] wired+tested

### Progress (scaffold complete — 2026-07-11, branch `feat/phase-d-frontend-pledge`)
- **Indexer** (`indexer/`): `PledgeCommitment` + `PledgeClaimed` handlers added
  (`src/index.ts`), gated behind `PONDER_PLEDGE_ADDRESS` so the indexer still boots
  with no vault wired. New tables `pledge_commitments` / `pledge_nullifiers` /
  `pledge_claims` (`ponder.schema.ts`); the pledge merkle tree is maintained in the
  shared `merkleTreeState` keyed by the vault address via a new `updateCommitmentTree`
  helper (same depth-24 Poseidon logic as zkAMM `NewCommitment`). Contract registered
  in `ponder.config.ts` (`PledgeVault`, robinhood-only, `PLEDGE_ENABLED` guard).
  `ponder codegen` clean.
- **SDK** (`sdk/`): `proveClaim` + `ClaimProofInputs` + claim-artifact loading
  (`loadCircuitArtifactsFromUrls` → `claim/claim_js/claim.wasm`, `claim/claim_final.zkey`),
  matching the committed `circuits/claim.circom` (public
  `[merkleRoot,nullifierHash,parcelId,amount,recipient]`, output `recipientBinding`).
  `npm run build` + `typecheck` clean.
- **Fund-privately UI**: `FundPrivatelyPanel.tsx` (pilot map) — shields R00T via
  `usePrivateWallet` + spend-proof, then `pledgePrivate(...)` to the vault, stores the
  encrypted pledge note client-side (`usePledge`). Reached from a new "Fund privately"
  button on `PlotDetailPanel`. Shows the "deposit wallet is NOT linked to claims" note.
- **Portfolio claim UI**: new `_pledges` tab (`components/portfolio/PrivatePledges.tsx`)
  lists pending/claimable/claimed pledges; "Claim to wallet…" builds a claim proof
  (`useZkProver.generateClaimProof`) and calls `claim(proof, pubSignals, recipient)`.
- **Artifacts**: `circuits/build/claim` copied to `frontend/public/circuits/claim/`
  (`*.wasm`/`*.zkey` gitignored on disk, same as the `pledge/` sibling).
- **Config**: `CONTRACTS.pledgeVault` (`VITE_PLEDGE_VAULT`) + `EVENTS.pledgeCommitment`
  / `EVENTS.pledgeClaimed` topics. UI is gated behind `pledge.isReady` (a configured
  vault) so nothing runs against a `0x…` placeholder.
- Frontend `tsc --noEmit` clean.

### Remaining (after Phase C deploy)
1. Set `VITE_PLEDGE_VAULT` (frontend/src/config.ts) + `PONDER_PLEDGE_ADDRESS` /
   `PONDER_PLEDGE_START_BLOCK` (indexer) to the deployed vault.
2. Confirm Phase C's `pledgePrivate` arg tuple matches `frontend/src/abis/pledge.ts`
   (`PLEDGE_VAULT_ABI`); adjust if the vault's signature differs.
3. Run indexer with `PONDER_NETWORK=robinhood` and test fund→claim end-to-end.
