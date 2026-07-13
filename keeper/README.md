# r00t price keeper

Keeps the Land's OTC pricing tracking the real market so the **steward only ever sets a discount %**.

Every tick (~2 min) it:
- reads **ETH/USD** from a deep market feed (Coinbase) → `setEthPrice`
- computes `rootPrice = R00T_valuation × (1 − discount)` → `setRootPrice`

Both moves are **clamped per tick** (`MAX_DEVIATION_BPS`) and, in pool mode, **EMA-smoothed** — so a
flash pool move a keeper can't bundle into a fill, and a spike that unwinds in a block, are never
captured. The LandVault also **vests** the discount, so even a mispriced fill can't be instantly dumped.

## R00T valuation source (`ROOT_SOURCE`)

- **`ref`** (default, safe) — `R00T_valuation = ROOT_REF_USD`, a steward anchor. Use this **now**:
  the on-chain R00T pool is ~$140 deep and prices R00T at ~$0.000001; tracking that would crater the
  OTC price and drain the reserve in one fill.
- **`pool`** (opt-in) — `R00T_valuation = pool R00T/ETH × ETH/USD`, EMA-smoothed + clamped. Flip to
  this **only once R00T has real market depth** (deep DEX pool or a CEX listing feed).

## Run locally

```bash
npm install
# preview without sending (recommended first):
DRY_RUN=1 INTERVAL_SEC=0 \
  LAND=0xFcb786b9d0b50f001D468DC3B36cCdfFaf711139 \
  PAIR=0xCf31Fc47be6D6fed5300a636d086E7FeAb21717e \
  KEEPER_PK=<steward-key> ROOT_REF_USD=0.10 DISCOUNT_BPS=1000 npm run dry
# live loop:
LAND=... PAIR=... KEEPER_PK=<steward-key> ROOT_REF_USD=0.10 DISCOUNT_BPS=1000 npm start
```

## Deploy on Railway (off your machine)

1. New Railway project → **Deploy from GitHub repo** → root directory `keeper/`.
2. Add **Variables** (Settings → Variables):

   | var | value |
   |---|---|
   | `KEEPER_PK` | the **steward** private key (this account must be `land.steward()`) |
   | `LAND` | `0xFcb786b9d0b50f001D468DC3B36cCdfFaf711139` |
   | `PAIR` | `0xCf31Fc47be6D6fed5300a636d086E7FeAb21717e` |
   | `ROOT_SOURCE` | `ref` |
   | `ROOT_REF_USD` | `0.10` |
   | `DISCOUNT_BPS` | `1000` (10%) |
   | `MAX_DEVIATION_BPS` | `500` (5%/tick) |
   | `INTERVAL_SEC` | `120` |
   | `RPC` | (optional) your provider RPC |

3. Deploy. `railway.json` runs it as an always-on worker with an on-failure restart policy.

## Security notes

- `KEEPER_PK` is the **steward** key — treat it as hot. It can set prices, pause, and withdraw the
  free reserve. Consider a dedicated steward key with only the funds it needs, and rotate if leaked.
- The keeper never has custody of user funds; worst case of a keeper compromise is price griefing,
  which the per-tick clamp + vesting bound.
- All env vars ship as Railway secrets, never in the repo.

## Env reference

| var | default | meaning |
|---|---|---|
| `RPC` | RH public | JSON-RPC endpoint |
| `LAND` | — | Land contract (setRootPrice/setEthPrice) |
| `PAIR` | — | zkAMM pair (only used in `pool` mode) |
| `KEEPER_PK` | — | steward key |
| `ROOT_SOURCE` | `ref` | `ref` \| `pool` |
| `ROOT_REF_USD` | current on-chain | steward R00T valuation (ref mode) |
| `DISCOUNT_BPS` | `1000` | OTC discount below valuation |
| `MAX_DEVIATION_BPS` | `500` | per-tick price-move clamp |
| `EMA_ALPHA` | `0.3` | pool-mode smoothing |
| `INTERVAL_SEC` | `120` | tick interval; `0` = one-shot |
| `ETH_USD_URL` | Coinbase spot | ETH/USD source |
| `DRY_RUN` | — | `1` = log only |
