# LandVault Security Audit — 2026-07-12

## Result: audit-clean — no HIGH/MEDIUM fund-loss vulnerabilities.

Scope: LandVault.sol, landdeposit.circom (+ verifier), Land.sol landVault wiring.
52/52 tests pass incl. all attack cases. landdeposit VK byte-identical to zkey.

### Verified safe
- Value forgery/drain: commitment binds (parcelId, amount) via landdeposit; claim
  reuses verified claim circuit binding the same leaf. No over-claim, no cross-parcel.
- Reserve solvency: committedR00T <= reserveR00T enforced; claims payable always.
- One-shot/irreversible: shared nullifier marked first (CEI) on both claim paths.
- Reentrancy: nonReentrant + CEI throughout; mintParcel has no callback.
- Front-run/MEV: proofs require funder secret; recipientBinding; dup guard.
- Field-range on all public signals. Rounding favors protocol/treasury.
- Access control: onlySteward; mintParcel vault-gated.

### Hardened during review
- setParcelTarget frozen once funding starts (no goalpost-moving).
- claims NOT pausable (pause can't trap patron funds).

### Deploy-time wiring (REQUIRED — else claims revert; not vulns)
1. Authorize vault in shared NullifierRegistry (governance setPoolAuthorization).
2. land.setLandVault(vault) — else claimParcelToken reverts.
3. Steward fundReserve(enough R00T) to back funding.

### Circuit
- landdeposit.circom: fully constrained (commitment + binding), minimal, mirrors
  the audited deposit.circom. VK verified byte-identical to deposit_final.zkey.
