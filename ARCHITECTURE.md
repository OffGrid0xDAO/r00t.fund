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
│     └─ Pilot Project section  (components/pilot/*)                         │
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

## Token & land economic layer — `contracts/src/` (Robinhood Chain)

Launches run on **Robinhood Chain** (chainId 4663) — native Uniswap v2/v3/**v4**
and Chainlink CCIP/Data Feeds from day one.

```
LandFactory ── createLand($R00T pledge) ──▶ Land (own treasury + parcel registry)
   holds v4 wiring                              │
   (PoolManager, fee, protocol tsy)             ├─ validate()  ← off-chain KMZ/topo check
                                                ├─ createParcel() → ParcelToken ($OAK…)
                                                ├─ seedParcelLiquidity() → REAL v4 pool
                                                │     (parcel/$R00T, full-range, unlock/settle)
                                                ├─ pledgeETH/USDC → 100% to treasury,
                                                │     mint parcel token AT LIVE POOL PRICE
                                                └─ collectParcelFees() → 70% steward / 30% protocol
```

- **`LandFactory.sol`** — anyone opens a land; requires an $R00T pledge that becomes
  the land's seed liquidity reserve. Holds the shared `PoolManager` + fee config.
- **`Land.sol`** — treasury, parcel-token registry, and the Uniswap v4 integration
  (implements `IUnlockCallback`; reads price via `StateLibrary`). Geo files validated
  off-chain, hashes + CID committed on-chain, `validator` gates pledges/parcels.
- **`ParcelToken.sol`** — per-parcel culture token, mint-restricted to its `Land`.
- Economics + the OTC-$R00T discount/premium mechanism: see `TOKENOMICS.md`.
- **Invariant:** pledged ETH/USDC funds the land and is never LP; only the
  steward's separately-pledged $R00T seeds parcel liquidity.

## Firewall boundaries (identity + geometry)
- Real place name and exact coordinates appear **nowhere** in tracked code, content,
  comments, asset names, or history. The land is "the Pilot Project / the pilot site".
- Real geodata lives only in the `.gitignore`'d `secret/` path. The committed
  terrain in `frontend/public/terrain/` is **fuzzed** (georeferencing stripped,
  downsampled, decimated + jittered) by `scripts/fuzz-terrain.mjs`.
- Plot zones are indicative and screen-relative — not cadastral parcels.

See `MIGRATION_NOTES.md` for the keep/remove decisions and the full firewall log.
