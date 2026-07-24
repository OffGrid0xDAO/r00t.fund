# Regenerative Liquidity — the idea & ethos

*r00t.fund at ETHGlobal Lisbon 2026*

## The problem
Regenerating real land — reforesting burned slopes, rebuilding soil, water, terraces — needs
**patient capital**, but onchain capital is impatient and extractive. Three failures stack up:
1. **Funding is charity-shaped.** Give money, get a warm feeling. No liquid upside → no flywheel.
2. **Token launches are unfair.** A steward *guesses* the opening price; insiders front-run; price
   isn't discovered, it's dictated.
3. **The market value that *is* created gets strip-mined by MEV/arbitrage bots** the moment two
   venues exist for the same asset.

## The ethos
- **100% of what backers pay funds the actual land.** Liquidity is provided by the protocol, never
  skimmed from the mission. *(carries over r00t's rule: pledges fund the ground, never LP.)*
- **Privacy is a right, not a premium you're punished for.** Backers can fund and trade **shielded**.
- **The privacy premium regenerates the land.** When someone pays a little for privacy, that little
  should go somewhere good — not to a sandwich bot.
- **Fair launches only.** A parcel's price is **discovered by the crowd**, not set by a steward.
- **Permissionless stewards.** Anyone reviving real land can spin up parcels and markets themselves.

## The idea in one breath
> **Every parcel of real land becomes its own fair-launched token with two synchronized markets — one
> private, one public — and the arbitrage that keeps them in sync is captured and spent on
> regenerating that exact plot.**

## How the pieces serve the ethos
| Piece | What it does | Why it matters |
|---|---|---|
| **CCA fair launch** (Uniswap Liquidity Launchpad) | crowd discovers each parcel's price P | ends steward price-guessing; fair entry |
| **Private zkAMM** (parcel/R00T) | shielded trading venue | backers keep privacy |
| **Public Uniswap v4** (parcel/R00T + hook) | open market + reference price | liquidity + discovery |
| **RegenArbHook** (v4 hook) | back-runs each trade, arbitrages the two pools, spread → regen | turns MEV/privacy-premium into regeneration |
| **ENS** (`oak.r00t.eth`) | parcel identity + live records | the land is legible + portable |
| **RegenLaunchpad** | one-tx steward self-service | permissionless, automatic |

## The innovation (what's genuinely new)
1. **Arbitraging a *shielded* AMM from a public Uniswap v4 hook.** You can't run a ZK-proof trade in a
   hook — but the private pool's **reserves are public** and it has **public swap functions**, so the
   hook does a *real* cross-pool arb while user **trade amounts stay hidden**. Private trades, public
   sync.
2. **Arb-to-regeneration as a primitive.** LVR / MEV that bots normally extract from LPs is redirected,
   per-trade and on-chain, into a real-world regenerative treasury.
3. **A fair-launch → dual-pool → self-syncing pipeline** a steward triggers in a single click.

## Why it aligns speculation with the planet
Normally, speculation and regeneration pull apart. Here they're wired together: **the more a parcel is
traded, the more its land is regenerated** (via captured arb), and **every entry is fair** (via the
CCA). Financial gravity now points at the soil.

## Scope of this hackathon
New at the event, on top of the live r00t.fund product (Continuity Track): the **RegenArbHook**, the
**RegenLaunchpad** orchestrator, the **CCA** parcel launch, **ENS** parcel names/records, and the
**Uniswap API** trading UX. See `INFRA.md` (system), `DESIGN.md` (hook), `README.md` (prizes).
