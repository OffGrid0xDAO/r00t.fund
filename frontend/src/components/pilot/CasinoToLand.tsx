/**
 * CasinoToLand — the Robinhood Chain partner + liquidity-narrative section.
 *
 * The original Robin Hood took from the rich and gave to the poor; r00t routes
 * liquidity from the trading casino (Robinhood degens' stonks/options) into real
 * regenerating land. Theme-aware: a light cream card with readable green in light
 * mode, a dark stage where the lime pops in dark mode.
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
          {/* lime glow bleeding from the "casino" side */}
          <div className="pointer-events-none absolute inset-y-0 left-0 w-2/3" style={{ background: `radial-gradient(ellipse 55% 70% at 0% 45%, color-mix(in srgb, ${LIME} 14%, transparent) 0%, transparent 70%)` }} />

          <div className="relative p-8 md:p-12 lg:p-16">
            <div className="flex items-center gap-4 mb-6">
              <div className="w-8 h-px" style={{ background: GREEN }} />
              <span className="text-xs tracking-[0.2em] uppercase font-mono" style={{ color: GREEN }}>Built on Robinhood Chain</span>
            </div>

            <div className="grid lg:grid-cols-2 gap-10 lg:gap-16 items-center">
              {/* copy */}
              <div>
                <h2 className="font-display text-3xl md:text-5xl tracking-[-0.02em] leading-[1.05] mb-5 text-[var(--text-primary)]">
                  From the casino floor <br className="hidden md:block" />
                  <span style={{ color: GREEN }}>to the forest floor.</span>
                </h2>
                <p className="text-base text-[var(--text-secondary)] leading-relaxed max-w-lg mb-5">
                  Robin Hood took from the rich and gave to the poor. We route liquidity from the trading
                  casino — the stonks, the options, the degens — straight into real land that's coming back
                  to life. Same energy, better ending.
                </p>
                <p className="text-sm text-[var(--text-muted)] leading-relaxed max-w-lg mb-8">
                  $R00T and its trading layer are <span className="font-medium text-[var(--text-secondary)]">built on Robinhood Chain</span>,
                  so the same rails millions already trade on can fund a plot, plant a tree, and prove it on-chain.
                  Verification stays independent on the CRE chain — patronage in, no revenue extracted out.
                </p>

                {/* chain lockup */}
                <div className="inline-flex items-center gap-3 px-5 py-3 rounded-xl border" style={{ borderColor: `color-mix(in srgb, ${GREEN} 45%, var(--border))`, background: `color-mix(in srgb, ${GREEN} 7%, var(--bg-elevated))` }}>
                  <span className="text-[10px] font-mono uppercase tracking-[0.18em] text-[var(--text-muted)]">Built on</span>
                  <span className="inline-flex items-center gap-2" style={{ color: GREEN }}>
                    <RobinhoodMark size={20} />
                    <span className="font-display text-lg tracking-tight">Robinhood Chain</span>
                  </span>
                </div>

                {onEnterApp && (
                  <div className="mt-8">
                    <button onClick={onEnterApp} className="group inline-flex items-center gap-2 px-6 py-3 font-medium text-sm rounded-xl transition-opacity hover:opacity-90 text-[var(--accent-ink)]" style={{ background: 'var(--accent)' }}>
                      Turn stonks into soil
                      <svg className="w-4 h-4 group-hover:translate-x-1 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" /></svg>
                    </button>
                  </div>
                )}
              </div>

              {/* flow diagram: casino → r00t → land */}
              <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.6 }}
                className="relative rounded-2xl border border-[var(--border)] dark:border-white/10 p-6 md:p-8 bg-[var(--bg-secondary)] dark:bg-white/[0.03]">
                <div className="flex items-center justify-between gap-3">
                  <FlowNode emoji="🎰" label="Casino" sub="stonks · options" />
                  <Arrow />
                  <FlowNode emoji="⚡" label="r00t.fund" sub="patronage rail" />
                  <Arrow />
                  <FlowNode emoji="🌱" label="The land" sub="Project 001" />
                </div>

                {/* animated liquidity line */}
                <div className="relative mt-6 h-1.5 rounded-full overflow-hidden bg-[var(--border)]">
                  <motion.div className="absolute inset-y-0 w-1/3 rounded-full"
                    style={{ background: `linear-gradient(90deg, ${GREEN}, var(--accent))` }}
                    animate={{ x: ['-40%', '340%'] }} transition={{ duration: 2.6, repeat: Infinity, ease: 'easeInOut' }} />
                </div>
                <p className="mt-4 text-[11px] font-mono text-[var(--text-muted)] text-center">
                  trading liquidity → patronage funding → verified regeneration
                </p>
              </motion.div>
            </div>
          </div>
        </div>
      </div>
    </section>
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
