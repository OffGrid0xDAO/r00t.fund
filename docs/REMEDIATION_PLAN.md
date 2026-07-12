# r00t — ZK Remediation + Anonymous Pledging (4-session parallel plan)

Master coordination doc. Each session owns ONE phase file (PHASE_A..D.md).
Read this first, then your phase. Findings/context: `AUDIT_ZK.md`.

## Why we're doing this
Deep ZK audit found **CRITICAL-1: deposit value forgery** — a note's internal
amount is never bound to the R00T actually deposited, so `deposit 1 → withdraw 10M`
drains the shielded pool. Plus **CRITICAL-2: cross-domain nullifier double-spend**
if the pledge rail uses a separate nullifier set. Must be fixed before any
third-party funds or anonymous pledging.

## Shared state (Robinhood Chain, chainId 4663) — DO NOT edit without coordinating
Current LIVE (pre-fix) addresses in `frontend/src/config.ts` (ARBITRUM_CONTRACTS):
- $R00T:            `0x7d0bfc2145327CF98f882De2CB71f8F1D7b8f022`
- ZkAMMPair:        `0xbd34EF73b3Cb1b8Bb0fFba47a42AFdbA90Ccf511`
- ZkAMMRouter:      `0x2EaFE93d9ecf8B8E2Dd0C5f0B5c86a374206C6B0`
- ZkAMMAdmin:       `0x2fF206f68c68b49eBfE5D1c39B26281669bcB851`
- NullifierRegistry:`0x39E35022a8591ad836472Fe234b0FEa8e505D9DD`
- LandFactory:      `0x849F8d78A1D8EA9cDa277Fb1f410E55272bD241D`
> These get REPLACED by Phase B/C redeploy. Only the session running the final
> deploy edits config/indexer addresses (see "Handoff").

## Dependency graph
```
A (circuits) ──► B (zkAMM deposit-binding + nullifier unify) ──► C (pledge/claim)
                                                     └──────────► D (indexer + frontend)
```
- **A** is independent — start immediately.
- **B** needs A's `DepositVerifier` interface (frozen in PHASE_A §Interface).
- **C** needs B's unified `NullifierRegistry` wiring + A's deposit pattern.
- **D** can build UI/indexer scaffolding immediately against the frozen ABIs in
  PHASE_D §Interface; only final address wiring waits on the B/C deploy.

## Frozen interfaces (so sessions don't block each other)
Agreed BEFORE coding. If a phase must change one, edit here + ping others.

### DepositVerifier (A → B)
```solidity
interface IDepositVerifier {
    // pubSignals = [binding, amount, commitment]  (Circom output first)
    function verifyProof(uint256[8] calldata proof, uint256[3] calldata pubSignals)
        external view returns (bool);
}
```

### NullifierRegistry usage (B defines, C consumes)
- ONE registry instance shared by zkAMM + pledge. Both call
  `checkAndMark(nullifierHash)` before paying/minting. No separate sets.

### Pledge/Claim events (C → D indexer)
```
event PledgeCommitment(uint256 indexed commitment, uint256 indexed leafIndex, bytes32 parcelId, bytes note);
event PledgeClaimed(uint256 indexed nullifierHash, address indexed recipient, bytes32 parcelId, uint256 amount);
```

## ★ Redeploy-freely policy (applies to every phase)
There are **no proxies, no migrations, no immutable-address constraints** on any
r00t contract. If a change adds security or correctness, **rewrite the contract
and redeploy it** — do NOT contort logic to preserve an existing address. This is
the sanctioned path, not a last resort.
- Any session may redeploy any contract it owns (zkAMM set, Land/LandFactory,
  verifiers, registries) when it improves security/soundness.
- Redeploy = fresh addresses. The owning session then rewires `frontend/src/config.ts`,
  `indexer/ponder.config.ts`, `scripts/bootstrap-robinhood.mjs`, updates
  §Shared state below, and hands off to dependent phases.
- The only guardrails before a mainnet broadcast: tests green + circuit VKs
  verified + `/security-review` on the diff + explicit human go.
- Live pools only hold our own test funds — abandoning an old deployment for a
  safer one is cheap and expected. Recover leftover funds via rescueETH/
  rescueTokens/setReserves (or an LP note) when practical, else write off.

## Global rules for every session
1. Work on a branch off `feat/clear-and-pilot`: `feat/phase-<x>-...`. Rebase before deploy.
2. `forge build` + `forge test` green before every commit. No red commits.
3. Any circuit: compile → phase-2 setup off `circuits/build/powersOfTau28_hez_final_16.ptau`
   → export verifier → VK-verify (diff `snarkjs zkey export solidityverifier` vs the
   committed `*Verifier.sol`). NEVER ship a verifier whose VK ≠ its `_final.zkey`.
4. NO mainnet broadcast without: tests green + `/security-review` on the diff + explicit go.
5. Update your phase file's "Status" as you go.

## Handoff / merge order
A → merge. B → rebase on A, merge, **deploy**, hand new addresses to C+D.
C → rebase on B, merge, **deploy**, hand pledge addresses to D.
D → rebase on B+C, wire final addresses, run indexer, ship frontend.
Final `/security-review` on the combined diff before public use.
