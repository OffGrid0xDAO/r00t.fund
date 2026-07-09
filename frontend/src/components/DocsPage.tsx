import { useRef, useState, useCallback, useEffect } from 'react';
import { motion, useScroll, useTransform, AnimatePresence } from 'framer-motion';
import { GlowButton } from './ui/GlowButton';
import { AppBackground } from './AppBackground';

interface DocsPageProps {
  onClose: () => void;
}

// ─── Local helper components (same pattern as ManifestoPage) ─────────────────

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

function Section({
  children,
  className = '',
  delay = 0,
  id,
}: {
  children: React.ReactNode;
  className?: string;
  delay?: number;
  id?: string;
}) {
  return (
    <motion.section
      id={id}
      initial={{ opacity: 0, y: 40 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-80px' }}
      transition={{ duration: 0.6, delay, ease: 'easeOut' }}
      className={`relative ${className}`}
    >
      <div className="relative z-10">{children}</div>
    </motion.section>
  );
}

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
          <div className="text-sm text-[var(--text-secondary)] leading-relaxed">{children}</div>
        </div>
      </div>
    </motion.div>
  );
}

function CodeBlock({ children }: { children: React.ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ duration: 0.5, delay: 0.1 }}
      className="p-5 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border)] shadow-glow-sm overflow-x-auto"
    >
      <pre className="text-xs font-mono">
        <code>{children}</code>
      </pre>
    </motion.div>
  );
}

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
        <path d="M0 16 L80 16" opacity="0.1" />
        <path d="M120 16 L200 16" opacity="0.1" />
      </svg>
    </motion.div>
  );
}

// Styled keyword spans for code blocks
function Kw({ children }: { children: React.ReactNode }) {
  return <span className="text-[var(--accent)]">{children}</span>;
}
function Ty({ children }: { children: React.ReactNode }) {
  return <span className="text-[var(--accent-secondary)]">{children}</span>;
}
function Cm({ children }: { children: React.ReactNode }) {
  return <span className="text-[var(--text-muted)] opacity-50">{children}</span>;
}
function Tx({ children }: { children: React.ReactNode }) {
  return <span className="text-[var(--text-primary)]">{children}</span>;
}
function Mu({ children }: { children: React.ReactNode }) {
  return <span className="text-[var(--text-muted)]">{children}</span>;
}

// ─── Sidebar nav definition ─────────────────────────────────────────────────

const NAV_SECTIONS = [
  { id: 'overview', label: 'Overview', icon: 'M2.25 12l8.954-8.955c.44-.439 1.152-.439 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25' },
  { id: 'architecture', label: 'Architecture', icon: 'M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z' },
  { id: 'zkamm', label: 'ZkAMM', icon: 'M7.5 21L3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5' },
  { id: 'cpt', label: 'CPT', icon: 'M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z' },
  { id: 'cre', label: 'CRE Workflows', icon: 'M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m13.35-.622l1.757-1.757a4.5 4.5 0 00-6.364-6.364l-4.5 4.5a4.5 4.5 0 001.242 7.244' },
  { id: 'privacy', label: 'Privacy & ZK', icon: 'M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z' },
  { id: 'sdk', label: 'SDK & OpenClaw', icon: 'M17.25 6.75L22.5 12l-5.25 5.25m-10.5 0L1.5 12l5.25-5.25m7.5-3l-4.5 16.5' },
] as const;

// ─── Main Component ─────────────────────────────────────────────────────────

export function DocsPage({ onClose }: DocsPageProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ container: containerRef });
  const [activeSection, setActiveSection] = useState('overview');
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  const scrollToSection = useCallback((id: string) => {
    const el = document.getElementById(id);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      setActiveSection(id);
      setMobileNavOpen(false);
    }
  }, []);

  // Track active section on scroll
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleScroll = () => {
      const sections = NAV_SECTIONS.map(s => ({
        id: s.id,
        el: document.getElementById(s.id),
      })).filter(s => s.el);

      let current = sections[0]?.id || 'overview';
      for (const section of sections) {
        if (section.el) {
          const rect = section.el.getBoundingClientRect();
          if (rect.top <= 150) current = section.id;
        }
      }
      setActiveSection(current);
    };

    container.addEventListener('scroll', handleScroll, { passive: true });
    return () => container.removeEventListener('scroll', handleScroll);
  }, []);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.3 }}
      className="fixed inset-0 z-50 bg-[var(--bg-primary)]"
    >
      <ScrollProgress progress={scrollYProgress} />
      <AppBackground />

      {/* Scroll container */}
      <div ref={containerRef} className="h-full overflow-y-auto">
        {/* Sticky header */}
        <motion.header
          initial={{ y: -20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ duration: 0.5, delay: 0.2 }}
          className="sticky top-0 z-50 header-glass px-6 py-4 backdrop-blur-md"
        >
          <div className="max-w-6xl mx-auto flex items-center justify-between">
            <motion.div className="flex items-center gap-3" whileHover={{ scale: 1.02 }}>
              <span className="text-2xl font-display font-bold text-[var(--accent)] text-glow">r00t</span>
              <span className="text-2xl font-display text-[var(--text-muted)]">.fund</span>
              <span className="text-xs font-mono text-[var(--text-muted)] opacity-50 hidden sm:inline">/ docs</span>
            </motion.div>
            <div className="flex items-center gap-3">
              {/* Mobile nav toggle */}
              <button
                onClick={() => setMobileNavOpen(!mobileNavOpen)}
                className="lg:hidden p-2 rounded-md border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
                style={{ background: 'var(--bg-elevated)' }}
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  {mobileNavOpen ? (
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  ) : (
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
                  )}
                </svg>
              </button>
              <GlowButton onClick={onClose} variant="ghost" size="sm">
                close()
              </GlowButton>
            </div>
          </div>
        </motion.header>

        {/* Mobile nav dropdown */}
        <AnimatePresence>
          {mobileNavOpen && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="lg:hidden sticky top-[60px] z-40 overflow-hidden border-b border-[var(--border)] backdrop-blur-md"
              style={{ background: 'var(--bg-primary)' }}
            >
              <nav className="max-w-6xl mx-auto px-6 py-3 flex flex-wrap gap-2">
                {NAV_SECTIONS.map(section => (
                  <button
                    key={section.id}
                    onClick={() => scrollToSection(section.id)}
                    className={`px-3 py-1.5 rounded-md text-xs font-mono transition-all ${
                      activeSection === section.id
                        ? 'bg-[var(--accent)] text-[var(--accent-ink)]'
                        : 'text-[var(--text-muted)] hover:text-[var(--text-primary)] bg-[var(--bg-secondary)]'
                    }`}
                  >
                    {section.label}
                  </button>
                ))}
              </nav>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Layout: sidebar + content */}
        <div className="max-w-6xl mx-auto flex">
          {/* Desktop sidebar */}
          <motion.aside
            initial={{ opacity: 0, x: -30 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.5, delay: 0.3 }}
            className="hidden lg:block w-56 flex-shrink-0 sticky top-[72px] self-start h-[calc(100vh-72px)] overflow-y-auto py-8 pl-6 pr-4"
          >
            <nav className="space-y-1">
              {NAV_SECTIONS.map(section => (
                <button
                  key={section.id}
                  onClick={() => scrollToSection(section.id)}
                  className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-sm font-mono transition-all duration-200 text-left ${
                    activeSection === section.id
                      ? 'bg-[var(--accent)]/10 text-[var(--accent)] border border-[var(--accent)]/20'
                      : 'text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-secondary)] border border-transparent'
                  }`}
                >
                  <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d={section.icon} />
                  </svg>
                  {section.label}
                </button>
              ))}
            </nav>

            {/* Sidebar footer */}
            <div className="mt-8 pt-6 border-t border-[var(--border)]">
              <p className="text-xs font-mono text-[var(--text-muted)] opacity-50">
                <span className="text-[var(--accent)] opacity-60">// </span>
                r00t.fund docs
              </p>
            </div>
          </motion.aside>

          {/* Content area */}
          <main className="flex-1 min-w-0 px-6 py-8 lg:py-12 lg:pl-8">
            <div className="max-w-3xl space-y-8">

              {/* ═══════════════════════════════════════════════════════════
                  Section 1: Overview
                  ═══════════════════════════════════════════════════════════ */}
              <Section id="overview" className="space-y-6 pt-4">
                <CodeLabel>overview</CodeLabel>
                <h1 className="text-4xl md:text-5xl font-display font-bold text-[var(--text-primary)] leading-tight">
                  what is{' '}
                  <span className="text-[var(--accent)] text-glow">r00t.fund</span>?
                </h1>
                <p className="text-lg text-[var(--text-secondary)] font-body leading-relaxed">
                  r00t.fund is a private launchpad for regenerative projects. It combines zero-knowledge proofs,
                  Chainlink CRE verification, and a compliance-first privacy model to let investors fund
                  real-world regenerative assets without revealing their identity or positions.
                </p>

                <div className="space-y-4 text-[var(--text-secondary)] font-body leading-relaxed">
                  <h3 className="text-xl font-display font-semibold text-[var(--text-primary)]">
                    The 5-Step Lifecycle
                  </h3>
                  <div className="grid gap-3">
                    {[
                      { step: '01', label: 'Launch', desc: 'Projects tokenize regenerative assets on r00t.fund and define their verification criteria.' },
                      { step: '02', label: 'Fund', desc: 'Investors deposit capital through the Compliant Private Vault. ETH enters escrow while compliance checks run.' },
                      { step: '03', label: 'Verify', desc: 'Chainlink CRE workflows validate projects using satellite imagery, soil data, and registry cross-checks.' },
                      { step: '04', label: 'Comply', desc: 'The R00tPolicyEngine gates every deposit with sanctions screening, KYC attestations, and volume limits.' },
                      { step: '05', label: 'Trade', desc: 'Verified tokens trade on the ZkAMM with full privacy: ZK proofs verify ownership without revealing balances.' },
                    ].map(item => (
                      <motion.div
                        key={item.step}
                        initial={{ opacity: 0, x: -20 }}
                        whileInView={{ opacity: 1, x: 0 }}
                        viewport={{ once: true }}
                        transition={{ duration: 0.4 }}
                        className="flex gap-4 p-4 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border)]"
                      >
                        <span className="text-2xl font-display font-bold text-[var(--accent)] opacity-40 flex-shrink-0">{item.step}</span>
                        <div>
                          <span className="font-mono font-medium text-[var(--text-primary)]">{item.label}</span>
                          <p className="text-sm text-[var(--text-secondary)] mt-1">{item.desc}</p>
                        </div>
                      </motion.div>
                    ))}
                  </div>
                </div>

                <div className="space-y-3 text-[var(--text-secondary)] font-body leading-relaxed">
                  <h3 className="text-xl font-display font-semibold text-[var(--text-primary)]">
                    Why It Exists
                  </h3>
                  <p>
                    Carbon markets are controlled by middlemen who extract value without verifying impact.
                    Regenerative projects lack direct access to capital, and investors who want to fund them
                    have no privacy-preserving infrastructure. r00t.fund removes the intermediaries: satellite
                    verification replaces manual audits, ZK proofs replace custodial trust, and Chainlink CRE
                    replaces centralized compliance gatekeepers.
                  </p>
                </div>

                <div className="grid sm:grid-cols-2 gap-3 mt-4">
                  <FeatureCard title="direct funding" icon="M12 6v12m-3-2.818l.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 11-18 0 9 9 0 0118 0z">
                    Capital flows directly from investors to verified regenerative projects. No fund managers, no intermediary tokens, no rent-seeking.
                  </FeatureCard>
                  <FeatureCard title="satellite verification" delay={0.1} icon="M12 21a9.004 9.004 0 008.716-6.747M12 21a9.004 9.004 0 01-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 017.843 4.582M12 3a8.997 8.997 0 00-7.843 4.582m15.686 0A11.953 11.953 0 0112 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0121 12c0 .778-.099 1.533-.284 2.253m0 0A17.919 17.919 0 0112 16.5c-3.162 0-6.133-.815-8.716-2.247m0 0A9.015 9.015 0 013 12c0-1.605.42-3.113 1.157-4.418">
                    Chainlink CRE analyzes Copernicus Sentinel-2 imagery, ISRIC SoilGrids, and Global Forest Watch data to verify environmental impact on-chain.
                  </FeatureCard>
                </div>
              </Section>

              <RootDivider />

              {/* ═══════════════════════════════════════════════════════════
                  Section 2: Architecture
                  ═══════════════════════════════════════════════════════════ */}
              <Section id="architecture" className="space-y-6">
                <CodeLabel>architecture</CodeLabel>
                <h2 className="text-3xl md:text-4xl font-display font-semibold text-[var(--text-primary)]">
                  system <span className="text-[var(--accent)]">architecture</span>
                </h2>
                <p className="text-[var(--text-secondary)] font-body leading-relaxed">
                  The protocol is built as a layered contract architecture where each component has a single responsibility.
                  State modifications flow through authorized callers only, with timelock protections on all admin operations.
                </p>

                {/* Contract diagram */}
                <CodeBlock>
                  <Cm>{'// Contract Relationships'}</Cm>{'\n\n'}
                  <Tx>{'ZkAMMAdmin'}</Tx>  <Mu>{'──── manages ────▶'}</Mu>  <Tx>{'ZkAMMPair'}</Tx>{'\n'}
                  <Mu>{'    │                            │'}</Mu>{'\n'}
                  <Mu>{'    │ sets router, verifiers     │ holds reserves'}</Mu>{'\n'}
                  <Mu>{'    │ CRE callback auth          │ token + LP merkle trees'}</Mu>{'\n'}
                  <Mu>{'    │ emergency multisig         │ nullifier sets'}</Mu>{'\n'}
                  <Mu>{'    │                            │'}</Mu>{'\n'}
                  <Tx>{'CompliantPrivateVault'}</Tx>  <Mu>{'──▶'}</Mu>  <Ty>{'insertCommitmentFromCRE()'}</Ty>{'\n'}
                  <Mu>{'    │                            │'}</Mu>{'\n'}
                  <Mu>{'    │ escrow ETH                 │ commitment ──▶ TokenPool'}</Mu>{'\n'}
                  <Mu>{'    │ emit events for CRE DON    │   (Poseidon Merkle tree)'}</Mu>{'\n'}
                  <Mu>{'    │                            │'}</Mu>{'\n'}
                  <Tx>{'R00tPolicyEngine'}</Tx>{'\n'}
                  <Mu>{'    │'}</Mu>{'\n'}
                  <Mu>{'    │ compliance attestations'}</Mu>{'\n'}
                  <Mu>{'    │ transfer policies'}</Mu>{'\n'}
                  <Mu>{'    │ sanctions + KYC checks'}</Mu>{'\n'}
                  <Mu>{'    ▼'}</Mu>{'\n'}
                  <Tx>{'R00tCREReceiver'}</Tx>  <Cm>{'  // base contract: DON auth + pause'}</Cm>
                </CodeBlock>

                <div className="space-y-4 text-[var(--text-secondary)] font-body leading-relaxed">
                  <h3 className="text-xl font-display font-semibold text-[var(--text-primary)]">
                    How Deposits Flow
                  </h3>
                  <p>
                    When a user deposits, their ETH enters escrow in the CompliantPrivateVault. The vault emits
                    a <code className="text-[var(--accent)] font-mono text-xs">PrivateTransferRequested</code> event
                    that the Chainlink CRE DON picks up. The DON queries the PolicyEngine off-chain
                    via <code className="text-[var(--accent)] font-mono text-xs">eth_call</code>, runs
                    sanctions checks, and either authorizes or denies the request. On authorization, the vault
                    inserts a Poseidon commitment into the ZkAMM Merkle tree and the deposit is live.
                  </p>

                  <h3 className="text-xl font-display font-semibold text-[var(--text-primary)]">
                    How Trades Flow
                  </h3>
                  <p>
                    Trading happens entirely on-chain through ZK proofs. To swap, a user generates a Groth16 proof
                    demonstrating they own a commitment in the Merkle tree with sufficient balance. The proof is
                    verified by one of 8 on-chain verifier contracts managed by ZkAMMAdmin. On success, the old
                    commitment is nullified and a new one is inserted with the updated balance.
                  </p>
                </div>

                <div className="grid sm:grid-cols-3 gap-3 mt-4">
                  <FeatureCard title="TokenPool" icon="M20.25 6.375c0 2.278-3.694 4.125-8.25 4.125S3.75 8.653 3.75 6.375m16.5 0c0-2.278-3.694-4.125-8.25-4.125S3.75 4.097 3.75 6.375m16.5 0v11.25c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125V6.375">
                    Poseidon Merkle tree storing token commitments. Every deposit, swap, and transfer creates a new leaf.
                  </FeatureCard>
                  <FeatureCard title="LP Pool" delay={0.1} icon="M3.75 3v11.25A2.25 2.25 0 006 16.5h2.25M3.75 3h-1.5m1.5 0h16.5m0 0h1.5m-1.5 0v11.25A2.25 2.25 0 0118 16.5h-2.25m-7.5 0h7.5m-7.5 0l-1 3m8.5-3l1 3m0 0l.5 1.5m-.5-1.5h-9.5m0 0l-.5 1.5">
                    Separate Merkle tree for LP position commitments. Liquidity providers earn fees without revealing their positions.
                  </FeatureCard>
                  <FeatureCard title="8 Verifiers" delay={0.2} icon="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z">
                    Sell, Transfer, Withdraw, AddLiquidity, RemoveLiquidity, ClaimFees, Swap, and Merge verifiers. Lockable permanently.
                  </FeatureCard>
                </div>
              </Section>

              <RootDivider />

              {/* ═══════════════════════════════════════════════════════════
                  Section 3: ZkAMM
                  ═══════════════════════════════════════════════════════════ */}
              <Section id="zkamm" className="space-y-6">
                <CodeLabel>zkamm</CodeLabel>
                <h2 className="text-3xl md:text-4xl font-display font-semibold text-[var(--text-primary)]">
                  the <span className="text-[var(--accent)]">ZkAMM</span>
                </h2>
                <p className="text-[var(--text-secondary)] font-body leading-relaxed">
                  The Zero-Knowledge Automated Market Maker is the core trading engine. It uses constant-product
                  mechanics (x&middot;y = k) but with private balances stored as Poseidon hash commitments in Merkle trees.
                  Every operation is proven with Groth16 ZK proofs, so the pool verifies correctness without
                  seeing amounts, owners, or trade sizes.
                </p>

                <div className="space-y-4 text-[var(--text-secondary)] font-body leading-relaxed">
                  <h3 className="text-xl font-display font-semibold text-[var(--text-primary)]">
                    Merkle Tree Commitments
                  </h3>
                  <p>
                    Balances are stored as leaves in a Poseidon Merkle tree (<code className="text-[var(--accent)] font-mono text-xs">TokenPool</code>).
                    Each leaf is a commitment: <code className="text-[var(--accent)] font-mono text-xs">Poseidon(nullifier, secret, amount)</code>.
                    To prove ownership, you demonstrate a valid Merkle path from your commitment to the root,
                    without revealing which leaf is yours.
                  </p>

                  <h3 className="text-xl font-display font-semibold text-[var(--text-primary)]">
                    Poseidon Hashing
                  </h3>
                  <p>
                    Unlike Keccak256 or SHA256, Poseidon is designed to be efficient inside arithmetic circuits (SNARKs).
                    The contract uses PoseidonT3 (2-input Poseidon) for the Merkle tree hash function, making proof
                    generation fast while keeping on-chain verification gas-efficient.
                  </p>
                </div>

                <CodeBlock>
                  <Kw>function</Kw> <Tx>depositPublic</Tx><Mu>{'('}</Mu>{'\n'}
                  {'    '}<Ty>uint256</Ty> <Tx>amount</Tx><Mu>,</Mu>{'\n'}
                  {'    '}<Ty>uint256</Ty> <Tx>commitment</Tx><Mu>,</Mu>{'\n'}
                  {'    '}<Ty>bytes32</Ty> <Tx>depositorBinding</Tx><Mu>,</Mu>  <Cm>{'// keccak256(commitment, depositor, amount)'}</Cm>{'\n'}
                  {'    '}<Ty>address</Ty> <Tx>depositor</Tx><Mu>,</Mu>{'\n'}
                  {'    '}<Ty>bytes</Ty>   <Tx>encryptedNote</Tx>{'\n'}
                  <Mu>{')'}</Mu> <Kw>external</Kw> <Kw>onlyRouter</Kw> <Kw>returns</Kw> <Mu>{'('}</Mu><Ty>uint256</Ty> <Tx>leafIndex</Tx><Mu>{')'}</Mu>
                </CodeBlock>

                <div className="space-y-4 text-[var(--text-secondary)] font-body leading-relaxed">
                  <h3 className="text-xl font-display font-semibold text-[var(--text-primary)]">
                    Anti-Frontrunning: Depositor Binding
                  </h3>
                  <p>
                    The <code className="text-[var(--accent)] font-mono text-xs">depositorBinding</code> parameter
                    is <code className="text-[var(--accent)] font-mono text-xs">keccak256(commitment, depositor, amount)</code>.
                    This binds the commitment to a specific depositor address and amount, preventing MEV bots from
                    copying a commitment from the mempool and inserting it under their own address.
                  </p>

                  <h3 className="text-xl font-display font-semibold text-[var(--text-primary)]">
                    CRE-Gated Deposits
                  </h3>
                  <p>
                    Compliance-checked deposits use <code className="text-[var(--accent)] font-mono text-xs">insertCommitmentFromCRE()</code>,
                    which validates the caller is an authorized CRE callback contract via the Admin. This is how the
                    CompliantPrivateVault inserts commitments after the DON approves a deposit request.
                  </p>

                  <h3 className="text-xl font-display font-semibold text-[var(--text-primary)]">
                    Swap Mechanics
                  </h3>
                  <p>
                    Swaps use constant-product math with a 1% total fee (30bps protocol + 70bps LP).
                    The user generates a ZK proof showing they own a commitment with enough balance,
                    the proof is verified on-chain, the old commitment is nullified, reserves are updated,
                    and a new commitment with the post-swap balance is inserted.
                  </p>
                </div>

                <CodeBlock>
                  <Cm>{'// Swap fee structure'}</Cm>{'\n'}
                  <Kw>uint256</Kw> <Tx>protocolFee</Tx> <Mu>=</Mu> <Ty>30</Ty> <Mu>bps</Mu>  <Cm>{'// 0.3% to treasury'}</Cm>{'\n'}
                  <Kw>uint256</Kw> <Tx>lpFee</Tx>       <Mu>=</Mu> <Ty>70</Ty> <Mu>bps</Mu>  <Cm>{'// 0.7% to LPs'}</Cm>{'\n'}
                  <Kw>uint256</Kw> <Tx>totalFee</Tx>     <Mu>=</Mu> <Ty>100</Ty> <Mu>bps</Mu> <Cm>{'// 1.0% total'}</Cm>{'\n\n'}
                  <Cm>{'// Sell: user sells tokens for ETH'}</Cm>{'\n'}
                  <Tx>ethOut</Tx> <Mu>=</Mu> <Mu>{'(tokenAmount * ethReserve) / (tokenReserve + tokenAmount) - fees'}</Mu>{'\n\n'}
                  <Cm>{'// Buy: user buys tokens with ETH'}</Cm>{'\n'}
                  <Tx>ethRequired</Tx> <Mu>=</Mu> <Mu>{'(ethReserve * tokenAmount) / (tokenReserve - tokenAmount) + 1 + fees'}</Mu>
                </CodeBlock>

                <div className="space-y-3 text-[var(--text-secondary)] font-body leading-relaxed">
                  <h3 className="text-xl font-display font-semibold text-[var(--text-primary)]">
                    LP Operations
                  </h3>
                  <p>
                    Liquidity providers receive LP commitment shares stored in a separate Merkle tree (<code className="text-[var(--accent)] font-mono text-xs">lpPool</code>).
                    LPs earn fees proportional to their share of the pool, tracked via <code className="text-[var(--accent)] font-mono text-xs">feePerShare</code> accumulator.
                    LP positions have a lock period (1 minute testnet, 24 hours production) to prevent flash-loan attacks.
                    Fee claiming uses epoch-based distribution with a minimum 72-hour claim window.
                  </p>
                </div>
              </Section>

              <RootDivider />

              {/* ═══════════════════════════════════════════════════════════
                  Section 4: CPT — Compliant Private Token
                  ═══════════════════════════════════════════════════════════ */}
              <Section id="cpt" className="space-y-6">
                <CodeLabel>compliant_private_token</CodeLabel>
                <h2 className="text-3xl md:text-4xl font-display font-semibold text-[var(--text-primary)]">
                  compliance <span className="text-[var(--accent)]">before</span> privacy
                </h2>
                <p className="text-[var(--text-secondary)] font-body leading-relaxed">
                  The Compliant Private Token (CPT) model gates every private deposit with compliance checks.
                  Unlike mixer protocols, r00t.fund requires that funds pass through a compliance pipeline <em>before</em> entering
                  the privacy pool. This means every commitment in the Merkle tree has been screened &mdash;
                  you cannot enter the pool without clearing compliance.
                </p>

                <div className="space-y-4 text-[var(--text-secondary)] font-body leading-relaxed">
                  <h3 className="text-xl font-display font-semibold text-[var(--text-primary)]">
                    CompliantPrivateVault Flow
                  </h3>
                </div>

                <CodeBlock>
                  <Cm>{'// 1. User requests deposit'}</Cm>{'\n'}
                  <Tx>vault</Tx><Mu>.</Mu><Kw>requestDeposit</Kw><Mu>{'('}</Mu>{'\n'}
                  {'    '}<Ty>commitment</Ty><Mu>,</Mu>     <Cm>{'// Poseidon(nullifier, secret, amount)'}</Cm>{'\n'}
                  {'    '}<Ty>addressHash</Ty><Mu>,</Mu>    <Cm>{'// keccak256(address, salt)'}</Cm>{'\n'}
                  {'    '}<Ty>encryptedNote</Ty>   <Cm>{'// encrypted for user\'s viewing key'}</Cm>{'\n'}
                  <Mu>{')'}</Mu> <Kw>{'{ value: depositAmount }'}</Kw>{'\n\n'}
                  <Cm>{'// 2. Event emitted → CRE DON picks up'}</Cm>{'\n'}
                  <Kw>emit</Kw> <Tx>PrivateTransferRequested</Tx><Mu>{'(requestId, ...)'}</Mu>{'\n\n'}
                  <Cm>{'// 3. CRE DON queries PolicyEngine (off-chain eth_call)'}</Cm>{'\n'}
                  <Tx>policyEngine</Tx><Mu>.</Mu><Kw>checkPrivateTransferAllowed</Kw><Mu>{'('}</Mu>{'\n'}
                  {'    '}<Ty>fromHash</Ty><Mu>,</Mu> <Ty>toHash</Ty><Mu>,</Mu> <Ty>amount</Ty><Mu>,</Mu> <Ty>DEPOSIT</Ty>{'\n'}
                  <Mu>{')'}</Mu>{'\n\n'}
                  <Cm>{'// 4a. If compliant → authorize'}</Cm>{'\n'}
                  <Tx>vault</Tx><Mu>.</Mu><Kw>authorizeTransfer</Kw><Mu>{'(requestId)'}</Mu>{'\n'}
                  <Cm>{'//   → inserts commitment into ZkAMM Merkle tree'}</Cm>{'\n'}
                  <Cm>{'//   → records volume in PolicyEngine'}</Cm>{'\n\n'}
                  <Cm>{'// 4b. If denied → refund'}</Cm>{'\n'}
                  <Tx>vault</Tx><Mu>.</Mu><Kw>denyTransfer</Kw><Mu>{'(requestId, reason)'}</Mu>{'\n'}
                  <Cm>{'//   → ETH refunded to requester'}  </Cm>
                </CodeBlock>

                <div className="space-y-4 text-[var(--text-secondary)] font-body leading-relaxed">
                  <h3 className="text-xl font-display font-semibold text-[var(--text-primary)]">
                    The 9 Policy Checks
                  </h3>
                  <p>
                    The <code className="text-[var(--accent)] font-mono text-xs">R00tPolicyEngine.checkPrivateTransferAllowed()</code> function
                    runs 9 sequential checks. If any fails, the transfer is denied with a reason string:
                  </p>
                  <div className="space-y-2">
                    {[
                      'Global address block list',
                      'Transfer policy is active for this type',
                      'Sender attestation exists and is active',
                      'Sender attestation not expired',
                      'Compliance level sufficient (BASIC → INSTITUTIONAL)',
                      'Sanctions check passed (if required)',
                      'Jurisdiction approved (if required)',
                      'Risk score within threshold',
                      'Amount within per-tx and daily limits',
                    ].map((check, i) => (
                      <div key={i} className="flex items-start gap-3 text-sm">
                        <span className="font-mono text-[var(--accent)] flex-shrink-0 w-5 text-right">{i + 1}.</span>
                        <span>{check}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="space-y-4 text-[var(--text-secondary)] font-body leading-relaxed">
                  <h3 className="text-xl font-display font-semibold text-[var(--text-primary)]">
                    Address Hashing Model
                  </h3>
                  <p>
                    Instead of storing raw addresses, the system uses <code className="text-[var(--accent)] font-mono text-xs">keccak256(address, salt)</code> where
                    the salt is known only to the user and the CRE DON. This means compliance attestations are stored
                    against a privacy-preserving identifier &mdash; the on-chain contracts never see the actual address
                    in plain text.
                  </p>

                  <h3 className="text-xl font-display font-semibold text-[var(--text-primary)]">
                    Compliance Levels
                  </h3>
                </div>

                <CodeBlock>
                  <Kw>enum</Kw> <Tx>ComplianceLevel</Tx> <Mu>{'{'}</Mu>{'\n'}
                  {'    '}<Ty>NONE</Ty><Mu>,</Mu>           <Cm>{'// No attestation'}</Cm>{'\n'}
                  {'    '}<Ty>BASIC</Ty><Mu>,</Mu>          <Cm>{'// Sanctions check only — allows deposits'}</Cm>{'\n'}
                  {'    '}<Ty>STANDARD</Ty><Mu>,</Mu>       <Cm>{'// KYC L1 + sanctions — allows withdrawals'}</Cm>{'\n'}
                  {'    '}<Ty>ENHANCED</Ty><Mu>,</Mu>       <Cm>{'// KYC L2 + EDD — allows vault transfers'}</Cm>{'\n'}
                  {'    '}<Ty>INSTITUTIONAL</Ty>  <Cm>{'// Full MiCA compliance — cross-border'}</Cm>{'\n'}
                  <Mu>{'}'}</Mu>{'\n\n'}
                  <Cm>{'// Transfer type → minimum level required'}</Cm>{'\n'}
                  <Tx>DEPOSIT</Tx>          <Mu>→</Mu> <Ty>BASIC</Ty>          <Cm>{'// max 100 ETH/tx, 500 ETH/day'}</Cm>{'\n'}
                  <Tx>WITHDRAWAL</Tx>       <Mu>→</Mu> <Ty>STANDARD</Ty>       <Cm>{'// max 50 ETH/tx, 200 ETH/day'}</Cm>{'\n'}
                  <Tx>PRIVATE_TRANSFER</Tx> <Mu>→</Mu> <Ty>STANDARD</Ty>       <Cm>{'// max 50 ETH/tx, 200 ETH/day'}</Cm>{'\n'}
                  <Tx>VAULT_TRANSFER</Tx>   <Mu>→</Mu> <Ty>ENHANCED</Ty>       <Cm>{'// max 500 ETH/tx, 2000 ETH/day'}</Cm>{'\n'}
                  <Tx>CROSS_BORDER</Tx>     <Mu>→</Mu> <Ty>INSTITUTIONAL</Ty>  <Cm>{'// max 1000 ETH/tx, 5000 ETH/day'}</Cm>
                </CodeBlock>

                <p className="text-sm text-[var(--text-secondary)] font-body">
                  Pending requests expire after <strong>1 hour</strong>. If the CRE DON doesn't process a request within that window,
                  anyone can call <code className="text-[var(--accent)] font-mono text-xs">expireStaleRequests()</code> to refund the escrowed ETH.
                </p>
              </Section>

              <RootDivider />

              {/* ═══════════════════════════════════════════════════════════
                  Section 5: CRE Workflows
                  ═══════════════════════════════════════════════════════════ */}
              <Section id="cre" className="space-y-6">
                <CodeLabel>cre_workflows</CodeLabel>
                <h2 className="text-3xl md:text-4xl font-display font-semibold text-[var(--text-primary)]">
                  Chainlink CRE <span className="text-[var(--accent)]">workflows</span>
                </h2>
                <p className="text-[var(--text-secondary)] font-body leading-relaxed">
                  r00t.fund uses 7 Chainlink Computation Runtime Environment (CRE) workflows to automate
                  verification, compliance, and monitoring. Each workflow runs off-chain in the CRE DON,
                  processes data from multiple sources, and delivers results on-chain through an authorized
                  DON forwarder.
                </p>

                <div className="grid gap-3">
                  {[
                    {
                      id: 'W1',
                      title: 'Confidential Funding',
                      desc: 'ZK-shielded capital allocation. Validates deposits through the CompliantPrivateVault flow, runs sanctions screening via ConfidentialHTTPClient, and authorizes or denies commitments.',
                      icon: 'M2.25 18.75a60.07 60.07 0 0115.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75M3.75 4.5v.75A.75.75 0 013 6h-.75m0 0v-.375c0-.621.504-1.125 1.125-1.125H20.25M2.25 6v9m18-10.5v.75c0 .414.336.75.75.75h.75m-1.5-1.5h.375c.621 0 1.125.504 1.125 1.125v9.75c0 .621-.504 1.125-1.125 1.125h-.375m1.5-1.5H21a.75.75 0 00-.75.75v.75m0 0H3.75m0 0h-.375a1.125 1.125 0 01-1.125-1.125V15m1.5 1.5v-.75A.75.75 0 003 15h-.75M15 10.5a3 3 0 11-6 0 3 3 0 016 0zm3 0h.008v.008H18V10.5zm-12 0h.008v.008H6V10.5z',
                    },
                    {
                      id: 'W2',
                      title: 'Proof of Reserve',
                      desc: 'Chainlink Proof of Reserve for locked assets. Verifies that the ETH and ROOT reserves in the ZkAMM pair match the reported values, preventing fractional reserve situations.',
                      icon: 'M20.25 6.375c0 2.278-3.694 4.125-8.25 4.125S3.75 8.653 3.75 6.375m16.5 0c0-2.278-3.694-4.125-8.25-4.125S3.75 4.097 3.75 6.375m16.5 0v11.25c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125V6.375',
                    },
                    {
                      id: 'W3',
                      title: 'AI Validator',
                      desc: 'Multi-model satellite imagery analysis. Processes Copernicus Sentinel-2 data through AI models to verify land restoration, vegetation health, and carbon sequestration claims.',
                      icon: 'M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z M15 12a3 3 0 11-6 0 3 3 0 016 0z',
                    },
                    {
                      id: 'W4',
                      title: 'Prediction Markets',
                      desc: 'Community stakes on environmental outcomes. Token holders predict whether restoration targets will be met, creating a decentralized verification layer alongside the AI validator.',
                      icon: 'M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z',
                    },
                    {
                      id: 'W5',
                      title: 'Health Monitor',
                      desc: 'Real-time NDVI and soil health tracking. Continuously monitors vegetation indices from Sentinel-2 and soil data from ISRIC SoilGrids to detect degradation early.',
                      icon: 'M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12z',
                    },
                    {
                      id: 'W6',
                      title: 'ACE Compliance',
                      desc: 'Automated EU MiCA compliance enforcement. Verifies that transactions comply with the Markets in Crypto-Assets regulation, jurisdiction requirements, and AML directives.',
                      icon: 'M12 3v17.25m0 0c-1.472 0-2.882.265-4.185.75M12 20.25c1.472 0 2.882.265 4.185.75M18.75 4.97A48.416 48.416 0 0012 4.5c-2.291 0-4.545.16-6.75.47m13.5 0c1.01.143 2.01.317 3 .52m-3-.52l2.62 10.726c.122.499-.106 1.028-.589 1.202a5.988 5.988 0 01-2.031.352 5.988 5.988 0 01-2.031-.352c-.483-.174-.711-.703-.59-1.202L18.75 4.971zm-16.5.52c.99-.203 1.99-.377 3-.52m0 0l2.62 10.726c.122.499-.106 1.028-.589 1.202a5.989 5.989 0 01-2.031.352 5.989 5.989 0 01-2.031-.352c-.483-.174-.711-.703-.59-1.202L5.25 4.971z',
                    },
                    {
                      id: 'W7',
                      title: 'Pilot Site Recovery Feed',
                      desc: 'Fire recovery data pipeline for the 9 ha Project 001 pilot site. Phase 1 (2026 H1): clear burned trees, woodchip biomass for soil fertility, build contour barriers from salvaged trunks — €27,150 budget. Phase 2 (Sep–Oct 2026): plant 2,550 native trees. Monitors dNBR burn severity and NDVI recovery trajectory via CRE DON.',
                      icon: 'M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z',
                    },
                  ].map(workflow => (
                    <FeatureCard key={workflow.id} title={`${workflow.id}: ${workflow.title}`} icon={workflow.icon}>
                      {workflow.desc}
                    </FeatureCard>
                  ))}
                </div>

                <div className="space-y-4 text-[var(--text-secondary)] font-body leading-relaxed mt-6">
                  <h3 className="text-xl font-display font-semibold text-[var(--text-primary)]">
                    Verification Pipeline
                  </h3>
                  <CodeBlock>
                    <Tx>Propose</Tx> <Mu>→</Mu> <Tx>Fund</Tx> <Mu>→</Mu> <Kw>CRE Checks</Kw> <Mu>→</Mu> <Tx>Verified?</Tx> <Mu>→</Mu> <Ty>Release</Ty>{'\n\n'}
                    <Cm>{'// Data sources queried by CRE workflows:'}</Cm>{'\n'}
                    <Mu>{'├── '}</Mu><Tx>Copernicus Sentinel-2</Tx>  <Cm>{'// satellite imagery (NDVI, vegetation)'}</Cm>{'\n'}
                    <Mu>{'├── '}</Mu><Tx>ISRIC SoilGrids</Tx>       <Cm>{'// soil organic carbon, pH, nutrients'}</Cm>{'\n'}
                    <Mu>{'├── '}</Mu><Tx>Global Forest Watch</Tx>    <Cm>{'// deforestation alerts, tree cover'}</Cm>{'\n'}
                    <Mu>{'└── '}</Mu><Tx>Verra / Gold Standard</Tx>  <Cm>{'// carbon credit registry cross-check'}</Cm>
                  </CodeBlock>

                  <h3 className="text-xl font-display font-semibold text-[var(--text-primary)]">
                    DON Forwarder Authentication
                  </h3>
                  <p>
                    All CRE callback contracts inherit from <code className="text-[var(--accent)] font-mono text-xs">R00tCREReceiver</code>,
                    which enforces that only the authorized Chainlink DON forwarder can call state-modifying functions.
                    This is the <code className="text-[var(--accent)] font-mono text-xs">onlyDonForwarder</code> modifier &mdash;
                    any unauthorized caller receives an <code className="text-[var(--accent)] font-mono text-xs">UnauthorizedForwarder()</code> revert.
                  </p>
                </div>
              </Section>

              <RootDivider />

              {/* ═══════════════════════════════════════════════════════════
                  Section 6: Privacy & ZK Proofs
                  ═══════════════════════════════════════════════════════════ */}
              <Section id="privacy" className="space-y-6">
                <CodeLabel>privacy_and_zk_proofs</CodeLabel>
                <h2 className="text-3xl md:text-4xl font-display font-semibold text-[var(--text-primary)]">
                  zero-knowledge <span className="text-[var(--accent)]">proofs</span>
                </h2>
                <p className="text-[var(--text-secondary)] font-body leading-relaxed">
                  r00t.fund uses Groth16 proofs on the BN254 (alt_bn128) elliptic curve. Groth16 produces
                  constant-size proofs (~200 bytes) that verify in constant time on-chain, regardless of circuit
                  complexity. The EVM has precompiles for BN254 pairing operations (EIP-196/197), making
                  verification gas-efficient.
                </p>

                <div className="space-y-4 text-[var(--text-secondary)] font-body leading-relaxed">
                  <h3 className="text-xl font-display font-semibold text-[var(--text-primary)]">
                    Commitment Structure
                  </h3>
                </div>

                <CodeBlock>
                  <Kw>struct</Kw> <Tx>Commitment</Tx> <Mu>{'{'}</Mu>{'\n'}
                  {'    '}<Ty>nullifier</Ty><Mu>: Field,</Mu> <Cm>{'// random value — prevents double-spending'}</Cm>{'\n'}
                  {'    '}<Ty>secret</Ty><Mu>: Field,</Mu>    <Cm>{'// only the owner knows this'}</Cm>{'\n'}
                  {'    '}<Ty>amount</Ty><Mu>: Field</Mu>     <Cm>{'// the private balance'}</Cm>{'\n'}
                  <Mu>{'}'}</Mu>{'\n\n'}
                  <Cm>{'// Commitment hash (stored in Merkle tree leaf):'}</Cm>{'\n'}
                  <Tx>leaf</Tx> <Mu>=</Mu> <Kw>Poseidon</Kw><Mu>{'('}</Mu><Ty>nullifier</Ty><Mu>,</Mu> <Ty>secret</Ty><Mu>,</Mu> <Ty>amount</Ty><Mu>{')'}</Mu>{'\n\n'}
                  <Cm>{'// To spend: reveal nullifier hash, keep secret + amount private'}</Cm>{'\n'}
                  <Tx>nullifierHash</Tx> <Mu>=</Mu> <Kw>Poseidon</Kw><Mu>{'('}</Mu><Ty>nullifier</Ty><Mu>{')'}</Mu>{'\n'}
                  <Cm>{'// If nullifierHash is already spent → reject (no double-spend)'}</Cm>
                </CodeBlock>

                <div className="space-y-4 text-[var(--text-secondary)] font-body leading-relaxed">
                  <h3 className="text-xl font-display font-semibold text-[var(--text-primary)]">
                    How Proofs Work
                  </h3>
                  <p>
                    When you want to trade, transfer, or withdraw, your client generates a ZK proof that says:
                    "I know a commitment (nullifier, secret, amount) that hashes to a leaf in the Merkle tree,
                    and the amount is at least X." The on-chain verifier checks the proof against the current
                    Merkle root. It learns nothing about which leaf is yours, what your balance is, or who you are.
                  </p>

                  <h3 className="text-xl font-display font-semibold text-[var(--text-primary)]">
                    Nullifiers Prevent Double-Spending
                  </h3>
                  <p>
                    Each commitment has a unique nullifier. When you spend a commitment, you reveal
                    its <code className="text-[var(--accent)] font-mono text-xs">nullifierHash</code> (but not the nullifier itself).
                    The contract stores all spent nullifier hashes. If the same hash appears twice, the transaction
                    reverts. This prevents spending the same commitment multiple times, without linking the
                    spend to any specific Merkle tree leaf.
                  </p>

                  <h3 className="text-xl font-display font-semibold text-[var(--text-primary)]">
                    Merkle Tree Membership
                  </h3>
                  <p>
                    The proof includes a Merkle path (siblings + indices) from the commitment leaf to the tree root.
                    The verifier checks that the path is valid for the current on-chain root. Since the tree uses
                    Poseidon hashing, the path verification happens inside the arithmetic circuit efficiently.
                    The tree depth determines the maximum number of commitments (2^depth).
                  </p>
                </div>

                <div className="grid sm:grid-cols-2 gap-3 mt-4">
                  <FeatureCard title="Groth16" icon="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z">
                    Constant-size proofs (~200 bytes). Constant verification time. Trusted setup required per circuit, but proof generation is fast.
                  </FeatureCard>
                  <FeatureCard title="BN254 Curve" delay={0.1} icon="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z">
                    EVM-native elliptic curve with precompiles for pairing operations. Gas-efficient on-chain verification via EIP-196 and EIP-197.
                  </FeatureCard>
                </div>
              </Section>

              <RootDivider />

              {/* ═══════════════════════════════════════════════════════════
                  Section 7: SDK & OpenClaw
                  ═══════════════════════════════════════════════════════════ */}
              <Section id="sdk" className="space-y-6">
                <CodeLabel>sdk_and_openclaw</CodeLabel>
                <h2 className="text-3xl md:text-4xl font-display font-semibold text-[var(--text-primary)]">
                  SDK & <span className="text-[var(--accent)]">OpenClaw</span>
                </h2>
                <p className="text-[var(--text-secondary)] font-body leading-relaxed">
                  r00t.fund is designed to be agent-accessible. Any AI agent that can read a URL and execute
                  commands can start interacting with the protocol. The OpenClaw standard means your agent
                  fetches a skill manifest, understands the protocol, and begins trading autonomously.
                </p>

                <div className="space-y-4 text-[var(--text-secondary)] font-body leading-relaxed">
                  <h3 className="text-xl font-display font-semibold text-[var(--text-primary)]">
                    Agent Setup
                  </h3>
                  <p>
                    Point your agent at the skill manifest and it handles the rest:
                  </p>
                </div>

                <CodeBlock>
                  <Cm>{'// Agent reads the skill manifest'}</Cm>{'\n'}
                  <Kw>$</Kw> <Tx>curl -s https://r00t.fund/skill.md</Tx>{'\n\n'}
                  <Cm>{'// Agent understands:'}</Cm>{'\n'}
                  <Cm>{'//   - What r00t.fund is'}</Cm>{'\n'}
                  <Cm>{'//   - How to install the SDK'}</Cm>{'\n'}
                  <Cm>{'//   - Available operations (deposit, swap, prove, withdraw)'}</Cm>{'\n'}
                  <Cm>{'//   - ZK proof generation workflow'}</Cm>{'\n'}
                  <Cm>{'//   - Error handling patterns'}</Cm>
                </CodeBlock>

                <div className="space-y-4 text-[var(--text-secondary)] font-body leading-relaxed">
                  <h3 className="text-xl font-display font-semibold text-[var(--text-primary)]">
                    Compatible Models
                  </h3>
                  <p>
                    Any model with tool-use capabilities works. Tested with:
                  </p>
                  <div className="flex flex-wrap gap-2 mt-2">
                    {['Claude', 'GPT-4', 'DeepSeek', 'Ollama (local)'].map(model => (
                      <span
                        key={model}
                        className="px-3 py-1.5 rounded-md text-xs font-mono bg-[var(--bg-secondary)] border border-[var(--border)] text-[var(--text-primary)]"
                      >
                        {model}
                      </span>
                    ))}
                  </div>
                </div>

                <div className="space-y-4 text-[var(--text-secondary)] font-body leading-relaxed">
                  <h3 className="text-xl font-display font-semibold text-[var(--text-primary)]">
                    SDK Installation
                  </h3>
                </div>

                <CodeBlock>
                  <Kw>$</Kw> <Tx>npm i @r00t/sdk</Tx>
                </CodeBlock>

                <div className="space-y-4 text-[var(--text-secondary)] font-body leading-relaxed">
                  <h3 className="text-xl font-display font-semibold text-[var(--text-primary)]">
                    API Reference
                  </h3>
                </div>

                <CodeBlock>
                  <Kw>import</Kw> <Mu>{'{ '}</Mu><Tx>R00tSDK</Tx><Mu>{' }'}</Mu> <Kw>from</Kw> <Ty>'@r00t/sdk'</Ty>{'\n\n'}
                  <Kw>const</Kw> <Tx>sdk</Tx> <Mu>=</Mu> <Kw>new</Kw> <Tx>R00tSDK</Tx><Mu>{'({'}</Mu>{'\n'}
                  {'    '}<Ty>rpcUrl</Ty><Mu>:</Mu>     <Ty>'https://rpc.r00t.fund'</Ty><Mu>,</Mu>{'\n'}
                  {'    '}<Ty>privateKey</Ty><Mu>:</Mu>  <Ty>process.env.PRIVATE_KEY</Ty><Mu>,</Mu>{'\n'}
                  {'    '}<Ty>viewingKey</Ty><Mu>:</Mu>  <Ty>process.env.VIEWING_KEY</Ty>{'\n'}
                  <Mu>{'}'}</Mu><Mu>)</Mu>{'\n\n'}
                  <Cm>{'// Deposit ETH → private pool (via compliance)'}</Cm>{'\n'}
                  <Kw>await</Kw> <Tx>sdk</Tx><Mu>.</Mu><Kw>deposit</Kw><Mu>{'('}</Mu><Ty>amount</Ty><Mu>{')'}</Mu>{'\n\n'}
                  <Cm>{'// Swap tokens privately'}</Cm>{'\n'}
                  <Kw>await</Kw> <Tx>sdk</Tx><Mu>.</Mu><Kw>swap</Kw><Mu>{'({'}</Mu>{'\n'}
                  {'    '}<Ty>amountIn</Ty><Mu>:</Mu> <Ty>'1.0'</Ty><Mu>,</Mu>{'\n'}
                  {'    '}<Ty>direction</Ty><Mu>:</Mu> <Ty>'ETH_TO_ROOT'</Ty>{'\n'}
                  <Mu>{'}'}</Mu><Mu>)</Mu>{'\n\n'}
                  <Cm>{'// Generate ZK proof for ownership'}</Cm>{'\n'}
                  <Kw>const</Kw> <Tx>proof</Tx> <Mu>=</Mu> <Kw>await</Kw> <Tx>sdk</Tx><Mu>.</Mu><Kw>prove</Kw><Mu>{'('}</Mu><Ty>commitment</Ty><Mu>,</Mu> <Ty>amount</Ty><Mu>{')'}</Mu>{'\n\n'}
                  <Cm>{'// Withdraw from private pool'}</Cm>{'\n'}
                  <Kw>await</Kw> <Tx>sdk</Tx><Mu>.</Mu><Kw>withdraw</Kw><Mu>{'({'}</Mu>{'\n'}
                  {'    '}<Ty>amount</Ty><Mu>:</Mu> <Ty>'0.5'</Ty><Mu>,</Mu>{'\n'}
                  {'    '}<Ty>recipient</Ty><Mu>:</Mu> <Ty>'0x...'</Ty>{'\n'}
                  <Mu>{'}'}</Mu><Mu>)</Mu>{'\n\n'}
                  <Cm>{'// Scan for your commitments'}</Cm>{'\n'}
                  <Kw>const</Kw> <Tx>balance</Tx> <Mu>=</Mu> <Kw>await</Kw> <Tx>sdk</Tx><Mu>.</Mu><Kw>scan</Kw><Mu>()</Mu>{'\n\n'}
                  <Cm>{'// Get pool reserves'}</Cm>{'\n'}
                  <Kw>const</Kw> <Tx>reserves</Tx> <Mu>=</Mu> <Kw>await</Kw> <Tx>sdk</Tx><Mu>.</Mu><Kw>getReserves</Kw><Mu>()</Mu>
                </CodeBlock>

                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.5, delay: 0.2 }}
                  className="flex flex-col sm:flex-row gap-4 pt-4"
                >
                  <GlowButton
                    onClick={() => window.open('https://github.com/offGrid0xDAO/r00t.fund/', '_blank')}
                    variant="primary"
                    size="lg"
                  >
                    view_source()
                  </GlowButton>
                  <GlowButton onClick={onClose} variant="secondary" size="lg">
                    start_trading()
                  </GlowButton>
                </motion.div>
              </Section>

              {/* Footer */}
              <Section className="pt-8" delay={0.1}>
                <motion.div
                  initial={{ scaleX: 0 }}
                  whileInView={{ scaleX: 1 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.8 }}
                  className="h-px bg-gradient-to-r from-transparent via-[var(--accent)] to-transparent"
                  style={{ boxShadow: '0 0 12px var(--accent)' }}
                />
                <div className="text-center py-12">
                  <motion.p
                    initial={{ opacity: 0 }}
                    whileInView={{ opacity: 1 }}
                    viewport={{ once: true }}
                    transition={{ duration: 0.6 }}
                    className="text-xs font-mono text-[var(--text-muted)]"
                  >
                    <span className="text-[var(--accent)] opacity-60">// </span>
                    private capital for planetary repair
                  </motion.p>
                </div>
              </Section>

            </div>
          </main>
        </div>
      </div>
    </motion.div>
  );
}
