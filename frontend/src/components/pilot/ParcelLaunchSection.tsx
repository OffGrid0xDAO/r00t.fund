/**
 * ParcelLaunchSection — the STEWARD's per-parcel launch + live pool verification, shown inside a
 * parcel's detail panel on the land map. Land is created first; then the steward clicks a parcel and
 * opens its Continuous Clearing Auction (open-CCA-only) right here. Nothing is hardcoded downstream:
 * the raise + (once cleared) its zkAMM/public-v4/hook market are AUTO-DISCOVERED on-chain
 * (useCCAAuctions + useV4Markets), so the swapper picks up R00T/<TICKER> automatically. The verify
 * strip reads that same on-chain state so you can SEE the parcel land in the zkAMM + public Uniswap
 * pool with the arb hook.
 *
 * UX: compact, single-screen (no internal scroll) — one status line, a one-row verify strip, and a
 * one-row open-CCA form with a single CTA. SVG icons (no emoji).
 */
import { useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { useV4Markets } from '../../hooks/useV4Markets';
import { useCCAAuctions } from '../../hooks/useCCAAuctions';
import { useLaunchParcel } from '../../hooks/useLaunchParcel';
import { useEnsSubname } from '../../hooks/useEnsSubname';
import type { Plot } from './types';
import { tickerFromName } from './ui';

const CheckIcon = ({ className = '' }: { className?: string }) => (
  <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth={3} aria-hidden>
    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
  </svg>
);
const BoltIcon = ({ className = '' }: { className?: string }) => (
  <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden>
    <path d="M13 2L4.09 12.11a1 1 0 0 0 .78 1.64H11l-1 8 8.91-10.11a1 1 0 0 0-.78-1.64H12l1-8z" />
  </svg>
);
const Spinner = ({ className = '' }: { className?: string }) => (
  <svg viewBox="0 0 24 24" className={`animate-spin ${className}`} fill="none" aria-hidden>
    <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="3" opacity="0.25" />
    <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
  </svg>
);
const XIcon = ({ className = '' }: { className?: string }) => (
  <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth={3} aria-hidden>
    <path strokeLinecap="round" strokeLinejoin="round" d="M6 6l12 12M18 6L6 18" />
  </svg>
);

export function ParcelLaunchSection({ plot, steward, color }: {
  plot: Plot;
  steward: { address: string; treasury: string };
  color: string;
}) {
  const suggested = (plot.ticker ?? tickerFromName(plot.name)).toUpperCase();
  const [ticker, setTicker] = useState(suggested);
  const [floor, setFloor] = useState(0.01);
  const [hours, setHours] = useState(1);

  const { markets } = useV4Markets();                 // auto-discovered from the hook's MarketRegistered
  const { auctions, refetch } = useCCAAuctions(steward.address);
  const { launch, clear, steps, busy } = useLaunchParcel();
  const { issueSubname, nameFor } = useEnsSubname();   // <ticker>.r00tfund.eth per parcel
  const [ensName, setEnsName] = useState<string | null>(null);

  const T = ticker.trim().toUpperCase();
  const market = useMemo(() => markets.find((m) => m.base?.toUpperCase() === T), [markets, T]);
  const auction = useMemo(() => auctions.find((a) => a.ticker?.toUpperCase() === T), [auctions, T]);
  const stage: 'none' | 'cca' | 'clearing' | 'live' =
    market ? 'live' : auction ? (auction.phase >= 2 ? 'clearing' : 'cca') : 'none';

  // the 3-check verification: is this parcel in the zkAMM + public v4 pool + hook?
  const checks = [
    { k: 'zkAMM', ok: !!market?.privatePool },
    { k: 'Uniswap v4', ok: !!market?.poolId },
    { k: 'Arb hook', ok: !!market },
  ];

  const statusLabel =
    stage === 'live' ? 'Live market' : stage === 'clearing' ? 'Clearing' : stage === 'cca' ? 'Raise open' : 'Not launched';

  // re-entrancy guard: a fast double-click could fire the multi-tx flow twice before `busy` re-renders.
  const submitting = useRef(false);
  const onOpen = async () => {
    if (submitting.current || busy) return;
    submitting.current = true;
    try {
      const r = await launch({
        ticker: T, name: plot.name, sale: 100_000, pool: 100_000,
        floorR00T: floor, windowHours: hours, treasury: steward.treasury,
      });
      if (r) refetch();
    } finally {
      submitting.current = false;
    }
  };
  const onClear = async () => {
    if (submitting.current || busy || !auction) return;
    submitting.current = true;
    try {
      const ok = await clear(auction.parcelId as `0x${string}`);
      if (ok) {
        refetch();
        // give the launched parcel its own ENS subname (<ticker>.r00tfund.eth) — best-effort
        issueSubname(T, steward.address).then((n) => n && setEnsName(n));
      }
    } finally {
      submitting.current = false;
    }
  };

  const inputCls = 'w-full mt-1 px-2.5 py-2 rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] text-sm text-[var(--text-primary)] outline-none focus:border-[var(--accent)] transition-colors';
  const lastStep = steps[steps.length - 1];

  return (
    <div className="rounded-xl border p-3.5" style={{ borderColor: `color-mix(in srgb, ${color} 40%, var(--border))`, background: `color-mix(in srgb, ${color} 5%, var(--bg-secondary))` }}>
      {/* status line */}
      <div className="flex items-center justify-between mb-3">
        <span className="text-[10px] font-mono uppercase tracking-[0.14em] text-[var(--text-muted)]">Launch this parcel</span>
        <span className="inline-flex items-center gap-1.5 text-[10px] font-mono px-2 py-0.5 rounded-full border"
          style={{ color: stage === 'none' ? 'var(--text-muted)' : color, borderColor: stage === 'none' ? 'var(--border)' : `${color}66` }}>
          <span className="w-1.5 h-1.5 rounded-full" style={{ background: stage === 'none' ? 'var(--text-muted)' : color }} />
          {statusLabel}
        </span>
      </div>

      {/* verify strip — one row: zkAMM · Uniswap v4 · Arb hook */}
      <div className="flex items-center gap-1.5 mb-3">
        {checks.map((c) => (
          <span key={c.k}
            className="inline-flex items-center gap-1 flex-1 justify-center py-1.5 rounded-lg border text-[10px] font-mono transition-colors"
            style={{
              color: c.ok ? color : 'var(--text-muted)',
              borderColor: c.ok ? `${color}55` : 'var(--border)',
              background: c.ok ? `color-mix(in srgb, ${color} 8%, transparent)` : 'transparent',
            }}>
            {c.ok
              ? <CheckIcon className="w-3 h-3" />
              : <span className="w-1.5 h-1.5 rounded-full bg-[var(--text-muted)] opacity-50" />}
            {c.k}
          </span>
        ))}
      </div>

      {/* ENS subname — every launched parcel gets <ticker>.r00tfund.eth as its human identity */}
      <div className="flex items-center gap-1.5 mb-3 text-[10px] font-mono">
        <span className="px-1.5 py-0.5 rounded border" style={{ color, borderColor: `${color}55` }}>ENS</span>
        <span className="truncate text-[var(--text-secondary)]">{ensName || nameFor(T)}</span>
        {ensName && <span style={{ color }}>· registered</span>}
      </div>

      {stage === 'none' && (
        <>
          <div className="grid grid-cols-[1.4fr_1fr_1fr] gap-2">
            <label className="text-[9px] font-mono uppercase tracking-wide text-[var(--text-muted)]">ticker
              <input value={ticker} onChange={(e) => setTicker(e.target.value.toUpperCase())} className={`${inputCls} font-mono`} /></label>
            <label className="text-[9px] font-mono uppercase tracking-wide text-[var(--text-muted)]">floor R00T
              <input type="number" step={0.01} value={floor} onChange={(e) => setFloor(Number(e.target.value) || 0)} className={inputCls} /></label>
            <label className="text-[9px] font-mono uppercase tracking-wide text-[var(--text-muted)]">window h
              <input type="number" step={1} min={1} value={hours} onChange={(e) => setHours(Math.max(1, Number(e.target.value) || 1))} className={inputCls} /></label>
          </div>
          <button onClick={onOpen} disabled={busy || !T}
            className="mt-3 w-full inline-flex items-center justify-center gap-2 py-2.5 rounded-lg text-[var(--accent-ink)] font-semibold text-sm cursor-pointer transition-transform duration-200 hover:-translate-y-0.5 disabled:opacity-60 disabled:cursor-not-allowed disabled:hover:translate-y-0"
            style={{ background: color, boxShadow: `0 0 24px ${color}33` }}>
            {busy ? <><Spinner className="w-4 h-4" /> Confirm in your wallet…</> : <><BoltIcon className="w-4 h-4" /> Open raise for ${T}</>}
          </button>
          <p className="mt-2 text-[10px] font-mono text-[var(--text-muted)] leading-relaxed">
            Signs a few txns (deploy → mint → approve → open CCA). Keep confirming — on clear it seeds the zkAMM + Uniswap v4 pool + hook.
          </p>
        </>
      )}

      {stage === 'cca' && auction && (
        <>
          <button onClick={onClear} disabled={busy}
            className="w-full inline-flex items-center justify-center gap-2 py-2.5 rounded-lg text-[var(--accent-ink)] font-semibold text-sm cursor-pointer transition-transform duration-200 hover:-translate-y-0.5 disabled:opacity-60 disabled:cursor-not-allowed disabled:hover:translate-y-0"
            style={{ background: color, boxShadow: `0 0 24px ${color}33` }}>
            {busy ? <><Spinner className="w-4 h-4" /> Confirm in your wallet…</> : <><BoltIcon className="w-4 h-4" /> Launch now (clearAndLaunch)</>}
          </button>
          <p className="mt-2 text-[10px] font-mono text-[var(--text-muted)] leading-relaxed">
            {Math.round(auction.raised).toLocaleString()} R00T bid · clears at your floor even with 0 bids. Tops up test R00T for the pool seed, then seeds the zkAMM + Uniswap v4 pool + hook. (ETH/USDC patronage is a separate rail — it won't show here.)
          </p>
        </>
      )}
      {stage === 'live' && market && (
        <p className="text-[11px] font-mono text-[var(--text-secondary)] leading-relaxed">
          Live — <span style={{ color }}>{market.label}</span> is trading on the zkAMM + Uniswap v4 with the arb hook. Swap it in the swapper.
        </p>
      )}

      {/* persistent progress / result — one line, always visible so an error or success never vanishes */}
      {lastStep && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
          className="mt-2 flex items-center gap-1.5 text-[10px] font-mono"
          style={{ color: lastStep.startsWith('✗') ? '#e05555' : busy ? 'var(--text-muted)' : color }}>
          {busy ? <Spinner className="w-3 h-3 shrink-0" /> : lastStep.startsWith('✗') ? <XIcon className="w-3 h-3 shrink-0" /> : <CheckIcon className="w-3 h-3 shrink-0" />}
          <span className="truncate">{lastStep.replace(/^[✓✗]\s*/, '')}</span>
        </motion.div>
      )}
    </div>
  );
}

export default ParcelLaunchSection;
