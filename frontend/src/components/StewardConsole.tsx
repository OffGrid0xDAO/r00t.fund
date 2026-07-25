/**
 * StewardConsole — the Regenerative Liquidity control room (ETHGlobal Lisbon 2026).
 *
 * Shows the full steward journey for a parcel token — Continuous Clearing Auction → one-tx launch of
 * a DOUBLE POOL (private RegenPrivatePool + public Uniswap v4, sharing one arb hook) — and then reads
 * that live deployment on Ethereum Sepolia: both pool prices, how far they diverge, and the regen
 * treasury that every cross-pool arb feeds. This is the on-chain proof the pools actually re-sync.
 */
import { HACKATHON } from '../config';
import { MarketsChart } from './MarketsChart';
import { useRegenLive, type ArbEvent } from '../hooks/useRegenLive';

const LIME = '#D6FE51';
const GREEN = '#00ff88';
const BLUE = '#8C9EFF';

/** dual-line chart of both pool prices over time — the rebalancing made visible. */
function DualPoolChart({ pts, cleared }: { pts: { pub: number; priv: number }[]; cleared: number | null }) {
  const W = 560, H = 150, PADX = 8, PADY = 12;
  if (pts.length < 2) {
    return <div className="h-[150px] grid place-items-center text-[12px] text-[#666]">collecting live price points… (updates every 8s; trades move the lines)</div>;
  }
  const ys = pts.flatMap((p) => [p.pub, p.priv]).concat(cleared ? [cleared] : []);
  const lo = Math.min(...ys), hi = Math.max(...ys);
  const span = hi - lo || 1;
  const x = (i: number) => PADX + (i / (pts.length - 1)) * (W - 2 * PADX);
  const y = (v: number) => H - PADY - ((v - lo) / span) * (H - 2 * PADY);
  const line = (key: 'pub' | 'priv') => pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p[key]).toFixed(1)}`).join(' ');
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: 150 }}>
      {cleared != null && <line x1={PADX} x2={W - PADX} y1={y(cleared)} y2={y(cleared)} stroke="#ffffff40" strokeDasharray="3 3" />}
      <path d={line('pub')} fill="none" stroke={BLUE} strokeWidth={2} />
      <path d={line('priv')} fill="none" stroke={LIME} strokeWidth={2} />
      {/* latest dots */}
      <circle cx={x(pts.length - 1)} cy={y(pts[pts.length - 1].pub)} r={3} fill={BLUE} />
      <circle cx={x(pts.length - 1)} cy={y(pts[pts.length - 1].priv)} r={3} fill={LIME} />
    </svg>
  );
}

function ArbFeed({ arbs }: { arbs: ArbEvent[] }) {
  if (!arbs.length) return <p className="text-[11px] text-[#666]">No rebalances indexed yet — each public swap emits one SpreadCaptured.</p>;
  const totalProfit = arbs.reduce((a, e) => a + e.profit, 0);
  return (
    <div>
      <div className="text-[11px] text-[#888] mb-2">
        <span style={{ color: GREEN }}>{arbs.length}</span> on-chain rebalance{arbs.length > 1 ? 's' : ''} · <span style={{ color: GREEN }}>{totalProfit.toFixed(3)}</span> R00T to treasury
      </div>
      <div className="space-y-1 max-h-32 overflow-auto">
        {[...arbs].reverse().map((e, i) => (
          <a key={i} href={`${HACKATHON.explorerUrl}/block/${e.block}`} target="_blank" rel="noreferrer"
            className="flex items-center justify-between text-[11px] font-mono px-2 py-1 rounded bg-[#111] hover:bg-[#181818]">
            <span className="text-[#888]">blk {e.block}</span>
            <span style={{ color: BLUE }}>pub {e.uni.toFixed(4)}</span>
            <span style={{ color: LIME }}>priv {e.priv.toFixed(4)}</span>
            <span style={{ color: GREEN }}>+{e.profit.toFixed(3)} R00T</span>
          </a>
        ))}
      </div>
    </div>
  );
}

function ex(kind: 'address' | 'tx', v: string) {
  return `${HACKATHON.explorerUrl}/${kind}/${v}`;
}

function Stat({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div className="bg-[#111] border border-[#333] rounded-lg p-4">
      <div className="text-[11px] uppercase tracking-wider text-[#666]">{label}</div>
      <div className="text-xl font-semibold mt-1" style={{ color: color || '#eee' }}>{value}</div>
      {sub && <div className="text-[11px] text-[#888] mt-0.5">{sub}</div>}
    </div>
  );
}

/** two price bars (private vs public) scaled to a shared max, with the CCA clear line marked. */
function DoublePoolViz({ priv, pub, cleared }: { priv: number | null; pub: number | null; cleared: number | null }) {
  const max = Math.max(priv || 0, pub || 0, cleared || 0) * 1.15 || 1;
  const pct = (x: number | null) => `${Math.min(100, ((x || 0) / max) * 100)}%`;
  const Bar = ({ label, x, color }: { label: string; x: number | null; color: string }) => (
    <div className="mb-3">
      <div className="flex justify-between text-xs mb-1">
        <span className="text-[#aaa]">{label}</span>
        <span className="font-mono" style={{ color }}>{x != null ? `${x.toFixed(5)} R00T/${HACKATHON.parcel.ticker}` : '…'}</span>
      </div>
      <div className="h-3 bg-[#222] rounded-full relative overflow-hidden">
        <div className="h-full rounded-full transition-all duration-700" style={{ width: pct(x), background: color }} />
        {cleared != null && (
          <div className="absolute top-0 bottom-0 w-[2px] bg-white/60" style={{ left: pct(cleared) }} title={`CCA clear ${cleared.toFixed(5)}`} />
        )}
      </div>
    </div>
  );
  return (
    <div>
      <Bar label="Private pool (zkAMM-style, shielded)" x={priv} color={LIME} />
      <Bar label="Public pool (Uniswap v4, hooked)" x={pub} color="#8C9EFF" />
      <div className="text-[11px] text-[#666] mt-1">white line = CCA cleared price · the hook back-runs every public swap to pull these together</div>
    </div>
  );
}

const STEPS = [
  ['Create parcel', 'Steward escrows the parcel supply (sale + pool tokens) and opens a Continuous Clearing Auction.'],
  ['Backers bid R00T', 'Uniform-price CCA — everyone settles at one clearing price, never below the R00T OTC floor.'],
  ['clearAndLaunch (1 tx)', 'Clears at P, routes the raise to the regen treasury, and seeds BOTH pools at P.'],
  ['Double pool + hook', 'Private RegenPrivatePool + public Uniswap v4 pool go live, wired to the shared RegenArbHook.'],
  ['Every trade regenerates', 'Each public swap back-runs a cross-pool arb; the spread funds the land’s regen treasury.'],
];

interface StewardConsoleProps {
  landName?: string | null;
  landAddress?: string | null;
  onOpenLand?: () => void;
}

export function StewardConsole({ landName, landAddress, onOpenLand }: StewardConsoleProps = {}) {
  const live = useRegenLive();
  const p = HACKATHON.parcel;
  const inSync = live.divergenceBps != null && live.divergenceBps < 30;

  return (
    <div className="max-w-3xl mx-auto w-full px-4 py-6">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h2 className="text-lg font-semibold" style={{ color: LIME }}>Steward Console — Regenerative Liquidity</h2>
          <p className="text-xs text-[#888] mt-1">Fair-launch real-land parcel tokens; a Uniswap v4 hook turns cross-pool arbitrage into regeneration.</p>
        </div>
        <span className="text-[10px] px-2 py-1 rounded-full border animate-pulse"
          style={{ color: GREEN, borderColor: GREEN }}>● LIVE · Sepolia</span>
      </div>

      {/* the land this steward manages — ties the console to the _land tab */}
      <button onClick={onOpenLand}
        className="w-full flex items-center justify-between rounded-xl border border-[#333] bg-[#0a0a0a] px-4 py-3 mb-5 hover:border-[#555] transition-colors text-left">
        <div className="flex items-center gap-2">
          <span className="text-lg">🗺️</span>
          <div>
            <div className="text-sm text-[#ddd]">Stewarding{landName ? ` ${landName}` : ' your land'}</div>
            <div className="text-[11px] text-[#888] font-mono">{landAddress ? `${landAddress.slice(0, 8)}…${landAddress.slice(-6)}` : 'connected steward'}</div>
          </div>
        </div>
        <span className="text-[11px] text-[#888]">← back to Land map</span>
      </button>

      {/* the launched parcel */}
      <div className="bg-[#0a0a0a] border border-[#333] rounded-xl p-4 mb-5">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <span className="text-2xl">🌳</span>
            <div>
              <div className="font-semibold">${p.ticker} · Oak Parcel</div>
              <div className="text-[11px] text-[#888]">
                phase: <span style={{ color: live.phase === 2 ? GREEN : '#aaa' }}>{['None', 'Auction', 'Live'][live.phase ?? 0] || '…'}</span>
              </div>
            </div>
          </div>
          {live.error && <span className="text-[11px] text-[#e05555]">{live.error}</span>}
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Stat label="CCA clear" value={live.clearedPrice != null ? live.clearedPrice.toFixed(4) : '…'} sub={`R00T / ${p.ticker}`} />
          <Stat label="Raised" value={live.raised != null ? `${live.raised.toLocaleString()}` : '…'} sub="R00T" />
          <Stat label="Divergence" value={live.divergenceBps != null ? `${live.divergenceBps} bps` : '…'} sub={inSync ? 'in sync (<30bps)' : 'arbing…'} color={inSync ? GREEN : LIME} />
          <Stat label="Regen treasury" value={live.treasuryRoot != null ? live.treasuryRoot.toLocaleString(undefined, { maximumFractionDigits: 2 }) : '…'} sub="R00T from arb" color={GREEN} />
        </div>
      </div>

      {/* all markets — pick a pair, watch trades + rebalancing live */}
      <div className="mb-3 text-sm font-semibold text-[#ddd]">Markets — choose a pair</div>
      <div className="mb-5"><MarketsChart /></div>

      {/* the double pool */}
      <div className="bg-[#0a0a0a] border border-[#333] rounded-xl p-4 mb-5">
        <div className="flex items-center justify-between mb-3">
          <div className="text-sm font-semibold text-[#ddd]">Double pool — live rebalancing</div>
          <div className="flex gap-3 text-[10px]">
            <span style={{ color: BLUE }}>● public v4</span>
            <span style={{ color: LIME }}>● private (zkAMM)</span>
          </div>
        </div>
        {/* time-series chart of both pool prices (falls back to on-chain arb points until the live series fills) */}
        <DualPoolChart
          pts={live.series.length >= 2 ? live.series.map((s) => ({ pub: s.pub, priv: s.priv }))
                : live.arbs.map((a) => ({ pub: a.uni, priv: a.priv }))}
          cleared={live.clearedPrice}
        />
        <div className="mt-3 mb-4">
          <ArbFeed arbs={live.arbs} />
        </div>
        <DoublePoolViz priv={live.privatePrice} pub={live.publicPrice} cleared={live.clearedPrice} />
        <div className="flex gap-3 mt-4 text-[11px]">
          <a className="underline text-[#8C9EFF]" href={ex('address', HACKATHON.launchpad)} target="_blank" rel="noreferrer">launchpad ↗</a>
          <a className="underline text-[#8C9EFF]" href={ex('address', HACKATHON.hook)} target="_blank" rel="noreferrer">arb hook ↗</a>
          <a className="underline text-[#8C9EFF]" href={ex('address', p.privatePool)} target="_blank" rel="noreferrer">private pool ↗</a>
          <a className="underline text-[#8C9EFF]" href={ex('address', p.treasury)} target="_blank" rel="noreferrer">treasury ↗</a>
          <button onClick={live.refetch} className="ml-auto text-[#888] hover:text-white">↻ refresh</button>
        </div>
      </div>

      {/* the steward journey */}
      <div className="bg-[#0a0a0a] border border-[#333] rounded-xl p-4">
        <div className="text-sm font-semibold mb-3 text-[#ddd]">How a steward launches a parcel</div>
        <ol className="space-y-2">
          {STEPS.map(([t, d], i) => (
            <li key={t} className="flex gap-3">
              <span className="shrink-0 w-6 h-6 rounded-full grid place-items-center text-[11px] font-semibold"
                style={{ background: '#1a1a1a', color: LIME, border: `1px solid ${LIME}55` }}>{i + 1}</span>
              <div>
                <div className="text-sm text-[#ddd]">{t}</div>
                <div className="text-[12px] text-[#888]">{d}</div>
              </div>
            </li>
          ))}
        </ol>
        <div className="text-[11px] text-[#666] mt-3">
          The base R00T/ETH market runs the same hook against the real shielded ZkAMMPair; parcels use RegenPrivatePool (identical reserve/rebalance surface).
        </div>
      </div>
    </div>
  );
}
