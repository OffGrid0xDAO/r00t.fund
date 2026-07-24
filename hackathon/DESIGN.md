# RegenArbHook — design spec (ETHGlobal Lisbon 2026)

> A Uniswap **v4 hook** that, on every swap, executes a **real two-leg arbitrage** between the
> **public Uniswap pool** and r00t.fund's **private zkAMM**, re-syncs their prices, and routes the
> **captured spread to the parcel's regeneration treasury.** The privacy premium funds the land.

This is the hard-sync design (no dynamic fee). The hook actually **buys and sells** to capture spread.

---

## Why this is possible (the crux judges will probe)

A v4 hook **cannot** run a *shielded* zkAMM trade — it has no ZK proof in the swap context. It
doesn't need one, because:

- The zkAMM's **reserves + price are public** (`getReserves()` / `ethReserve()` / `tokenReserve()`
  are plain `view`s). Only the *user trade amounts* are hidden.
- The zkAMM exposes **public, non-shielded swap functions** — `buyTokensForShorts(uint tokenAmount)`
  (payable: ETH→R00T, price up) and `sellTokensForShorts(uint tokenAmount)` (R00T→ETH, price down),
  currently `onlyShorts`. We add a twin **`rebalanceFor` role** (or reuse the shorts hook slot) so the
  hook can call them. These move the pool **reserves** exactly like an arbitrageur would; **shielded
  users' notes (committed amounts) are untouched** — only the public price moves.

So: **shielded trades stay private; the public reserves sync every block; the arb → regeneration.**

## The mechanism (`afterSwap`)

After a user's Uniswap swap moves the pool price, the hook back-runs it **atomically in the same tx**:

```
P_u = uniswap price   (poolManager.getSlot0 after the user swap)
P_z = zkAMM price      (zkAMM.getReserves)
if |P_u - P_z| > syncThresholdBps:
    if P_u > P_z:                       # R00T dearer on Uniswap → cheaper on zkAMM
        1. BUY R00T on zkAMM   (buyTokensForShorts, ETH in)      → P_z ↑
        2. SELL that R00T on Uniswap (poolManager.swap)          → P_u ↓, ETH out
    else:                               # R00T cheaper on Uniswap
        1. BUY R00T on Uniswap (poolManager.swap, ETH in)        → P_u ↑
        2. SELL R00T on zkAMM  (sellTokensForShorts)             → P_z ↓, ETH out
    profit = ethOut - ethIn             # the spread, realized
    take(profit) → regenTreasury(parcelId)
    emit SpreadCaptured(parcelId, profit, P_u_before, P_z_before)
```

Both pools converge toward each other; the round-trip **profit is real ETH** and is swept to the
plot's regen treasury. This is the MEV/LVR an external bot would take — redirected to the land.

### Inventory
The two legs net out, but sizing/rounding needs a small working buffer. The hook holds a **seed
inventory** (ETH + R00T, treasury-funded) and sweeps realized profit to the treasury each arb. Sizing
each rebalance to ~½ the gap keeps legs small and avoids draining either pool below `MIN_LIQUIDITY`.

## v4 hook wiring

- **Permissions:** `afterSwap` + `afterSwapReturnDelta` only. (Address must encode these bits →
  mine a CREATE2 salt with HookMiner at deploy.)
- **Pool init:** the parcel/R00T pool is created with `hooks = RegenArbHook` (vs today's
  `IHooks(address(0))` at `Land.sol:231`).
- **Flash accounting:** the Uniswap leg is a nested `poolManager.swap` inside the unlock; settle its
  deltas; route the surplus via `poolManager.take(currency, regenTreasury, profit)`.

## zkAMM change required (our contract, redeployed on the demo chain)
Add `rebalanceFor(address)` authorization (twin of `setShortsContract`) so the hook can call
`buyTokensForShorts` / `sellTokensForShorts`. Shielded logic untouched.

## Fair-price reference
`P_z` = zkAMM **TWAP** (reuse the manipulation-safe cumulative-price oracle already in `R00TShorts`),
not raw spot — so a single-block poke can't trick the hook into a bad rebalance.

## Guards (security — this handles real value)
- `nonReentrant`; only `poolManager` may call the hook callbacks.
- Cap rebalance size to `maxRebalanceBps` of the smaller reserve; never cross `MIN_LIQUIDITY`.
- Slippage bound on both legs; if the round-trip isn't net-positive, **skip** (no forced loss).
- TWAP staleness + max-deviation clamp on `P_z`.

## Build order (event)
1. `IZkAMMRebalance` + add `rebalanceFor` to a demo zkAMM; deploy zkAMM + Uniswap pool on testnet.
2. `RegenArbHook.afterSwap` — zkAMM leg + Uniswap leg + profit→treasury + events.
3. Foundry test: mock PoolManager + mock zkAMM reserves; assert pools converge + treasury grows +
   no-loss guard + no drain below MIN_LIQUIDITY.
4. Frontend: swaps via the **Uniswap API** against the hooked pool; ENS records show `regenCaptured`.
5. Stretch: CCA fair-launch for one parcel (see README).

## Non-goals
- No dynamic fee. No shielded-trade execution from the hook. No am-AMM auction (stretch only).
