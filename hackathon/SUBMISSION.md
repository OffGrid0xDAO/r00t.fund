# ETHGlobal Lisbon 2026 — submission fields

Fill final links/numbers at the event; copy fields below into the ETHGlobal form.

**Project name:** r00t.fund — Regenerative Liquidity

---

## Short description  (≤100 chars — tweet-fittable)

> Fair-launch real-land tokens on Uniswap v4; a hook turns cross-pool arbitrage into regeneration.

_Alternates:_
- `A Uniswap v4 launchpad where trading fair-launched land tokens regenerates real land.`
- `Real land → fair-launched tokens; a v4 hook routes private↔public arbitrage into regeneration.`

---

## Description  (min 280 chars)

r00t.fund turns real, regenerating land into onchain markets. Each parcel of a real pilot site is
**fair-launched as its own token** through a Continuous Clearing Auction (Uniswap's Liquidity
Launchpad) — so backers, not a steward, discover its price. **100% of what backers pay funds the
actual land regeneration.**

Every parcel token then trades against **$R00T in two pools at once**: a **private, shielded zkAMM**
(privacy for backers) and a **public Uniswap v4 pool**. A shared **Uniswap v4 hook** back-runs every
public trade with a *real* arbitrage between the two pools, keeps their prices in sync, and routes the
captured spread — the "privacy premium" — straight into **that plot's regeneration fund**. The more a
parcel is traded, the more its land is regenerated.

Every parcel is an **ENS name** (`oak.r00t.eth`) whose records show its price, pools, and live
regeneration status. Stewards create land, launch parcels, and wire the whole pipeline — auction →
dual pools → rebalancing hook — from one dashboard, in a single transaction.

---

## How it's made  (min 280 chars)

Built on **Uniswap v4 hooks**. One **shared `RegenArbHook`** (deployed at a mined CREATE2 address that
encodes the `afterSwap` flags) serves every parcel via a `poolId → config` registry — so launching a
new parcel needs **no new hook deploy**.

The core trick: our private AMM is a **ZK-shielded zkAMM**, so a hook can't run a proof-gated trade —
**but its reserves are public `view` state and it exposes public swap functions.** So in `afterSwap`
the hook reads both prices (Uniswap `getSlot0` vs the zkAMM's TWAP reserves) and executes a **real
two-leg arbitrage** — buy on the cheaper pool, sell on the dearer (a nested `poolManager.swap` settled
via v4 flash-accounting + the zkAMM's `buy/sellTokensForShorts`) — then `poolManager.take()`s the
spread to the regen treasury. **User trade amounts stay private; the public reserves sync every trade.**

Price discovery is a **Continuous Clearing Auction** (Liquidity Launchpad). A **`RegenLaunchpad`**
orchestrator does the whole launch in one tx: clear the auction at price P, seed both pools at P,
`register()` the pool with the hook, `rebalanceFor()` the hook on the zkAMM, and write the ENS records.
Parcels are **ENS subnames** with ENSIP text records; the frontend executes swaps/LP via the **Uniswap
Trading API**. Solidity + **Foundry**; demo on **Unichain Sepolia** + **ENS Sepolia**; production
r00t.fund lives on Robinhood Chain.

**Notably hacky / worth mentioning:** arbitraging a **zero-knowledge shielded AMM** from a public
Uniswap v4 hook — leaning on its public reserve surface to sync prices while individual trade amounts
remain confidential. Private trading, public price integrity, and the arbitrage funds real-world
regeneration.

---

## Partner tech used
- **Uniswap** — v4 hooks, Liquidity Launchpad (CCA), Trading/Routing + LP API. *(both prizes)*
- **ENS** — parcel subnames + text records; (stretch) stealth patron names, named keeper agents.

## Links (fill at event)
- Repo: · Live demo: · Video: · Contracts (verified): · `FEEDBACK.md`: · Uniswap feedback form: ✅/❌
