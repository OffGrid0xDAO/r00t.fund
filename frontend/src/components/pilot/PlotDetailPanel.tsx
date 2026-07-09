/**
 * PlotDetailPanel — the click-through detail for a single plot.
 * Fund (patronage only), choose-what-grows, advance the lifecycle, and read the
 * bridged verification attestation.
 */
import { useState } from 'react';
import { motion } from 'framer-motion';
import type { Plot } from './types';
import { STATUS_ORDER, STATUS_LABEL, TYPE_LABEL } from './types';
import { CROPS } from './data';
import { TYPE_COLOR, REWARD_LABEL, eur, pct } from './ui';

const FUND_PRESETS = [25, 100, 500];

export function PlotDetailPanel({
  plot, busy, verifying, onClose, onFund, onChooseCrop, onPlant, onVerify,
}: {
  plot: Plot;
  busy: boolean;
  verifying: boolean;
  onClose: () => void;
  onFund: (amount: number) => void;
  onChooseCrop: (cropId: string) => void;
  onPlant: () => void;
  onVerify: () => void;
}) {
  const [amount, setAmount] = useState(100);
  const color = TYPE_COLOR[plot.type];
  const progress = pct(plot.fundedEur, plot.targetEur);
  const remaining = Math.max(0, plot.targetEur - plot.fundedEur);
  const isSyntropic = plot.type === 'syntropic';
  const statusIdx = STATUS_ORDER.indexOf(plot.status);

  return (
    <motion.div
      initial={{ x: '100%', opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      exit={{ x: '100%', opacity: 0 }}
      transition={{ type: 'spring', stiffness: 320, damping: 34 }}
      className="pointer-events-auto absolute top-0 right-0 h-full w-full sm:w-[380px] z-30 overflow-y-auto border-l border-[var(--border)] backdrop-blur-md"
      style={{ background: 'color-mix(in srgb, var(--bg-elevated) 92%, transparent)' }}
    >
      <div className="p-5 md:p-6">
        {/* header */}
        <div className="flex items-start justify-between gap-3 mb-4">
          <div>
            <span className="inline-flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-[0.15em]" style={{ color }}>
              <span className="w-2 h-2 rounded-full" style={{ background: color }} />
              {TYPE_LABEL[plot.type]}
            </span>
            <h3 className="font-display text-2xl text-[var(--text-primary)] mt-1 leading-tight">{plot.name}</h3>
          </div>
          <button onClick={onClose} className="shrink-0 p-1.5 rounded-md text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-secondary)] transition-colors" aria-label="Close">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>

        <p className="text-sm text-[var(--text-secondary)] leading-relaxed mb-5">{plot.blurb}</p>

        {/* lifecycle stepper */}
        <div className="flex items-center gap-1 mb-5">
          {STATUS_ORDER.map((s, i) => (
            <div key={s} className="flex-1">
              <div className="h-1 rounded-full transition-colors duration-300" style={{ background: i <= statusIdx ? color : 'var(--border)' }} />
              <span className={`mt-1 block text-[8px] font-mono uppercase tracking-wide ${i === statusIdx ? 'text-[var(--text-primary)]' : 'text-[var(--text-muted)]'}`}>{STATUS_LABEL[s].split(' ')[0]}</span>
            </div>
          ))}
        </div>

        {/* funding progress */}
        <div className="rounded-xl border border-[var(--border)] p-4 mb-4" style={{ background: 'var(--bg-secondary)' }}>
          <div className="flex items-baseline justify-between mb-2">
            <span className="font-display text-lg text-[var(--text-primary)]">{eur(plot.fundedEur)}</span>
            <span className="text-xs font-mono text-[var(--text-muted)]">of {eur(plot.targetEur)}</span>
          </div>
          <div className="h-2 rounded-full overflow-hidden" style={{ background: 'var(--border)' }}>
            <motion.div className="h-full rounded-full" style={{ background: color }} initial={{ width: 0 }} animate={{ width: `${progress}%` }} transition={{ duration: 0.6, ease: 'easeOut' }} />
          </div>
          <div className="flex items-center justify-between mt-2 text-[11px] font-mono text-[var(--text-muted)]">
            <span>{plot.contributions.length} backers</span>
            <span>{remaining > 0 ? `${eur(remaining)} to go` : 'fully backed'}</span>
          </div>
        </div>

        {/* choose what grows (syntropic only) */}
        {isSyntropic && plot.cropOptions && (
          <div className="mb-4">
            <p className="text-[10px] font-mono uppercase tracking-[0.15em] text-[var(--text-muted)] mb-2">Choose what grows</p>
            <div className="flex flex-wrap gap-2">
              {plot.cropOptions.map((cid) => {
                const crop = CROPS.find((c) => c.id === cid);
                if (!crop) return null;
                const active = plot.chosenCropId === cid;
                return (
                  <button
                    key={cid}
                    onClick={() => onChooseCrop(cid)}
                    title={crop.note}
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs transition-colors ${active ? 'text-white border-transparent' : 'text-[var(--text-secondary)] border-[var(--border)] hover:border-[var(--accent)]'}`}
                    style={active ? { background: color } : { background: 'var(--bg-elevated)' }}
                  >
                    <span>{crop.emoji}</span>{crop.label}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* fund controls */}
        <div className="mb-4">
          <p className="text-[10px] font-mono uppercase tracking-[0.15em] text-[var(--text-muted)] mb-2">Back this plot</p>
          <div className="flex gap-2 mb-2">
            {FUND_PRESETS.map((v) => (
              <button key={v} onClick={() => setAmount(v)} className={`flex-1 py-2 rounded-lg border text-sm font-medium transition-colors ${amount === v ? 'text-white border-transparent' : 'text-[var(--text-secondary)] border-[var(--border)] hover:border-[var(--accent)]'}`} style={amount === v ? { background: color } : { background: 'var(--bg-elevated)' }}>{eur(v)}</button>
            ))}
            <input
              type="number" min={1} value={amount}
              onChange={(e) => setAmount(Math.max(1, Number(e.target.value) || 0))}
              className="w-20 px-2 py-2 rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] text-sm text-[var(--text-primary)] text-center font-mono"
            />
          </div>
          <button
            onClick={() => onFund(amount)}
            disabled={busy}
            className="w-full py-3 rounded-lg text-white font-medium text-sm transition-opacity disabled:opacity-60 hover:opacity-90"
            style={{ background: color }}
          >
            {busy ? 'Recording…' : `Fund ${eur(amount)} — patronage`}
          </button>
        </div>

        {/* lifecycle actions */}
        {(plot.status === 'funded' || plot.status === 'planted') && (
          <div className="flex gap-2 mb-4">
            {plot.status === 'funded' && (
              <button onClick={onPlant} className="flex-1 py-2.5 rounded-lg border border-[var(--border)] text-sm text-[var(--text-primary)] hover:border-[var(--accent)] transition-colors" style={{ background: 'var(--bg-elevated)' }}>Mark planted 🌱</button>
            )}
            <button onClick={onVerify} disabled={verifying} className="flex-1 py-2.5 rounded-lg border border-[var(--border)] text-sm text-[var(--text-primary)] hover:border-[var(--accent)] transition-colors disabled:opacity-60" style={{ background: 'var(--bg-elevated)' }}>
              {verifying ? 'Checking…' : 'Request verification'}
            </button>
          </div>
        )}

        {/* verification receipt */}
        {plot.verified?.attested && (
          <div className="rounded-xl border p-3 mb-4 flex items-center gap-3" style={{ borderColor: 'var(--success)', background: 'color-mix(in srgb, var(--success) 8%, transparent)' }}>
            <span className="text-lg">✅</span>
            <div className="text-xs">
              <p className="text-[var(--text-primary)] font-medium">Verified regenerating</p>
              <p className="text-[var(--text-muted)] font-mono">{plot.verified.ndvi != null ? `NDVI ${plot.verified.ndvi.toFixed(2)} · ` : ''}{plot.verified.source}</p>
            </div>
          </div>
        )}

        {/* patronage rewards */}
        <div className="mb-2">
          <p className="text-[10px] font-mono uppercase tracking-[0.15em] text-[var(--text-muted)] mb-2">What backers receive</p>
          <div className="flex flex-wrap gap-1.5">
            {plot.rewards.map((r) => (
              <span key={r} className="inline-flex items-center px-2.5 py-1 rounded-full border border-[var(--border)] bg-[var(--bg-secondary)] text-[11px] text-[var(--text-secondary)]">{REWARD_LABEL[r]}</span>
            ))}
          </div>
          <p className="mt-2 text-[10px] text-[var(--text-muted)] italic">Patronage only — no revenue share, yield, or resale value.</p>
        </div>

        {/* contributors */}
        {plot.contributions.length > 0 && (
          <div className="mt-4 pt-4 border-t border-[var(--border)]">
            <p className="text-[10px] font-mono uppercase tracking-[0.15em] text-[var(--text-muted)] mb-2">Recent backers</p>
            <ul className="space-y-1.5">
              {plot.contributions.slice(0, 5).map((c) => (
                <li key={c.id} className="flex items-center justify-between text-xs">
                  <span className="font-mono text-[var(--text-secondary)]">{c.backer}</span>
                  <span className="text-[var(--text-muted)]">{eur(c.amountEur)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </motion.div>
  );
}

export default PlotDetailPanel;
