/**
 * CasinoToLand — the Robinhood partner + liquidity-narrative section.
 *
 * The original Robin Hood took from the rich and gave to the poor; r00t routes
 * liquidity from the trading casino (Robinhood degens' stonks/options) into real
 * regenerating land. Robinhood is presented as the launch venue / liquidity
 * source. Uses the Robinhood brand green (--rh-green) on the source side, flowing
 * into the forest accent on the land side.
 */
import { motion } from 'framer-motion';
import { RobinhoodWordmark } from './RobinhoodWordmark';

export function CasinoToLand({ onEnterApp }: { onEnterApp?: () => void }) {
  return (
    <section className="relative py-16 md:py-24 px-6 md:px-12 lg:px-16 border-t border-[var(--border)]/50 overflow-hidden">
      {/* soft RH-green glow bleeding in from the left ("casino") side */}
      <div className="pointer-events-none absolute inset-y-0 left-0 w-1/2" style={{ background: 'radial-gradient(ellipse 60% 60% at 0% 50%, color-mix(in srgb, var(--rh-green) 12%, transparent) 0%, transparent 70%)' }} />

      <div className="relative max-w-6xl mx-auto">
        <div className="flex items-center gap-4 mb-6">
          <div className="w-8 h-px" style={{ background: 'var(--rh-green)' }} />
          <span className="text-xs tracking-[0.2em] uppercase font-mono" style={{ color: 'var(--rh-green)' }}>Launching on · Liquidity partner</span>
        </div>

        <div className="grid lg:grid-cols-2 gap-10 lg:gap-16 items-center">
          {/* copy */}
          <div>
            <h2 className="font-display text-3xl md:text-5xl text-[var(--text-primary)] tracking-[-0.02em] leading-[1.05] mb-5">
              From the casino floor <br className="hidden md:block" />
              <span style={{ color: 'var(--rh-green)' }}>to the forest floor.</span>
            </h2>
            <p className="text-base text-[var(--text-secondary)] leading-relaxed max-w-lg mb-5">
              Robin Hood took from the rich and gave to the poor. We route liquidity from the trading
              casino — the stonks, the options, the degens — straight into real land that's coming back
              to life. Same energy, better ending.
            </p>
            <p className="text-sm text-[var(--text-muted)] leading-relaxed max-w-lg mb-8">
              r00t launches on <span className="font-medium text-[var(--text-secondary)]">Robinhood</span> so the
              same rails millions already trade on can fund a plot, plant a tree, and prove it on-chain —
              patronage in, no revenue extracted out.
            </p>

            {/* partner lockup */}
            <div className="inline-flex items-center gap-3 px-5 py-3 rounded-xl border" style={{ borderColor: 'color-mix(in srgb, var(--rh-green) 40%, var(--border))', background: 'color-mix(in srgb, var(--rh-green) 6%, var(--bg-elevated))' }}>
              <span className="text-[10px] font-mono uppercase tracking-[0.18em] text-[var(--text-muted)]">Powered by</span>
              <span style={{ color: 'var(--rh-green)' }}><RobinhoodWordmark height={18} /></span>
            </div>

            {onEnterApp && (
              <div className="mt-8">
                <button onClick={onEnterApp} className="group inline-flex items-center gap-2 px-6 py-3 text-white font-medium text-sm rounded-xl transition-opacity hover:opacity-90" style={{ background: 'var(--rh-green)' }}>
                  Turn stonks into soil
                  <svg className="w-4 h-4 group-hover:translate-x-1 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" /></svg>
                </button>
              </div>
            )}
          </div>

          {/* flow diagram: casino → r00t → land */}
          <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.6 }}
            className="relative rounded-2xl border border-[var(--border)] p-6 md:p-8" style={{ background: 'var(--bg-elevated)', boxShadow: 'var(--shadow-md)' }}>
            <div className="flex items-center justify-between gap-3">
              <FlowNode emoji="🎰" label="Casino" sub="stonks · options" color="var(--rh-green)" />
              <Arrow />
              <FlowNode emoji="⚡" label="r00t.fund" sub="patronage rail" color="var(--accent)" />
              <Arrow />
              <FlowNode emoji="🌱" label="The land" sub="Project 001" color="var(--accent)" />
            </div>

            {/* animated liquidity line */}
            <div className="relative mt-6 h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--border)' }}>
              <motion.div className="absolute inset-y-0 w-1/3 rounded-full"
                style={{ background: 'linear-gradient(90deg, var(--rh-green), var(--accent))' }}
                animate={{ x: ['-40%', '340%'] }} transition={{ duration: 2.6, repeat: Infinity, ease: 'easeInOut' }} />
            </div>
            <p className="mt-4 text-[11px] font-mono text-[var(--text-muted)] text-center">
              trading liquidity → patronage funding → verified regeneration
            </p>
          </motion.div>
        </div>
      </div>
    </section>
  );
}

function FlowNode({ emoji, label, sub, color }: { emoji: string; label: string; sub: string; color: string }) {
  return (
    <div className="flex-1 text-center">
      <div className="mx-auto mb-2 w-12 h-12 rounded-xl grid place-items-center text-2xl border" style={{ borderColor: `color-mix(in srgb, ${color} 40%, var(--border))`, background: `color-mix(in srgb, ${color} 8%, transparent)` }}>{emoji}</div>
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
