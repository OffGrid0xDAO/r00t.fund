import { useRef } from 'react';
import { motion, useScroll, useTransform } from 'framer-motion';
import { GlowButton } from './ui/GlowButton';
import { AppBackground } from './AppBackground';

interface ManifestoPageProps {
  onClose: () => void;
}

// Section wrapper with background number watermark
function Section({
  children,
  className = '',
  delay = 0,
  number,
}: {
  children: React.ReactNode;
  className?: string;
  delay?: number;
  number?: string;
}) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 40 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-100px' }}
      transition={{ duration: 0.6, delay, ease: 'easeOut' }}
      className={`relative ${className}`}
    >
      {/* Large background number watermark */}
      {number && (
        <span
          className="absolute -left-4 md:-left-8 top-0 font-display font-bold text-[var(--text-primary)] pointer-events-none select-none"
          style={{
            fontSize: 'clamp(6rem, 15vw, 12rem)',
            opacity: 0.03,
            lineHeight: 1,
          }}
        >
          {number}
        </span>
      )}
      <div className="relative z-10">{children}</div>
    </motion.section>
  );
}

// Root divider between sections
function RootDivider() {
  return (
    <motion.div
      initial={{ opacity: 0, scaleX: 0 }}
      whileInView={{ opacity: 1, scaleX: 1 }}
      viewport={{ once: true }}
      transition={{ duration: 1, ease: 'easeOut' }}
      className="py-4 flex items-center justify-center"
    >
      <svg className="w-48 h-8 text-[var(--accent)]" viewBox="0 0 200 32" fill="none" stroke="currentColor" strokeWidth="1" opacity="0.3">
        <path d="M100 0 V16" />
        <path d="M100 16 Q80 24 60 28" />
        <path d="M100 16 Q120 24 140 28" />
        <path d="M100 16 Q90 20 75 24" opacity="0.5" />
        <path d="M100 16 Q110 20 125 24" opacity="0.5" />
        <path d="M0 16 L80 16" opacity="0.1" />
        <path d="M120 16 L200 16" opacity="0.1" />
      </svg>
    </motion.div>
  );
}

// Animated code label
function CodeLabel({ children }: { children: string }) {
  return (
    <motion.p
      initial={{ opacity: 0, x: -20 }}
      whileInView={{ opacity: 1, x: 0 }}
      viewport={{ once: true }}
      transition={{ duration: 0.4 }}
      className="text-xs font-mono font-medium tracking-wider uppercase text-[var(--text-muted)] mb-3 hover-glitch"
    >
      <span className="text-[var(--accent)] opacity-60">// </span>
      {children}
    </motion.p>
  );
}

// Feature card with icon and glow
function FeatureCard({
  title,
  children,
  delay = 0,
  icon,
}: {
  title: string;
  children: React.ReactNode;
  delay?: number;
  icon: string;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ duration: 0.5, delay }}
      whileHover={{ scale: 1.02, y: -4 }}
      className="p-6 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border)] hover:border-[var(--accent)] hover:shadow-glow-sm transition-all duration-300"
    >
      <div className="flex items-start gap-4">
        <div className="w-10 h-10 rounded-lg bg-[var(--accent)]/10 flex items-center justify-center flex-shrink-0">
          <svg className="w-5 h-5 text-[var(--accent)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d={icon} />
          </svg>
        </div>
        <div>
          <h3 className="font-mono font-medium text-[var(--text-primary)] mb-2 flex items-center gap-2">
            <span className="text-[var(--accent)]">//</span>
            {title}
          </h3>
          <p className="text-sm text-[var(--text-secondary)] leading-relaxed">{children}</p>
        </div>
      </div>
    </motion.div>
  );
}

// Scroll progress bar
function ScrollProgress({ progress }: { progress: any }) {
  const scaleX = useTransform(progress, [0, 1], [0, 1]);

  return (
    <motion.div
      className="fixed top-0 left-0 right-0 h-0.5 z-[60] origin-left"
      style={{
        scaleX,
        background: 'linear-gradient(90deg, var(--accent) 0%, var(--accent-secondary) 100%)',
        boxShadow: '0 0 8px var(--accent)',
      }}
    />
  );
}

export function ManifestoPage({ onClose }: ManifestoPageProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ container: containerRef });

  // Parallax effects
  const heroY = useTransform(scrollYProgress, [0, 0.3], [0, 100]);
  const heroOpacity = useTransform(scrollYProgress, [0, 0.2], [1, 0.3]);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.3 }}
      className="fixed inset-0 z-50 bg-[var(--bg-primary)]"
    >
      {/* Scroll progress indicator */}
      <ScrollProgress progress={scrollYProgress} />

      {/* Root network background */}
      <AppBackground />

      {/* Scroll Container */}
      <div ref={containerRef} className="h-full overflow-y-auto">
        {/* Glassmorphism Header */}
        <motion.header
          initial={{ y: -20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ duration: 0.5, delay: 0.2 }}
          className="sticky top-0 z-50 header-glass px-6 py-4 backdrop-blur-md"
        >
          <div className="max-w-3xl mx-auto flex items-center justify-between">
            <motion.div
              className="flex items-center logo-glow"
              whileHover={{ scale: 1.02 }}
            >
              <span className="text-2xl font-display font-bold text-[var(--accent)] text-glow">r00t</span>
              <span className="text-2xl font-display text-[var(--text-muted)]">.fund</span>
            </motion.div>
            <GlowButton onClick={onClose} variant="ghost" size="sm">
              close()
            </GlowButton>
          </div>
        </motion.header>

        {/* Content */}
        <main className="relative max-w-3xl mx-auto px-6 py-12">
          <div className="space-y-8">
            {/* Hero Section */}
            <motion.section
              style={{ y: heroY, opacity: heroOpacity }}
              className="text-center space-y-6 pt-8 pb-12"
            >
              <motion.div
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.8, delay: 0.3 }}
              >
                <p className="text-xs font-mono tracking-widest uppercase text-[var(--text-muted)] mb-4">
                  <span className="text-[var(--accent)]">// </span>manifesto
                </p>
                <h1 className="text-5xl md:text-6xl lg:text-7xl font-display font-bold text-[var(--text-primary)] leading-tight">
                  fund what{' '}
                  <span className="text-[var(--accent)] text-glow">heals</span>
                </h1>
              </motion.div>

              <motion.p
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6, delay: 0.5 }}
                className="text-lg md:text-xl font-body text-[var(--text-secondary)] max-w-xl mx-auto"
              >
                Private capital healing public land. Zero-knowledge infrastructure for the regenerative economy.
              </motion.p>

              {/* Animated divider */}
              <motion.div
                initial={{ scaleX: 0 }}
                animate={{ scaleX: 1 }}
                transition={{ duration: 1, delay: 0.7 }}
                className="w-32 h-px mx-auto bg-gradient-to-r from-transparent via-[var(--accent)] to-transparent"
                style={{ boxShadow: '0 0 20px var(--accent)' }}
              />
            </motion.section>

            <RootDivider />

            {/* The Problem */}
            <Section className="space-y-4" number="01">
              <CodeLabel>the_problems</CodeLabel>
              <h2 className="text-3xl md:text-4xl font-display font-semibold text-[var(--text-primary)]">
                Unrooted investments diverging from{' '}
                <span className="text-[var(--error)]">real world necessities</span>
              </h2>
              <div className="space-y-4 text-[var(--text-secondary)] font-body leading-relaxed">
                <p>
                  The crypto world is suffocating by an epidemy of greed - dumping any sense of meaning or purpose.
                  Meanwhile, transparency became surveillance and noble aspiration submitted to corrupted narratives.
                </p>
                <p>
                  Blockchain promised financial freedom. Instead, we got a panopticon where every
                  transaction is traced, every wallet is watched, and the ideals of crypto met with disdain.
                </p>
                <p className="italic border-l-2 border-[var(--accent)] pl-4 py-3 bg-[var(--bg-secondary)] rounded-r-lg shadow-glow-sm">
                  Roots are hidden for a reason. They are the vital parts of the ecosystem, offering
                  sovereignty and autonomy to all entities. There's no central authority in the forest, yet everything thrives.
                </p>
                <p>
                  The irony: While Money is supposed to facilitate real-world operations and reward purposeful work, it became an end in itself, unrelated to any value. And the very transparency meant to build trust has become a tool for
                  surveillance, discrimination, and market manipulation.
                </p>
              </div>
            </Section>

            <RootDivider />

            {/* The Vision */}
            <Section className="space-y-4" delay={0.1} number="02">
              <CodeLabel>the_vision</CodeLabel>
              <h2 className="text-3xl md:text-4xl font-display font-semibold text-[var(--text-primary)]">
                conviction capital,{' '}
                <span className="text-[var(--accent)] text-glow">confidential execution</span>
              </h2>
              <div className="space-y-4 text-[var(--text-secondary)] font-body leading-relaxed">
                <p>
                  Regenerative finance is the next frontier. r00t.fund lets you take positions in
                  tokenized real-world assets - restoration projects, sustainable infrastructure,
                  liveable eco-systems. That's the only road to sustainable growth.
                </p>
                <p>
                  The planet needs capital. Capital needs privacy. We bridge both - institutional-grade
                  confidentiality for investors who want to do good without broadcasting their playbook.
                </p>
              </div>
            </Section>

            <RootDivider />

            {/* How It Works */}
            <Section className="space-y-6" delay={0.1} number="03">
              <CodeLabel>how_it_works</CodeLabel>
              <h2 className="text-3xl md:text-4xl font-display font-semibold text-[var(--text-primary)]">
                zero-knowledge, full impact
              </h2>

              <div className="grid gap-4 mt-6">
                <FeatureCard
                  title="stealth allocations"
                  delay={0}
                  icon="M3.98 8.223A10.477 10.477 0 001.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.523 10.523 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228l-3.65-3.65m0 0a3 3 0 10-4.243-4.243m4.242 4.242L9.88 9.88"
                >
                  Your $R00T tokens are stored as cryptographic commitments - invisible on-chain.
                  Build positions in regenerative assets without signaling your thesis to the market.
                  Zero-knowledge proofs verify ownership without revealing balances or identity.
                </FeatureCard>

                <FeatureCard
                  title="private governance"
                  delay={0.1}
                  icon="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z"
                >
                  $R00T holders vote anonymously on which regenerative projects receive funding.
                  No wallet-watching, no front-running, no social pressure.
                  Conviction expressed through cryptographic ballots, not public posturing.
                </FeatureCard>

                <FeatureCard
                  title="real-world impact"
                  delay={0.2}
                  icon="M12 21a9.004 9.004 0 008.716-6.747M12 21a9.004 9.004 0 01-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 017.843 4.582M12 3a8.997 8.997 0 00-7.843 4.582m15.686 0A11.953 11.953 0 0112 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0121 12c0 .778-.099 1.533-.284 2.253m0 0A17.919 17.919 0 0112 16.5c-3.162 0-6.133-.815-8.716-2.247m0 0A9.015 9.015 0 013 12c0-1.605.42-3.113 1.157-4.418"
                >
                  Every project launched through r00t.fund creates verified real-world impact -
                  land restoration, carbon sequestration, sustainable infrastructure, regenerative agriculture.
                  Tokenized assets backed by measurable planetary healing.
                </FeatureCard>
              </div>
            </Section>

            <RootDivider />

            {/* The Technology */}
            <Section className="space-y-4" delay={0.1} number="04">
              <CodeLabel>the_tech</CodeLabel>
              <h2 className="text-3xl md:text-4xl font-display font-semibold text-[var(--text-primary)]">
                cryptography as{' '}
                <span className="text-[var(--accent-secondary)]">care</span>
              </h2>
              <div className="space-y-4 text-[var(--text-secondary)] font-body leading-relaxed">
                <p>
                  We use zero-knowledge proofs (specifically Groth16 on the BN254 curve) to enable
                  private balances and transfers. Your tokens exist as commitments in a Merkle tree -
                  mathematically proven to be valid without revealing amounts or owners.
                </p>
                <p>
                  When you transfer or vote, you generate a proof that says "I own enough tokens
                  to do this" without saying who you are or how much you have. It's financial
                  privacy without compromising on security.
                </p>
              </div>

              <motion.div
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.5, delay: 0.2 }}
                className="p-5 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border)] mt-6 shadow-glow-sm"
              >
                <pre className="text-xs font-mono overflow-x-auto">
                  <code>
                    <span className="text-[var(--accent)]">struct</span>{' '}
                    <span className="text-[var(--text-primary)]">Commitment</span>{' '}
                    <span className="text-[var(--text-muted)]">{'{'}</span>{'\n'}
                    {'    '}<span className="text-[var(--accent-secondary)]">nullifier</span>
                    <span className="text-[var(--text-muted)]">: Field,</span>{' '}
                    <span className="text-[var(--text-muted)] opacity-50">// prevents double-spending</span>{'\n'}
                    {'    '}<span className="text-[var(--accent-secondary)]">secret</span>
                    <span className="text-[var(--text-muted)]">: Field,</span>{' '}
                    <span className="text-[var(--text-muted)] opacity-50">// only you know this</span>{'\n'}
                    {'    '}<span className="text-[var(--accent-secondary)]">amount</span>
                    <span className="text-[var(--text-muted)]">: Field</span>{' '}
                    <span className="text-[var(--text-muted)] opacity-50">// your private balance</span>{'\n'}
                    <span className="text-[var(--text-muted)]">{'}'}</span>{'\n\n'}
                    <span className="text-[var(--accent)]">fn</span>{' '}
                    <span className="text-[var(--text-primary)]">prove_ownership</span>
                    <span className="text-[var(--text-muted)]">(commitment, amount) -&gt; </span>
                    <span className="text-[var(--accent-secondary)]">Proof</span>{' '}
                    <span className="text-[var(--text-muted)]">{'{'}</span>{'\n'}
                    {'    '}<span className="text-[var(--text-muted)] opacity-50">// proves you own &gt;= amount</span>{'\n'}
                    {'    '}<span className="text-[var(--text-muted)] opacity-50">// reveals nothing else</span>{'\n'}
                    <span className="text-[var(--text-muted)]">{'}'}</span>
                  </code>
                </pre>
              </motion.div>
            </Section>

            <RootDivider />

            {/* The Name */}
            <Section className="space-y-4" delay={0.1} number="05">
              <CodeLabel>the_name</CodeLabel>
              <h2 className="text-3xl md:text-4xl font-display font-semibold text-[var(--text-primary)]">
                why{' '}
                <span className="text-[var(--accent)] text-glow">r00t</span>?
              </h2>
              <div className="space-y-4 text-[var(--text-secondary)] font-body leading-relaxed">
                <p>
                  <span className="text-[var(--accent)] font-mono font-medium">r00t</span> - the foundation
                  from which everything grows. In nature, root systems are hidden underground,
                  yet they're the source of all life above. They connect, nourish, and sustain.
                </p>
                <p>
                  In computing, root access means full control over your system.
                  Here, $ROOT gives you sovereign control over your financial privacy and
                  your power to support regeneration.
                </p>
                <p>
                  The leetspeak spelling (r00t, not root) nods to our cypherpunk heritage -
                  the hackers and cryptographers who've always known that privacy is a right,
                  not a privilege.
                </p>
              </div>
            </Section>

            <RootDivider />

            {/* Call to Action */}
            <Section className="space-y-6" delay={0.1} number="06">
              <CodeLabel>deploy_capital</CodeLabel>
              <h2 className="text-3xl md:text-4xl font-display font-semibold text-[var(--text-primary)]">
                the alpha is{' '}
                <span className="text-[var(--accent)] text-glow">regeneration</span>
              </h2>
              <div className="space-y-4 text-[var(--text-secondary)] font-body leading-relaxed">
                <p>
                  The smart money is moving into ReFi (regenerative finance). r00t.fund gives sophisticated investors
                  first-mover access to tokenized regenerative assets - with the on-chain privacy
                  that serious capital demands.
                </p>
                <p>
                  Whether you're an institution seeking sustainable yield, a fund building
                  positions in carbon assets, or an individual who believes capital should heal -
                  this is your infrastructure.
                </p>
              </div>

              <motion.div
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.5, delay: 0.2 }}
                className="flex flex-col sm:flex-row gap-4 pt-4"
              >
                <GlowButton onClick={onClose} variant="primary" size="lg">
                  deploy_capital()
                </GlowButton>
                <GlowButton
                  onClick={() => window.open('https://github.com/r00tfund', '_blank')}
                  variant="secondary"
                  size="lg"
                >
                  view_source()
                </GlowButton>
              </motion.div>
            </Section>

            {/* Footer Quote */}
            <Section className="pt-8" delay={0.1}>
              <motion.div
                initial={{ scaleX: 0 }}
                whileInView={{ scaleX: 1 }}
                viewport={{ once: true }}
                transition={{ duration: 0.8 }}
                className="h-px bg-gradient-to-r from-transparent via-[var(--accent)] to-transparent"
                style={{ boxShadow: '0 0 12px var(--accent)' }}
              />

              <blockquote className="text-center py-12">
                <motion.p
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.6 }}
                  className="text-xl md:text-2xl italic font-body text-[var(--text-secondary)]"
                >
                  "The best time to plant a tree was 20 years ago.
                  <br />
                  The second best time is{' '}
                  <span className="text-[var(--accent)] not-italic font-semibold text-glow">now</span>."
                </motion.p>
                <motion.p
                  initial={{ opacity: 0 }}
                  whileInView={{ opacity: 1 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.6, delay: 0.2 }}
                  className="text-sm text-[var(--text-muted)] mt-4"
                >
                  - Chinese Proverb
                </motion.p>
              </blockquote>

              <motion.div
                initial={{ opacity: 0 }}
                whileInView={{ opacity: 1 }}
                viewport={{ once: true }}
                transition={{ duration: 0.6, delay: 0.3 }}
                className="text-center pb-8"
              >
                <p className="text-xs font-mono text-[var(--text-muted)]">
                  <span className="text-[var(--accent)] opacity-60">// </span>
                  private capital for planetary repair
                </p>
              </motion.div>
            </Section>
          </div>
        </main>
      </div>
    </motion.div>
  );
}
