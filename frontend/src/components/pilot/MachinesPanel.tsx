/**
 * MachinesPanel — shared communal capex (Workstream E).
 * Tractor, chipper, pump, kitchen build — funded together, separate from the
 * plant-a-plot flow. Patronage only (naming + certificate), no financial return.
 */
import { motion } from 'framer-motion';
import type { Machine } from './types';
import { eur, pct } from './ui';

export function MachinesPanel({
  machines, pending, onClose, onFund,
}: {
  machines: Machine[];
  pending: Record<string, boolean>;
  onClose: () => void;
  onFund: (machineId: string, amount: number) => void;
}) {
  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="pointer-events-auto absolute inset-0 z-40 grid place-items-center p-4"
      style={{ background: 'color-mix(in srgb, var(--bg-primary) 55%, transparent)' }}
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.96, y: 12 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.96, y: 12 }}
        transition={{ type: 'spring', stiffness: 300, damping: 30 }}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg rounded-2xl border border-[var(--border)] overflow-hidden"
        style={{ background: 'var(--bg-elevated)', boxShadow: 'var(--shadow-lg)' }}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)]">
          <div>
            <h3 className="font-display text-xl text-[var(--text-primary)]">Communal machines & infrastructure</h3>
            <p className="text-[11px] font-mono text-[var(--text-muted)]">Funded together · shared by every plot</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-md text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-secondary)]" aria-label="Close">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>

        <div className="p-5 space-y-4 max-h-[60vh] overflow-y-auto">
          {machines.map((m) => {
            const progress = pct(m.fundedEur, m.targetEur);
            const done = m.fundedEur >= m.targetEur;
            return (
              <div key={m.id} className="rounded-xl border border-[var(--border)] p-4" style={{ background: 'var(--bg-secondary)' }}>
                <div className="flex items-start gap-3">
                  <span className="text-2xl leading-none">{m.emoji}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <h4 className="font-display text-base text-[var(--text-primary)]">{m.name}</h4>
                      <span className="text-[9px] font-mono uppercase tracking-wide text-[var(--text-muted)] px-2 py-0.5 rounded-full border border-[var(--border)]">{m.kind}</span>
                    </div>
                    <p className="text-xs text-[var(--text-secondary)] mt-0.5 mb-2 leading-relaxed">{m.blurb}</p>
                    <div className="h-1.5 rounded-full overflow-hidden mb-1.5" style={{ background: 'var(--border)' }}>
                      <div className="h-full rounded-full bg-[var(--accent)]" style={{ width: `${progress}%` }} />
                    </div>
                    <div className="flex items-center justify-between text-[11px] font-mono text-[var(--text-muted)]">
                      <span>{eur(m.fundedEur)} / {eur(m.targetEur)}</span>
                      {done ? (
                        <span className="text-[var(--success)]">fully funded ✓</span>
                      ) : (
                        <button onClick={() => onFund(m.id, 100)} disabled={!!pending[m.id]} className="px-3 py-1 rounded-md text-[var(--accent-ink)] bg-[var(--accent)] hover:opacity-90 disabled:opacity-60 transition-opacity">
                          {pending[m.id] ? '…' : 'Chip in €100'}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </motion.div>
    </motion.div>
  );
}

export default MachinesPanel;
