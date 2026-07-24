# r00t.fund × ETHGlobal Lisbon 2026 — Regenerative Liquidity

> **Every land parcel is an ENS name with its own Uniswap v4 pool. A hook back-runs each trade with a
> real arbitrage between the public pool and r00t.fund's private zkAMM, keeping them in sync — and the
> captured spread regenerates that exact plot.** Fair launches (CCA) + private↔public peg-keeping that
> funds regeneration.

This directory is the **hackathon workspace**, kept separate from the production r00t.fund code so
judges can verify exactly what was built at the event. Continuity Track (r00t.fund is a live product).

## What's new (built at the event)
| Piece | File | Prize |
|---|---|---|
| **RegenArbHook** — v4 hook: real cross-pool arb (Uniswap ↔ zkAMM), spread → regen treasury | [`contracts/src/RegenArbHook.sol`](contracts/src/RegenArbHook.sol) · [DESIGN.md](DESIGN.md) | 🦄 Uniswap **Stack Contribution** |
| **Uniswap API** trade/LP execution against the hooked parcel pools | `frontend/` (event) | 🦄 Uniswap **API Integration** |
| **Parcel ENS subnames** (`oak.r00t.eth`) + text records (`token`, `pool`, `regenCaptured`, `clearedPrice`) | `ens/` (event) | 🪪 ENS **Continuity** |
| **Parcel CCA fair-launch** (Liquidity Launchpad) — *stretch* | `contracts/src/ParcelCCA.sol` (event) | strengthens both Uniswap prizes |

## The core primitive (RegenArbHook)
- A v4 hook **cannot** run a shielded zkAMM trade — but the zkAMM's **reserves/price are public**, and
  it has **public swap functions** (`buyTokensForShorts`/`sellTokensForShorts`). The hook uses those to
  execute a **real two-leg arb in `afterSwap`**, re-syncing the pools and realizing the spread as ETH →
  the plot's regen treasury. Shielded users' notes are untouched; only the public price moves.
- Full mechanism + security guards: **[DESIGN.md](DESIGN.md)**.

## Verify (for judges)
- Hook contract + the arb logic: `contracts/src/RegenArbHook.sol` (`afterSwap`).
- zkAMM public rebalance surface: `contracts/src/interfaces/IZkAMMRebalance.sol`.
- Uniswap API integration: see `frontend/…` (README links to exact lines).
- Live demo + video: (link at event).

## Demo beat
Launch `cactus.r00t.eth` via CCA → clears at a fair price, seeds the v4 pool → judge buys `$CACTUS`
through the **Uniswap API** → RegenArbHook back-runs it, syncs the private zkAMM, sweeps the spread →
the ENS `regenCaptured` record ticks up → the plot greens on the map.

## Target chain
Uniswap API + ENS don't support Robinhood Chain → demo on **Unichain Sepolia** (best v4/API support)
with **ENS on Sepolia**. Production r00t.fund stays on Robinhood Chain.

## Requirements checklist
- [ ] Public repo (this) · open source
- [ ] [`FEEDBACK.md`](FEEDBACK.md) + Uniswap Developer Feedback Form submitted
- [ ] README points to the hook contract + Uniswap API lines
- [ ] Valid Uniswap Developer Platform API key
- [ ] Functional demo (no hardcoded values) · video/live link · present in person (ENS booth Sun AM)
