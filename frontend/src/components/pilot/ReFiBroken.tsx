/**
 * ReFiBroken — the "why r00t exists" problem statement. Regenerative finance is
 * broken: most climate money is eaten by brokers/certifiers/overhead before it
 * reaches the people actually planting. r00t sends 100% to the land, verified by
 * satellite. Also names the RWA value: the regrowth mints carbon credits.
 */
import { motion } from 'framer-motion';

export function ReFiBroken() {
  return (
    <section className="relative py-16 md:py-24 px-6 md:px-12 lg:px-16 border-t border-[var(--border)]/50 dark:border-transparent">
      <div className="max-w-5xl mx-auto">
        <div className="flex items-center gap-4 mb-6">
          <div className="w-8 h-px bg-[var(--accent)]" />
          <span className="text-xs tracking-[0.2em] text-[var(--accent-on-bg)] uppercase font-mono">Why r00t exists</span>
        </div>

        <motion.h2 initial={{ opacity: 0, y: 12 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }}
          className="font-display text-3xl md:text-5xl text-[var(--text-primary)] tracking-[-0.02em] leading-[1.08] max-w-3xl mb-8">
          Regenerative finance is broken. <span className="text-[var(--accent-on-bg)]">The money never reaches the ground.</span>
        </motion.h2>

        <div className="grid md:grid-cols-3 gap-6 md:gap-8">
          <div className="md:col-span-2">
            <p className="text-base md:text-lg text-[var(--text-secondary)] leading-relaxed max-w-xl">
              <span className="text-[var(--text-primary)] font-medium">60–80% of climate finance is absorbed by intermediaries</span> —
              brokers, certifiers, consultants, NGO overhead — before a single tree goes in the ground.
              A €25 carbon credit can deliver €3–5 to the person who actually restored the land. Sometimes nothing.
            </p>
            <p className="mt-4 text-base text-[var(--text-secondary)] leading-relaxed max-w-xl">
              r00t cuts the chain. <span className="text-[var(--accent-on-bg)] font-medium">100% of every pledge goes straight to the land</span>,
              the crews planting see the money, and satellites — not paperwork — prove it grew. The regrowth
              itself becomes the asset: real carbon drawn down, real credits minted, on-chain.
            </p>
          </div>

          {/* the split */}
          <div className="space-y-3">
            <Stat pct="3–5" of="€25" label="reaches the planter today" tone="bad" />
            <Stat pct="100%" of="every pledge" label="reaches the land on r00t" tone="good" />
          </div>
        </div>
      </div>
    </section>
  );
}

function Stat({ pct, of, label, tone }: { pct: string; of: string; label: string; tone: 'bad' | 'good' }) {
  const good = tone === 'good';
  return (
    <div className="rounded-xl border p-4" style={{ borderColor: good ? 'color-mix(in srgb, var(--accent) 40%, var(--border))' : 'var(--border)', background: good ? 'color-mix(in srgb, var(--accent) 6%, transparent)' : 'transparent' }}>
      <p className="font-display text-2xl md:text-3xl tracking-tight" style={{ color: good ? 'var(--accent-on-bg)' : 'var(--text-muted)' }}>
        {pct}<span className="text-sm text-[var(--text-muted)] font-mono"> of {of}</span>
      </p>
      <p className="text-[11px] font-mono uppercase tracking-[0.12em] text-[var(--text-muted)] mt-1">{label}</p>
    </div>
  );
}

export default ReFiBroken;
