/**
 * PlotMap — the interactive Farmville-style plot layer over the terrain.
 *
 *   hover → contributors + amount still needed
 *   click → detail panel (fund · choose-what-grows · lifecycle · verification)
 *   greening intensity tracks funding, in the r00t palette
 *
 * The layer is pointer-events-none so the terrain shows through; only the plot
 * hotspots, HUD, and panels capture input.
 */
import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { usePilotState } from './usePilotState';
import { TYPE_COLOR, eur, pct, greenLevel } from './ui';
import { TYPE_LABEL } from './types';
import { PlotDetailPanel } from './PlotDetailPanel';
import { MachinesPanel } from './MachinesPanel';

export function PlotMap() {
  const state = usePilotState();
  const { plots, machines, pending, totals } = state;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [showMachines, setShowMachines] = useState(false);

  const selected = plots.find((p) => p.id === selectedId) || null;
  const hovered = plots.find((p) => p.id === hoveredId) || null;

  return (
    <div className="pointer-events-none absolute inset-0 z-20 select-none">
      {/* plot hotspots */}
      {plots.map((p) => {
        const color = TYPE_COLOR[p.type];
        const g = greenLevel(p.status, p.fundedEur, p.targetEur);
        const diameter = `${p.r * 2 * 100}%`;
        const isSel = p.id === selectedId;
        return (
          <button
            key={p.id}
            onMouseEnter={() => setHoveredId(p.id)}
            onMouseLeave={() => setHoveredId((h) => (h === p.id ? null : h))}
            onClick={() => setSelectedId(p.id)}
            className="pointer-events-auto absolute rounded-full outline-none"
            style={{ left: `${p.x * 100}%`, top: `${p.y * 100}%`, width: diameter, aspectRatio: '1', transform: 'translate(-50%,-50%)' }}
            aria-label={`${p.name} — ${TYPE_LABEL[p.type]}`}
          >
            {/* greening fill */}
            <motion.span
              className="absolute inset-0 rounded-full"
              style={{ background: `radial-gradient(circle at 50% 45%, ${color} 0%, transparent 70%)`, opacity: 0.25 + 0.55 * g }}
              animate={{ scale: hoveredId === p.id || isSel ? 1.08 : 1 }}
              transition={{ type: 'spring', stiffness: 300, damping: 24 }}
            />
            {/* status ring */}
            <span className="absolute inset-[18%] rounded-full border" style={{ borderColor: color, opacity: p.status === 'seeking' ? 0.5 : 0.9, borderStyle: p.status === 'verified' ? 'solid' : 'dashed' }} />
            {/* pulse for still-seeking plots */}
            {p.status === 'seeking' && (
              <motion.span className="absolute inset-[30%] rounded-full" style={{ background: color }} animate={{ opacity: [0.5, 0.1, 0.5], scale: [1, 1.4, 1] }} transition={{ duration: 2.4, repeat: Infinity, ease: 'easeInOut' }} />
            )}
            {p.status === 'verified' && (
              <span className="absolute inset-0 grid place-items-center text-sm">✅</span>
            )}
          </button>
        );
      })}

      {/* hover tooltip */}
      <AnimatePresence>
        {hovered && hovered.id !== selectedId && (
          <motion.div
            key={hovered.id}
            initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 6 }}
            transition={{ duration: 0.15 }}
            className="pointer-events-none absolute z-30 w-52 -translate-x-1/2 rounded-lg border border-[var(--border)] p-3 backdrop-blur-md"
            style={{ left: `${hovered.x * 100}%`, top: `calc(${hovered.y * 100}% + ${hovered.r * 100}%)`, background: 'color-mix(in srgb, var(--bg-elevated) 92%, transparent)', boxShadow: 'var(--shadow-md)' }}
          >
            <div className="flex items-center gap-1.5 mb-1">
              <span className="w-2 h-2 rounded-full" style={{ background: TYPE_COLOR[hovered.type] }} />
              <span className="text-[9px] font-mono uppercase tracking-wide text-[var(--text-muted)]">{TYPE_LABEL[hovered.type]}</span>
            </div>
            <p className="font-display text-sm text-[var(--text-primary)] leading-tight mb-1.5">{hovered.name}</p>
            <div className="h-1 rounded-full overflow-hidden mb-1.5" style={{ background: 'var(--border)' }}>
              <div className="h-full rounded-full" style={{ background: TYPE_COLOR[hovered.type], width: `${pct(hovered.fundedEur, hovered.targetEur)}%` }} />
            </div>
            <div className="flex items-center justify-between text-[10px] font-mono text-[var(--text-muted)]">
              <span>{hovered.contributions.length} backers</span>
              <span>{hovered.fundedEur >= hovered.targetEur ? 'fully backed' : `${eur(hovered.targetEur - hovered.fundedEur)} to go`}</span>
            </div>
            <p className="mt-1.5 text-[9px] text-[var(--accent)] font-mono">click to back →</p>
          </motion.div>
        )}
      </AnimatePresence>

      {/* totals HUD */}
      <div className="pointer-events-auto absolute left-3 bottom-3 z-30 flex items-center gap-3 rounded-xl border border-[var(--border)] px-3.5 py-2.5 backdrop-blur-md" style={{ background: 'color-mix(in srgb, var(--bg-elevated) 88%, transparent)' }}>
        <div>
          <p className="font-display text-base text-[var(--text-primary)] leading-none">{eur(totals.funded)}</p>
          <p className="text-[9px] font-mono text-[var(--text-muted)] mt-0.5">of {eur(totals.target)} · {totals.backers} backers · {totals.verified}/{totals.plots} verified</p>
        </div>
        <div className="w-px h-8 bg-[var(--border)]" />
        <button onClick={() => setShowMachines(true)} className="text-xs font-medium text-[var(--text-secondary)] hover:text-[var(--accent)] transition-colors flex items-center gap-1.5">
          🚜 Machines
        </button>
      </div>

      {/* legend */}
      <div className="pointer-events-none absolute right-3 top-3 z-20 flex flex-col gap-1">
        {(['syntropic', 'water', 'structure'] as const).map((t) => (
          <span key={t} className="inline-flex items-center gap-1.5 text-[9px] font-mono text-[var(--text-muted)] px-2 py-1 rounded-full backdrop-blur-sm" style={{ background: 'color-mix(in srgb, var(--bg-elevated) 70%, transparent)' }}>
            <span className="w-2 h-2 rounded-full" style={{ background: TYPE_COLOR[t] }} />{TYPE_LABEL[t]}
          </span>
        ))}
      </div>

      {/* detail drawer */}
      <AnimatePresence>
        {selected && (
          <PlotDetailPanel
            plot={selected}
            busy={!!pending[selected.id]}
            verifying={!!pending[selected.id + ':verify']}
            onClose={() => setSelectedId(null)}
            onFund={(amt) => state.fundPlot(selected.id, amt)}
            onChooseCrop={(cid) => state.chooseCrop(selected.id, cid)}
            onPlant={() => state.plantPlot(selected.id)}
            onVerify={() => state.verifyPlot(selected.id)}
          />
        )}
      </AnimatePresence>

      {/* communal machines modal */}
      <AnimatePresence>
        {showMachines && (
          <MachinesPanel machines={machines} pending={pending} onClose={() => setShowMachines(false)} onFund={state.fundMachine} />
        )}
      </AnimatePresence>
    </div>
  );
}

export default PlotMap;
