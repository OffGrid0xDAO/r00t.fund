import { useState, useCallback, useEffect, useRef, lazy, Suspense } from 'react';
import { motion, AnimatePresence, useScroll, useTransform } from 'framer-motion';
import { useAccount, useConnect, useChainId, useSwitchChain, usePublicClient } from 'wagmi';
import { SwapPanel, TokenOption } from './components/SwapPanel';
import { ShortsPanel } from './components/ShortsPanel';
import { GlowButton } from './components/ui/GlowButton';
import { BrandedZeros } from './components/ui/BrandedZeros';
import { RootLogo } from './components/ui/RootLogo';
import { ToastProvider } from './components/ui/Toast';
import { AppBackground } from './components/AppBackground';
import { usePrivateWallet } from './hooks/usePrivateWallet';
import { useWalletSession } from './hooks/useWalletSession';
import { useTradeSubscription } from './hooks/useTradeSubscription';
import { CONTRACTS, TOKEN, NETWORK } from './config';
import { fetchParcelTokens } from './components/pilot/parcelTokens';

// Deterministic synthetic address for a parcel token until its real pool exists
// post-TGE. Valid 0x + 40-hex so viem reads fail gracefully (try/catch in SwapPanel).
function parcelTokenAddress(ticker: string): string {
  const hex = Array.from(ticker.toLowerCase())
    .map(c => c.charCodeAt(0).toString(16).padStart(2, '0')).join('');
  return ('0x' + hex.padEnd(40, '0')).slice(0, 42);
}

// Lazy load heavy components for better initial load
const PortfolioPanel = lazy(() => import('./components/PortfolioPanel').then(m => ({ default: m.PortfolioPanel })));
const LandsPanel = lazy(() => import('./components/pilot/LandsPanel').then(m => ({ default: m.LandsPanel })));
const PriceChart = lazy(() => import('./components/PriceChart').then(m => ({ default: m.PriceChart })));
const ManifestoPage = lazy(() => import('./components/ManifestoPage').then(m => ({ default: m.ManifestoPage })));
const DocsPage = lazy(() => import('./components/DocsPage').then(m => ({ default: m.DocsPage })));
const LandingPage = lazy(() => import('./components/LandingPage').then(m => ({ default: m.LandingPage })));
const PlotMapTopo = lazy(() => import('./components/pilot/PlotMapTopo').then(m => ({ default: m.PlotMapTopo })));
import { ChartModal } from './components/ChartModal';

// Loading fallback — content-aware skeleton with shimmer sweep
function PanelSkeleton({ variant = 'default' }: { variant?: 'swap' | 'chart' | 'portfolio' | 'default' }) {
  const shimmerClass = "relative overflow-hidden before:absolute before:inset-0 before:bg-gradient-to-r before:from-transparent before:via-[var(--bg-elevated)]/60 before:to-transparent before:-translate-x-full before:animate-[shimmer-sweep_1.5s_ease-in-out_infinite]";

  if (variant === 'swap') {
    return (
      <div className="space-y-4 p-6">
        <div className="flex justify-between items-center">
          <div className={`h-5 w-24 bg-[var(--bg-secondary)] rounded-md ${shimmerClass}`} />
          <div className={`h-8 w-32 bg-[var(--bg-secondary)] rounded-lg ${shimmerClass}`} />
        </div>
        <div className={`h-24 bg-[var(--bg-secondary)] rounded-lg ${shimmerClass}`} />
        <div className="flex justify-center"><div className={`w-10 h-10 bg-[var(--bg-secondary)] rounded-full ${shimmerClass}`} /></div>
        <div className={`h-24 bg-[var(--bg-secondary)] rounded-lg ${shimmerClass}`} />
        <div className={`h-12 bg-[var(--bg-secondary)] rounded-lg ${shimmerClass}`} />
      </div>
    );
  }

  if (variant === 'chart') {
    return (
      <div className="space-y-3 p-6">
        <div className="flex justify-between">
          <div className={`h-4 w-20 bg-[var(--bg-secondary)] rounded ${shimmerClass}`} />
          <div className={`h-4 w-32 bg-[var(--bg-secondary)] rounded ${shimmerClass}`} />
        </div>
        <div className="h-48 relative">
          <svg className="w-full h-full text-[var(--bg-secondary)]" viewBox="0 0 400 200" preserveAspectRatio="none">
            <path d="M0 150 Q100 120 200 140 T400 100" fill="none" stroke="currentColor" strokeWidth="2" opacity="0.3" />
          </svg>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4 p-6">
      <div className={`h-6 bg-[var(--bg-secondary)] rounded-md w-1/3 ${shimmerClass}`} />
      <div className={`h-32 bg-[var(--bg-secondary)] rounded-lg ${shimmerClass}`} />
      <div className={`h-10 bg-[var(--bg-secondary)] rounded-md ${shimmerClass}`} />
    </div>
  );
}

type Tab = '_swap' | '_portfolio' | '_projects' | '_land';

const DEMO_TOKENS: TokenOption[] = [
  { address: CONTRACTS.zkAMM, name: TOKEN.name, symbol: TOKEN.symbol, isRoot: true },
];

// Animated Logo Component - Unified styling with branded zeros
function AnimatedLogo({ onClick }: { onClick: () => void }) {
  return (
    <motion.button
      onClick={onClick}
      className="relative group"
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.98 }}
    >
      <div className="relative flex items-center gap-2.5">
        <RootLogo size={30} className="text-[var(--accent-on-bg)]" />
        <div className="flex items-baseline">
          <span className="text-3xl tracking-tight text-[var(--accent-on-bg)] font-display">
            r<BrandedZeros />t
          </span>
          <span className="text-3xl text-[var(--text-primary)] font-display">
            .fund
          </span>
        </div>
      </div>
      {/* Unified underline - same in both modes */}
      <motion.div
        className="absolute -bottom-0.5 left-0 right-0 h-px origin-left"
        style={{
          background: 'var(--accent)',
          opacity: 0.6,
        }}
        initial={{ scaleX: 0 }}
        whileHover={{ scaleX: 1 }}
        transition={{ duration: 0.3, ease: 'easeOut' }}
      />
    </motion.button>
  );
}

// Navigation Tabs - Unified styling
function NavPill({
  tabs,
  activeTab,
  onChange
}: {
  tabs: { id: Tab; label: string; icon: React.ReactNode }[];
  activeTab: Tab;
  onChange: (tab: Tab) => void;
}) {
  return (
    <motion.div
      initial={{ y: 20, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ delay: 0.3, duration: 0.6, ease: 'easeOut' }}
      className="inline-flex gap-1 p-1 rounded-lg border border-[var(--border)]"
      style={{
        background: 'var(--bg-secondary)',
      }}
    >
      {tabs.map((tab) => (
        <motion.button
          key={tab.id}
          onClick={() => onChange(tab.id)}
          className={`relative px-5 py-2.5 rounded-md text-sm font-medium transition-colors duration-200 flex items-center gap-2 ${activeTab === tab.id
            ? 'text-[var(--accent-ink)]'
            : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
            }`}
          whileTap={{ scale: 0.97 }}
        >
          {activeTab === tab.id && (
            <motion.div
              layoutId="activeTab"
              className="absolute inset-0 rounded-md bg-[var(--accent)]"
              transition={{ type: 'spring', stiffness: 500, damping: 35 }}
            />
          )}
          <span className="relative z-10 opacity-80">{tab.icon}</span>
          <span className="relative z-10 font-medium">{tab.label}</span>
        </motion.button>
      ))}
    </motion.div>
  );
}


// Wallet Button - Unified styling
function WalletButton({
  address,
  onDisconnect,
}: {
  address: string;
  onDisconnect: () => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setIsOpen(false);
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  return (
    <div ref={ref} className="relative">
      <motion.button
        onClick={() => setIsOpen(!isOpen)}
        whileHover={{ scale: 1.02 }}
        whileTap={{ scale: 0.98 }}
        className="flex items-center gap-3 px-4 py-2.5 rounded-lg border border-[var(--border)] transition-all duration-200 hover:border-[var(--accent)]"
        style={{ background: 'var(--bg-elevated)' }}
      >
        <div className="relative">
          <div className="w-3 h-3 rounded-full bg-[var(--success)]" />
        </div>
        <span className="font-mono text-sm text-[var(--text-primary)]">
          {address.slice(0, 6)}...{address.slice(-4)}
        </span>
        <motion.svg
          animate={{ rotate: isOpen ? 180 : 0 }}
          className="w-4 h-4 text-[var(--text-muted)]"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </motion.svg>
      </motion.button>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: 10, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.95 }}
            className="absolute right-0 top-full mt-2 p-2 rounded-lg border border-[var(--border)] min-w-[200px]"
            style={{ background: 'var(--bg-elevated)', boxShadow: 'var(--shadow-md)' }}
          >
            <motion.button
              onClick={() => { onDisconnect(); setIsOpen(false); }}
              whileHover={{ backgroundColor: 'rgba(166, 61, 47, 0.1)' }}
              className="w-full px-4 py-3 rounded-md text-left font-mono text-sm text-[var(--error)] flex items-center gap-2 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
              </svg>
              disconnect()
            </motion.button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// Trading Card - Unified styling
function TradingCard({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 30 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: 'easeOut' }}
      className={`relative ${className}`}
    >
      <div
        className="relative p-6 rounded-lg border border-[var(--border)] overflow-hidden"
        style={{
          background: 'var(--bg-elevated)',
          boxShadow: 'var(--shadow-md)',
        }}
      >
        {children}
      </div>
    </motion.div>
  );
}

function App() {
  const [activeTab, setActiveTab] = useState<Tab>('_swap');
  const [swapMode, setSwapMode] = useState<'trade' | 'short'>('trade');
  const [showManifesto, setShowManifesto] = useState(false);
  const [showDocs, setShowDocs] = useState(false);
  const [showLanding, setShowLanding] = useState(() => {
    // Check if user has visited before
    if (typeof window !== 'undefined') {
      return !localStorage.getItem('hasVisited');
    }
    return true;
  });
  const [showChartModal, setShowChartModal] = useState(false);
  const [heroCollapsed, setHeroCollapsed] = useState(false);

  // Subscribe to on-chain trade events via WebSocket for instant chart updates
  useTradeSubscription();

  // Auto-collapse hero after initial view
  useEffect(() => {
    const timer = setTimeout(() => setHeroCollapsed(true), 3000);
    return () => clearTimeout(timer);
  }, []);
  const [isDark, setIsDark] = useState(() => {
    if (typeof window !== 'undefined') {
      // Dark is the baseline on entry — only light if the visitor picked it before.
      return localStorage.getItem('theme') !== 'light';
    }
    return true;
  });

  const { address, isConnected } = useAccount();
  const { connect, connectors } = useConnect();
  const chainId = useChainId();
  const { switchChain } = useSwitchChain();

  // Centralized wallet session management (viewing key lifecycle)
  const session = useWalletSession();

  const [selectedToken, setSelectedToken] = useState<string>(CONTRACTS.zkAMM);
  const [availableTokens, setAvailableTokens] = useState<TokenOption[]>(DEMO_TOKENS);
  const [portfolioInitialTab] = useState<'overview' | 'transfer' | 'withdraw' | undefined>(undefined);

  const handleEnterApp = useCallback(() => {
    localStorage.setItem('hasVisited', 'true');
    setShowLanding(false);
  }, []);

  const handleLiveTokensDiscovered = useCallback((tokens: { address: string; name: string; symbol: string }[]) => {
    setAvailableTokens(prev => {
      let updated = prev;
      for (const token of tokens) {
        if (!updated.find(t => t.address === token.address)) {
          updated = [...updated, { address: token.address, name: token.name, symbol: token.symbol, isRoot: false }];
        }
      }
      return updated;
    });
  }, []);

  // Fetch live project tokens from launchpad on mount (independent of which tab is active)
  const publicClient = usePublicClient();
  useEffect(() => {
    if (!publicClient || CONTRACTS.launchpad === '0x...') return;
    const launchpadAddr = CONTRACTS.launchpad as `0x${string}`;
    const abi = [
      { name: 'proposalCount', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
      { name: 'getProposal', type: 'function', stateMutability: 'view', inputs: [{ name: 'proposalId', type: 'uint256' }], outputs: [{ type: 'tuple', components: [{ name: 'creator', type: 'address' },{ name: 'pledgedR00t', type: 'uint256' },{ name: 'name', type: 'string' },{ name: 'symbol', type: 'string' },{ name: 'metadataHash', type: 'bytes32' },{ name: 'totalSupply', type: 'uint256' },{ name: 'feeBps', type: 'uint256' },{ name: 'deployerBps', type: 'uint256' },{ name: 'votesFor', type: 'uint256' },{ name: 'votesAgainst', type: 'uint256' },{ name: 'votingEnds', type: 'uint256' },{ name: 'status', type: 'uint8' },{ name: 'ammAddress', type: 'address' },{ name: 'tokenAddress', type: 'address' },{ name: 'createdAt', type: 'uint256' }] }] },
    ] as const;

    (async () => {
      try {
        const count = await publicClient.readContract({ address: launchpadAddr, abi, functionName: 'proposalCount' });
        const proposals = await Promise.all(
          Array.from({ length: Number(count) }, (_, i) =>
            publicClient.readContract({ address: launchpadAddr, abi, functionName: 'getProposal', args: [BigInt(i)] })
          )
        );
        const liveTokens = proposals
          .filter(p => p.ammAddress && p.ammAddress !== '0x0000000000000000000000000000000000000000')
          .map(p => ({ address: p.ammAddress, name: p.name, symbol: p.symbol }));
        if (liveTokens.length > 0) handleLiveTokensDiscovered(liveTokens);
      } catch (err) {
        console.error('[App] Failed to fetch live project tokens:', err);
      }
    })();
  }, [publicClient, handleLiveTokensDiscovered]);

  // Add live (tradable) parcel tokens to the swap token list. Pledging/launching
  // parcels are NOT tradable yet, so they're excluded here (see LandsPanel).
  useEffect(() => {
    let cancelled = false;
    fetchParcelTokens().then(tokens => {
      if (cancelled) return;
      const live = tokens.filter(t => t.tradable).map(t => ({
        address: parcelTokenAddress(t.ticker),
        name: `${t.emoji} ${t.name}`,
        symbol: t.ticker,
        isRoot: false,
      }));
      if (live.length) {
        setAvailableTokens(prev => {
          const seen = new Set(prev.map(t => t.address));
          const add = live.filter(t => !seen.has(t.address));
          return add.length ? [...prev, ...add] : prev;
        });
      }
    }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const { balance, commitments, storeCommitment, spendCommitment, removeCommitment, fetchAllOnChainCommitments, resetWallet, scan } = usePrivateWallet(CONTRACTS.zkAMM, CONTRACTS.zkAMMPair, session.viewingKey);
  const expectedChainId = NETWORK.chainId;
  const isWrongNetwork = isConnected && chainId !== expectedChainId;

  // Scroll animations
  const { scrollY } = useScroll();
  const headerOpacity = useTransform(scrollY, [0, 100], [1, 0.95]);

  useEffect(() => {
    if (isDark) {
      document.documentElement.classList.add('dark');
      localStorage.setItem('theme', 'dark');
    } else {
      document.documentElement.classList.remove('dark');
      localStorage.setItem('theme', 'light');
    }
  }, [isDark]);

  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    {
      id: '_swap',
      label: 'swap()',
      icon: <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" /></svg>
    },
    {
      id: '_portfolio',
      label: '_portfolio',
      icon: <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" /></svg>
    },
    {
      id: '_projects',
      label: '_tokens',
      icon: <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
    },
    {
      id: '_land',
      label: '_land',
      icon: <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" /></svg>
    },
  ];

  // NOTE: Lock screen removed from blocking the main UI
  // Password is now only requested when accessing Portfolio (private operations)
  // Users can browse swap and projects without unlocking

  // Show landing page for first-time visitors
  if (showLanding) {
    return (
      <>
        <Suspense fallback={<div className="min-h-screen bg-[var(--bg-primary)]" />}>
          <LandingPage onEnterApp={handleEnterApp} onOpenManifesto={() => setShowManifesto(true)} onOpenDocs={() => setShowDocs(true)} />
        </Suspense>
        {showManifesto && (
          <Suspense fallback={null}>
            <ManifestoPage onClose={() => setShowManifesto(false)} />
          </Suspense>
        )}
        {showDocs && (
          <Suspense fallback={null}>
            <DocsPage onClose={() => setShowDocs(false)} />
          </Suspense>
        )}
      </>
    );
  }

  return (
    <ToastProvider>
    <div className="min-h-screen bg-[var(--bg-primary)] text-[var(--text-primary)] overflow-x-hidden">
      {/* Background with animated root SVG */}
      <AppBackground />

      {/* Header */}
      <motion.header
        style={{ opacity: headerOpacity }}
        className="fixed top-0 left-0 right-0 z-50 px-6 py-4 backdrop-blur-md bg-[var(--bg-primary)]/80"
      >
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <AnimatedLogo onClick={() => setShowLanding(true)} />

          <div className="flex items-center gap-4">
            {/* Docs button */}
            <motion.button
              onClick={() => setShowDocs(true)}
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              className="px-3 py-2 rounded-md border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--accent-on-bg)] hover:border-[var(--accent)] transition-colors font-mono text-xs"
              style={{ background: 'var(--bg-elevated)' }}
            >
              docs
            </motion.button>

            {/* Manifesto button */}
            <motion.button
              onClick={() => setShowManifesto(true)}
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              className="px-3 py-2 rounded-md border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--accent-on-bg)] hover:border-[var(--accent)] transition-colors font-mono text-xs"
              style={{ background: 'var(--bg-elevated)' }}
            >
              manifesto
            </motion.button>

            {/* Theme toggle */}
            <motion.button
              onClick={() => setIsDark(!isDark)}
              whileHover={{ scale: 1.1, rotate: 15 }}
              whileTap={{ scale: 0.9 }}
              className="p-2.5 rounded-md border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
              style={{ background: 'var(--bg-elevated)' }}
            >
              {isDark ? (
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
                </svg>
              ) : (
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
                </svg>
              )}
            </motion.button>

            {isConnected && address ? (
              <WalletButton
                address={address}
                onDisconnect={session.disconnect}
              />
            ) : (
              <GlowButton onClick={() => connect({ connector: connectors[0] })} variant="primary">
                <span className="flex items-center gap-2">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                  connect()
                </span>
              </GlowButton>
            )}
          </div>
        </div>
      </motion.header>

      {/* Main Content */}
      <main className="relative z-10 pt-32 pb-20 px-4">
        <div className="max-w-6xl mx-auto">
          {/* Hero Section — Collapses after initial view */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, ease: 'easeOut' }}
            className="text-center"
            layout
          >
            <AnimatePresence>
              {!heroCollapsed && (
                <motion.div
                  initial={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.5, ease: 'easeInOut' }}
                  className="overflow-hidden"
                >
                  <motion.p
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: 0.2 }}
                    className="text-xs uppercase tracking-[0.25em] text-[var(--text-muted)] mb-6 font-mono"
                  >
                    // private launchpad for regenerative projects
                  </motion.p>

                  <motion.h1
                    initial={{ opacity: 0, y: 15 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.3, duration: 0.6 }}
                    className="text-5xl md:text-6xl mb-4 text-[var(--text-primary)] font-display font-medium leading-tight"
                  >
                    Fund what heals.
                    <br />
                    <span className="text-[var(--accent-on-bg)]">Leave no trace.</span>
                  </motion.h1>

                  <motion.p
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: 0.5 }}
                    className="text-base text-[var(--text-secondary)] mb-10 max-w-lg mx-auto"
                  >
                    Private launchpad for regenerative projects — verified by Chainlink.
                  </motion.p>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Compact tagline — shows when hero collapses */}
            <AnimatePresence>
              {heroCollapsed && (
                <motion.p
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.2, duration: 0.4 }}
                  className="text-xs font-mono text-[var(--text-muted)] mb-4 hover-glitch cursor-default"
                  onClick={() => setHeroCollapsed(false)}
                >
                  <span className="text-[var(--accent-on-bg)] opacity-60">// </span>
                  private launchpad for regenerative projects
                </motion.p>
              )}
            </AnimatePresence>

            {/* Navigation Pills — always visible */}
            <div className={`flex justify-center ${heroCollapsed ? 'mb-8' : 'mb-16'}`}>
              <NavPill tabs={tabs} activeTab={activeTab} onChange={setActiveTab} />
            </div>
          </motion.div>

          {/* Wrong Network Warning */}
          <AnimatePresence>
            {isWrongNetwork && (
              <motion.div
                initial={{ opacity: 0, y: -20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                className="max-w-2xl mx-auto mb-8"
              >
                <div
                  className="p-4 rounded-lg border border-[var(--warning)] flex items-center justify-between"
                  style={{ background: 'rgba(184, 134, 11, 0.1)' }}
                >
                  <div className="flex items-center gap-3">
                    <div className="w-3 h-3 rounded-full bg-[var(--warning)] animate-pulse" />
                    <span className="text-sm text-[var(--warning)]">Wrong network — switch to {NETWORK.name}</span>
                  </div>
                  <GlowButton
                    onClick={() => switchChain({ chainId: expectedChainId })}
                    variant="secondary"
                    size="sm"
                  >
                    switch()
                  </GlowButton>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Main Trading Interface */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
            {/* Left Sidebar - Price Chart */}
            <motion.div
              initial={{ opacity: 0, x: -40 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.4, duration: 0.6 }}
              className="lg:col-span-4"
            >
              <TradingCard>
                <Suspense fallback={<PanelSkeleton variant="chart" />}>
                  <PriceChart
                    zkAMMAddress={CONTRACTS.zkAMM}
                    onExpand={() => setShowChartModal(true)}
                  />
                </Suspense>
              </TradingCard>
            </motion.div>

            {/* Main Panel */}
            <div className="lg:col-span-8">
              <TradingCard>
                <AnimatePresence mode="wait">
                  <motion.div
                    key={activeTab}
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -20 }}
                    transition={{ duration: 0.3 }}
                  >
                    {activeTab === '_swap' && (
                      <div className="space-y-4">
                        {/* Trade/Short Mode Toggle */}
                        <motion.div
                          initial={{ opacity: 0, y: -10 }}
                          animate={{ opacity: 1, y: 0 }}
                          className="flex justify-center"
                        >
                          <div
                            className="inline-flex gap-1 p-1 rounded-lg border border-[var(--border)]"
                            style={{ background: 'var(--bg-secondary)' }}
                          >
                            <motion.button
                              onClick={() => setSwapMode('trade')}
                              className={`relative px-5 py-2 rounded-md text-sm font-medium transition-colors ${
                                swapMode === 'trade' ? 'text-[var(--accent-ink)]' : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                              }`}
                              whileTap={{ scale: 0.97 }}
                            >
                              {swapMode === 'trade' && (
                                <motion.div
                                  layoutId="swapModeTab"
                                  className="absolute inset-0 rounded-md bg-[var(--accent)]"
                                  transition={{ type: 'spring', stiffness: 500, damping: 35 }}
                                />
                              )}
                              <span className="relative z-10 flex items-center gap-1.5">
                                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
                                </svg>
                                trade
                              </span>
                            </motion.button>
                            <motion.button
                              onClick={() => setSwapMode('short')}
                              className={`relative px-5 py-2 rounded-md text-sm font-medium transition-colors ${
                                swapMode === 'short' ? 'text-white' : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                              }`}
                              whileTap={{ scale: 0.97 }}
                            >
                              {swapMode === 'short' && (
                                <motion.div
                                  layoutId="swapModeTab"
                                  className="absolute inset-0 rounded-md bg-[var(--error)]"
                                  transition={{ type: 'spring', stiffness: 500, damping: 35 }}
                                />
                              )}
                              <span className="relative z-10 flex items-center gap-1.5">
                                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 17h8m0 0V9m0 8l-8-8-4 4-6-6" />
                                </svg>
                                short
                              </span>
                            </motion.button>
                          </div>
                        </motion.div>

                        {/* Conditionally render Trade or Short panel */}
                        <AnimatePresence mode="wait">
                          {swapMode === 'trade' ? (
                            <motion.div
                              key="trade"
                              initial={{ opacity: 0, x: -20 }}
                              animate={{ opacity: 1, x: 0 }}
                              exit={{ opacity: 0, x: 20 }}
                              transition={{ duration: 0.2 }}
                            >
                              <SwapPanel
                                zkAMMAddress={CONTRACTS.zkAMM}
                                viewingKey={session.viewingKey}
                                balance={balance}
                                commitments={commitments}
                                availableTokens={availableTokens}
                                selectedToken={selectedToken}
                                onTokenChange={setSelectedToken}
                                onBuySuccess={storeCommitment}
                                onSellSuccess={spendCommitment}
                                removeCommitment={removeCommitment}
                                fetchAllOnChainCommitments={fetchAllOnChainCommitments}
                                session={session}
                                resetWallet={resetWallet}
                                scan={scan}
                              />
                            </motion.div>
                          ) : (
                            <motion.div
                              key="short"
                              initial={{ opacity: 0, x: 20 }}
                              animate={{ opacity: 1, x: 0 }}
                              exit={{ opacity: 0, x: -20 }}
                              transition={{ duration: 0.2 }}
                            >
                              <ShortsPanel />
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </div>
                    )}
                    {activeTab === '_portfolio' && (
                      <Suspense fallback={<PanelSkeleton />}>
                        <PortfolioPanel
                          zkAMMAddress={CONTRACTS.zkAMM}
                          pairAddress={CONTRACTS.zkAMMPair}
                          session={session}
                          balance={balance}
                          initialTab={portfolioInitialTab}
                        />
                      </Suspense>
                    )}
                    {activeTab === '_projects' && (
                      <Suspense fallback={<PanelSkeleton />}>
                        <LandsPanel onOpenMap={() => setActiveTab('_land')} />
                      </Suspense>
                    )}
                    {activeTab === '_land' && (
                      <div className="space-y-4">
                        <div className="flex items-center gap-3">
                          <span className="text-xs tracking-[0.2em] text-[var(--accent-on-bg)] uppercase font-mono">Pilot Project · Land Map</span>
                          <span className="text-[10px] font-mono text-[var(--text-muted)]">top-down · fund a plot or infrastructure</span>
                        </div>
                        <div className="rounded-xl border border-[var(--border)] overflow-hidden" style={{ background: 'var(--bg-secondary)' }}>
                          <Suspense fallback={<PanelSkeleton />}>
                            <PlotMapTopo />
                          </Suspense>
                        </div>
                        <p className="text-[10px] font-mono text-[var(--text-muted)] text-center">Fuzzed, non-cadastral geometry — indicative zones, not a legal subdivision. Patronage only — no revenue share.</p>
                      </div>
                    )}
                  </motion.div>
                </AnimatePresence>
              </TradingCard>

              {/* Status Notice */}
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.8 }}
                className="mt-6 text-center"
              >
                <p
                  className="inline-flex items-center gap-3 text-sm text-[var(--text-muted)] px-5 py-2.5 rounded-md border border-[var(--border)]"
                  style={{ background: 'var(--bg-secondary)' }}
                >
                  <span className="w-2 h-2 rounded-full bg-[var(--success)] animate-pulse" />
                  <span className="font-mono text-xs">
                    <span className="text-[var(--accent-on-bg)]">ACTIVE</span>
                    <span className="opacity-40 mx-2">·</span>
                    <span>ZK proofs + Chainlink CRE</span>
                  </span>
                </p>
              </motion.div>
            </div>
          </div>
        </div>
      </main>

      {/* Footer */}
      <motion.footer
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.8 }}
        className="relative z-10 px-6 py-12 border-t border-[var(--border)]"
      >
        <div className="max-w-6xl mx-auto flex flex-col md:flex-row items-center justify-between gap-6">
          <div className="flex items-center gap-4">
            <span
              className="flex items-center gap-2 text-lg text-[var(--accent-on-bg)] cursor-pointer hover:opacity-70 transition-opacity font-display"
              onClick={() => setShowLanding(true)}
            >
              <RootLogo size={22} className="text-[var(--accent-on-bg)]" />
              r<BrandedZeros />t<span className="text-[var(--text-primary)]">.fund</span>
            </span>
            <span className="text-[var(--border)] opacity-50">|</span>
            <span className="text-xs text-[var(--text-muted)] tracking-wide">
              Private Launchpad · Verified by Chainlink
            </span>
          </div>

          <div className="flex items-center gap-6 text-xs text-[var(--text-muted)]">
            <a
              href="https://github.com/offGrid0xDAO/r00t.fund/"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-[var(--text-primary)] transition-colors flex items-center gap-1.5"
            >
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path fillRule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" clipRule="evenodd" /></svg>
              GitHub
            </a>
            <a
              href="https://x.com/r00tdotfund"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="r00t.fund on X"
              className="hover:text-[var(--text-primary)] transition-colors flex items-center gap-1.5"
            >
              <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" /></svg>
              X
            </a>
            <span className="flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-[var(--success)] animate-pulse" />
              {NETWORK.name}
            </span>
          </div>
        </div>
      </motion.footer>

      {/* Manifesto Page */}
      <AnimatePresence>
        {showManifesto && (
          <Suspense fallback={<div className="fixed inset-0 bg-[var(--bg-primary)] flex items-center justify-center"><PanelSkeleton /></div>}>
            <ManifestoPage onClose={() => setShowManifesto(false)} />
          </Suspense>
        )}
      </AnimatePresence>

      {/* Docs Page */}
      <AnimatePresence>
        {showDocs && (
          <Suspense fallback={<div className="fixed inset-0 bg-[var(--bg-primary)] flex items-center justify-center"><PanelSkeleton /></div>}>
            <DocsPage onClose={() => setShowDocs(false)} />
          </Suspense>
        )}
      </AnimatePresence>

      {/* Fullscreen Chart Modal */}
      <ChartModal
        isOpen={showChartModal}
        onClose={() => setShowChartModal(false)}
        title="market_analytics"
      >
        <Suspense fallback={<PanelSkeleton />}>
          <PriceChart zkAMMAddress={CONTRACTS.zkAMM} isExpanded={true} />
        </Suspense>
      </ChartModal>
    </div>
    </ToastProvider>
  );
}

export default App;
