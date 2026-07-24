# RegenLaunchpad — full infrastructure (steward self-service)

> Any steward, from the frontend: **create a Land → add parcels → run a fair CCA → auto-seed the
> private zkAMM + public Uniswap v4 pool → wire the rebalancing hook → go live.** No scripts, no
> per-parcel contract deploys.

## Architecture

```
                         ┌───────────────────────── FRONTEND (Steward Console) ─────────────────────────┐
                         │  Create Land · Add Parcel · Launch CCA · Monitor (regenCaptured, prices)       │
                         └───────────────┬───────────────────────────────────────────────┬───────────────┘
                                         │ wagmi txs                                       │ Uniswap API (public trade/LP)
                                         ▼                                                 ▼
   ┌─────────────────┐   createLand   ┌──────────────────────┐   register(poolId,cfg)  ┌───────────────────────┐
   │  RegenLaunchpad  │──────────────▶│  Land (per steward)   │                          │  RegenArbHook (SHARED) │
   │   (orchestrator) │   createParcel │  - parcel tokens      │◀────── afterSwap arb ────│  registry: poolId→cfg  │
   │                 │──────────────▶│  - regenTreasury      │                          │  (deployed ONCE, mined)│
   │  startCCA / bid  │   clearAndLaunch                       │                          └───────────────────────┘
   │  clearAndLaunch  │──────┬────────┴──────────┬────────────────────┬───────────────┐
   └─────────────────┘      │ seed              │ seed               │ raise         │ ENS records
                            ▼                   ▼                    ▼               ▼
                    ┌───────────────┐   ┌────────────────────┐  ┌─────────────┐  ┌──────────────────┐
                    │ private zkAMM  │   │ public Uni v4 pool  │  │ regenTreasury│  │ <parcel>.r00t.eth │
                    │  (parcel/R00T) │   │ (parcel/R00T, HOOK) │  │  (the land)  │  │  text records     │
                    └───────────────┘   └────────────────────┘  └─────────────┘  └──────────────────┘
```

## Contracts

### `RegenLaunchpad` (orchestrator — the "automatic" glue)
- `createLand(name, region, geo, ensNode)` → deploys/【uses existing】 `Land`; mints `<land>.r00t.eth`.
- `createParcel(land, {name, ticker, supply, cca})` → deploys the parcel ERC20; mints
  `<parcel>.<land>.r00t.eth`; sets record `status="pending"`.
- `startCCA(parcel, window, reservePriceR00T)` → opens the auction; record `status="auction"`.
- `bid(parcel, r00tAmount)` → escrow bid (CCA).
- **`clearAndLaunch(parcel)` — ONE tx does everything:**
  1. CCA clears at uniform price **P**; bidders get tokens; refunds the marginal.
  2. **Raise (R00T) → regenTreasury** (100% funds the land).
  3. Pull pool R00T-side from the **protocol reserve**; seed **both** pools at P:
     `zkAMM.setReserves(...)` (private) + `Land.seedParcelLiquidity(P, ...)` (Uni v4, hooked).
  4. `RegenArbHook.register(uniPoolId, {zkAMM, regenTreasury, parcelId})`.
  5. `zkAMM.rebalanceFor(hook)`; write ENS records `clearedPrice=P`, `pools`, `status="live"`.

### `RegenArbHook` (SHARED, deployed once)
- Registry `poolId → ParcelConfig`. `register()` is `onlyLaunchpad`.
- `afterSwap`: look up cfg by `key.toId()` → real two-leg arb (zkAMM ↔ Uni) → spread → `cfg.regenTreasury`.
- See [DESIGN.md](DESIGN.md) for the arb mechanism + guards.

### Reused (extended on the demo chain)
- `Land` (already seeds Uni v4 pools — swap `IHooks(address(0))` → the shared hook).
- `ZkAMMPair` (+ `rebalanceFor` role; seed via `setReserves`).
- Parcel ERC20s.

## Frontend — Steward Console (new, hackathon)
| Screen | Actions | Reads |
|---|---|---|
| **Create Land** | name/region/geo → `createLand` → ENS name | tx status |
| **Parcels** | add parcel, set supply + CCA params, **Launch** | funding %, status from ENS |
| **Auction (CCA)** live | bidders place bids; steward `clearAndLaunch` | clearing curve, demand |
| **Dashboard** | per parcel: prices (zkAMM vs Uni), **regenCaptured**, pool depth | hook events, ENS records |

Plus **public parcel page**: bid in CCA, **trade via the Uniswap API**, see `regenCaptured` + the plot greening.

## Token allocation (per parcel, e.g. 1,000,000)
| CCA auction | Public Uni v4 LP | Private zkAMM LP | Regen reserve |
|---|---|---|---|
| 40% (→ raise → land) | 20% | 20% | 20% |
Both pools seeded at the **same** cleared price P (zero launch-arb); R00T-side from the protocol reserve.

## What's realistically built at the event (48h cut)
**Core (win condition):** shared `RegenArbHook.afterSwap` (real arb → treasury) · `RegenLaunchpad.clearAndLaunch`
seeding both pools + wiring the hook · Steward Console (create land / launch parcel) · public trade via
**Uniswap API** · ENS subname + records.
**Headline stretch:** the full CCA bidding UX (else launch at a fixed P).
**Skip unless ahead:** multi-steward polish, am-AMM.

## Chain
Unichain Sepolia (Uniswap v4 + API) · ENS on Sepolia. Production r00t.fund stays on Robinhood Chain.
