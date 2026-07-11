# PHASE A — Deposit-binding circuit + verifier (the CRITICAL-1 crypto core)

**Owner:** session A. **Depends on:** nothing. **Blocks:** B, C.
Read `docs/REMEDIATION_PLAN.md` + `AUDIT_ZK.md` first.

## Goal
Ship a sound, VK-verified `DepositVerifier` proving a note's public `amount`
equals the amount inside its public `commitment`. This is the primitive B uses to
close the pool-drain.

## Tasks
1. `circuits/deposit.circom` already drafted (Poseidon(nullifier,secret,amount) ==
   commitment; binding = Poseidon(amount, commitment)). Review vs `lib/poseidon.circom`
   `Commitment()` — confirm the SAME hash domain/order the deposit path uses.
2. Compile: `circom circuits/deposit.circom --r1cs --wasm --sym -o circuits/build -l circuits/lib`.
3. Trusted setup (phase 2) off `circuits/build/powersOfTau28_hez_final_16.ptau`:
   groth16 setup → contribute → export `deposit_final.zkey` +
   `deposit_verification_key.json`.
4. Export verifier: `snarkjs zkey export solidityverifier deposit_final.zkey` →
   `contracts/src/verifiers/DepositVerifier.sol` (rename contract →
   `DepositGroth16Verifier`, pragma ^0.8.24). Add a thin `RealDepositVerifier`
   wrapper implementing the frozen `IDepositVerifier` (see plan §Interfaces).
5. **VK-verify**: diff `snarkjs zkey export solidityverifier` output constants vs
   the committed verifier. Must be byte-identical.
6. Copy `deposit.wasm` + `deposit_final.zkey` → `frontend/public/circuits/deposit/`.
7. Add a foundry test with a REAL proof fixture: matching amount → `verifyProof`
   true; tampered amount → false.

## Frozen output (B depends on this — don't change without editing the plan)
- `contracts/src/verifiers/DepositVerifier.sol` + `RealDepositVerifier.sol`
- `IDepositVerifier.verifyProof(uint256[8], uint256[3] /*[binding,amount,commitment]*/)`
- proving artifacts in `frontend/public/circuits/deposit/`

## Done when
`forge build`/`test` green, VK verified identical, artifacts committed on
`feat/phase-a-deposit-circuit`. NO contract logic changes (that's B). NO deploy.

## Status
- [ ] circuit reviewed  [ ] compiled  [ ] setup  [ ] verifier+wrapper  [ ] VK-verified  [ ] proof test  [ ] committed
