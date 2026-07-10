/**
 * LandsSection — the multi-tenant network. Pilot Project is the template; other
 * stewards onboard their land the same way. Shows the land registry + the
 * "Start your land" onboarding. Every land's parcel tokens pair with $R00T.
 */
import { lazy, Suspense, useState } from 'react';
import { motion } from 'framer-motion';
import { LANDS, BASE_TOKEN, type LandStatus } from './lands';

const StartYourLand = lazy(() => import('./StartYourLand'));

const STATUS_STYLE: Record<LandStatus, { label: string; color: string }> = {
  live: { label: 'live', color: 'var(--success)' },
  processing: { label: 'processing', color: '#D4A84B' },
  queued: { label: 'queued', color: 'var(--text-muted)' },
};

export function LandsSection({ onEnterApp }: { onEnterApp?: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <section className="relative py-16 md:py-24 px-6 md:px-12 lg:px-16 border-t border-[var(--border)]/50 dark:border-transparent">
      <div className="max-w-6xl mx-auto">
        <div className="flex items-end justify-between gap-6 mb-10 flex-wrap">
          <div>
            <div className="flex items-center gap-4 mb-5">
              <div className="w-8 h-px bg-[var(--accent)]" />
              <span className="text-xs tracking-[0.2em] text-[var(--accent-on-bg)] uppercase font-mono">The land network</span>
            </div>
            <h2 className="font-display text-3xl md:text-5xl text-[var(--text-primary)] tracking-[-0.02em] leading-[1.05] max-w-xl">
              Pilot Project is the template. <span className="text-[var(--accent-on-bg)]">Bring your own land.</span>
            </h2>
            <p className="mt-4 text-base text-[var(--text-secondary)] max-w-lg leading-relaxed">
              Any steward can onboard their terrain — submit a topography + boundary, and the pipeline fuzzes it
              and auto-divides it into parcels. Every parcel token pairs with ${BASE_TOKEN}, so each new land
              compounds the base currency.
            </p>
          </div>
          <button onClick={() => setOpen(true)} className="group inline-flex items-center gap-2 px-6 py-3 bg-[var(--accent)] text-[var(--accent-ink)] font-medium text-sm rounded-xl hover:opacity-90 transition-opacity">
            Start your land
            <svg className="w-4 h-4 group-hover:translate-x-1 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" /></svg>
          </button>
        </div>

        {/* land registry grid */}
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {LANDS.map((land, i) => {
            const st = STATUS_STYLE[land.status];
            return (
              <motion.div
                key={land.id}
                initial={{ opacity: 0, y: 16 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: '-30px' }}
                transition={{ duration: 0.5, delay: i * 0.06 }}
                onClick={() => land.status === 'live' && onEnterApp?.()}
                className={`rounded-xl border border-[var(--border)] p-5 transition-colors ${land.status === 'live' ? 'cursor-pointer hover:border-[var(--accent)]/50' : ''}`}
                style={{ background: 'var(--bg-elevated)', boxShadow: 'var(--shadow-sm)' }}
              >
                <div className="flex items-center justify-between mb-3">
                  <span className="inline-flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-wide" style={{ color: st.color }}>
                    <span className="w-1.5 h-1.5 rounded-full" style={{ background: st.color }} />{st.label}
                  </span>
                  <span className="text-[10px] font-mono text-[var(--text-muted)]">{land.hectares} ha</span>
                </div>
                <h3 className="font-display text-lg text-[var(--text-primary)] leading-tight">{land.name}</h3>
                <p className="text-xs text-[var(--text-muted)] font-mono mt-0.5">{land.steward} · {land.region}</p>
                <div className="mt-4 flex items-center justify-between text-[11px] font-mono">
                  {land.status === 'live' ? (
                    <>
                      <span className="text-[var(--text-secondary)]">{land.parcels} parcels</span>
                      <span className="text-[var(--accent-on-bg)]">{land.raisedR00T.toLocaleString()} ${BASE_TOKEN} →</span>
                    </>
                  ) : (
                    <span className="text-[var(--text-muted)]">terrain {land.status}…</span>
                  )}
                </div>
              </motion.div>
            );
          })}
        </div>
      </div>

      {open && (
        <Suspense fallback={null}>
          <StartYourLand onClose={() => setOpen(false)} />
        </Suspense>
      )}
    </section>
  );
}

export default LandsSection;
