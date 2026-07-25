/**
 * MarketsChart — pair-selectable price chart for the ETHGlobal Sepolia markets. Pick R00T/OAK or
 * R00T/ETH and see the PUBLIC (Uniswap v4) and PRIVATE (zkAMM / ZkParcelPool) prices over every real
 * rebalance, the live divergence, and the regen treasury growing from captured spread. Reads on-chain
 * (useV4Chart) so it works without the indexer; the Ponder/Railway feed is a drop-in upgrade.
 */
import { useMemo, useState } from 'react';
import { HACKATHON } from '../config';
import { useV4Chart } from '../hooks/useV4Chart';
import { useV4Markets } from '../hooks/useV4Markets';

const LIME = '#D6FE51', BLUE = '#8C9EFF', GREEN = '#7CFFB2';

function DualLine({ pts }: { pts: { pub: number; priv: number }[] }) {
  const W = 640, H = 200, PADX = 8, PADY = 14;
  if (pts.length < 2) return <div className="text-xs text-[#666] py-16 text-center">waiting for trades…</div>;
  const ys = pts.flatMap((p) => [p.pub, p.priv]);
  const lo = Math.min(...ys), hi = Math.max(...ys), span = hi - lo || 1;
  const x = (i: number) => PADX + (i / (pts.length - 1)) * (W - 2 * PADX);
  const y = (v: number) => PADY + (1 - (v - lo) / span) * (H - 2 * PADY);
  const line = (k: 'pub' | 'priv') => pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p[k]).toFixed(1)}`).join(' ');
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: 200 }}>
      <path d={line('pub')} fill="none" stroke={BLUE} strokeWidth={1.5} />
      <path d={line('priv')} fill="none" stroke={LIME} strokeWidth={1.5} />
      <circle cx={x(pts.length - 1)} cy={y(pts[pts.length - 1].pub)} r={3} fill={BLUE} />
      <circle cx={x(pts.length - 1)} cy={y(pts[pts.length - 1].priv)} r={3} fill={LIME} />
    </svg>
  );
}

export function MarketsChart() {
  const [mi, setMi] = useState(0);
  const { markets } = useV4Markets(); // auto-discovers new markets from MarketRegistered
  const market = markets[Math.min(mi, markets.length - 1)] ?? markets[0];
  const c = useV4Chart(market);
  const inSync = c.divergenceBps != null && c.divergenceBps < 30;
  const rebalances = useMemo(() => c.series.filter((p) => p.tx).slice(-6).reverse(), [c.series]);

  return (
    <div className="bg-[#0a0a0a] border border-[#333] rounded-xl p-4">
      {/* pair selector */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex gap-2 flex-wrap">
          {markets.map((m, i) => (
            <button key={m.key} onClick={() => setMi(i)}
              className={`px-3 py-1.5 rounded-md text-xs font-mono border transition-colors ${i === mi ? 'text-black' : 'text-[#aaa] border-[#333] hover:border-[#555]'}`}
              style={i === mi ? { background: LIME, borderColor: LIME } : {}}>
              {m.label}
            </button>
          ))}
        </div>
        <div className="flex gap-3 text-[10px]">
          <span style={{ color: BLUE }}>● public v4</span>
          <span style={{ color: LIME }}>● private</span>
        </div>
      </div>

      <DualLine pts={c.series.map((p) => ({ pub: p.pub, priv: p.priv }))} />

      {/* live stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-3">
        <Stat label="public" value={c.livePub != null ? c.livePub.toPrecision(4) : '…'} sub={market.priceLabel} color={BLUE} />
        <Stat label="private" value={c.livePriv != null ? c.livePriv.toPrecision(4) : '…'} sub={market.priceLabel} color={LIME} />
        <Stat label="divergence" value={c.divergenceBps != null ? `${c.divergenceBps} bps` : '…'} sub={inSync ? 'in sync' : 'arbing…'} color={inSync ? GREEN : LIME} />
        <Stat label="regen treasury" value={c.treasury != null ? c.treasury.toLocaleString(undefined, { maximumFractionDigits: market.treasuryIsEth ? 4 : 2 }) : '…'} sub={market.quote} color={GREEN} />
      </div>

      {/* recent rebalances */}
      <div className="mt-3 border-t border-[#222] pt-3">
        <div className="text-[10px] text-[#666] mb-1">recent rebalances (each = a real cross-pool arb → treasury)</div>
        <div className="flex flex-col gap-1">
          {rebalances.length === 0 && <span className="text-[11px] text-[#555]">no rebalances indexed yet — trade the pool to trigger one</span>}
          {rebalances.map((r, i) => (
            <a key={i} href={`${HACKATHON.explorerUrl}/tx/${r.tx}`} target="_blank" rel="noreferrer"
              className="flex items-center justify-between text-[11px] font-mono hover:bg-white/5 rounded px-1 py-0.5">
              <span style={{ color: GREEN }}>+{r.profit.toPrecision(3)} {market.quote}</span>
              <span className="text-[#666]">pub {r.pub.toPrecision(3)} · priv {r.priv.toPrecision(3)} ↗</span>
            </a>
          ))}
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div className="bg-[#111] rounded-lg p-2.5">
      <div className="text-[10px] text-[#777] uppercase tracking-wide">{label}</div>
      <div className="text-sm font-mono mt-0.5" style={{ color: color || '#ddd' }}>{value}</div>
      {sub && <div className="text-[9px] text-[#666] mt-0.5">{sub}</div>}
    </div>
  );
}
