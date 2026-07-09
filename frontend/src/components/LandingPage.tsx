import { motion, useScroll, useTransform } from 'framer-motion';
import { useState, useEffect, useRef, lazy, Suspense } from 'react';
import { formatEther } from 'viem';
import { BrandedZeros } from './ui/BrandedZeros';
import { RootLogo } from './ui/RootLogo';
import { AppBackground } from './AppBackground';
import { useProofOfReserve } from './projects/hooks/useProofOfReserve';
import { useProtocolHealth } from './projects/hooks/useProtocolHealth';

// Project 001 pilot-terrain section (WebGL + interactive map) — lazy-loaded.
const PilotTerrainSection = lazy(() => import('./pilot/PilotTerrainSection'));

interface LandingPageProps {
  onEnterApp: () => void;
  onOpenManifesto?: () => void;
  onOpenDocs?: () => void;
}

// Sun icon for light mode
function SunIcon() {
  return (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
    </svg>
  );
}

// Moon icon for dark mode
function MoonIcon() {
  return (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
    </svg>
  );
}

// Arrow icon
function ArrowRight({ className = '' }: { className?: string }) {
  return (
    <svg className={`w-4 h-4 ${className}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
    </svg>
  );
}

// Flow step component for lifecycle and other sections
function FlowStep({ num, title, desc, delay }: { num: string; title: string; desc: string; delay: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 30 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-40px' }}
      transition={{ duration: 0.6, delay }}
      className="relative group"
    >
      <div
        className="relative p-6 md:p-8 rounded-xl border border-[var(--border)] overflow-hidden h-full transition-all duration-300 hover:border-[var(--accent)]/40"
        style={{
          background: 'var(--bg-elevated)',
          boxShadow: 'var(--shadow-sm)',
        }}
      >
        {/* Large watermark number */}
        <span className="absolute -top-4 -right-2 text-[5rem] font-display font-bold text-[var(--accent)] opacity-[0.04] leading-none select-none pointer-events-none">
          {num}
        </span>

        <div className="relative z-10">
          <span className="inline-block text-[10px] font-mono tracking-[0.3em] text-[var(--accent)] uppercase mb-3">
            Step {num}
          </span>
          <h3 className="font-display text-xl text-[var(--text-primary)] mb-2 tracking-tight">{title}</h3>
          <p className="text-sm text-[var(--text-secondary)] leading-relaxed">{desc}</p>
        </div>
      </div>
    </motion.div>
  );
}

// Compact card for problem/manifesto sections
function InfoCard({ num, title, desc, delay }: { num: string; title: string; desc: string; delay: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-30px' }}
      transition={{ duration: 0.5, delay }}
    >
      <div
        className="relative p-6 rounded-xl border border-[var(--border)] overflow-hidden h-full hover:border-[var(--accent)]/30 transition-colors duration-300"
        style={{
          background: 'var(--bg-elevated)',
          boxShadow: 'var(--shadow-sm)',
        }}
      >
        <span className="text-[10px] tracking-[0.2em] text-[var(--accent)] font-mono">{num}</span>
        <h3 className="font-display text-lg text-[var(--text-primary)] mt-2 mb-2 tracking-tight">{title}</h3>
        <p className="text-sm text-[var(--text-secondary)] leading-relaxed">{desc}</p>
      </div>
    </motion.div>
  );
}

// Section header component
function SectionHeader({ label, title }: { label: string; title: React.ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      whileInView={{ opacity: 1 }}
      viewport={{ once: true }}
      className="mb-10 md:mb-12"
    >
      <div className="flex items-center gap-4 mb-6">
        <div className="w-8 h-px bg-[var(--accent)]" />
        <span className="text-xs tracking-[0.2em] text-[var(--accent)] uppercase font-mono">{label}</span>
      </div>
      <h2 className="font-display text-3xl md:text-5xl text-[var(--text-primary)] tracking-[-0.02em] leading-[1.1] max-w-xl">
        {title}
      </h2>
    </motion.div>
  );
}

export function LandingPage({ onEnterApp, onOpenManifesto, onOpenDocs }: LandingPageProps) {
  const { data: reserveData } = useProofOfReserve();
  const { report: healthReport } = useProtocolHealth();

  const [isDark, setIsDark] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('theme') === 'dark' ||
        (!localStorage.getItem('theme') && window.matchMedia('(prefers-color-scheme: dark)').matches);
    }
    return false;
  });

  const heroRef = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({
    target: heroRef,
    offset: ['start start', 'end start'],
  });
  const logoScale = useTransform(scrollYProgress, [0, 1], [1, 0.6]);
  const logoOpacity = useTransform(scrollYProgress, [0, 0.8], [1, 0]);
  const textY = useTransform(scrollYProgress, [0, 1], [0, -60]);

  useEffect(() => {
    if (isDark) {
      document.documentElement.classList.add('dark');
      localStorage.setItem('theme', 'dark');
    } else {
      document.documentElement.classList.remove('dark');
      localStorage.setItem('theme', 'light');
    }
  }, [isDark]);

  const scrollToLifecycle = () => {
    const el = document.getElementById('lifecycle');
    if (el) el.scrollIntoView({ behavior: 'smooth' });
  };

  return (
    <div className="min-h-screen bg-[var(--bg-primary)] text-[var(--text-primary)] overflow-x-hidden relative">

      {/* ═══════════════════════════════════════════════════════════════════
          BACKGROUND - matches dapp with animated roots SVG
          ═══════════════════════════════════════════════════════════════════ */}
      <AppBackground />

      {/* ═══════════════════════════════════════════════════════════════════
          HEADER
          ═══════════════════════════════════════════════════════════════════ */}
      <header className="fixed top-0 left-0 right-0 z-50 backdrop-blur-md bg-[var(--bg-primary)]/70 border-b border-[var(--border)]/30">
        <div className="flex items-center justify-between px-6 md:px-12 lg:px-16 py-5 md:py-6">
          <motion.div
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.5 }}
            className="flex items-center gap-3"
          >
            <RootLogo size={34} className="text-[var(--accent)]" />
            <span className="font-display text-2xl tracking-tight">
              <span className="text-[var(--accent)]">r<BrandedZeros />t</span>
              <span className="text-[var(--text-primary)]">.fund</span>
            </span>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, x: 10 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.5, delay: 0.1 }}
            className="flex items-center gap-5"
          >
            {onOpenDocs && (
              <button
                onClick={onOpenDocs}
                className="hidden sm:block text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors font-medium"
              >
                Docs
              </button>
            )}
            {onOpenManifesto && (
              <button
                onClick={onOpenManifesto}
                className="hidden sm:block text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors font-medium"
              >
                Manifesto
              </button>
            )}
            <a
              href="https://github.com/offGrid0xDAO/r00t.fund/"
              target="_blank"
              rel="noopener noreferrer"
              className="hidden sm:block text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors font-medium"
            >
              GitHub
            </a>
            <button
              onClick={() => setIsDark(!isDark)}
              className="p-2.5 rounded-lg bg-[var(--bg-elevated)] border border-[var(--border)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-[var(--text-muted)] transition-all duration-200"
              aria-label="Toggle theme"
            >
              {isDark ? <SunIcon /> : <MoonIcon />}
            </button>
            <button
              onClick={onEnterApp}
              className="px-5 py-2.5 bg-[var(--accent)] text-white text-sm font-medium rounded-lg hover:opacity-90 transition-opacity"
            >
              Launch App
            </button>
          </motion.div>
        </div>
      </header>

      {/* ═══════════════════════════════════════════════════════════════════
          HERO
          ═══════════════════════════════════════════════════════════════════ */}
      <section ref={heroRef} className="relative min-h-screen flex items-center justify-center px-6 md:px-12 lg:px-16 pt-24 pb-24">

        {/* Solid radial mask behind logo to hide roots */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background: 'radial-gradient(ellipse 60% 45% at 65% 42%, var(--bg-primary) 0%, var(--bg-primary) 40%, transparent 70%)',
          }}
        />

        <div className="relative w-full max-w-7xl mx-auto flex flex-col lg:flex-row items-center lg:items-center gap-8 lg:gap-16">
          {/* Text content — left side */}
          <motion.div style={{ y: textY }} className="relative z-10 text-left flex-1 order-2 lg:order-1">
            {/* Headline */}
            <motion.h1
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, delay: 1.0 }}
              className="font-display text-[clamp(2.5rem,6vw,5.5rem)] leading-[0.95] tracking-[-0.03em] mb-6"
            >
              <span className="text-[var(--text-primary)]">Fund a plot.</span>
              <br />
              <span className="text-[var(--accent)] text-glow">Grow it back.</span>
            </motion.h1>

            {/* Sub-headline */}
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.8, delay: 1.2 }}
              className="text-base md:text-lg text-[var(--text-secondary)] max-w-lg leading-relaxed mb-10"
            >
              Back a plot of real land, choose what grows on it, and watch it come back to life — every contribution traceable to the soil it heals, independently verified. Take from the casino, give back to the land.
            </motion.p>

            {/* CTAs */}
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 1.4 }}
              className="flex flex-col sm:flex-row items-start gap-4"
            >
              <button
                onClick={onEnterApp}
                className="group relative w-full sm:w-auto px-8 py-4 bg-[var(--accent)] text-white font-medium text-base rounded-xl hover:shadow-[0_0_40px_rgba(45,90,61,0.35)] dark:hover:shadow-[0_0_40px_rgba(93,168,112,0.35)] transition-all duration-300 overflow-hidden"
              >
                <span className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent -skew-x-12 opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
                <span className="relative z-10 flex items-center justify-center gap-2">
                  Back a Plot
                  <ArrowRight className="group-hover:translate-x-1 transition-transform duration-300" />
                </span>
              </button>
              <button
                onClick={scrollToLifecycle}
                className="w-full sm:w-auto px-8 py-4 bg-[var(--bg-elevated)] border border-[var(--border)] text-[var(--text-secondary)] font-medium text-base rounded-xl hover:border-[var(--accent)] hover:text-[var(--text-primary)] transition-all duration-300"
              >
                See How It Works
              </button>
            </motion.div>
          </motion.div>

          {/* Logo — right side */}
          <motion.div
            style={{ scale: logoScale, opacity: logoOpacity }}
            className="relative flex-shrink-0 order-1 lg:order-2"
          >
            {/* Glow ring behind logo */}
            <motion.div
              animate={{
                boxShadow: [
                  '0 0 60px 20px rgba(45, 90, 61, 0.08)',
                  '0 0 80px 30px rgba(45, 90, 61, 0.15)',
                  '0 0 60px 20px rgba(45, 90, 61, 0.08)',
                ],
              }}
              transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut' }}
              className="absolute inset-0 rounded-full dark:shadow-none"
              style={{
                background: 'radial-gradient(circle, rgba(45, 90, 61, 0.06) 0%, transparent 70%)',
              }}
            />
            <motion.div
              className="dark:block hidden absolute inset-0 rounded-full"
              animate={{
                boxShadow: [
                  '0 0 60px 20px rgba(93, 168, 112, 0.06)',
                  '0 0 80px 30px rgba(93, 168, 112, 0.12)',
                  '0 0 60px 20px rgba(93, 168, 112, 0.06)',
                ],
              }}
              transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut' }}
            />

            <motion.div
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 1.2, ease: [0.16, 1, 0.3, 1] }}
            >
              <RootLogo
                size="clamp(260px, 36vw, 480px)"
                className="text-[var(--accent)] relative z-10"
                animated
                textured
                glowColor="var(--accent-glow)"
              />
            </motion.div>
          </motion.div>
        </div>

        {/* Scroll indicator */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 2.5 }}
          className="absolute bottom-6 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2"
        >
          <span className="text-[9px] font-mono text-[var(--text-muted)] tracking-[0.3em] uppercase">Scroll</span>
          <motion.div
            animate={{ y: [0, 6, 0] }}
            transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
            className="w-px h-8 bg-gradient-to-b from-[var(--accent)]/60 to-transparent"
          />
        </motion.div>
      </section>

      {/* ═══════════════════════════════════════════════════════════════════
          METRICS
          ═══════════════════════════════════════════════════════════════════ */}
      <section className="relative py-10 border-y border-[var(--border)]/50">
        <div className="max-w-7xl mx-auto px-6 md:px-12 lg:px-16">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8 md:gap-12">
            {([
              { label: 'Trees Planted', value: '2,550' },
              { label: 'Hectares Restoring', value: '9' },
              { label: 'Backing Ratio', value: reserveData ? `${(reserveData.backingRatio / 100).toFixed(0)}%` : '—', live: !!reserveData },
              { label: 'Protocol Risk', value: healthReport ? ['NONE','LOW','MED','HIGH','CRIT'][healthReport.overallRiskLevel] : '—', live: !!healthReport, color: healthReport ? (healthReport.overallRiskLevel <= 1 ? 'var(--success)' : healthReport.overallRiskLevel === 2 ? 'var(--warning)' : 'var(--error)') : undefined },
            ] as { label: string; value: string; live?: boolean; color?: string }[]).map((stat, i) => (
              <motion.div
                key={stat.label}
                initial={{ opacity: 0, y: 15 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.4, delay: i * 0.08 }}
                className="text-center md:text-left"
              >
                <p className="text-3xl md:text-4xl font-display tracking-tight tabular-nums" style={{ color: stat.color || 'var(--text-primary)' }}>
                  {stat.value}
                </p>
                <span className="text-[11px] tracking-[0.15em] text-[var(--text-muted)] uppercase font-mono inline-flex items-center gap-1.5">
                  {stat.live && (
                    <span className="relative flex h-1.5 w-1.5">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[var(--success)] opacity-75" />
                      <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-[var(--success)]" />
                    </span>
                  )}
                  {stat.label}
                </span>
              </motion.div>
            ))}
          </div>
          {reserveData && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.4, delay: 0.35 }}
              className="mt-6 flex items-center justify-center md:justify-start gap-2"
            >
              <span className="relative flex h-1.5 w-1.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[var(--success)] opacity-75" />
                <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-[var(--success)]" />
              </span>
              <span className="text-xs font-mono text-[var(--text-muted)]">TVL</span>
              <span className="text-sm font-mono font-medium" style={{ color: 'var(--accent)' }}>
                {Number(formatEther(reserveData.totalTVL)).toLocaleString(undefined, { maximumFractionDigits: 4 })} ETH
              </span>
            </motion.div>
          )}
        </div>
      </section>

      {/* ═══════════════════════════════════════════════════════════════════
          THE LIFECYCLE — 5 steps
          ═══════════════════════════════════════════════════════════════════ */}
      <section id="lifecycle" className="relative py-16 md:py-20 px-6 md:px-12 lg:px-16">
        <div className="max-w-6xl mx-auto">
          <SectionHeader
            label="The Lifecycle"
            title={<>From launch <br className="hidden md:block" /><span className="text-[var(--accent)]">to verified impact</span></>}
          />

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-6">
            <FlowStep
              num="01"
              title="Launch"
              desc="Projects propose to the community with coordinates, species, targets. The community votes using ZK proofs — identity stays private."
              delay={0}
            />
            <FlowStep
              num="02"
              title="Fund"
              desc="Capital flows through ZkAMM directly to project implementers. No brokers. No intermediaries. The person planting trees receives the funds."
              delay={0.08}
            />
            <FlowStep
              num="03"
              title="Verify"
              desc="Chainlink CRE queries Sentinel-2 satellites, soil data, and AI analysis to independently confirm whether land is regenerating."
              delay={0.16}
            />
            <FlowStep
              num="04"
              title="Comply"
              desc="Chainlink ACE ensures privacy and EU MiCA compliance coexist. Institutional capital flows without sacrificing privacy."
              delay={0.24}
            />
            <FlowStep
              num="05"
              title="Trade"
              desc="Verified projects generate carbon credits backed by satellite data. Tradeable through ZkAMM with full privacy."
              delay={0.32}
            />
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════════════════════════════════════════
          THE PROBLEM
          ═══════════════════════════════════════════════════════════════════ */}
      <section className="relative py-16 md:py-20 px-6 md:px-12 lg:px-16 border-t border-[var(--border)]/50">
        <div className="max-w-6xl mx-auto">
          <SectionHeader
            label="The Problem"
            title={<>Why carbon markets <br className="hidden md:block" /><span className="text-[var(--accent)]">are broken</span></>}
          />

          <div className="grid sm:grid-cols-2 gap-4">
            <InfoCard
              num="01"
              title="The money never reaches the ground"
              desc="60-80% of climate finance consumed by intermediaries. A &euro;25 carbon credit delivers &euro;3-5 to the person who restored the land."
              delay={0}
            />
            <InfoCard
              num="02"
              title="No one checks if land recovered"
              desc="Registries rely on self-reported data. No oracle. No satellite feed. No on-chain proof."
              delay={0.08}
            />
            <InfoCard
              num="03"
              title="Privacy vs compliance deadlock"
              desc="Institutions need compliance, protocols offer privacy. Neither can serve both."
              delay={0.16}
            />
            <InfoCard
              num="04"
              title="No accountability"
              desc="Launchpads raise funds with no verification of delivery. No milestone gates. No consequences."
              delay={0.24}
            />
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════════════════════════════════════════
          PROJECT 001 — pilot terrain section + interactive plot map
          (see components/pilot/*). Terrain is rendered from fuzzed, non-cadastral
          geometry only — no real coordinates in the client bundle.
          ═══════════════════════════════════════════════════════════════════ */}
      <Suspense fallback={<div className="py-24 text-center text-xs font-mono text-[var(--text-muted)]">loading pilot site…</div>}>
        <PilotTerrainSection onEnterApp={onEnterApp} />
      </Suspense>

      {/* ═══════════════════════════════════════════════════════════════════
          CRE WORKFLOWS — 7 workflows
          ═══════════════════════════════════════════════════════════════════ */}
      <section className="relative py-16 md:py-20 px-6 md:px-12 lg:px-16 border-t border-[var(--border)]/50">
        <div className="max-w-6xl mx-auto">
          <SectionHeader
            label="CRE Workflows"
            title={<>8 Chainlink CRE Workflows<br className="hidden md:block" /><span className="text-[var(--accent)]">Independent verification</span></>}
          />

          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              { num: 'W1', name: 'Confidential Funding', desc: 'ZK-shielded capital allocation with milestone-based releases', track: 'Privacy' },
              { num: 'W2', name: 'Proof of Reserve', desc: 'On-chain reserves + carbon credit pricing as composite backing ratio', track: 'DeFi' },
              { num: 'W3', name: 'AI Validator', desc: 'Llama 3.3 70B analyzes satellite imagery for regeneration verification', track: 'AI' },
              { num: 'W4', name: 'Prediction Markets', desc: 'Environmental outcome markets settled by real satellite data', track: 'Markets' },
              { num: 'W5', name: 'Health Monitor', desc: 'Real-time protocol risk scoring with automatic circuit breakers', track: 'Risk' },
              { num: 'W6', name: 'ACE Compliance', desc: 'Anonymous sanctions screening — EU MiCA without sacrificing privacy', track: 'Privacy' },
              { num: 'W7', name: 'Pilot Site Feed', desc: 'Custom data feed publishing weekly satellite NDVI recovery for the pilot terrain', track: 'Data' },
              { num: 'W8', name: 'World ID Bridge', desc: 'Sybil-resistant governance — World ID verification on any EVM chain', track: 'Identity' },
            ].map((w, i) => (
              <motion.div
                key={w.num}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: '-30px' }}
                transition={{ duration: 0.5, delay: i * 0.06 }}
              >
                <div
                  className="relative p-6 rounded-xl border border-[var(--border)] overflow-hidden h-full hover:border-[var(--accent)]/30 transition-colors duration-300"
                  style={{ background: 'var(--bg-elevated)', boxShadow: 'var(--shadow-sm)' }}
                >
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-xs font-mono text-[var(--accent)] font-medium">{w.num}</span>
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full border border-[var(--border)] bg-[var(--bg-secondary)] text-[9px] font-mono text-[var(--text-muted)] uppercase tracking-wider">
                      {w.track}
                    </span>
                  </div>
                  <h3 className="font-display text-lg text-[var(--text-primary)] mb-2 tracking-tight">{w.name}</h3>
                  <p className="text-sm text-[var(--text-secondary)] leading-relaxed">{w.desc}</p>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════════════════════════════════════════
          VERIFICATION PIPELINE
          ═══════════════════════════════════════════════════════════════════ */}
      <section className="relative py-16 md:py-20 px-6 md:px-12 lg:px-16 border-t border-[var(--border)]/50">
        <div className="max-w-6xl mx-auto">
          <SectionHeader
            label="Verification"
            title={<>How verification <br className="hidden md:block" /><span className="text-[var(--accent)]">actually works</span></>}
          />

          {/* Pipeline steps */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-12">
            {[
              { step: 'Propose', icon: '01' },
              { step: 'Fund', icon: '02' },
              { step: 'CRE Checks', icon: '03' },
              { step: 'Verified?', icon: '04' },
              { step: 'Release', icon: '05' },
            ].map((p, i) => (
              <motion.div
                key={p.step}
                initial={{ opacity: 0, y: 15 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.4, delay: i * 0.08 }}
                className="relative"
              >
                <div
                  className="p-4 rounded-xl border border-[var(--border)] text-center h-full"
                  style={{ background: 'var(--bg-elevated)', boxShadow: 'var(--shadow-sm)' }}
                >
                  <span className="text-[10px] font-mono text-[var(--accent)] block mb-1">{p.icon}</span>
                  <span className="text-sm font-medium text-[var(--text-primary)]">{p.step}</span>
                </div>
                {/* Arrow connector */}
                {i < 4 && (
                  <div className="hidden md:flex absolute top-1/2 -right-2 transform -translate-y-1/2 z-10 text-[var(--text-muted)]">
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                    </svg>
                  </div>
                )}
              </motion.div>
            ))}
          </div>

          {/* Data sources */}
          <motion.div
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6, delay: 0.3 }}
          >
            <p className="text-[10px] text-[var(--text-muted)] mb-4 uppercase tracking-[0.3em] font-mono text-center">
              Data Sources
            </p>
            <div className="flex justify-center items-center gap-3 flex-wrap">
              {[
                'Copernicus Sentinel-2',
                'ISRIC SoilGrids',
                'Global Forest Watch',
                'Verra / Gold Standard',
                'National forest & soil registries',
              ].map((source, i) => (
                <motion.span
                  key={source}
                  initial={{ opacity: 0, y: 8 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: 0.4 + i * 0.06, duration: 0.4 }}
                  className="inline-flex items-center px-4 py-2 rounded-full border border-[var(--border)] bg-[var(--bg-elevated)] text-xs font-mono text-[var(--text-secondary)] hover:border-[var(--accent)] hover:text-[var(--accent)] transition-colors duration-200"
                >
                  {source}
                </motion.span>
              ))}
            </div>
          </motion.div>
        </div>
      </section>

      {/* ═══════════════════════════════════════════════════════════════════
          SDK — OpenClaw Agent Setup
          ═══════════════════════════════════════════════════════════════════ */}
      <section className="relative py-16 md:py-20 px-6 md:px-12 lg:px-16 border-t border-[var(--border)]/50">
        <div className="max-w-6xl mx-auto">
          <div className="grid lg:grid-cols-2 gap-12 lg:gap-16 items-center">

            {/* Left — copy */}
            <div>
              <motion.div
                initial={{ opacity: 0 }}
                whileInView={{ opacity: 1 }}
                viewport={{ once: true }}
              >
                <div className="flex items-center gap-4 mb-6">
                  <div className="w-8 h-px bg-[var(--accent)]" />
                  <span className="text-xs tracking-[0.2em] text-[var(--accent)] uppercase font-mono">OpenClaw</span>
                </div>
                <h2 className="font-display text-3xl md:text-5xl text-[var(--text-primary)] tracking-[-0.02em] leading-[1.1] mb-5">
                  Give your agent <br className="hidden md:block" />
                  <span className="text-[var(--accent)]">a dark pool.</span>
                </h2>
                <p className="text-base text-[var(--text-secondary)] leading-relaxed max-w-lg mb-8">
                  One command. Your OpenClaw agent reads the skill file, installs the SDK, and starts trading with full ZK privacy. Access Chainlink CRE verification data directly. Works with Claude, GPT, DeepSeek, Ollama — any model.
                </p>
              </motion.div>

              <motion.div
                initial={{ opacity: 0, y: 10 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: 0.15 }}
                className="space-y-5"
              >
                {[
                  { num: '1', text: 'Send the curl command to your agent' },
                  { num: '2', text: 'Agent reads the skill.md instructions' },
                  { num: '3', text: 'It installs the SDK and starts trading privately' },
                ].map((step, i) => (
                  <motion.div
                    key={step.num}
                    initial={{ opacity: 0, x: -10 }}
                    whileInView={{ opacity: 1, x: 0 }}
                    viewport={{ once: true }}
                    transition={{ delay: 0.2 + i * 0.08 }}
                    className="flex items-center gap-4"
                  >
                    <span className="flex items-center justify-center w-7 h-7 rounded-full border border-[var(--accent)]/30 text-[var(--accent)] text-xs font-mono shrink-0">
                      {step.num}
                    </span>
                    <span className="text-sm text-[var(--text-primary)]">{step.text}</span>
                  </motion.div>
                ))}
              </motion.div>

              <motion.div
                initial={{ opacity: 0 }}
                whileInView={{ opacity: 1 }}
                viewport={{ once: true }}
                transition={{ delay: 0.4 }}
                className="mt-8 flex flex-wrap items-center gap-2"
              >
                {['OpenClaw', 'Claude', 'GPT-4', 'DeepSeek', 'Ollama'].map((tag) => (
                  <span
                    key={tag}
                    className="inline-flex items-center px-3 py-1 rounded-full border border-[var(--border)] bg-[var(--bg-secondary)] text-[10px] font-mono text-[var(--text-muted)]"
                  >
                    {tag}
                  </span>
                ))}
              </motion.div>
            </div>

            {/* Right — install card */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: 0.1, duration: 0.6 }}
            >
              <div
                className="rounded-xl border border-[var(--border)] overflow-hidden"
                style={{ background: 'var(--bg-elevated)', boxShadow: 'var(--shadow-sm)' }}
              >
                {/* Header */}
                <div className="px-6 pt-6 pb-4">
                  <p className="text-xs tracking-[0.15em] text-[var(--text-muted)] uppercase font-mono mb-4">install as</p>
                  <div className="flex gap-0 w-fit rounded-lg border border-[var(--border)] overflow-hidden">
                    <span className="px-4 py-2 text-sm font-medium text-[var(--text-secondary)] bg-[var(--bg-secondary)]">
                      Human
                    </span>
                    <span className="px-4 py-2 text-sm font-medium text-[var(--text-primary)] bg-[var(--bg-elevated)] border-l border-[var(--border)]">
                      Bot
                    </span>
                  </div>
                </div>

                {/* Bot instructions */}
                <div className="px-6 pb-2">
                  <p className="text-sm font-medium text-[var(--text-primary)] mb-3">If you are a bot:</p>
                </div>

                {/* Curl command */}
                <div className="mx-6 mb-4 flex items-center gap-2 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border)] px-4 py-3">
                  <code className="flex-1 text-[13px] font-mono text-[var(--text-primary)] truncate">
                    curl -s https://r00t.fund/skill.md
                  </code>
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText('curl -s https://r00t.fund/skill.md');
                    }}
                    className="shrink-0 flex items-center gap-1.5 text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15.666 3.888A2.25 2.25 0 0013.5 2.25h-3c-1.03 0-1.9.693-2.166 1.638m7.332 0c.055.194.084.4.084.612v0a.75.75 0 01-.75.75H9.75a.75.75 0 01-.75-.75v0c0-.212.03-.418.084-.612m7.332 0c.646.049 1.288.11 1.927.184 1.1.128 1.907 1.077 1.907 2.185V19.5a2.25 2.25 0 01-2.25 2.25H6.75A2.25 2.25 0 014.5 19.5V6.257c0-1.108.806-2.057 1.907-2.185a48.208 48.208 0 011.927-.184" />
                    </svg>
                    copy
                  </button>
                </div>

                {/* Steps */}
                <div className="px-6 pb-6 space-y-2">
                  <p className="text-sm text-[var(--text-secondary)]">
                    <span className="text-[var(--text-muted)] font-mono mr-2">1.</span>
                    send this command to your agent
                  </p>
                  <p className="text-sm text-[var(--text-secondary)]">
                    <span className="text-[var(--text-muted)] font-mono mr-2">2.</span>
                    they'll set up the SDK & start trading privately
                  </p>
                </div>
              </div>

              {/* SDK fallback link */}
              <div className="mt-4 flex items-center justify-between">
                <a
                  href="https://github.com/offGrid0xDAO/r00t.fund/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
                >
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z"/></svg>
                  View SDK on GitHub
                </a>
                <span className="text-xs font-mono text-[var(--text-muted)]">npm i @r00t/sdk</span>
              </div>
            </motion.div>
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════════════════════════════════════════
          MANIFESTO — Why this exists
          ═══════════════════════════════════════════════════════════════════ */}
      <section id="manifesto" className="relative py-16 md:py-20 px-6 md:px-12 lg:px-16">
        <div className="max-w-6xl mx-auto">
          {/* Large logo watermark behind the quote */}
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none overflow-hidden">
            <RootLogo
              size="clamp(300px, 50vw, 600px)"
              className="text-[var(--accent)] opacity-[0.03]"
            />
          </div>

          <div className="relative z-10">
            <motion.div
              initial={{ opacity: 0 }}
              whileInView={{ opacity: 1 }}
              viewport={{ once: true }}
              className="flex items-center gap-4 mb-12"
            >
              <div className="w-8 h-px bg-[var(--accent)]" />
              <span className="text-xs tracking-[0.2em] text-[var(--accent)] uppercase font-mono">Manifesto</span>
            </motion.div>

            <motion.blockquote
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.8 }}
              className="mb-16"
            >
              <p className="font-display text-[clamp(1.5rem,4vw,3.5rem)] leading-[1.15] tracking-[-0.02em] text-[var(--text-primary)]">
                The money should reach the ground.{' '}
                <span className="text-[var(--accent)]">The data should prove it did.</span>
              </p>
            </motion.blockquote>

            <div className="grid sm:grid-cols-2 gap-4">
              <InfoCard
                num="01"
                title="Direct funding"
                desc="Smart contracts, not middlemen. The person planting trees on burned hillside receives the capital."
                delay={0}
              />
              <InfoCard
                num="02"
                title="Satellite verification"
                desc="Chainlink CRE checks Sentinel-2 NDVI every 6 hours. No self-reporting. No trust assumptions."
                delay={0.08}
              />
              <InfoCard
                num="03"
                title="Privacy by default"
                desc="ZK proofs protect every transaction. Funders, voters, and traders stay private."
                delay={0.16}
              />
              <InfoCard
                num="04"
                title="Carbon with proof"
                desc="Credits backed by satellite data and on-chain attestations, not paperwork."
                delay={0.24}
              />
            </div>

            {onOpenManifesto && (
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.6, delay: 0.4 }}
                className="mt-10 text-center"
              >
                <button
                  onClick={onOpenManifesto}
                  className="group inline-flex items-center gap-2 px-6 py-3 border border-[var(--accent)]/40 text-[var(--accent)] font-medium text-sm rounded-xl hover:bg-[var(--accent)] hover:text-white hover:border-[var(--accent)] transition-all duration-300"
                >
                  Read Full Manifesto
                  <ArrowRight className="group-hover:translate-x-1 transition-transform" />
                </button>
              </motion.div>
            )}
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════════════════════════════════════════
          TECH STACK
          ═══════════════════════════════════════════════════════════════════ */}
      <section className="relative py-16 px-6 md:px-12 lg:px-16 border-t border-[var(--border)]/50">
        <motion.div
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          transition={{ duration: 0.8 }}
          className="max-w-4xl mx-auto text-center"
        >
          <p className="text-[10px] text-[var(--text-muted)] mb-6 uppercase tracking-[0.3em] font-mono">
            Built with
          </p>
          <div className="flex justify-center items-center gap-3 flex-wrap">
            {['Chainlink CRE', 'Solidity', 'ZK-SNARKs', 'Groth16', 'Circom', 'Copernicus Sentinel-2', 'World ID', 'Tenderly', 'Foundry', 'React', 'TypeScript', 'Ponder'].map((tech, i) => (
              <motion.span
                key={tech}
                initial={{ opacity: 0, y: 8 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.06, duration: 0.4 }}
                className="inline-flex items-center px-4 py-2 rounded-full border border-[var(--border)] bg-[var(--bg-elevated)] text-xs font-mono text-[var(--text-secondary)] hover:border-[var(--accent)] hover:text-[var(--accent)] transition-colors duration-200"
              >
                {tech}
              </motion.span>
            ))}
          </div>
        </motion.div>
      </section>

      {/* ═══════════════════════════════════════════════════════════════════
          FINAL CTA
          ═══════════════════════════════════════════════════════════════════ */}
      <section className="relative py-16 md:py-24 px-6 md:px-12 lg:px-16">
        <div className="max-w-2xl mx-auto text-center">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.8 }}
          >
            <RootLogo size={56} className="text-[var(--accent)] mx-auto mb-8 opacity-40" />
            <h2 className="font-display text-3xl md:text-5xl text-[var(--text-primary)] tracking-[-0.02em] mb-4 leading-[1.1]">
              Fund what heals.<br /><span className="text-[var(--accent)]">Watch it grow back.</span>
            </h2>
            <p className="text-[var(--text-secondary)] mb-8 max-w-md mx-auto">
              Real land. Real trees. Every contribution traceable to the soil it heals — and independently verified as it regenerates.
            </p>
            <button
              onClick={onEnterApp}
              className="group relative px-10 py-4 bg-[var(--accent)] text-white font-medium text-base rounded-xl hover:shadow-[0_0_40px_rgba(45,90,61,0.35)] dark:hover:shadow-[0_0_40px_rgba(93,168,112,0.35)] transition-all duration-300 overflow-hidden"
            >
              <span className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent -skew-x-12 opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
              <span className="relative z-10 flex items-center gap-2">
                Back a Plot
                <ArrowRight className="group-hover:translate-x-1 transition-transform duration-300" />
              </span>
            </button>
          </motion.div>
        </div>
      </section>

      {/* ═══════════════════════════════════════════════════════════════════
          FOOTER
          ═══════════════════════════════════════════════════════════════════ */}
      <footer className="relative border-t border-[var(--border)]/50">
        <div className="px-6 md:px-12 lg:px-16 py-12">
          <div className="max-w-6xl mx-auto grid md:grid-cols-12 gap-10 md:gap-8">
            {/* Left column */}
            <div className="md:col-span-6 lg:col-span-7">
              <motion.div
                initial={{ opacity: 0 }}
                whileInView={{ opacity: 1 }}
                viewport={{ once: true }}
                className="flex items-center gap-3 mb-5"
              >
                <RootLogo size={24} className="text-[var(--accent)]" />
                <span className="font-display text-2xl tracking-tight">
                  <span className="text-[var(--accent)]">r<BrandedZeros />t</span>
                  <span className="text-[var(--text-primary)]">.fund</span>
                </span>
              </motion.div>
              <motion.p
                initial={{ opacity: 0, y: 10 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: 0.1 }}
                className="font-display text-base md:text-lg italic text-[var(--text-secondary)] leading-relaxed max-w-sm"
              >
                "Take from the casino. Give back to the land."
              </motion.p>
            </div>

            {/* Right column */}
            <div className="md:col-span-6 lg:col-span-5">
              <div className="grid grid-cols-2 gap-8">
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: 0.15 }}
                >
                  <h4 className="text-[10px] tracking-[0.2em] text-[var(--text-muted)] uppercase mb-4 font-mono">Navigate</h4>
                  <nav className="space-y-2.5">
                    {onOpenDocs ? (
                      <button onClick={onOpenDocs} className="group flex items-center gap-2 text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors">
                        <span className="w-0 group-hover:w-2 h-px bg-[var(--accent)] transition-all duration-200" />
                        Docs
                      </button>
                    ) : (
                      <a href="#" className="group flex items-center gap-2 text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors">
                        <span className="w-0 group-hover:w-2 h-px bg-[var(--accent)] transition-all duration-200" />
                        Docs
                      </a>
                    )}
                    <a href="https://github.com/offGrid0xDAO/r00t.fund/" target="_blank" rel="noopener noreferrer" className="group flex items-center gap-2 text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors">
                      <span className="w-0 group-hover:w-2 h-px bg-[var(--accent)] transition-all duration-200" />
                      GitHub
                    </a>
                    {onOpenManifesto && (
                      <button onClick={onOpenManifesto} className="group flex items-center gap-2 text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors">
                        <span className="w-0 group-hover:w-2 h-px bg-[var(--accent)] transition-all duration-200" />
                        Manifesto
                      </button>
                    )}
                  </nav>
                </motion.div>

                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: 0.2 }}
                >
                  <h4 className="text-[10px] tracking-[0.2em] text-[var(--text-muted)] uppercase mb-4 font-mono">Network</h4>
                  <div className="inline-flex items-center gap-2 px-3 py-1.5 bg-[var(--bg-secondary)] border border-[var(--border)] rounded-full">
                    <span className="relative flex h-1.5 w-1.5">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[var(--success)] opacity-75" />
                      <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-[var(--success)]" />
                    </span>
                    <span className="text-xs font-medium text-[var(--text-primary)]">Sepolia</span>
                  </div>
                  <p className="mt-2 text-xs text-[var(--text-muted)]">Testnet active</p>
                </motion.div>
              </div>
            </div>
          </div>
        </div>

        {/* Bottom bar */}
        <div className="border-t border-[var(--border)]/50 px-6 md:px-12 lg:px-16 py-5">
          <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-3">
            <span className="text-xs text-[var(--text-muted)] font-mono">&copy; 2025-2026 r00t.fund</span>
            <div className="flex items-center gap-1.5 text-xs text-[var(--text-muted)]">
              <span className="w-3 h-px bg-[var(--accent)] opacity-50" />
              <span>Private launchpad for regenerative projects</span>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
