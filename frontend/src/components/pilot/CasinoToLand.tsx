/**
 * CasinoToLand — the off-grid launchpad + Robinhood Chain (RWA) narrative section.
 *
 * The pitch: take the extractive engine of the memecoin casino — the same
 * fair-launch mechanics, the same speculative velocity — and point it at the
 * ground. In the casino the value extracted leaves (insiders, snipers, then gone);
 * on r00t it roots — every launch funds real off-grid land coming back to life.
 * The right card explains the actual mechanism + that anyone can start their land.
 * Theme-aware: readable green in light mode, lime that pops on dark.
 */
import { motion } from 'framer-motion';
import { RobinhoodMark } from './RobinhoodWordmark';

const GREEN = 'var(--accent-on-bg)';
const LIME = 'var(--rh-green)';

const scrollToLands = () => document.getElementById('land-network')?.scrollIntoView({ behavior: 'smooth' });

export function CasinoToLand({ onEnterApp }: { onEnterApp?: () => void }) {
  return (
    <section className="relative py-4 px-6 md:px-12 lg:px-16">
      <div className="max-w-6xl mx-auto">
        <div className="relative rounded-3xl overflow-hidden border border-[var(--border)] dark:border-white/10 bg-[var(--bg-elevated)] dark:bg-[#0B0D0A]" style={{ boxShadow: 'var(--shadow-lg)' }}>
          <div className="pointer-events-none absolute inset-y-0 left-0 w-2/3" style={{ background: `radial-gradient(ellipse 55% 70% at 0% 45%, color-mix(in srgb, ${LIME} 14%, transparent) 0%, transparent 70%)` }} />

          <div className="relative p-8 md:p-12 lg:p-16">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 mb-6">
              <div className="flex items-center gap-4">
                <div className="w-8 h-px" style={{ background: GREEN }} />
                <span className="text-xs tracking-[0.2em] uppercase font-mono" style={{ color: GREEN }}>RWA ReFi launchpad</span>
              </div>
              <span className="text-[10px] font-mono uppercase tracking-[0.18em] px-2 py-1 rounded-md border" style={{ borderColor: `color-mix(in srgb, ${GREEN} 40%, var(--border))`, color: 'var(--text-muted)' }}>real-world assets · regenerative finance</span>
              <span className="text-[10px] font-mono uppercase tracking-[0.18em] px-2 py-1 rounded-md border" style={{ borderColor: `color-mix(in srgb, ${GREEN} 40%, var(--border))`, color: 'var(--text-muted)' }}>Robinhood Chain</span>
            </div>

            <div className="grid lg:grid-cols-2 gap-10 lg:gap-16 items-start">
              {/* copy */}
              <div>
                <h2 className="font-display text-2xl md:text-4xl tracking-[-0.02em] leading-[1.08] mb-5 text-[var(--text-primary)]">
                  The extractive engine of the memecoin casino, <span style={{ color: GREEN }}>pointed at the ground.</span>
                </h2>
                <p className="text-base text-[var(--text-secondary)] leading-relaxed max-w-lg mb-5">
                  Same fair-launch mechanics, same speculative velocity that mints tokens by the
                  minute — but the value that gets extracted doesn't vanish into insiders and snipers.
                  It roots. Every launch funds a real off-grid plot that's coming back to life. Take
                  from the casino, give it back to the land.
                </p>

                {/* same power, opposite direction */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-8 max-w-lg">
                  <ExtractRow tone="drain" label="the casino" flow="value extracted → insiders" tail="then it's gone" />
                  <ExtractRow tone="root" label="r00t.fund" flow="value extracted → the land" tail="and it compounds" />
                </div>

                <div className="inline-flex items-center gap-3 px-5 py-3 rounded-xl border mb-6" style={{ borderColor: `color-mix(in srgb, ${GREEN} 45%, var(--border))`, background: `color-mix(in srgb, ${GREEN} 7%, var(--bg-elevated))` }}>
                  <span className="text-[10px] font-mono uppercase tracking-[0.18em] text-[var(--text-secondary)]">Launched on</span>
                  <span className="inline-flex items-center gap-2" style={{ color: GREEN }}>
                    <RobinhoodMark size={20} />
                    <span className="font-display text-lg tracking-tight">Robinhood Chain</span>
                  </span>
                </div>

                {onEnterApp && (
                  <div className="flex flex-wrap items-center gap-4">
                    <button onClick={onEnterApp} className="group inline-flex items-center gap-2 px-6 py-3 font-medium text-sm rounded-xl transition-opacity hover:opacity-90 text-[var(--accent-ink)]" style={{ background: 'var(--accent)' }}>
                      Launch a plot
                      <svg className="w-4 h-4 group-hover:translate-x-1 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" /></svg>
                    </button>
                    <button onClick={scrollToLands} className="text-sm font-medium text-[var(--text-secondary)] hover:text-[var(--accent-on-bg)] transition-colors">or start your own land ↓</button>
                  </div>
                )}
              </div>

              {/* how it works — the actual mechanism */}
              <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.6 }}
                className="relative rounded-2xl border border-[var(--border)] dark:border-white/10 p-6 md:p-7 bg-[var(--bg-secondary)] dark:bg-white/[0.03]">
                <p className="text-[10px] font-mono uppercase tracking-[0.18em] text-[var(--text-muted)] mb-4">How a launch works</p>
                <div className="space-y-4">
                  <Step n={1} emoji="🌱" title="Back a parcel" desc="Pledge into a plot you like. Each parcel is a real field with its own culture — oak, chestnut, carrot, cactus." />
                  <Step n={2} emoji="💧" title="It funds the land" desc="100% of what you pledge goes to the land treasury — real regeneration capital. It's never used as trading liquidity." />
                  <Step n={3} emoji="🪙" title="You mint its token" desc="The parcel's culture coin ($OAK, $CARROT…) is minted straight to you, on the spot. Earlier backers get more." />
                  <Step n={4} emoji="📈" title="It trades, the land pays it forward" desc="The coin trades against $R00T while satellites verify the field regrowing — drawing down carbon and minting real credits. A living asset, not a rug." />
                </div>

                <div className="mt-5 pt-4 border-t border-[var(--border)] dark:border-white/10">
                  <button onClick={scrollToLands} className="group flex items-center justify-between w-full text-left">
                    <span>
                      <span className="block text-sm text-[var(--text-primary)] font-medium">🌍 Bring your own land</span>
                      <span className="block text-[11px] font-mono text-[var(--text-muted)]">submit a boundary + topography — we auto-parcel it</span>
                    </span>
                    <svg className="w-4 h-4 shrink-0 group-hover:translate-x-1 transition-transform" style={{ color: GREEN }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" /></svg>
                  </button>
                </div>
              </motion.div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function ExtractRow({ tone, label, flow, tail }: { tone: 'drain' | 'root'; label: string; flow: string; tail: string }) {
  const root = tone === 'root';
  const accent = root ? GREEN : 'var(--text-muted)';
  return (
    <div className="rounded-xl border px-4 py-3" style={{ borderColor: root ? `color-mix(in srgb, ${GREEN} 40%, var(--border))` : 'var(--border)', background: root ? `color-mix(in srgb, ${GREEN} 6%, transparent)` : 'transparent' }}>
      <div className="flex items-center gap-1.5 mb-1">
        <span className="w-1.5 h-1.5 rounded-full" style={{ background: accent, opacity: root ? 1 : 0.5 }} />
        <span className="font-mono text-xs" style={{ color: accent }}>{label}</span>
      </div>
      <p className="text-[13px] leading-snug text-[var(--text-primary)]">{flow}</p>
      <p className="text-[11px] font-mono mt-0.5" style={{ color: root ? GREEN : 'var(--text-muted)' }}>{tail}</p>
    </div>
  );
}

function Step({ n, emoji, title, desc }: { n: number; emoji: string; title: string; desc: string }) {
  return (
    <div className="flex gap-3">
      <div className="shrink-0 mt-0.5 w-9 h-9 rounded-xl grid place-items-center text-lg border relative" style={{ borderColor: `color-mix(in srgb, ${GREEN} 40%, var(--border))`, background: `color-mix(in srgb, ${GREEN} 10%, transparent)` }}>
        {emoji}
        <span className="absolute -top-1.5 -left-1.5 w-4 h-4 rounded-full grid place-items-center text-[9px] font-mono font-bold text-[var(--accent-ink)]" style={{ background: 'var(--accent)' }}>{n}</span>
      </div>
      <div className="min-w-0">
        <p className="text-sm font-medium text-[var(--text-primary)] leading-tight">{title}</p>
        <p className="text-[12px] text-[var(--text-secondary)] leading-snug mt-0.5">{desc}</p>
      </div>
    </div>
  );
}

export default CasinoToLand;
