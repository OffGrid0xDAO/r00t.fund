# Privacy + Liquidity architecture — two pools, protocol-pegged

> Decision (2026-07, founder): **two-pool model.** A public Uniswap v4 pool for
> the degen/number-go-up market, and a ZK shielded pool for private trading. The
> protocol keeps the two pools price-pegged and **captures all arbitrage profit to
> the land treasury** ("the privacy premium funds the land").

## Why two pools (not unified settlement)

A unified single-pool design (ZK layer as a settlement wrapper over one public
Uniswap pool) only provides privacy **at scale** — you're hidden inside a batch, so
with few concurrent wallets there's no anonymity set and no privacy. For an early /
small project that's a dealbreaker.

**Two pools with their own shielded reserves give real private execution from day
one**, independent of batch volume. The cost is that the two pools' prices drift and
must be kept pegged — which we turn into a feature by internalizing the arbitrage.

## The two pools

1. **Public pool — Uniswap v4** (`$R00T/ETH`, and each `$PARCEL/$R00T`).
   Transparent, deep, price discovery, the visible market that feeds the momentum /
   land-value / leaderboard degen loop.
2. **Shielded pool — ZkAMM** (existing repo: ZkAMM + Railgun + `useZkProver`,
   `commitments`, `viewingKey`). Own reserves; buy/transfer/sell happen as ZK proofs
   against a commitment set, so the buy↔sell link is broken (see the note flow in
   the frontend privacy stack).

## The peg keeper (protocol-run arbitrage → treasury)

External searchers **cannot** reliably peg these pools on Robinhood Chain: its
**FCFS, no-priority-fee** sequencing removes the MEV/arb-bot edge (no sandwiching, no
fee auction). So the protocol runs the arbitrage itself — which is exactly what we
want, because the spread then accrues to the treasury, not to bots.

### Mechanism
The keeper holds **protocol-owned liquidity (POL)** in both pools (seeded from the
token reserve / treasury — no external LPs in the privacy pool). On an interval:

```
1. read priceₚᵤᵦₗᵢ꜀  (Uniswap v4)  and  price_shielded  (ZkAMM)
2. if |divergence| > PEG_TOLERANCE:
     buy in the cheaper pool, sell in the dearer pool, using POL inventory,
     sized ≤ MAX_REBALANCE, in ONE batched tx
   → both prices converge, and the captured spread is booked to the TREASURY
3. else: do nothing
```

Because the keeper is the **sole arbitrageur**, the spread that would have gone to
MEV searchers is captured by the protocol. Framed for users: **private traders pay a
small "privacy premium" (the spread), and that premium funds the land.**

### Privacy of the rebalance
The shield↔public boundary is the one place a shielded action can be linked to a
public one — so the keeper:
- rebalances **periodically and batched**, never per-trade (individual private
  trades are not mirrored 1:1 to the public pool),
- **rate-limits** the boundary (protects both the peg and the anonymity set),
- sizes rebalances to net imbalance, not individual orders.

### Parameters (to tune)
- `PEG_TOLERANCE` — price band before rebalancing (e.g. ±0.5–1.5%). Tighter peg =
  more boundary crossings = weaker privacy. This band **is** the privacy/peg trade-off.
- `REBALANCE_INTERVAL` — batching cadence (e.g. every N blocks / minutes).
- `MAX_REBALANCE` — cap per rebalance to bound slippage + info leak.

### Trust / centralization
The keeper sees both sides, so it's a trust point. Mitigations:
- make the rebalance **permissionlessly triggerable** (anyone can call it; the logic,
  not the caller, decides size/direction — profit still routes to treasury),
- or **ZK-attest** the rebalance (prove correct execution without a trusted operator),
- start operator-run, decentralize the trigger over time.

## Robinhood Chain fit
- **FCFS / anti-MEV sequencing** ⇒ no sandwiching of the keeper or of shield/unshield;
  external arb bots have no edge → protocol-run peg is *necessary*, not just nicer.
- Watch for **Timeboost** adoption (Arbitrum's MEV express-lane auction) — if enabled
  it reintroduces paid priority and changes the keeper's timing assumptions.
- CRE/ZK verification stays on a CRE-capable chain; only bridged CCIP attestations
  cross over (unchanged).

## Build TODOs
- [ ] `PegKeeper` contract/service: read both prices, batched rebalance via POL,
      book spread to treasury, permissionless trigger.
- [ ] POL provisioning from the token reserve into both pools.
- [ ] ZkAMM ↔ Uniswap price oracle read (TWAP on the v4 side).
- [ ] Rate-limit / batch the shield↔unshield gate.
- [ ] Frontend "Private" toggle on the buy panel: public Uniswap swap (visible
      balance, feeds the degen loop) vs. shielded buy (commitment/note).
- [ ] Legal review (token distribution + privacy pool posture) before mainnet.
