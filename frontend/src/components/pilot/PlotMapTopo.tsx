/**
 * PlotMapTopo — top-down ("vertical") plan view of the Project 001 land border.
 *
 * Renders the de-georeferenced border outline + contour texture + river as an SVG
 * plan, with fund-a-plot and fund-infrastructure hotspots placed INSIDE the border
 * (terrain-normalized coords, so alignment is exact). Reuses PlotDetailPanel,
 * MachinesPanel, and the usePilotState lifecycle.
 *
 * Firewall: geometry is fuzzed/de-georeferenced (see scripts/fuzz-terrain.mjs).
 */
import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { usePilotState } from './usePilotState';
import { TYPE_COLOR, eur, pct, greenLevel } from './ui';
import { TYPE_LABEL } from './types';
import { PlotDetailPanel } from './PlotDetailPanel';
import { MachinesPanel } from './MachinesPanel';
import { clippedVoronoi, centroid, type Pt } from './voronoi';

interface Boundary { propertyBoundary: number[][] }
interface Contours { contours: { l: string; p: number[][] }[] }
interface River { centerline: number[][] }

export function PlotMapTopo({ className = '' }: { className?: string }) {
  const state = usePilotState();
  const { plots, machines, pending, totals } = state;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [showMachines, setShowMachines] = useState(false);

  const [boundary, setBoundary] = useState<number[][] | null>(null);
  const [contours, setContours] = useState<{ l: string; p: number[][] }[]>([]);
  const [river, setRiver] = useState<number[][] | null>(null);

  useEffect(() => {
    fetch('/terrain/heightmap.json').then(r => r.json()).then((d: Boundary) => setBoundary(d.propertyBoundary)).catch(() => {});
    fetch('/terrain/contours.json').then(r => r.json()).then((d: Contours) => setContours(d.contours || [])).catch(() => {});
    fetch('/terrain/river.json').then(r => r.json()).then((d: River) => setRiver(d.centerline)).catch(() => {});
  }, []);

  // fit the border bbox into a 1000-wide viewBox (keeps aspect, no letterboxing)
  const view = useMemo(() => {
    if (!boundary || boundary.length < 3) return null;
    const xs = boundary.map(p => p[0]), ys = boundary.map(p => p[1]);
    const xmin = Math.min(...xs), xmax = Math.max(...xs), ymin = Math.min(...ys), ymax = Math.max(...ys);
    const pad = 0.14 * Math.max(xmax - xmin, ymax - ymin);
    const vx0 = xmin - pad, vy0 = ymin - pad;
    const vw = (xmax - xmin) + 2 * pad, vh = (ymax - ymin) + 2 * pad;
    const S = 1000 / vw;
    const H = vh * S;
    const project = (nx: number, ny: number): [number, number] => [(nx - vx0) * S, (ny - vy0) * S];
    const inPad = (nx: number, ny: number) => nx >= vx0 && nx <= vx0 + vw && ny >= vy0 && ny <= vy0 + vh;
    return { vx0, vy0, vw, vh, S, H, project, inPad };
  }, [boundary]);

  const borderPath = useMemo(() => {
    if (!boundary || !view) return '';
    return boundary.map((p, i) => `${i === 0 ? 'M' : 'L'}${view.project(p[0], p[1]).map(n => n.toFixed(1)).join(' ')}`).join(' ') + ' Z';
  }, [boundary, view]);

  const contourPaths = useMemo(() => {
    if (!view) return [] as { d: string; l: string }[];
    const out: { d: string; l: string }[] = [];
    for (const c of contours) {
      if (!c.p.some(([nx, ny]) => view.inPad(nx, ny))) continue;
      const d = c.p.map((p, i) => `${i === 0 ? 'M' : 'L'}${view.project(p[0], p[1]).map(n => n.toFixed(1)).join(' ')}`).join(' ');
      out.push({ d, l: c.l });
    }
    return out;
  }, [contours, view]);

  const riverPath = useMemo(() => {
    if (!river || !view) return '';
    const pts = river.filter(([nx, ny]) => view.inPad(nx, ny));
    if (pts.length < 2) return '';
    return pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${view.project(p[0], p[1]).map(n => n.toFixed(1)).join(' ')}`).join(' ');
  }, [river, view]);

  // Partition the land into one investment polygon per plot (clipped Voronoi).
  const cells = useMemo(() => {
    if (!boundary || boundary.length < 3) return {} as Record<string, { poly: Pt[]; c: Pt }>;
    const seeds: Pt[] = plots.map(p => [p.x, p.y]);
    const polys = clippedVoronoi(seeds, boundary as Pt[]);
    const out: Record<string, { poly: Pt[]; c: Pt }> = {};
    plots.forEach((p, i) => {
      const poly = polys[i];
      if (poly && poly.length >= 3) out[p.id] = { poly, c: centroid(poly) };
    });
    return out;
  }, [boundary, plots]);

  const selected = plots.find(p => p.id === selectedId) || null;
  const hovered = plots.find(p => p.id === hoveredId) || null;

  if (!view) {
    return <div className={`grid place-items-center aspect-[16/9] text-xs font-mono text-[var(--text-muted)] ${className}`}>loading land border…</div>;
  }
  const toPct = (sx: number, sy: number) => ({ left: `${(sx / 1000) * 100}%`, top: `${(sy / view.H) * 100}%` });

  return (
    <div className={`relative w-full ${className}`}>
      <svg viewBox={`0 0 1000 ${view.H.toFixed(1)}`} width="100%" style={{ display: 'block' }} className="select-none">
        {/* faint contour texture inside the land */}
        <g opacity={0.5}>
          {contourPaths.map((c, i) => (
            <path key={i} d={c.d} fill="none" stroke="var(--accent-on-bg)" strokeOpacity={c.l === 'major' ? 0.5 : c.l === 'medium' ? 0.3 : 0.16} strokeWidth={c.l === 'major' ? 1.1 : 0.7} strokeLinejoin="round" />
          ))}
        </g>

        {/* land border */}
        <path d={borderPath} fill="var(--accent-on-bg)" fillOpacity={0.05} stroke="var(--accent-on-bg)" strokeWidth={2.4} strokeLinejoin="round" strokeOpacity={0.85} />
        <path d={borderPath} fill="none" stroke="var(--accent-on-bg)" strokeWidth={6} strokeLinejoin="round" strokeOpacity={0.08} />

        {/* river */}
        {riverPath && <path d={riverPath} fill="none" stroke="#5BA8B5" strokeWidth={3.2} strokeOpacity={0.55} strokeLinecap="round" strokeLinejoin="round" />}

        {/* investment polygons — "polígonos de investimento" partitioning the land */}
        {plots.map((p) => {
          const cell = cells[p.id];
          if (!cell) return null;
          const color = TYPE_COLOR[p.type];
          const g = greenLevel(p.status, p.fundedEur, p.targetEur);
          const active = hoveredId === p.id || selectedId === p.id;
          const [cx, cy] = view.project(cell.c[0], cell.c[1]);
          const d = cell.poly.map((pt, i) => `${i === 0 ? 'M' : 'L'}${view.project(pt[0], pt[1]).map(n => n.toFixed(1)).join(' ')}`).join(' ') + ' Z';
          return (
            <g key={p.id} style={{ cursor: 'pointer' }}
               onMouseEnter={() => setHoveredId(p.id)} onMouseLeave={() => setHoveredId(h => h === p.id ? null : h)}
               onClick={() => setSelectedId(p.id)}>
              {/* parcel fill — greening intensity tracks funding */}
              <path d={d} fill={color} fillOpacity={(0.1 + 0.32 * g) * (active ? 1.5 : 1)}
                    stroke={color} strokeWidth={active ? 2.4 : 1.4}
                    strokeOpacity={p.status === 'seeking' ? 0.6 : 0.9}
                    strokeDasharray={p.status === 'verified' ? undefined : '5 4'}
                    strokeLinejoin="round" />
              {/* label at the parcel centroid */}
              <text x={cx} y={cy - 2} textAnchor="middle" className="font-mono" fontSize={11} fontWeight={600} fill={color} style={{ paintOrder: 'stroke', stroke: 'var(--bg-primary)', strokeWidth: 3, strokeLinejoin: 'round' }}>
                {p.status === 'verified' ? '✅ ' : ''}{pct(p.fundedEur, p.targetEur)}%
              </text>
              <text x={cx} y={cy + 11} textAnchor="middle" className="font-mono" fontSize={7.5} fill="var(--text-muted)" style={{ paintOrder: 'stroke', stroke: 'var(--bg-primary)', strokeWidth: 2.5, strokeLinejoin: 'round' }}>
                {p.name}
              </text>
            </g>
          );
        })}

        {/* infrastructure pins */}
        {machines.filter(m => m.x != null && m.y != null).map((m) => {
          const [sx, sy] = view.project(m.x as number, m.y as number);
          return (
            <g key={m.id} style={{ cursor: 'pointer' }} onClick={() => setShowMachines(true)} onMouseEnter={() => setHoveredId('m:' + m.id)} onMouseLeave={() => setHoveredId(h => h === 'm:' + m.id ? null : h)}>
              <circle cx={sx} cy={sy} r={9} fill="var(--bg-elevated)" stroke="#D4A84B" strokeWidth={1.4} />
              <text x={sx} y={sy + 4.5} textAnchor="middle" fontSize={9}>{m.emoji}</text>
            </g>
          );
        })}
      </svg>

      {/* hover tooltip (plots) */}
      <AnimatePresence>
        {hovered && hovered.id !== selectedId && (() => {
          const [sx, sy] = view.project(hovered.x, hovered.y);
          return (
            <motion.div key={hovered.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 6 }} transition={{ duration: 0.14 }}
              className="pointer-events-none absolute z-30 w-52 -translate-x-1/2 rounded-lg border border-[var(--border)] p-3 backdrop-blur-md"
              style={{ ...toPct(sx, sy), marginTop: 10, background: 'color-mix(in srgb, var(--bg-elevated) 92%, transparent)', boxShadow: 'var(--shadow-md)' }}>
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
          );
        })()}
      </AnimatePresence>

      {/* legend */}
      <div className="pointer-events-none absolute right-3 top-3 z-20 flex flex-col gap-1">
        {(['syntropic', 'water', 'structure'] as const).map((t) => (
          <span key={t} className="inline-flex items-center gap-1.5 text-[9px] font-mono text-[var(--text-muted)] px-2 py-1 rounded-full backdrop-blur-sm" style={{ background: 'color-mix(in srgb, var(--bg-elevated) 70%, transparent)' }}>
            <span className="w-2 h-2 rounded-full" style={{ background: TYPE_COLOR[t] }} />{TYPE_LABEL[t]}
          </span>
        ))}
      </div>

      {/* totals HUD */}
      <div className="absolute left-3 bottom-3 z-20 flex items-center gap-3 rounded-xl border border-[var(--border)] px-3.5 py-2.5 backdrop-blur-md" style={{ background: 'color-mix(in srgb, var(--bg-elevated) 88%, transparent)' }}>
        <div>
          <p className="font-display text-base text-[var(--text-primary)] leading-none">{eur(totals.funded)}</p>
          <p className="text-[9px] font-mono text-[var(--text-muted)] mt-0.5">of {eur(totals.target)} · {totals.backers} backers · {totals.verified}/{totals.plots} verified</p>
        </div>
        <div className="w-px h-8 bg-[var(--border)]" />
        <button onClick={() => setShowMachines(true)} className="text-xs font-medium text-[var(--text-secondary)] hover:text-[var(--accent)] transition-colors flex items-center gap-1.5">🚜 Machines & infra</button>
      </div>

      {/* detail drawer */}
      <AnimatePresence>
        {selected && (
          <PlotDetailPanel plot={selected} busy={!!pending[selected.id]} verifying={!!pending[selected.id + ':verify']}
            onClose={() => setSelectedId(null)} onFund={(amt) => state.fundPlot(selected.id, amt)}
            onChooseCrop={(cid) => state.chooseCrop(selected.id, cid)} onPlant={() => state.plantPlot(selected.id)} onVerify={() => state.verifyPlot(selected.id)} />
        )}
      </AnimatePresence>

      {/* machines / infrastructure modal */}
      <AnimatePresence>
        {showMachines && <MachinesPanel machines={machines} pending={pending} onClose={() => setShowMachines(false)} onFund={state.fundMachine} />}
      </AnimatePresence>
    </div>
  );
}

export default PlotMapTopo;
