/**
 * PilotTerrainSection — the "Project 001" pilot-terrain section on the landing.
 *
 * Presents the fuzzed contour-relief terrain (PilotTerrain) inside the r00t
 * design system. The interactive Farmville plot map (PlotMap) is mounted as an
 * overlay on top of the terrain backdrop.
 */
import { lazy, Suspense } from 'react';
import { motion } from 'framer-motion';
import { PlotMap } from './PlotMap';

// WebGL is heavy — load the terrain canvas only when this section is reached.
const PilotTerrain = lazy(() => import('./PilotTerrain').then(m => ({ default: m.PilotTerrain })));

export function PilotTerrainSection() {
  return (
    <section
      id="pilot-001"
      className="relative py-16 md:py-24 px-6 md:px-12 lg:px-16 border-t border-[var(--border)]/50"
    >
      <div className="max-w-6xl mx-auto">
        {/* Section header — matches the landing's SectionHeader idiom */}
        <motion.div
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          className="mb-10 md:mb-12"
        >
          <div className="flex items-center gap-4 mb-6">
            <div className="w-8 h-px bg-[var(--accent)]" />
            <span className="text-xs tracking-[0.2em] text-[var(--accent)] uppercase font-mono">Project 001 · The Pilot Site</span>
          </div>
          <h2 className="font-display text-3xl md:text-5xl text-[var(--text-primary)] tracking-[-0.02em] leading-[1.1] max-w-2xl">
            9 hectares of burned hillside, <span className="text-[var(--accent)]">plot by plot.</span>
          </h2>
          <p className="mt-5 text-base text-[var(--text-secondary)] leading-relaxed max-w-xl">
            Back a zone, choose what grows on it, and watch the land green as funding lands.
            Hover a plot to see who's backing it and what's still needed — click to fund it.
          </p>
        </motion.div>

        {/* Terrain backdrop + interactive plot map overlay */}
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-40px' }}
          transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
          className="relative rounded-2xl border border-[var(--border)] overflow-hidden"
          style={{ background: 'var(--bg-elevated)', boxShadow: 'var(--shadow-md)' }}
        >
          {/* fixed-aspect stage */}
          <div className="relative w-full aspect-[16/10]">
            {/* WebGL terrain relief (ambient backdrop) */}
            <Suspense fallback={<div className="absolute inset-0 grid place-items-center text-xs font-mono text-[var(--text-muted)]">rendering terrain…</div>}>
              <PilotTerrain />
            </Suspense>

            {/* Interactive plot map (hover / click / fund) */}
            <PlotMap />
          </div>
        </motion.div>

        <p className="mt-4 text-[11px] font-mono text-[var(--text-muted)] text-center">
          Terrain shown from fuzzed, non-cadastral geometry — plot boundaries are indicative, not a legal subdivision.
        </p>
      </div>
    </section>
  );
}

export default PilotTerrainSection;
