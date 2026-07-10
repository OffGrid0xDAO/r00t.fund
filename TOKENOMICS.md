# $R00T — tokenomics & the OTC land mechanism

> Direction set by the founder (2026-07). Launch target: **Robinhood Chain**
> (chainId 4663) — native Uniswap v2/v3/**v4** + Chainlink CCIP/Data Feeds day-one.
> Guiding invariant: **pledged ETH/USDC funds the land — it is never used as LP.**
>
> ⚠️ Token-distribution / launch design, not legal advice. A tradable token +
> real-world land has securities-law exposure. Get counsel before mainnet.

## One sentence

**Opening a land is an OTC sale of the steward's $R00T to the crowd:** the steward
locks $R00T at creation as the seed liquidity for real Uniswap v4 parcel/$R00T
pools; backers pledge ETH/USDC (100% to the treasury — the ground) and mint the
parcel's culture token **at the live pool price**; their exit is against the
steward's $R00T float, so demand sets the price the steward realizes — premium or
discount.

## The two token layers

| Layer | Token | What it is |
|---|---|---|
| **Base** | **$R00T** | Protocol reserve currency, fixed 69M supply. Everything is priced in it. |
| **Parcel** | $OAK / $CARROT / … | A localized, yield-bearing wrapper around $R00T. Always paired to $R00T in a v4 pool. "$R00T with a place and a carbon yield." |

## The contracts (as built — `contracts/src/`)

- **`RootToken.sol`** — $R00T (ERC20, 69M).
- **`ParcelToken.sol`** — per-parcel culture token; mint restricted to its `Land`.
- **`LandFactory.sol`** — anyone opens a land. Holds the shared Uniswap v4 wiring
  (`PoolManager`, fee tier, tick spacing, protocol treasury). `createLand(...)`
  requires an $R00T pledge ≥ `minR00tPledge`, pulls it into the new `Land`, and
  earmarks it as that land's seed reserve.
- **`Land.sol`** — one steward's land:
  - **Own treasury.** `pledgeETH` / `pledgeUSDC` forward **100%** to `treasury`.
  - **Geo validation.** `boundaryHash` (KMZ) + `topoHash` (topography) + IPFS `cid`
    committed on-chain; a `validator` flips `validated` after the OFF-CHAIN check.
    Parcel creation + pledging are gated on `validated`.
  - **Parcel tokens.** `createParcel(id, name, symbol)` deploys a `ParcelToken`.
  - **Real v4 liquidity.** `seedParcelLiquidity(id, sqrtPriceX96, rootAmount,
    parcelAmount)` initializes the parcel/$R00T pool on the live `PoolManager` and
    adds full-range liquidity via the v4 unlock/settle callback — $R00T from the
    reserve, parcel tokens freshly minted into the pool.
  - **Mint-at-pool-price.** Pledges read the pool's `sqrtPrice` (`StateLibrary`),
    value the pledge in $R00T (`rootPriceE6`), and mint the parcel token **at
    market**. No fixed rate ⇒ nothing to arb.
  - **Fee split.** `collectParcelFees(id)` collects v4 swap fees and splits them
    **70% steward / 30% protocol** (`STEWARD_FEE_BPS = 7000`).

## Loop A — Pledge (funds the land)

- Degens pledge ETH/USDC to a parcel on the land map.
- **100% → land treasury** (regeneration capex). Never LP, never yield.
- The parcel's culture token is **minted to the pledger at the live v4 pool price**
  — so a backer always receives fair value, and cannot mint-cheap-then-dump.
- A separate **early-bird points ledger** (`allocationPoints`, `bonusBps`) rewards
  earliness — reserved for a future $R00T airdrop / governance weight. Points do
  **not** mint extra parcel tokens (that would reopen the arb).

## Loop B — the OTC $R00T sale (why discount/premium)

The crowd's only source of $R00T for a parcel is the **steward's seeded float**.
So across the whole loop: **ETH in → treasury, $R00T out → crowd, the parcel token
is the transport layer.** The steward converts illiquid $R00T into real regeneration
capital.

Effective price the steward realizes ≈ `ETH raised ÷ $R00T distributed`:

- **Hot land** → parcels trade up, crowd pays up → steward sells $R00T at a **premium**.
- **Cold land** → parcels trade down → steward sells $R00T at a **discount**.

The premium/discount is **the crowd's verdict on that specific land**, denominated
in $R00T. Trading fees on top split 70/30 steward/protocol.

## Multi-tenant: every land pairs with $R00T

r00t is a **network of lands**. The Pilot Project is the template; other stewards
onboard via **Start your land** (`StartYourLand.tsx`): submit boundary + topography,
the pipeline (`fuzz-terrain.mjs` → `apply-kml-boundary.mjs` → `gen-zones.mjs`,
server-side on ingest) fuzzes and auto-parcels it, and the hashes are committed for
on-chain validation. Every land's parcel tokens pair with $R00T ⇒ each onboarded
land compounds $R00T demand. The same identity/geometry firewall applies to tenants.

## Deploy

`contracts/script/DeployLandFactory.s.sol` — deploys (or reuses) $R00T and the
`LandFactory` wired to Robinhood Chain's Uniswap v4 `PoolManager`
(`0x8366a39CC670B4001A1121B8F6A443A643e40951`). Set `CONTRACTS.landFactory`
(`VITE_LAND_FACTORY`) in `frontend/src/config.ts` after deploy.

## Deferred (post-launch)

- **Two-pool privacy** (public v4 + ZK shielded pool, peg-keeper routing arb →
  treasury). See `PRIVACY_LIQUIDITY.md`. Kept optional — clashes with the public
  degen loop + Robinhood compliance posture at launch.
- **$R00T price oracle.** `rootPriceE6` is owner-set today; swap for a $R00T base
  pool read or a Chainlink feed once $R00T has market depth.
- **Vesting of minted parcel tokens** tied to satellite-verified regeneration
  (Chainlink CRE) — an on-brand alternative/complement to mint-at-market.
- **v4 fee hook** — move the 70/30 split into a hook if per-swap routing is wanted.
- Legal review before mainnet.

## Legacy note

An earlier draft used a fixed early-bird **price-tier airdrop** (Round 1/2/3…) and a
one-sided-liquidity seed. That is superseded: fixed-rate mint + an open pool is a
free arb. The shipped model mints **at the live pool price** and keeps earliness as
a **points reward**, not extra supply.
