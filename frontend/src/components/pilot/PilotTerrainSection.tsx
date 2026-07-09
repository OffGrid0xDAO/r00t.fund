/**
 * PilotTerrainSection — the "Project 001" cinematic terrain intro on the landing.
 *
 * A clean 3D contour-relief render of the pilot site (PilotTerrain), matching the
 * source intro animation. Content lives over the blank left area; hovering the
 * glowing land shows a hint, and clicking it opens the top-down plot map.
 */
import { lazy, Suspense, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { SEED_PLOTS } from './data';
import { TYPE_LABEL } from './types';
import { TYPE_COLOR, eur } from './ui';

const PilotTerrain = lazy(() => import('./PilotTerrain').then(m => ({ default: m.PilotTerrain })));
const PlotMapTopo = lazy(() => import('./PlotMapTopo').then(m => ({ default: m.PlotMapTopo })));

export function PilotTerrainSection({ onEnterApp }: { onEnterApp?: () => void }) {
  const [hovering, setHovering] = useState(false);
  const [showMap, setShowMap] = useState(false);

  const stats = useMemo(() => {
    const funded = SEED_PLOTS.reduce((s, p) => s + p.fundedEur, 0);
    const target = SEED_PLOTS.reduce((s, p) => s + p.targetEur, 0);
    const backers = new Set(SEED_PLOTS.flatMap(p => p.contributions.map(c => c.backer))).size;
    const verified = SEED_PLOTS.filter(p => p.status === 'verified').length;
    return { funded, target, backers, verified, plots: SEED_PLOTS.length };
  }, []);

  return (
    <section id="pilot-001" className="relative pt-10 pb-16 md:pt-14 md:pb-24 px-6 md:px-12 lg:px-16 border-t border-[var(--border)]/50 dark:border-transparent">
      <div className="max-w-6xl mx-auto">
        {/* cinematic terrain stage */}
        <motion.div
          initial={{ opacity: 0, y: 24 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: '-40px' }}
          transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
          className="relative rounded-2xl border border-[var(--border)] overflow-hidden"
          style={{ background: 'var(--bg-primary)', boxShadow: 'var(--shadow-md)' }}
        >
          <div className="relative w-full h-[64vh] md:h-[80vh]">
            <Suspense fallback={<div className="absolute inset-0 grid place-items-center text-xs font-mono text-[var(--text-muted)]">rendering terrain…</div>}>
              <PilotTerrain onLandHover={setHovering} onLandClick={() => setShowMap(true)} />
            </Suspense>

            {/* ── content over the blank left side ── */}
            <div className="pointer-events-none absolute inset-y-0 left-0 w-full md:w-[48%] p-6 md:p-10 lg:p-12 flex flex-col justify-center">
              <motion.div initial={{ opacity: 0, x: -16 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true }} transition={{ duration: 0.6, delay: 0.2 }}>
                <div className="flex items-center gap-3 mb-5">
                  <div className="w-8 h-px bg-[var(--accent)]" />
                  <span className="text-xs tracking-[0.2em] text-[var(--accent-on-bg)] uppercase font-mono">Project 001 · The Pilot Site</span>
                </div>
                <h2 className="font-display text-3xl md:text-4xl lg:text-5xl text-[var(--text-primary)] tracking-[-0.02em] leading-[1.05] mb-4">
                  9 hectares of burned hillside, <span className="text-[var(--accent-on-bg)]">mapped plot by plot.</span>
                </h2>
                <p className="text-sm md:text-base text-[var(--text-secondary)] leading-relaxed max-w-md mb-6">
                  The real terrain — every contour, swale and watercourse. Back a zone, choose what grows,
                  and watch the land green as funding lands.
                </p>

                {/* live-ish stats */}
                <div className="flex flex-wrap gap-x-8 gap-y-3 mb-6">
                  {[
                    { v: eur(stats.funded), l: `raised of ${eur(stats.target)}` },
                    { v: String(stats.backers), l: 'backers' },
                    { v: `${stats.verified}/${stats.plots}`, l: 'zones verified' },
                  ].map((s) => (
                    <div key={s.l}>
                      <p className="font-display text-2xl md:text-3xl text-[var(--text-primary)] tracking-tight leading-none">{s.v}</p>
                      <p className="text-[10px] font-mono uppercase tracking-[0.12em] text-[var(--text-muted)] mt-1">{s.l}</p>
                    </div>
                  ))}
                </div>

                {/* intervention legend */}
                <div className="flex flex-wrap gap-2 mb-7">
                  {(['syntropic', 'water', 'structure'] as const).map((t) => (
                    <span key={t} className="inline-flex items-center gap-1.5 text-[11px] font-mono text-[var(--text-secondary)] px-2.5 py-1 rounded-full border border-[var(--border)]" style={{ background: 'color-mix(in srgb, var(--bg-elevated) 80%, transparent)' }}>
                      <span className="w-2 h-2 rounded-full" style={{ background: TYPE_COLOR[t] }} />{TYPE_LABEL[t]}
                    </span>
                  ))}
                </div>

                <div className="pointer-events-auto flex flex-col sm:flex-row items-start sm:items-center gap-3">
                  <button onClick={() => setShowMap(true)} className="group inline-flex items-center gap-2 px-6 py-3 bg-[var(--accent)] text-[var(--accent-ink)] font-medium text-sm rounded-xl hover:opacity-90 transition-opacity">
                    Open the land map
                    <svg className="w-4 h-4 group-hover:translate-x-1 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" /></svg>
                  </button>
                  {onEnterApp && (
                    <button onClick={onEnterApp} className="text-sm text-[var(--text-secondary)] hover:text-[var(--accent-on-bg)] transition-colors font-medium">
                      Open in app →
                    </button>
                  )}
                </div>
                <p className="mt-4 text-[10px] font-mono text-[var(--text-muted)]">hover the glowing land · click it to open the map</p>
              </motion.div>
            </div>

            {/* hover hint over the land */}
            <AnimatePresence>
              {hovering && !showMap && (
                <motion.div
                  initial={{ opacity: 0, y: 8, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 8, scale: 0.96 }}
                  transition={{ duration: 0.18 }}
                  className="pointer-events-none absolute right-6 md:right-[16%] top-1/2 -translate-y-1/2 z-20 rounded-xl border border-[var(--accent)]/40 px-4 py-3 backdrop-blur-md"
                  style={{ background: 'color-mix(in srgb, var(--bg-elevated) 90%, transparent)', boxShadow: 'var(--shadow-lg)' }}
                >
                  <p className="font-display text-sm text-[var(--text-primary)] flex items-center gap-2">🌱 Project 001 — the pilot site</p>
                  <p className="text-[11px] font-mono text-[var(--accent-on-bg)] mt-0.5">click to open the plot map →</p>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </motion.div>

        <p className="mt-4 text-[11px] font-mono text-[var(--text-muted)] text-center">
          Shown from fuzzed, non-cadastral geometry — indicative, not a legal subdivision.
        </p>
      </div>

      {/* ── top-view land map modal ── */}
      <AnimatePresence>
        {showMap && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] grid place-items-center p-4 md:p-8"
            style={{ background: 'color-mix(in srgb, var(--bg-primary) 70%, transparent)', backdropFilter: 'blur(6px)' }}
            onClick={() => setShowMap(false)}
          >
            <motion.div
              initial={{ scale: 0.96, y: 16 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.96, y: 16 }}
              transition={{ type: 'spring', stiffness: 280, damping: 30 }}
              onClick={(e) => e.stopPropagation()}
              className="relative w-full max-w-6xl rounded-2xl border border-[var(--border)] overflow-hidden"
              style={{ background: 'var(--bg-elevated)', boxShadow: 'var(--shadow-lg)' }}
            >
              <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)]">
                <div className="flex items-center gap-3">
                  <span className="text-xs tracking-[0.2em] text-[var(--accent-on-bg)] uppercase font-mono">Project 001 · Land Map</span>
                  <span className="text-[10px] font-mono text-[var(--text-muted)] hidden sm:inline">top-down · fund a plot or infrastructure</span>
                </div>
                <button onClick={() => setShowMap(false)} className="p-1.5 rounded-md text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-secondary)]" aria-label="Close">
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
              </div>
              <div style={{ background: 'var(--bg-secondary)' }}>
                <Suspense fallback={<div className="grid place-items-center h-[50vh] text-xs font-mono text-[var(--text-muted)]">loading land map…</div>}>
                  <PlotMapTopo />
                </Suspense>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}

export default PilotTerrainSection;
