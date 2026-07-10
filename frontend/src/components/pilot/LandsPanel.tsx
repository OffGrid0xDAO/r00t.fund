/**
 * LandsPanel — the dapp's land / parcel-token view (replaces the old projects
 * launchpad). Lists $R00T + every parcel token with its launch status. Tokens
 * are only tradable once live; pledging/launching tokens route you to the land
 * map to fund them (funding earns early-bird allocation).
 */
import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { LANDS, BASE_TOKEN } from './lands';
import { fetchParcelTokens, STATUS_META, type ParcelToken } from './parcelTokens';
import { TYPE_COLOR, usd, fmtPrice } from './ui';
import { CONTRACTS } from '../../config';

const ROOT_ADDR = CONTRACTS.rootToken;
const uniswapUrl = (out: string) => `https://app.uniswap.org/swap?inputCurrency=${ROOT_ADDR}&outputCurrency=${out}`;

export function LandsPanel({ onOpenMap }: { onOpenMap?: () => void }) {
  const [tokens, setTokens] = useState<ParcelToken[] | null>(null);
  const [filter, setFilter] = useState<'all' | 'live' | 'pledging'>('all');

  useEffect(() => { fetchParcelTokens().then(setTokens).catch(() => setTokens([])); }, []);

  const land = LANDS.find(l => l.status === 'live');
  const shown = (tokens ?? []).filter(t =>
    filter === 'all' ? true : filter === 'live' ? t.tradable : t.status === 'pledging');
  const liveCount = (tokens ?? []).filter(t => t.tradable).length;

  return (
    <div className="space-y-4">
      {/* header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <span className="text-xs tracking-[0.2em] text-[var(--accent-on-bg)] uppercase font-mono">Lands · Parcel tokens</span>
          <p className="text-[11px] font-mono text-[var(--text-muted)] mt-0.5">{land?.name ?? 'Pilot Project'} · {liveCount} live · pair with ${BASE_TOKEN}</p>
        </div>
        {onOpenMap && (
          <button onClick={onOpenMap} className="text-xs font-medium text-[var(--text-secondary)] hover:text-[var(--accent-on-bg)] transition-colors inline-flex items-center gap-1.5">🗺️ Open land map</button>
        )}
      </div>

      {/* $R00T base token */}
      <div className="rounded-xl border border-[var(--border)] p-4 flex items-center justify-between" style={{ background: `color-mix(in srgb, var(--accent) 6%, var(--bg-secondary))` }}>
        <div className="flex items-center gap-3">
          <span className="text-2xl">🌱</span>
          <div>
            <p className="font-display text-base text-[var(--text-primary)] leading-tight">${BASE_TOKEN} <span className="text-[10px] font-mono text-[var(--text-muted)]">base currency</span></p>
            <p className="text-[11px] font-mono text-[var(--text-muted)]">every parcel token pairs against ${BASE_TOKEN}</p>
          </div>
        </div>
        <a href={`https://app.uniswap.org/swap?outputCurrency=${ROOT_ADDR}`} target="_blank" rel="noopener noreferrer"
           className="px-4 py-2 rounded-lg text-[var(--accent-ink)] font-medium text-sm hover:opacity-90 transition-opacity" style={{ background: 'var(--accent)' }}>Buy ${BASE_TOKEN}</a>
      </div>

      {/* filter */}
      <div className="inline-flex gap-1 p-1 rounded-lg border border-[var(--border)]" style={{ background: 'var(--bg-secondary)' }}>
        {(['all', 'live', 'pledging'] as const).map(f => (
          <button key={f} onClick={() => setFilter(f)}
            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${filter === f ? 'text-[var(--accent-ink)] bg-[var(--accent)]' : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'}`}>
            {f === 'all' ? 'All' : f === 'live' ? 'Tradable' : 'Pledging'}
          </button>
        ))}
      </div>

      {/* token list */}
      {!tokens ? (
        <p className="text-xs font-mono text-[var(--text-muted)] py-8 text-center">loading parcel tokens…</p>
      ) : (
        <div className="grid sm:grid-cols-2 gap-3">
          {shown.map((t, i) => {
            const st = STATUS_META[t.status];
            const color = TYPE_COLOR[t.type];
            return (
              <motion.div key={t.id}
                initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35, delay: i * 0.03 }}
                className="rounded-xl border border-[var(--border)] p-4" style={{ background: 'var(--bg-elevated)' }}>
                <div className="flex items-start justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className="text-xl">{t.emoji}</span>
                    <div>
                      <p className="font-mono text-sm font-semibold" style={{ color }}>${t.ticker}</p>
                      <p className="text-[10px] font-mono text-[var(--text-muted)]">{t.name}{t.areaHa != null ? ` · ${t.areaHa.toFixed(2)} ha` : ''}</p>
                    </div>
                  </div>
                  <span className="inline-flex items-center gap-1 text-[9px] font-mono uppercase tracking-wide px-2 py-1 rounded-full" style={{ color: st.color, background: `color-mix(in srgb, ${st.color} 12%, transparent)` }}>
                    <span className="w-1.5 h-1.5 rounded-full" style={{ background: st.color }} />{st.label}
                  </span>
                </div>

                {/* funding / price */}
                <div className="h-1.5 rounded-full overflow-hidden mb-1.5" style={{ background: 'var(--border)' }}>
                  <div className="h-full rounded-full" style={{ background: color, width: `${t.fundedPct}%` }} />
                </div>
                <div className="flex items-center justify-between text-[11px] font-mono text-[var(--text-muted)] mb-3">
                  <span>{usd(t.fundedUsd)} / {usd(t.targetUsd)}</span>
                  {t.tradable ? <span>{fmtPrice(t.priceR00T)}</span> : <span>{t.fundedPct}%</span>}
                </div>

                {/* action — gated by launch status */}
                {t.tradable ? (
                  <a href={uniswapUrl(ROOT_ADDR)} target="_blank" rel="noopener noreferrer"
                     className="block text-center py-2 rounded-lg text-white font-medium text-sm hover:opacity-90 transition-opacity" style={{ background: color }}>
                    Trade ${t.ticker} ↗
                  </a>
                ) : (
                  <button onClick={onOpenMap}
                    className="w-full py-2 rounded-lg border border-[var(--border)] text-sm text-[var(--text-primary)] hover:border-[var(--accent)] transition-colors" style={{ background: 'var(--bg-secondary)' }}>
                    {t.status === 'launching' ? 'Fully funded · TGE soon' : `Pledge → earn $${t.ticker}`}
                  </button>
                )}
                {!t.tradable && (
                  <p className="mt-1.5 text-[9px] font-mono text-[var(--text-muted)] text-center">not tradable until live · fund the land to earn early-bird allocation</p>
                )}
              </motion.div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default LandsPanel;
