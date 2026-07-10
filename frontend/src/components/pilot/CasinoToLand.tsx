/**
 * CasinoToLand — the off-grid launchpad + Robinhood Chain (RWA) narrative section.
 *
 * The pitch: take the extractive engine of a pump.fun — the same speculative
 * velocity, the same fair-launch mechanics — and point it at the ground. On
 * pump.fun the value extracted leaves (insiders, snipers, then gone); on r00t
 * the value extracted roots — it funds real off-grid land coming back to life.
 * Same energy as "take from the casino, give back to the land," just built as a
 * launchpad. Theme-aware: readable green in light mode, lime that pops on dark.
 */
import { motion } from 'framer-motion';
import { RobinhoodMark } from './RobinhoodWordmark';

// accent for headings/marks: readable green in light, lime on dark (via token)
const GREEN = 'var(--accent-on-bg)';
const LIME = 'var(--rh-green)';

export function CasinoToLand({ onEnterApp }: { onEnterApp?: () => void }) {
  return (
    <section className="relative py-4 px-6 md:px-12 lg:px-16">
      <div className="max-w-6xl mx-auto">
        <div
          className="relative rounded-3xl overflow-hidden border border-[var(--border)] dark:border-white/10 bg-[var(--bg-elevated)] dark:bg-[#0B0D0A]"
          style={{ boxShadow: 'var(--shadow-lg)' }}
        >
          {/* lime glow bleeding from the "extraction" side */}
          <div className="pointer-events-none absolute inset-y-0 left-0 w-2/3" style={{ background: `radial-gradient(ellipse 55% 70% at 0% 45%, color-mix(in srgb, ${LIME} 14%, transparent) 0%, transparent 70%)` }} />

          <div className="relative p-8 md:p-12 lg:p-16">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 mb-6">
              <div className="flex items-center gap-4">
                <div className="w-8 h-px" style={{ background: GREEN }} />
                <span className="text-xs tracking-[0.2em] uppercase font-mono" style={{ color: GREEN }}>Off-grid projects launchpad</span>
              </div>
              <span className="text-[10px] font-mono uppercase tracking-[0.18em] px-2 py-1 rounded-md border" style={{ borderColor: `color-mix(in srgb, ${GREEN} 40%, var(--border))`, color: 'var(--text-muted)' }}>
                RWA · Robinhood Chain
              </span>
            </div>

            <div className="grid lg:grid-cols-2 gap-10 lg:gap-16 items-center">
              {/* copy */}
              <div>
                <h2 className="font-display text-3xl md:text-5xl tracking-[-0.02em] leading-[1.05] mb-5 text-[var(--text-primary)]">
                  The extractive engine of pump.fun, <br className="hidden md:block" />
                  <span style={{ color: GREEN }}>pointed at the ground.</span>
                </h2>
                <p className="text-base text-[var(--text-secondary)] leading-relaxed max-w-lg mb-5">
                  Same fair-launch mechanics, same speculative velocity that mints
                  tokens by the minute — but here the value that gets extracted doesn't
                  vanish into insiders and snipers. It roots. Every launch funds a real
                  off-grid plot that's coming back to life. Take from the casino, give
                  back to the land.
                </p>

                {/* same power, opposite direction */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-8 max-w-lg">
                  <ExtractRow
                    tone="drain"
                    label="pump.fun"
                    flow="value extracted → insiders"
                    tail="then it's gone"
                  />
                  <ExtractRow
                    tone="root"
                    label="r00t.fund"
                    flow="value extracted → land"
                    tail="and it compounds"
                  />
                </div>

                {/* chain lockup */}
                <div className="inline-flex items-center gap-3 px-5 py-3 rounded-xl border" style={{ borderColor: `color-mix(in srgb, ${GREEN} 45%, var(--border))`, background: `color-mix(in srgb, ${GREEN} 7%, var(--bg-elevated))` }}>
                  <span className="text-[10px] font-mono uppercase tracking-[0.18em] text-[var(--text-muted)]">Launched on</span>
                  <span className="inline-flex items-center gap-2" style={{ color: GREEN }}>
                    <RobinhoodMark size={20} />
                    <span className="font-display text-lg tracking-tight">Robinhood Chain</span>
                  </span>
                </div>

                {onEnterApp && (
                  <div className="mt-8">
                    <button onClick={onEnterApp} className="group inline-flex items-center gap-2 px-6 py-3 font-medium text-sm rounded-xl transition-opacity hover:opacity-90 text-[var(--accent-ink)]" style={{ background: 'var(--accent)' }}>
                      Launch a plot
                      <svg className="w-4 h-4 group-hover:translate-x-1 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" /></svg>
                    </button>
                  </div>
                )}
              </div>

              {/* flow diagram: speculation → r00t launchpad → land */}
              <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.6 }}
                className="relative rounded-2xl border border-[var(--border)] dark:border-white/10 p-6 md:p-8 bg-[var(--bg-secondary)] dark:bg-white/[0.03]">
                <div className="flex items-center justify-between gap-3">
                  <FlowNode emoji="📈" label="Speculation" sub="fair launches · trades" />
                  <Arrow />
                  <FlowNode emoji="⚡" label="r00t.fund" sub="off-grid launchpad" />
                  <Arrow />
                  <FlowNode emoji="🌱" label="The land" sub="Pilot Project" />
                </div>

                {/* animated liquidity line */}
                <div className="relative mt-6 h-1.5 rounded-full overflow-hidden bg-[var(--border)]">
                  <motion.div className="absolute inset-y-0 w-1/3 rounded-full"
                    style={{ background: `linear-gradient(90deg, ${GREEN}, var(--accent))` }}
                    animate={{ x: ['-40%', '340%'] }} transition={{ duration: 2.6, repeat: Infinity, ease: 'easeInOut' }} />
                </div>
                <p className="mt-4 text-[11px] font-mono text-[var(--text-muted)] text-center">
                  extracted value → patronage funding → verified regeneration
                </p>
              </motion.div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/** One row of the "same power, opposite direction" contrast. */
function ExtractRow({ tone, label, flow, tail }: { tone: 'drain' | 'root'; label: string; flow: string; tail: string }) {
  const root = tone === 'root';
  const accent = root ? GREEN : 'var(--text-muted)';
  return (
    <div
      className="rounded-xl border px-4 py-3"
      style={{
        borderColor: root ? `color-mix(in srgb, ${GREEN} 40%, var(--border))` : 'var(--border)',
        background: root ? `color-mix(in srgb, ${GREEN} 6%, transparent)` : 'transparent',
      }}
    >
      <div className="flex items-center gap-1.5 mb-1">
        <span className="w-1.5 h-1.5 rounded-full" style={{ background: accent, opacity: root ? 1 : 0.5 }} />
        <span className="font-mono text-xs" style={{ color: accent }}>{label}</span>
      </div>
      <p className="text-[13px] leading-snug text-[var(--text-primary)]">{flow}</p>
      <p className="text-[11px] font-mono mt-0.5" style={{ color: root ? GREEN : 'var(--text-muted)' }}>{tail}</p>
    </div>
  );
}

function FlowNode({ emoji, label, sub }: { emoji: string; label: string; sub: string }) {
  return (
    <div className="flex-1 text-center">
      <div className="mx-auto mb-2 w-12 h-12 rounded-xl grid place-items-center text-2xl border" style={{ borderColor: `color-mix(in srgb, ${GREEN} 45%, var(--border))`, background: `color-mix(in srgb, ${GREEN} 10%, transparent)` }}>{emoji}</div>
      <p className="font-display text-sm text-[var(--text-primary)] leading-tight">{label}</p>
      <p className="text-[10px] font-mono text-[var(--text-muted)] mt-0.5">{sub}</p>
    </div>
  );
}

function Arrow() {
  return (
    <svg className="w-5 h-5 shrink-0 text-[var(--text-muted)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
    </svg>
  );
}

export default CasinoToLand;
