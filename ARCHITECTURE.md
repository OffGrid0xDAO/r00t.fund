# Architecture — r00t.fund

How the consumer product, the verification substrate, and the bridge between them
fit together. This document reflects the re-alignment from the hackathon submission
to the consumer regenerative-crowdfunding product ("fund a plot, choose what grows,
watch it verified").

## Three planes

```
┌─────────────────────────────────────────────────────────────────────────┐
│  CONSUMER FRONT  (frontend/, Vite + React)                                │
│                                                                           │
│   Landing (LandingPage.tsx)                                               │
│     └─ Project 001 pilot section  (components/pilot/*)                     │
│          ├─ PilotTerrain      three.js contour relief, FUZZED geometry     │
│          └─ PlotMap            hover / click / fund · choose-what-grows     │
│               ├─ PatronageBackend   fund()      → mock now / contract later │
│               └─ AttestationAdapter getAttestation() → mock now / CCIP later │
│                                                                           │
│   Reads a per-plot "verified" status. NEVER runs CRE or ZK itself.         │
└───────────────▲───────────────────────────────────────────────▲──────────┘
                │ patronage contribute()                          │ verified status
                │ (no revenue share, ever)                        │ (read-only)
┌───────────────┴──────────────┐                   ┌──────────────┴──────────────┐
│  PATRONAGE / FUNDING          │                   │  CCIP BRIDGE                 │
│  (consumer-chain contract)    │                   │  attestation receiver        │
│  contribute(plot, amount)     │                   │  latestAttestation(plot)     │
│  patronage entitlements only  │                   │  carries the CRE/ZK verdict  │
└──────────────────────────────┘                   └──────────────▲──────────────┘
                                                                   │ CCIP message
                                                    ┌──────────────┴──────────────┐
                                                    │  CRE-CAPABLE CHAIN           │
                                                    │  (contracts/, cre-workflows/) │
                                                    │  • Chainlink CRE workflows    │
                                                    │  • ZK circuits + verifiers    │
                                                    │  • pilot-site data feed (W7)  │
                                                    │  Verification substrate —     │
                                                    │  stays here, is NOT ported.   │
                                                    └──────────────────────────────┘
```

## Where each thing plugs in

### Consumer front — `frontend/`
- Vite + React, framer-motion, Tailwind tokens (`--accent`, `--bg-*`, forest/gold/stone).
- The pilot experience lives in `frontend/src/components/pilot/`:
  - `PilotTerrain.tsx` — WebGL contour-relief render (three.js / @react-three/fiber),
    lazy-loaded, driven by `frontend/public/terrain/*.json`.
  - `PlotMap.tsx` + `PlotDetailPanel.tsx` + `MachinesPanel.tsx` — the interactive
    map, plot detail, and communal-capex flows.
  - `usePilotState.ts` — the lifecycle state machine (`seeking → greening → funded
    → planted → verified`).
  - `patronage.ts` — the two integration interfaces (below).
- The front only ever **reads** a verified status. It does not know about CRE or ZK.

### Patronage / funding — `PatronageBackend` (Workstream F)
- Interface in `frontend/src/components/pilot/patronage.ts`.
- `mockPatronageBackend` records contributions locally today.
- **Swap slot:** `makeContractPatronageBackend(client, address)` calls the
  patronage/funding contract's `contribute(bytes32 plot, uint256 amount)`.
- **Legal invariant:** the contract records patronage only. It must never transfer
  value, shares, yield, or resale rights back to a backer or a token. Backer
  entitlements are produce / stays / naming / choose-what-grows / certificate badge.
- Wire to `contracts/src/**/ZkProjectPool.sol` if it exposes a patronage-style
  contribute; otherwise scaffold a minimal `Patronage` contract with no
  value-return path.

### CCIP bridge — `AttestationAdapter` (Workstream G)
- Interface in `patronage.ts`. `mockAttestationAdapter` returns a synthetic
  attestation so the fund→plant→verify loop is exercisable.
- **Swap slot:** `makeCcipAttestationAdapter(client, receiverAddress)` reads the
  latest attestation the CCIP receiver recorded for a plot.
- The consumer chain sees only the **bridged attestation** (a verdict + NDVI proxy
  + message id). It never sees or runs the CRE workflow.

### CRE-capable chain — `contracts/`, `cre-workflows/`
- Chainlink CRE workflows (`cre-workflows/workflow-*`), ZK circuits (`circuits/`),
  and verifier contracts are the **verification substrate** and stay here.
- `PilotSiteForest.sol` (formerly the hackathon W7 feed) publishes the pilot-site
  restoration data (NDVI recovery etc.) as an `AggregatorV3Interface` feed.
- CRE + ZK verification stay on this chain. Per the firewall/chain rules, they are
  **not** ported to the consumer/Robinhood chain — only their attestation crosses
  the bridge.

## Firewall boundaries (identity + geometry)
- Real place name and exact coordinates appear **nowhere** in tracked code, content,
  comments, asset names, or history. The land is "Project 001 / the pilot site".
- Real geodata lives only in the `.gitignore`'d `secret/` path. The committed
  terrain in `frontend/public/terrain/` is **fuzzed** (georeferencing stripped,
  downsampled, decimated + jittered) by `scripts/fuzz-terrain.mjs`.
- Plot zones are indicative and screen-relative — not cadastral parcels.

See `MIGRATION_NOTES.md` for the keep/remove decisions and the full firewall log.
