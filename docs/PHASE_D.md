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
- [ ] indexer handlers  [ ] fund-privately UI  [ ] portfolio claim UI  [ ] artifacts  [ ] wired+tested
