# $R00T — Regen Launch tokenomics (draft)

> Direction set by the founder (2026-07): move from strict patronage-only to a
> degen-friendly launch to attract capital to the land. The guiding invariant
> that remains: **pledged ETH/USDC funds the land — it is never used as LP.**
>
> ⚠️ This is a token-distribution / launch design, not legal advice. "Early
> pledgers get more token supply" + a tradable token has securities-law exposure
> in many jurisdictions. Get counsel before mainnet.

## The two-loop model

**Loop A — Pledge (funds the land).**
- Degens pledge ETH/USDC to parcels they like on the land map.
- **100% of pledges → land treasury** (regeneration capex). Not LP, not yield.
- In return, pledgers accrue a **$R00T allocation on an early-bird curve** —
  earlier = more $R00T per €. Allocation is locked, claimable at TGE.

**Loop B — Token (number-go-up).**
- At TGE a **reserved $R00T allocation** seeds a **Uniswap v4 one-sided-liquidity**
  position (range order in $R00T only — no ETH needed to bootstrap). Buyers bring
  the ETH; that buy-side ETH can also route to the land treasury.
- Token trades on the open market. Early pledgers acquired it below the launch
  price on the curve → their position is up vs market. The upside lives in the
  token's own market, decoupled from the pledged land money.

## Early-bird distribution (favor early degens)

Tiered rounds with a rising price + visible FOMO:

| Round | Price (€/$R00T) | Cap | Signal |
|------:|:---------------:|:---:|--------|
| 1 | 0.010 | first €X or N days | best deal, "genesis" badge |
| 2 | 0.014 | next tranche | — |
| 3 | 0.019 | next tranche | — |
| … | … | … | "Round k of N — price rises in €X or Yh" |

Earlier € buys more $R00T ⇒ early pledgers hold the largest positions at the
lowest cost basis. Simple, legible, degen-legible.

## One global $R00T (not per-parcel tokens)

Parcels are **gamified allocation buckets**, not separate tokens. All pledges earn
the one $R00T; per-parcel flavor comes from badges, heat, and (optional) per-parcel
bonus multipliers. Per-parcel tokens would fragment liquidity into dead markets and
multiply legal/technical risk — avoided.

## Momentum / heat (shipped, non-price)

The map surfaces a **Regen Index** and **parcel heat** — momentum signals (recent
pledge velocity, backers, funding %). These are *stats that go up*, not prices:
they drive FOMO and competition without asserting a financial claim on a parcel.

Implemented in `frontend/src/components/pilot/`:
- `ui.ts` — `parcelHeat`, `recentEur`, `regenIndex`.
- `PlotMapTopo.tsx` — hot parcels pulse; 🔥 on the hottest; live pledge feed;
  a demo pledge simulator so momentum is visible; Regen Index in the tooltip.

## Open build TODOs
- [ ] Pledge contract: `pledge(bytes32 parcel)` → funds land treasury, records
      €/ETH + timestamp + round; emits allocation. No LP path from pledges.
- [ ] Early-bird curve on-chain (round price schedule or continuous bonding).
- [ ] TGE + claim contract; vesting/lock as chosen.
- [ ] Uniswap v4 one-sided-liquidity hook to seed the market from the reserve
      allocation; route buy-side ETH to treasury.
- [ ] Legal review before any of the above ships to mainnet.
