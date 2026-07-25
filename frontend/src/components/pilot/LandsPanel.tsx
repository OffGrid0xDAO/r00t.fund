/**
 * LandsPanel — the dapp's land / parcel-token view. Reads the LIVE on-chain launches (the CCA
 * auctions from the RegenLaunchpad, auto-discovered) — nothing hardcoded. $R00T base + every parcel a
 * steward has launched, with its status (raising / live). Fresh app = empty until the first launch.
 */
import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { useAccount } from 'wagmi';
import { BASE_TOKEN } from './lands';
import { CONTRACTS, HACKATHON } from '../../config';
import { useCCAAuctions } from '../../hooks/useCCAAuctions';

const ROOT_ADDR = CONTRACTS.rootToken;
const uniswapUrl = (out: string) => `https://app.uniswap.org/swap?inputCurrency=${ROOT_ADDR}&outputCurrency=${out}`;
const EMOJI: Record<string, string> = { OAK: '🌳', NUT: '🌰', CARROT: '🥕', CACTUS: '🌵', BERRY: '🫐', HERB: '🌿', FIG: '🫒', SPUD: '🥔' };

export function LandsPanel({ onOpenMap, onStartLand }: { onOpenMap?: () => void; onStartLand?: () => void }) {
  const { address } = useAccount();
  const { auctions, loading } = useCCAAuctions(address);
  const [filter, setFilter] = useState<'all' | 'live' | 'raising'>('all');

  const liveCount = auctions.filter((a) => a.phase === 2).length;
  const shown = useMemo(() => auctions.filter((a) =>
    filter === 'all' ? true : filter === 'live' ? a.phase === 2 : a.phase === 1), [auctions, filter]);

  return (
    <div className="space-y-4">
      {/* header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <span className="text-xs tracking-[0.2em] text-[var(--accent-on-bg)] uppercase font-mono">Lands · Parcel tokens</span>
          <p className="text-[11px] font-mono text-[var(--text-muted)] mt-0.5">{auctions.length} parcel{auctions.length === 1 ? '' : 's'} · {liveCount} live · pair with ${BASE_TOKEN}</p>
        </div>
        <div className="flex items-center gap-3">
          {onStartLand && <button onClick={onStartLand} className="text-xs font-medium text-black px-3 py-1.5 rounded-lg" style={{ background: 'var(--accent)' }}>+ Start your land</button>}
          {onOpenMap && <button onClick={onOpenMap} className="text-xs font-medium text-[var(--text-secondary)] hover:text-[var(--accent-on-bg)] transition-colors inline-flex items-center gap-1.5">🗺️ Land map</button>}
        </div>
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
        {(['all', 'live', 'raising'] as const).map((f) => (
          <button key={f} onClick={() => setFilter(f)}
            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${filter === f ? 'text-[var(--accent-ink)] bg-[var(--accent)]' : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'}`}>
            {f === 'all' ? 'All' : f === 'live' ? 'Live' : 'Raising'}
          </button>
        ))}
      </div>

      {/* parcel list — LIVE from on-chain CCA auctions */}
      {loading ? (
        <p className="text-xs font-mono text-[var(--text-muted)] py-8 text-center">reading launches on-chain…</p>
      ) : auctions.length === 0 ? (
        <div className="rounded-xl border border-dashed border-[var(--border)] p-8 text-center">
          <div className="text-3xl mb-2">🌱</div>
          <p className="text-sm text-[var(--text-primary)]">No parcels launched yet</p>
          <p className="text-[11px] font-mono text-[var(--text-muted)] mt-1">Start your land, define parcels, and open them via a CCA — they appear here automatically.</p>
          {onStartLand && <button onClick={onStartLand} className="mt-4 px-4 py-2 rounded-lg text-black font-medium text-sm" style={{ background: 'var(--accent)' }}>Start your land</button>}
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 gap-3">
          {shown.map((a, i) => {
            const live = a.phase === 2;
            const price = live ? a.clearedPrice : Math.max(a.impliedPrice, a.reservePrice);
            const st = live ? { label: 'LIVE', color: '#7CFFB2' } : { label: 'RAISING', color: '#D6FE51' };
            return (
              <motion.div key={a.parcelId}
                initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35, delay: i * 0.03 }}
                className="rounded-xl border border-[var(--border)] p-4" style={{ background: 'var(--bg-elevated)' }}>
                <div className="flex items-start justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className="text-xl">{EMOJI[a.ticker] || '🌱'}</span>
                    <div>
                      <p className="font-mono text-sm font-semibold" style={{ color: st.color }}>${a.ticker}</p>
                      <p className="text-[10px] font-mono text-[var(--text-muted)]">raised {a.raised.toLocaleString(undefined, { maximumFractionDigits: 0 })} R00T</p>
                    </div>
                  </div>
                  <span className="inline-flex items-center gap-1 text-[9px] font-mono uppercase tracking-wide px-2 py-1 rounded-full" style={{ color: st.color, background: `color-mix(in srgb, ${st.color} 12%, transparent)` }}>
                    <span className="w-1.5 h-1.5 rounded-full" style={{ background: st.color }} />{st.label}
                  </span>
                </div>

                <div className="flex items-center justify-between text-[11px] font-mono text-[var(--text-muted)] mb-3">
                  <span>{price ? price.toFixed(4) : '…'} R00T/{a.ticker}</span>
                  <span>{live ? 'cleared' : 'floor ' + a.reservePrice.toFixed(3)}</span>
                </div>

                {live ? (
                  <a href={uniswapUrl(a.token)} target="_blank" rel="noopener noreferrer"
                     className="block text-center py-2 rounded-lg text-black font-medium text-sm hover:opacity-90 transition-opacity" style={{ background: st.color }}>
                    Trade ${a.ticker} ↗
                  </a>
                ) : (
                  <a href={`${HACKATHON.explorerUrl}/address/${a.token}`} target="_blank" rel="noopener noreferrer"
                    className="block text-center py-2 rounded-lg border border-[var(--border)] text-sm text-[var(--text-primary)] hover:border-[var(--accent)] transition-colors" style={{ background: 'var(--bg-secondary)' }}>
                    Raising — back it in the Steward Console
                  </a>
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
