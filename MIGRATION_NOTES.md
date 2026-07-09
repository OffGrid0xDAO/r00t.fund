# Migration Notes — clear the hackathon layer, re-align, add the pilot map

Branch: `feat/clear-and-pilot`. Work done in small, build-green commits. This is a
re-skin + feature add on a good frontend, not a rebuild.

## Workstream A — cleared / re-aligned (presentation only)

| Item | File | Decision |
|---|---|---|
| Hero headline "Fund what heals / Prove it on-chain" | `LandingPage.tsx` | **Re-align** → "Fund a plot / Grow it back" (consumer, not tech) |
| Hero sub-headline (Chainlink CRE pitch) | `LandingPage.tsx` | **Re-align** → "back a plot, choose what grows, watch it verified… take from the casino, give back to the land"; verification demoted |
| Hero + final CTA "Enter Protocol" | `LandingPage.tsx` | **Re-align** → "Back a Plot" |
| Tech-flex line "27 contracts. 8 CRE workflows. 12 ZK circuits." | `LandingPage.tsx` | **Remove** framing → "Real land. Real trees. Every contribution traceable…" (tech kept elsewhere) |
| Footer tagline "Verified by Chainlink…" | `LandingPage.tsx` | **Re-align** → "Take from the casino. Give back to the land." |
| "commented out for hackathon demo video" block | `LandingPage.tsx` | **Remove** → repurposed as the Project 001 pilot-section anchor |

Kept intact: the whole design system (tokens, type, components, animation idioms),
the metrics/lifecycle/problem/manifesto sections, and all substrate wiring.

## Workstream H — firewall scrub (identity + geometry)

Real place name **"Serra da Estrela"** and exact coordinates **`40.3228°N,
7.6114°W / Seia / EPSG:3763`** were embedded across frontend, README, contracts,
workflows, and diagrams. Now scrubbed to **"Project 001 / the pilot site"** and
**coordinates withheld** everywhere in tracked files. Verified:
`git grep -niE "serra|estrela|seia|40\.3228|7\.6114"` → clean (excl. `contracts/lib/`
vendored test vectors and `*.rsp`).

Scrub log:
- **Frontend (ships to users):** UI strings, `index.html` meta keywords, and
  internal symbols (`serraEstrela → pilotSite`, `SERRA_ESTRELA_ABI → PILOT_SITE_ABI`,
  `SERRA_DA_ESTRELA_SPECIES → PILOT_SITE_SPECIES`). Verified with `tsc`.
- **Contracts:** `SerraEstrelaNativeForest{.sol,.ts}` → `PilotSiteForest`, imports +
  deploy/simulate scripts updated, coord comment removed. Verified with `forge build` (green).
- **Workflows:** `workflow-7-serra-estrela/` → `workflow-7-pilot-site/`, diagram
  assets renamed, `SERRA_ESTRELA_*` config keys + comments scrubbed.
- **README + diagram SVGs:** coordinates removed, location generalized, anchor/heading realigned.
- **Real geodata:** copied into `.gitignore`'d `secret/terrain/` (source of truth,
  never committed).

Branch name and commit messages contain no real identifiers.

## Workstream C — fuzzed geometry

`scripts/fuzz-terrain.mjs` reads `secret/terrain/*.json` and emits
`frontend/public/terrain/*.json`:
- georeferencing (`coordinates` / `crs`) **stripped**;
- heightmap block-averaged **512² → 128²**;
- boundary + river **decimated and jittered** (decoupled from the legal parcel);
- contours **regenerated** from the fuzzed relief (marching squares), never
  transported from the real contour file.

Only fuzzed output is committed (an explicit `!frontend/public/terrain/*.json`
overrides the repo-wide `*.json` ignore).

## Workstreams B / D / E / F / G — pilot terrain + interactive map

Imported from the landing repo's `TerrainScene.tsx`; **its colours/fonts were NOT
imported** — re-rendered in r00t tokens. New code under `frontend/src/components/pilot/`:
- `PilotTerrain.tsx` (B) — re-skinned WebGL contour relief, fuzzed data, lazy-loaded.
- `PlotMap.tsx`, `PlotDetailPanel.tsx` (D) — hover/click/fund, choose-what-grows,
  lifecycle, greening-as-funding.
- `MachinesPanel.tsx` (E) — communal capex, funded together.
- `patronage.ts` (F/G) — `PatronageBackend` + `AttestationAdapter` interfaces with
  mock impls and marked contract/CCIP swap slots.
- `usePilotState.ts` — `seeking → greening → funded → planted → verified`.

Deps added to `frontend/`: `three@0.184`, `@react-three/fiber@8.18`, `@types/three`.

## Preserved substrate (kept, re-pointed — never deleted)
- Chainlink CRE workflows (`cre-workflows/`), ZK circuits (`circuits/`) + verifiers,
  CCIP integration, and the patronage/funding pool contracts.
- `PilotSiteForest.sol` data feed retained (identity scrubbed only).

## Open TODOs (for the PR)
- [ ] **Real terrain swap** — re-run `scripts/fuzz-terrain.mjs` against production
      geodata; drop-in replaces `frontend/public/terrain/*.json`. User to adjust the
      shape/zones from the pilot-site source.
- [ ] **Real fuzzed geometry per plot** — replace hand-placed screen positions in
      `pilot/data.ts` with fuzzed zone polygons derived from the terrain boundary.
- [ ] **Contract wiring (F)** — implement `makeContractPatronageBackend` against the
      patronage/funding contract (patronage-only; no value return).
- [ ] **Live CCIP attestation (G)** — implement `makeCcipAttestationAdapter` over the
      bridged attestation receiver.
- [ ] **Deprecated hackathon workflow-7** — per "we'll do different", plan removal or
      replacement of `workflow-7-pilot-site` / `PilotSiteForest` substrate.
- [ ] Optional: gzip/precompute contour asset (`contours.json` ~0.9MB raw / ~150KB gz).
