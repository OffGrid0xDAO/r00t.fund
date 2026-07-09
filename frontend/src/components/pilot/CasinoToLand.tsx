/**
 * CasinoToLand — the Robinhood partner + liquidity-narrative section.
 *
 * The original Robin Hood took from the rich and gave to the poor; r00t routes
 * liquidity from the trading casino (Robinhood degens' stonks/options) into real
 * regenerating land. Rendered on a fixed DARK stage so the Robinhood lime pops
 * exactly like their own brand surface — regardless of site theme.
 */
import { motion } from 'framer-motion';
import { RobinhoodMark } from './RobinhoodWordmark';

const LIME = '#D6FE51';

export function CasinoToLand({ onEnterApp }: { onEnterApp?: () => void }) {
  return (
    <section className="relative py-4 px-6 md:px-12 lg:px-16">
      <div className="max-w-6xl mx-auto">
        <div className="relative rounded-3xl overflow-hidden border border-white/10" style={{ background: '#0B0D0A', boxShadow: 'var(--shadow-lg)' }}>
          {/* lime glow bleeding from the "casino" side */}
          <div className="pointer-events-none absolute inset-y-0 left-0 w-2/3" style={{ background: `radial-gradient(ellipse 55% 70% at 0% 45%, ${LIME}22 0%, transparent 70%)` }} />

          <div className="relative p-8 md:p-12 lg:p-16">
            <div className="flex items-center gap-4 mb-6">
              <div className="w-8 h-px" style={{ background: LIME }} />
              <span className="text-xs tracking-[0.2em] uppercase font-mono" style={{ color: LIME }}>Built on Robinhood Chain</span>
            </div>

            <div className="grid lg:grid-cols-2 gap-10 lg:gap-16 items-center">
              {/* copy */}
              <div>
                <h2 className="font-display text-3xl md:text-5xl tracking-[-0.02em] leading-[1.05] mb-5 text-white">
                  From the casino floor <br className="hidden md:block" />
                  <span style={{ color: LIME }}>to the forest floor.</span>
                </h2>
                <p className="text-base text-white/70 leading-relaxed max-w-lg mb-5">
                  Robin Hood took from the rich and gave to the poor. We route liquidity from the trading
                  casino — the stonks, the options, the degens — straight into real land that's coming back
                  to life. Same energy, better ending.
                </p>
                <p className="text-sm text-white/45 leading-relaxed max-w-lg mb-8">
                  $R00T and its trading layer are <span className="font-medium text-white/80">built on Robinhood Chain</span>,
                  so the same rails millions already trade on can fund a plot, plant a tree, and prove it on-chain.
                  Verification stays independent on the CRE chain — patronage in, no revenue extracted out.
                </p>

                {/* chain lockup */}
                <div className="inline-flex items-center gap-3 px-5 py-3 rounded-xl border" style={{ borderColor: `${LIME}55`, background: `${LIME}10` }}>
                  <span className="text-[10px] font-mono uppercase tracking-[0.18em] text-white/50">Built on</span>
                  <span className="inline-flex items-center gap-2" style={{ color: LIME }}>
                    <RobinhoodMark size={20} />
                    <span className="font-display text-lg tracking-tight">Robinhood Chain</span>
                  </span>
                </div>

                {onEnterApp && (
                  <div className="mt-8">
                    <button onClick={onEnterApp} className="group inline-flex items-center gap-2 px-6 py-3 font-medium text-sm rounded-xl transition-opacity hover:opacity-90" style={{ background: LIME, color: '#10140A' }}>
                      Turn stonks into soil
                      <svg className="w-4 h-4 group-hover:translate-x-1 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" /></svg>
                    </button>
                  </div>
                )}
              </div>

              {/* flow diagram: casino → r00t → land */}
              <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.6 }}
                className="relative rounded-2xl border border-white/10 p-6 md:p-8" style={{ background: 'rgba(255,255,255,0.03)' }}>
                <div className="flex items-center justify-between gap-3">
                  <FlowNode emoji="🎰" label="Casino" sub="stonks · options" color={LIME} />
                  <Arrow />
                  <FlowNode emoji="⚡" label="r00t.fund" sub="patronage rail" color={LIME} />
                  <Arrow />
                  <FlowNode emoji="🌱" label="The land" sub="Project 001" color={LIME} />
                </div>

                {/* animated liquidity line */}
                <div className="relative mt-6 h-1.5 rounded-full overflow-hidden bg-white/10">
                  <motion.div className="absolute inset-y-0 w-1/3 rounded-full"
                    style={{ background: `linear-gradient(90deg, ${LIME}, #6EC786)` }}
                    animate={{ x: ['-40%', '340%'] }} transition={{ duration: 2.6, repeat: Infinity, ease: 'easeInOut' }} />
                </div>
                <p className="mt-4 text-[11px] font-mono text-white/40 text-center">
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

function FlowNode({ emoji, label, sub, color }: { emoji: string; label: string; sub: string; color: string }) {
  return (
    <div className="flex-1 text-center">
      <div className="mx-auto mb-2 w-12 h-12 rounded-xl grid place-items-center text-2xl border" style={{ borderColor: `${color}55`, background: `${color}12` }}>{emoji}</div>
      <p className="font-display text-sm text-white leading-tight">{label}</p>
      <p className="text-[10px] font-mono text-white/40 mt-0.5">{sub}</p>
    </div>
  );
}

function Arrow() {
  return (
    <svg className="w-5 h-5 shrink-0 text-white/30" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
    </svg>
  );
}

export default CasinoToLand;
