#!/usr/bin/env node
/**
 * sync-prices.mjs — the OTC price keeper.
 *
 * The steward sets ONLY a discount % (and, until R00T has a deep market, a R00T reference
 * valuation). This keeper does the rest, on-chain, on a schedule:
 *   • ETH/USD   ← a real, deep market feed (Coinbase spot). ALWAYS market. Never set by hand.
 *   • R00T/USD  ← see ROOT_SOURCE below.
 *   • rootPrice = R00T_valuation × (1 − discount)  → setRootPrice()
 *   • ethPrice  = ETH/USD                          → setEthPrice()
 *
 * ROOT_SOURCE — where the R00T market valuation comes from:
 *   • "ref"  (DEFAULT, SAFE): R00T_valuation = ROOT_REF_USD, a steward-set anchor. Use this
 *      while R00T has no deep market. The on-chain R00T pool is currently ~$140 deep and prices
 *      R00T at ~$0.000001 — tracking THAT would drop the OTC price 100,000× and drain the reserve
 *      in one fill. So the reference is the honest valuation until real depth exists.
 *   • "pool" (OPT-IN): R00T_valuation = pool R00T/ETH × ETH/USD, EMA-smoothed + clamped. Only
 *      flip to this once the R00T pool (or a real DEX/CEX feed) is deep enough to price mints.
 *
 * Why "pool" mode is safe ONCE the pool is deep (the point of your ask — no security lost):
 *   - The settlement price is pushed by THIS tx, a block after any pool move. An attacker can't
 *     crash the pool AND fund in the same tx — they don't control this update.
 *   - MAX_DEVIATION_BPS clamps how far rootPrice moves per tick, so a flash spike that unwinds
 *     within a block is never captured, and sustained manipulation is rate-limited + visible.
 *   - EMA_ALPHA smooths across ticks (a TWAP in spirit) so one poisoned read barely moves it.
 *   - The LandVault also VESTS the discount, so even a mispriced fill can't be instantly dumped.
 *
 * Run:  DISCOUNT_BPS=1000 ROOT_REF_USD=0.10 LAND=0x.. PAIR=0x.. KEEPER_PK=0x.. node keeper/sync-prices.mjs
 * Cron: every ~2 min (e.g. a "star-slash-2" minute schedule) — systemd timer or Railway cron.
 *
 * Env:
 *   RPC              JSON-RPC (default RH public)
 *   LAND             Land contract (setRootPrice/setEthPrice/rootPriceE6/ethPriceE6)
 *   PAIR             zkAMM pair (ethReserve/tokenReserve) — only used in ROOT_SOURCE=pool
 *   KEEPER_PK        steward/keeper key (must be the Land steward)
 *   ROOT_SOURCE      "ref" (default) | "pool"
 *   ROOT_REF_USD     steward R00T valuation in USD (ref mode; default = current on-chain OTC/(1-disc))
 *   DISCOUNT_BPS     OTC discount below the valuation, in bps (default 1000 = 10%)
 *   MAX_DEVIATION_BPS per-tick clamp on each price move (default 500 = 5%)
 *   EMA_ALPHA        pool-mode smoothing 0..1, higher = faster (default 0.3)
 *   ETH_USD_URL      override ETH/USD source (default Coinbase spot)
 *   DRY_RUN          "1" to log only, don't send
 */
import { createWalletClient, createPublicClient, http, parseAbi, getAddress } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

const norm = (a, name) => { try { return getAddress(a); } catch { console.error(`bad ${name} address: ${a}`); process.exit(1); } };
const RPC   = process.env.RPC  || 'https://rpc.mainnet.chain.robinhood.com';
const LAND  = process.env.LAND && norm(process.env.LAND, 'LAND');
const PAIR  = process.env.PAIR && norm(process.env.PAIR, 'PAIR');
const PK    = process.env.KEEPER_PK;
const ROOT_SOURCE       = (process.env.ROOT_SOURCE || 'ref').toLowerCase(); // 'ref' | 'pool'
const ROOT_REF_USD      = process.env.ROOT_REF_USD ? Number(process.env.ROOT_REF_USD) : null;
// Hard floor on the OTC price (USD). Protects the reserve while R00T's market is below it: the
// thin pool prices R00T ~$0.000001, so "5% below market" only takes over once market > floor.
const ROOT_FLOOR_USD    = Number(process.env.ROOT_FLOOR_USD ?? '0.10');
const DISCOUNT_BPS      = BigInt(process.env.DISCOUNT_BPS      ?? '1000'); // 10%
const MAX_DEVIATION_BPS = Number(process.env.MAX_DEVIATION_BPS ?? '500'); // 5%/tick
const EMA_ALPHA         = Number(process.env.EMA_ALPHA         ?? '0.3');
const ETH_USD_URL       = process.env.ETH_USD_URL || 'https://api.coinbase.com/v2/prices/ETH-USD/spot';
const DRY               = process.env.DRY_RUN === '1';

if (!LAND || !PK) { console.error('set LAND, KEEPER_PK'); process.exit(1); }
if (ROOT_SOURCE === 'pool' && !PAIR) { console.error('ROOT_SOURCE=pool needs PAIR'); process.exit(1); }

const landAbi = parseAbi([
  'function rootPriceE6() view returns (uint256)',
  'function ethPriceE6() view returns (uint256)',
  'function setRootPrice(uint256)',
  'function setEthPrice(uint256)',
]);
const pairAbi = parseAbi([
  'function ethReserve() view returns (uint256)',
  'function tokenReserve() view returns (uint256)',
]);

const account = privateKeyToAccount(PK.startsWith('0x') ? PK : `0x${PK}`);
const chain = { id: Number(process.env.CHAIN_ID || 4663), name: 'RH', nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: [RPC] } } };
const pub = createPublicClient({ chain, transport: http(RPC) });
const wal = createWalletClient({ account, chain, transport: http(RPC) });

// tiny EMA state persisted between runs (survives cron restarts)
import { readFileSync, writeFileSync } from 'node:fs';
const STATE = new URL('./.price-ema.json', import.meta.url).pathname;
function loadEma() { try { return JSON.parse(readFileSync(STATE, 'utf8')); } catch { return {}; } }
function saveEma(s) { try { writeFileSync(STATE, JSON.stringify(s)); } catch {} }

async function ethUsd() {
  const r = await fetch(ETH_USD_URL);
  const j = await r.json();
  const p = Number(j?.data?.amount ?? j?.price ?? j?.USD);
  if (!isFinite(p) || p <= 0) throw new Error('bad ETH/USD feed response');
  return p;
}

function clamp(nextE6, prevE6, maxBps) {
  if (prevE6 <= 0n) return nextE6;
  const maxUp = (prevE6 * BigInt(10000 + maxBps)) / 10000n;
  const maxDn = (prevE6 * BigInt(10000 - maxBps)) / 10000n;
  if (nextE6 > maxUp) return maxUp;
  if (nextE6 < maxDn) return maxDn;
  return nextE6;
}

async function main() {
  const ema = loadEma();
  const [prevRoot, prevEth] = await Promise.all([
    pub.readContract({ address: LAND, abi: landAbi, functionName: 'rootPriceE6' }),
    pub.readContract({ address: LAND, abi: landAbi, functionName: 'ethPriceE6' }),
  ]);

  const ethPrice = await ethUsd();                 // deep external market (always)

  // --- R00T valuation ($/R00T, pre-discount) ---
  let rootValuation, rootSpot = null;
  if (ROOT_SOURCE === 'pool') {
    const [er, tr] = await Promise.all([
      pub.readContract({ address: PAIR, abi: pairAbi, functionName: 'ethReserve' }),
      pub.readContract({ address: PAIR, abi: pairAbi, functionName: 'tokenReserve' }),
    ]);
    const eth = Number(er), tok = Number(tr);
    if (eth <= 0 || tok <= 0) throw new Error('empty pool — refusing to price');
    rootSpot = ethPrice / (tok / eth);             // $/R00T at pool spot, this tick
    const emaPrev = Number(ema.rootMarket ?? rootSpot);
    rootValuation = EMA_ALPHA * rootSpot + (1 - EMA_ALPHA) * emaPrev; // TWAP-in-spirit
    saveEma({ rootMarket: rootValuation });
  } else {
    // ref mode: steward anchor. Default to the current on-chain valuation (OTC/(1-discount))
    // so an unset ROOT_REF_USD is a no-op rather than a surprise move.
    rootValuation = ROOT_REF_USD ?? (Number(prevRoot) / 1e6) / (Number(10000n - DISCOUNT_BPS) / 10000);
  }

  // apply the discount → target OTC price, then floor it (reserve protection while market < floor)
  const otcRaw = rootValuation * Number(10000n - DISCOUNT_BPS) / 10000; // 0.95 × market (at 5% disc)
  const otcFloored = Math.max(otcRaw, ROOT_FLOOR_USD);
  const flooredBind = otcFloored > otcRaw;
  const otcTargetE6 = BigInt(Math.round(otcFloored * 1e6));
  const ethTargetE6 = BigInt(Math.round(ethPrice * 1e6));

  // clamp per-tick move (bounds a poisoned read or a fat-fingered ref)
  const rootE6 = clamp(otcTargetE6, prevRoot, MAX_DEVIATION_BPS);
  const ethE6  = clamp(ethTargetE6, prevEth, MAX_DEVIATION_BPS);

  console.log(JSON.stringify({
    source: ROOT_SOURCE, ethUsd: ethPrice, rootSpot: rootSpot && +rootSpot.toFixed(8),
    rootValuation: +rootValuation.toFixed(6), discountBps: Number(DISCOUNT_BPS),
    floorUsd: ROOT_FLOOR_USD, floorBinds: flooredBind,
    rootPrev: (Number(prevRoot)/1e6).toFixed(6), rootNext: (Number(rootE6)/1e6).toFixed(6),
    ethPrev: (Number(prevEth)/1e6).toFixed(2), ethNext: (Number(ethE6)/1e6).toFixed(2),
    clampedRoot: rootE6 !== otcTargetE6, clampedEth: ethE6 !== ethTargetE6, dry: DRY,
  }, null, 0));

  if (DRY) return;
  if (ethE6 !== prevEth)  { const h = await wal.writeContract({ address: LAND, abi: landAbi, functionName: 'setEthPrice',  args: [ethE6] });  console.log('setEthPrice',  h); }
  if (rootE6 !== prevRoot){ const h = await wal.writeContract({ address: LAND, abi: landAbi, functionName: 'setRootPrice', args: [rootE6] }); console.log('setRootPrice', h); }
}

// LOOP mode: run forever, tick every INTERVAL_SEC (default 120s). This is the production shape
// on Railway — a normal always-on worker with a restart policy — no external cron needed. A
// single tick error is logged and retried next tick (doesn't kill the process). Set INTERVAL_SEC=0
// for a one-shot run (cron/manual).
const INTERVAL_SEC = Number(process.env.INTERVAL_SEC ?? '120');

if (INTERVAL_SEC > 0) {
  console.log(`keeper: loop mode, tick every ${INTERVAL_SEC}s · source=${ROOT_SOURCE} · discount=${Number(DISCOUNT_BPS)/100}% · dry=${DRY}`);
  const tick = () => main().catch((e) => console.error(`[${new Date().toISOString()}] tick error:`, e.message));
  await tick();
  setInterval(tick, INTERVAL_SEC * 1000);
} else {
  main().catch((e) => { console.error('keeper error:', e.message); process.exit(1); });
}
