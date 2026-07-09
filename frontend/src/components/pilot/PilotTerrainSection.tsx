/**
 * PilotTerrainSection — the "Project 001" cinematic terrain intro on the landing.
 *
 * A clean 3D contour-relief render of the pilot site (PilotTerrain), matching the
 * source intro animation. The interactive fund-a-plot experience is the top-down
 * plan map in the app (PlotMapTopo) — this section links into it.
 */
import { lazy, Suspense } from 'react';
import { motion } from 'framer-motion';

// WebGL is heavy — load the terrain canvas only when this section is reached.
const PilotTerrain = lazy(() => import('./PilotTerrain').then(m => ({ default: m.PilotTerrain })));

export function PilotTerrainSection({ onEnterApp }: { onEnterApp?: () => void }) {
  return (
    <section id="pilot-001" className="relative py-16 md:py-24 px-6 md:px-12 lg:px-16 border-t border-[var(--border)]/50">
      <div className="max-w-6xl mx-auto">
        <motion.div initial={{ opacity: 0 }} whileInView={{ opacity: 1 }} viewport={{ once: true }} className="mb-8 md:mb-10">
          <div className="flex items-center gap-4 mb-6">
            <div className="w-8 h-px bg-[var(--accent)]" />
            <span className="text-xs tracking-[0.2em] text-[var(--accent)] uppercase font-mono">Project 001 · The Pilot Site</span>
          </div>
          <h2 className="font-display text-3xl md:text-5xl text-[var(--text-primary)] tracking-[-0.02em] leading-[1.1] max-w-2xl">
            9 hectares of burned hillside, <span className="text-[var(--accent)]">mapped plot by plot.</span>
          </h2>
          <p className="mt-5 text-base text-[var(--text-secondary)] leading-relaxed max-w-xl">
            This is the real terrain — every contour, swale and watercourse. Back a zone, choose what grows,
            and watch the land green as funding lands.
          </p>
        </motion.div>

        {/* cinematic terrain stage */}
        <motion.div
          initial={{ opacity: 0, y: 24 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: '-40px' }}
          transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
          className="relative rounded-2xl border border-[var(--border)] overflow-hidden"
          style={{ background: 'var(--bg-elevated)', boxShadow: 'var(--shadow-md)' }}
        >
          <div className="relative w-full h-[52vh] md:h-[68vh]">
            <Suspense fallback={<div className="absolute inset-0 grid place-items-center text-xs font-mono text-[var(--text-muted)]">rendering terrain…</div>}>
              <PilotTerrain />
            </Suspense>
          </div>
        </motion.div>

        <div className="mt-6 flex flex-col sm:flex-row items-center justify-between gap-4">
          <p className="text-[11px] font-mono text-[var(--text-muted)]">
            Shown from fuzzed, non-cadastral geometry — indicative, not a legal subdivision.
          </p>
          {onEnterApp && (
            <button
              onClick={onEnterApp}
              className="group inline-flex items-center gap-2 px-6 py-3 bg-[var(--accent)] text-white font-medium text-sm rounded-xl hover:opacity-90 transition-opacity"
            >
              Explore the plot map
              <svg className="w-4 h-4 group-hover:translate-x-1 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" /></svg>
            </button>
          )}
        </div>
      </div>
    </section>
  );
}

export default PilotTerrainSection;
