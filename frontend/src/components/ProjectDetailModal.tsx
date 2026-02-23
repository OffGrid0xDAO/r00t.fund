import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { usePublicClient } from 'wagmi';
import { formatUnits, parseEther } from 'viem';
import { motion, AnimatePresence } from 'framer-motion';
import { GlowButton } from './ui/GlowButton';
import { DataFeedGauge } from './projects/live/DataFeedGauge';
import { NdviMiniChart } from './projects/live/NdviMiniChart';
import { SpeciesBreakdown } from './projects/live/SpeciesBreakdown';
import { usePredictionMarket } from './projects/hooks/usePredictionMarket';
import { getExplorerAddressUrl } from '../config';
import type {
  CreDataFeedReport,
  ProjectSummary,
  CreWorkflowStatus,
  ProposalMetadata,
  MilestoneNode,
  PredictionMarket as PredictionMarketType,
} from './projects/types';

// === Interfaces ===

interface ProjectDetailModalProps {
  project: {
    name: string;
    symbol: string;
    ammAddress: string;
    totalSupply?: bigint;
    feeBps?: number;
    metadataHash?: string;
  };
  onClose: () => void;
  onTrade: (ammAddress: string) => void;
  creReport?: CreDataFeedReport | null;
  creSummary?: ProjectSummary | null;
  creWorkflowStatus?: CreWorkflowStatus;
}

interface PricePoint {
  timestamp: number;
  price: number;
  blockNumber: number;
}

// === Constants ===

const RISK_LABELS = ['NONE', 'LOW', 'MED', 'HIGH', 'CRIT'] as const;
const RISK_COLORS = ['var(--text-muted)', 'var(--success)', 'var(--warning)', 'var(--error)', 'var(--error)'] as const;

const ZKAMM_ABI = [
  { name: 'ethReserve', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { name: 'tokenReserve', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
] as const;

const PHASE_ACCENTS = ['#3b82f6', '#10b981', '#f59e0b', '#059669', '#6366f1', '#0d9488'];

const IMPL_PHASES = [
  { title: 'Satellite Assessment', subtitle: 'Sentinel-2 dNBR Analysis', desc: 'High-resolution multispectral imagery mapping burn severity and baseline vegetation across the project area.', status: 'completed' as const, prediction: 'NDVI baseline established above 0.3' },
  { title: 'Species Selection', subtitle: 'Native Biodiversity Planning', desc: 'Climate-resilient native species selected based on CO2 sequestration rates and survival modeling.', status: 'completed' as const, prediction: 'Species survival rate exceeds 75%' },
  { title: 'Seedling Cultivation', subtitle: 'Nursery Propagation', desc: 'Controlled nursery environment for seed germination and hardening at 800-1500m elevation.', status: 'completed' as const, prediction: '1000+ seedlings pass hardening' },
  { title: 'Field Deployment', subtitle: 'GPS-Tagged Planting', desc: 'Strategic planting across fire-damaged zones with GPS tagging and soil amendment.', status: 'active' as const, prediction: '500+ trees survive 6 months' },
  { title: 'IoT Monitoring Grid', subtitle: 'Sensor + Drone Network', desc: 'Soil moisture sensors, weather stations, and autonomous drone corridors deployed.', status: 'active' as const, prediction: 'Sensor uptime exceeds 95%' },
  { title: 'Carbon Verification', subtitle: 'On-Chain Certification', desc: 'tCO2/year measurements validated through Chainlink CRE and proof-of-reserve.', status: 'pending' as const, prediction: '50 tCO2/yr certified on-chain' },
];

// Compact oracle badge definitions — mirrors LiveProjectCard pattern
const ORACLE_BADGES: { key: keyof CreWorkflowStatus; label: string; metricFn: (s: CreWorkflowStatus, r?: CreDataFeedReport | null) => string | null }[] = [
  { key: 'serraEstrela', label: 'W7:NDVI', metricFn: (_s, r) => r ? r.ndviCurrent.toFixed(1) : null },
  { key: 'proofOfReserve', label: 'W2:PoR', metricFn: (s) => s.proofOfReserve.active ? `${(s.proofOfReserve.backingRatio / 100).toFixed(0)}%` : null },
  { key: 'aiOrchestrator', label: 'W3:AI', metricFn: (s) => s.aiOrchestrator.active ? (RISK_LABELS[s.aiOrchestrator.riskLevel] || '?') : null },
  { key: 'protocolHealth', label: 'W5:HEALTH', metricFn: (s) => s.protocolHealth.active ? (RISK_LABELS[s.protocolHealth.riskLevel] || '?') : null },
  { key: 'policyEngine', label: 'W6:KYC', metricFn: (s) => s.policyEngine.active ? `${s.policyEngine.totalAttestations}` : null },
  { key: 'confidentialFunding', label: 'W1:VAULT', metricFn: (s) => s.confidentialFunding.active ? `${s.confidentialFunding.verifiedProposals}` : null },
  { key: 'predictionMarket', label: 'W4:BET', metricFn: (s) => s.predictionMarket.active ? `${s.predictionMarket.openMarkets}` : null },
];

// === Helpers ===

function getStoredMetadata(metadataHash?: string): ProposalMetadata | null {
  if (!metadataHash) return null;
  try {
    const raw = localStorage.getItem(`r00t_metadata_${metadataHash}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed.version === 2) return parsed;
    return null;
  } catch {
    return null;
  }
}

function formatNumber(num: number, decimals = 2) {
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(decimals)}M`;
  if (num >= 1_000) return `${(num / 1_000).toFixed(decimals)}K`;
  return num.toFixed(decimals);
}

function getStatusColor(status: string): string {
  switch (status) {
    case 'completed': return 'var(--success)';
    case 'active': return 'var(--accent)';
    case 'failed': return 'var(--error)';
    default: return 'var(--text-muted)';
  }
}

// === Main Component ===

export function ProjectDetailModal({
  project,
  onClose,
  onTrade,
  creReport,
  creSummary,
  creWorkflowStatus,
}: ProjectDetailModalProps) {
  const publicClient = usePublicClient();
  const [ethReserve, setEthReserve] = useState<bigint>(0n);
  const [tokenReserve, setTokenReserve] = useState<bigint>(0n);
  const [isLoading, setIsLoading] = useState(true);
  const [priceHistory, setPriceHistory] = useState<PricePoint[]>([]);
  const [activePhase, setActivePhase] = useState(0);
  const carouselRef = useRef<HTMLDivElement>(null);

  // Prediction market
  const { getMarket, buyShares, isLoading: isBetting, error: betError } = usePredictionMarket();
  const [expandedBet, setExpandedBet] = useState<number | null>(null);
  const [betAmount, setBetAmount] = useState('0.01');
  const [markets, setMarkets] = useState<Map<number, PredictionMarketType>>(new Map());

  const metadata = useMemo(() => getStoredMetadata(project.metadataHash), [project.metadataHash]);

  // Fetch reserves
  useEffect(() => {
    if (!publicClient || project.ammAddress === '0x...') {
      setEthReserve(10n * 10n ** 18n);
      setTokenReserve(10000000n * 10n ** 18n);
      setIsLoading(false);
      const points: PricePoint[] = [];
      let price = 1000000;
      for (let i = 0; i < 30; i++) {
        price = Math.max(800000, Math.min(1200000, price + (Math.random() - 0.45) * 50000));
        points.push({ timestamp: Date.now() - (30 - i) * 3600000, price, blockNumber: 1000 + i });
      }
      setPriceHistory(points);
      return;
    }
    const fetchData = async () => {
      try {
        const [eth, token] = await Promise.all([
          publicClient.readContract({ address: project.ammAddress as `0x${string}`, abi: ZKAMM_ABI, functionName: 'ethReserve' }),
          publicClient.readContract({ address: project.ammAddress as `0x${string}`, abi: ZKAMM_ABI, functionName: 'tokenReserve' }),
        ]);
        setEthReserve(eth);
        setTokenReserve(token);
        const cp = Number(token) / Number(eth);
        const points: PricePoint[] = [];
        let price = cp * 0.9;
        for (let i = 0; i < 30; i++) {
          price = price + (cp - price) * 0.1 + (Math.random() - 0.5) * cp * 0.02;
          points.push({ timestamp: Date.now() - (30 - i) * 3600000, price, blockNumber: 1000 + i });
        }
        setPriceHistory(points);
      } catch (err) {
        console.error('Failed to fetch project data:', err);
      } finally {
        setIsLoading(false);
      }
    };
    fetchData();
  }, [publicClient, project.ammAddress]);

  // Auto-advance carousel
  useEffect(() => {
    const interval = setInterval(() => {
      setActivePhase(prev => (prev + 1) % IMPL_PHASES.length);
    }, 5000);
    return () => clearInterval(interval);
  }, []);

  const scrollToPhase = useCallback((idx: number) => {
    setActivePhase(idx);
    if (carouselRef.current?.children[idx]) {
      (carouselRef.current.children[idx] as HTMLElement).scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
    }
  }, []);

  // Prediction market handlers
  const handlePredict = useCallback(async (phaseIdx: number) => {
    if (expandedBet === phaseIdx) { setExpandedBet(null); return; }
    setExpandedBet(phaseIdx);
    if (!markets.has(phaseIdx)) {
      const market = await getMarket(phaseIdx);
      if (market) setMarkets(prev => new Map(prev).set(phaseIdx, market));
    }
  }, [expandedBet, markets, getMarket]);

  const handleBet = useCallback(async (phaseIdx: number, isPositive: boolean) => {
    try {
      const amount = parseEther(betAmount);
      await buyShares(phaseIdx, isPositive, amount);
      const market = await getMarket(phaseIdx);
      if (market) setMarkets(prev => new Map(prev).set(phaseIdx, market));
    } catch { /* error handled by hook */ }
  }, [betAmount, buyShares, getMarket]);

  // NDVI history
  const ndviHistory = useMemo(() => {
    if (!creReport) return [];
    const base = creReport.ndviPreFire > 0 ? creReport.ndviPreFire : 0.6;
    const current = creReport.ndviCurrent;
    return Array.from({ length: 12 }, (_, i) => {
      const t = i / 11;
      return Math.max(0, Math.min(1, base * 0.3 + (current - base * 0.3) * Math.pow(t, 0.6) + (Math.random() - 0.5) * 0.02));
    });
  }, [creReport]);

  // CRE milestones
  const milestones: MilestoneNode[] = useMemo(() => {
    const ws = creWorkflowStatus;
    return [
      { id: 'w8', workflow: 'W8', label: 'World ID Verification', description: 'Sybil-resistant identity proof via Worldcoin', status: 'completed' as const },
      { id: 'w1', workflow: 'W1', label: 'Confidential Funding Vault', description: 'Privacy-preserving project funding verified', status: ws?.confidentialFunding.active ? 'completed' as const : 'pending' as const },
      { id: 'w2', workflow: 'W2', label: 'Proof of Reserve', description: 'On-chain treasury backing verified by CRE DON', status: ws?.proofOfReserve.active ? 'completed' as const : 'pending' as const },
      { id: 'w3', workflow: 'W3', label: 'AI Risk Analysis', description: 'Multi-model market risk assessment via AI oracle', status: ws?.aiOrchestrator.active ? 'active' as const : 'pending' as const },
      { id: 'w7', workflow: 'W7', label: 'NDVI Satellite Monitoring', description: 'Sentinel-2 vegetation index tracking active', status: ws?.serraEstrela.active ? 'active' as const : 'pending' as const },
      { id: 'w5', workflow: 'W5', label: 'Protocol Health Monitor', description: 'Reserve ratio + shorts utilization monitoring', status: ws?.protocolHealth.active ? 'active' as const : 'pending' as const },
      { id: 'w6', workflow: 'W6', label: 'Compliance & KYC', description: 'Privacy-preserving compliance attestations', status: ws?.policyEngine.active ? 'completed' as const : 'pending' as const },
      { id: 'w4', workflow: 'W4', label: 'Prediction Markets', description: 'Environmental outcome markets for community bets', status: ws?.predictionMarket.active ? 'active' as const : 'pending' as const },
    ];
  }, [creWorkflowStatus]);

  // Price calculations
  const currentPrice = tokenReserve > 0n && ethReserve > 0n ? Number(tokenReserve) / Number(ethReserve) : 0;
  const marketCap = Number(formatUnits(ethReserve, 18));
  const liquidity = marketCap * 2;

  const priceChange = useMemo(() => {
    if (priceHistory.length < 2) return 0;
    return ((priceHistory[priceHistory.length - 1].price - priceHistory[0].price) / priceHistory[0].price) * 100;
  }, [priceHistory]);

  const chartWidth = 100;
  const chartHeight = 50;
  const { linePath, areaPath } = useMemo(() => {
    if (priceHistory.length < 2) return { linePath: '', areaPath: '' };
    const prices = priceHistory.map(p => p.price);
    const minP = Math.min(...prices);
    const range = (Math.max(...prices) - minP) || 1;
    const pts = priceHistory.map((point, i) => ({
      x: (i / (priceHistory.length - 1)) * chartWidth,
      y: 5 + 40 - ((point.price - minP) / range) * 40,
    }));
    const lp = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x},${p.y}`).join(' ');
    return { linePath: lp, areaPath: `${lp} L ${chartWidth},${chartHeight} L 0,${chartHeight} Z` };
  }, [priceHistory]);

  const isPositive = priceChange >= 0;
  const explorerAddressUrl = getExplorerAddressUrl(project.ammAddress);

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4 pt-16"
        onClick={onClose}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.92, y: 30 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.92, y: 30 }}
          transition={{ type: 'spring', damping: 22, stiffness: 300 }}
          onClick={(e) => e.stopPropagation()}
          className="max-w-3xl w-full rounded-xl bg-[var(--bg-elevated)] border border-[var(--border)] max-h-[92vh] overflow-y-auto"
          style={{ scrollbarWidth: 'thin', scrollbarColor: 'var(--border) transparent' }}
        >
          {/* ═══ HEADER ═══ */}
          <div className="sticky top-0 z-10 backdrop-blur-md border-b border-[var(--border)] px-6 py-4" style={{ background: 'color-mix(in srgb, var(--bg-elevated) 92%, transparent)' }}>
            <div className="flex items-start justify-between">
              <div>
                <div className="flex items-center gap-2.5 mb-1">
                  <h2 className="text-xl font-bold text-[var(--text-primary)]">{project.name}</h2>
                  <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded-md" style={{ background: 'color-mix(in srgb, var(--accent) 10%, transparent)', color: 'var(--accent)', border: '1px solid color-mix(in srgb, var(--accent) 20%, transparent)' }}>
                    ${project.symbol}
                  </span>
                  <span className="text-[9px] font-mono px-1.5 py-0.5 rounded" style={{ background: 'color-mix(in srgb, var(--success) 10%, transparent)', color: 'var(--success)', border: '1px solid color-mix(in srgb, var(--success) 20%, transparent)' }}>
                    LIVE
                  </span>
                </div>
                <div className="flex items-center gap-3 text-[10px] text-[var(--text-muted)] font-mono">
                  <span>{project.ammAddress.slice(0, 10)}...{project.ammAddress.slice(-8)}</span>
                  {metadata?.environmental?.projectType && (
                    <span className="px-1.5 py-0.5 rounded bg-[var(--bg-secondary)] text-[var(--text-secondary)]">
                      {metadata.environmental.projectType.replace('_', ' ')}
                    </span>
                  )}
                </div>
              </div>
              <button onClick={onClose} className="p-2 rounded-lg hover:bg-[var(--bg-secondary)] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>

          {isLoading ? (
            <div className="text-center py-16 text-[var(--text-muted)] font-mono text-sm">
              <motion.div animate={{ opacity: [0.4, 1, 0.4] }} transition={{ duration: 1.5, repeat: Infinity }}>
                loading project data...
              </motion.div>
            </div>
          ) : (
            <div className="px-6 pb-6 space-y-5">

              {/* ═══ DESCRIPTION ═══ */}
              {metadata?.description && (
                <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="pt-4">
                  <p className="text-sm text-[var(--text-secondary)] leading-relaxed">{metadata.description}</p>
                  {metadata.environmental && (
                    <div className="flex flex-wrap gap-2 mt-3">
                      {metadata.environmental.latitude && metadata.environmental.longitude && (
                        <span className="inline-flex items-center gap-1.5 text-[10px] font-mono text-[var(--text-muted)] px-2 py-1 rounded-md bg-[var(--bg-secondary)] border border-[var(--border)]">
                          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                          {Number(metadata.environmental.latitude).toFixed(4)}, {Number(metadata.environmental.longitude).toFixed(4)}
                        </span>
                      )}
                      {metadata.environmental.landAreaHectares && (
                        <span className="text-[10px] font-mono text-[var(--text-muted)] px-2 py-1 rounded-md bg-[var(--bg-secondary)] border border-[var(--border)]">{metadata.environmental.landAreaHectares} ha</span>
                      )}
                      {metadata.environmental.carbonTargetTco2Year && (
                        <span className="text-[10px] font-mono text-[var(--text-muted)] px-2 py-1 rounded-md bg-[var(--bg-secondary)] border border-[var(--border)]">target: {metadata.environmental.carbonTargetTco2Year} tCO2/yr</span>
                      )}
                    </div>
                  )}
                </motion.div>
              )}

              {/* ═══ IMPLEMENTATION PHASES CAROUSEL ═══ */}
              <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}>
                <div className="flex items-center justify-between mb-3">
                  <p className="text-[10px] font-mono text-[var(--text-muted)] uppercase">
                    <span className="text-[var(--accent)] opacity-60">// </span>implementation_phases
                  </p>
                  <div className="flex items-center gap-1">
                    {IMPL_PHASES.map((_, idx) => (
                      <button key={idx} onClick={() => scrollToPhase(idx)} className="transition-all duration-300"
                        style={{ width: activePhase === idx ? 16 : 6, height: 6, borderRadius: 3, background: activePhase === idx ? 'var(--accent)' : 'var(--border)' }}
                      />
                    ))}
                  </div>
                </div>

                <div ref={carouselRef} className="flex gap-3 overflow-x-auto pb-2 snap-x snap-mandatory" style={{ scrollbarWidth: 'none' }}
                  onScroll={(e) => {
                    const el = e.currentTarget;
                    const cardW = el.firstElementChild?.clientWidth || 240;
                    const idx = Math.round(el.scrollLeft / (cardW + 12));
                    if (idx !== activePhase && idx >= 0 && idx < IMPL_PHASES.length) setActivePhase(idx);
                  }}
                >
                  {IMPL_PHASES.map((phase, idx) => {
                    const accent = PHASE_ACCENTS[idx];
                    const pct = phase.status === 'completed' ? '100%' : phase.status === 'active' ? '60%' : '0%';
                    const market = markets.get(idx);
                    const totalShares = market ? Number(market.totalPositiveShares + market.totalNegativeShares) : 0;
                    const yesPct = market && totalShares > 0 ? Math.round((Number(market.totalPositiveShares) / totalShares) * 100) : 50;

                    return (
                      <motion.div key={idx} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: idx * 0.04 }}
                        className="min-w-[240px] max-w-[240px] rounded-lg snap-center shrink-0 relative bg-[var(--bg-secondary)] border border-[var(--border)] overflow-hidden"
                      >
                        {/* Accent strip */}
                        <div className="absolute left-0 top-0 bottom-0 w-1" style={{ background: accent }} />

                        <div className="p-4 pl-5">
                          {/* Phase + status */}
                          <div className="flex items-center justify-between mb-2">
                            <span className="text-[9px] font-mono text-[var(--text-muted)]">phase_{String(idx + 1).padStart(2, '0')}</span>
                            <span className="text-[8px] font-mono font-bold uppercase" style={{ color: getStatusColor(phase.status) }}>
                              {phase.status === 'completed' && (
                                <span className="inline-flex items-center gap-0.5">
                                  <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>
                                  done
                                </span>
                              )}
                              {phase.status === 'active' && (
                                <span className="inline-flex items-center gap-0.5">
                                  <span className="w-1.5 h-1.5 rounded-full bg-current animate-pulse" />
                                  active
                                </span>
                              )}
                              {phase.status === 'pending' && 'upcoming'}
                            </span>
                          </div>

                          <h4 className="text-sm font-semibold text-[var(--text-primary)] mb-0.5">{phase.title}</h4>
                          <p className="text-[10px] font-mono text-[var(--text-muted)] mb-1.5">{phase.subtitle}</p>
                          <p className="text-[10px] text-[var(--text-secondary)] leading-relaxed line-clamp-3 mb-3">{phase.desc}</p>

                          {/* Progress bar */}
                          <div className="h-1 rounded-full bg-[var(--border)] mb-2">
                            <motion.div className="h-full rounded-full" style={{ background: accent }}
                              initial={{ width: 0 }} animate={{ width: pct }} transition={{ duration: 0.8, delay: idx * 0.05 }}
                            />
                          </div>

                          {/* Prediction / Result row */}
                          {phase.status === 'completed' ? (
                            <div className="flex items-center gap-1.5 mt-1">
                              <svg className="w-3 h-3 text-[var(--success)] shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" /></svg>
                              <span className="text-[9px] font-mono text-[var(--success)]">{phase.prediction}</span>
                            </div>
                          ) : (
                            <>
                              <div className="flex items-center justify-between">
                                <span className="text-[8px] font-mono text-[var(--text-muted)] truncate max-w-[140px]">{phase.prediction}</span>
                                <button
                                  onClick={() => handlePredict(idx)}
                                  className="text-[9px] font-mono font-bold hover:underline transition-colors"
                                  style={{ color: 'var(--accent)' }}
                                >
                                  {expandedBet === idx ? 'close()' : 'predict()'}
                                </button>
                              </div>

                              {/* Expanded betting panel */}
                              <AnimatePresence>
                                {expandedBet === idx && (
                                  <motion.div
                                    initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
                                    transition={{ duration: 0.2 }}
                                    className="overflow-hidden"
                                  >
                                    <div className="mt-2 pt-2 border-t border-[var(--border)]">
                                      {market && totalShares > 0 ? (
                                        <div className="flex items-center gap-1 mb-2">
                                          <div className="flex-1 h-1.5 rounded-full bg-[var(--border)] overflow-hidden flex">
                                            <div className="h-full rounded-l-full" style={{ width: `${yesPct}%`, background: 'var(--success)' }} />
                                            <div className="h-full rounded-r-full" style={{ width: `${100 - yesPct}%`, background: 'var(--error)' }} />
                                          </div>
                                          <span className="text-[8px] font-mono text-[var(--text-muted)]">{yesPct}/{100 - yesPct}</span>
                                        </div>
                                      ) : (
                                        <p className="text-[8px] font-mono text-[var(--text-muted)] mb-2">
                                          {market ? 'no bets yet' : 'market available'}
                                        </p>
                                      )}
                                      <div className="flex items-center gap-1.5">
                                        <input
                                          type="number" step="0.01" min="0.001" value={betAmount}
                                          onChange={(e) => setBetAmount(e.target.value)}
                                          className="w-16 px-1.5 py-1 rounded text-[10px] font-mono bg-[var(--bg-elevated)] border border-[var(--border)] text-[var(--text-primary)]"
                                        />
                                        <span className="text-[8px] font-mono text-[var(--text-muted)]">ETH</span>
                                        <button
                                          onClick={() => handleBet(idx, true)}
                                          disabled={isBetting}
                                          className="flex-1 py-1 rounded text-[9px] font-mono font-bold text-white transition-colors"
                                          style={{ background: 'var(--success)', opacity: isBetting ? 0.5 : 1 }}
                                        >
                                          YES
                                        </button>
                                        <button
                                          onClick={() => handleBet(idx, false)}
                                          disabled={isBetting}
                                          className="flex-1 py-1 rounded text-[9px] font-mono font-bold text-white transition-colors"
                                          style={{ background: 'var(--error)', opacity: isBetting ? 0.5 : 1 }}
                                        >
                                          NO
                                        </button>
                                      </div>
                                      {betError && <p className="text-[8px] text-[var(--error)] mt-1 font-mono">{betError.slice(0, 60)}</p>}
                                    </div>
                                  </motion.div>
                                )}
                              </AnimatePresence>
                            </>
                          )}
                        </div>
                      </motion.div>
                    );
                  })}
                </div>
              </motion.div>

              {/* ═══ CRE ORACLE STATUS — compact badge strip ═══ */}
              {creWorkflowStatus && (
                <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
                  <p className="text-[10px] font-mono text-[var(--text-muted)] mb-2 uppercase">
                    <span className="text-[var(--accent)] opacity-60">// </span>chainlink_cre_data_sources
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {ORACLE_BADGES.map((badge) => {
                      const active = (creWorkflowStatus[badge.key] as { active: boolean }).active;
                      const metric = badge.metricFn(creWorkflowStatus, creReport);
                      const riskLevel = badge.key === 'aiOrchestrator' ? creWorkflowStatus.aiOrchestrator.riskLevel
                        : badge.key === 'protocolHealth' ? creWorkflowStatus.protocolHealth.riskLevel : undefined;
                      const badgeColor = riskLevel !== undefined && active
                        ? (RISK_COLORS[riskLevel] || 'var(--success)')
                        : active ? 'var(--success)' : 'var(--text-muted)';

                      return (
                        <span key={badge.key}
                          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-mono"
                          style={{
                            background: active
                              ? `color-mix(in srgb, ${badgeColor} 15%, transparent)`
                              : 'color-mix(in srgb, var(--text-muted) 8%, transparent)',
                            color: active ? badgeColor : 'var(--text-muted)',
                          }}
                        >
                          <span className="w-1 h-1 rounded-full" style={{ background: 'currentColor' }} />
                          {badge.label}
                          {metric && <span className="opacity-70">{metric}</span>}
                        </span>
                      );
                    })}
                    {/* W8: World ID — special case, no key in CreWorkflowStatus */}
                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-mono"
                      style={{ background: 'color-mix(in srgb, var(--success) 15%, transparent)', color: 'var(--success)' }}
                    >
                      <span className="w-1 h-1 rounded-full" style={{ background: 'currentColor' }} />
                      W8:WORLD
                    </span>
                  </div>
                </motion.div>
              )}

              {/* ═══ ENVIRONMENTAL GAUGES ═══ */}
              {(creReport || creSummary) && (
                <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25 }}
                  className="rounded-xl p-4 bg-[var(--bg-secondary)] border border-[var(--border)]"
                >
                  <p className="text-[10px] font-mono text-[var(--text-muted)] mb-3 uppercase">
                    <span className="text-[var(--accent)] opacity-60">// </span>environmental_metrics
                  </p>
                  <div className="flex justify-around mb-3">
                    <DataFeedGauge label="NDVI" value={creReport?.ndviCurrent ?? 0} max={1} unit="" color="var(--success)" size={80} />
                    <DataFeedGauge label="CO2/yr" value={creSummary?.annualCO2Kg ? creSummary.annualCO2Kg / 1000 : (creReport?.annualCO2 ?? 0) / 1000} max={100} unit="tCO2" color="var(--accent)" size={80} />
                    <DataFeedGauge label="FRI" value={creReport?.fireRecoveryIndex ?? (creSummary?.fireRecoveryIndex ?? 0)} max={100} unit="%" size={80} />
                    <DataFeedGauge label="SOC" value={creReport?.soilOrganicCarbon ?? 0} max={100} unit="g/kg" color="#f59e0b" size={80} />
                  </div>
                  {ndviHistory.length > 0 && (
                    <div className="mt-2">
                      <p className="text-[8px] font-mono text-[var(--text-muted)] mb-1 uppercase">ndvi recovery curve</p>
                      <NdviMiniChart values={ndviHistory} width={480} height={44} />
                    </div>
                  )}
                  {creSummary && (
                    <div className="flex gap-4 text-[10px] font-mono text-[var(--text-muted)] pt-3 mt-3 border-t border-[var(--border)]">
                      <span>trees: {creSummary.estimatedLiveTrees.toLocaleString()}/{creSummary.totalTreesPlanted.toLocaleString()}</span>
                      <span>survival: {creSummary.survivalRatePct}%</span>
                      <span>reports: {creSummary.totalReports}</span>
                      <span>carbon credits: {creReport?.carbonCredits ?? 0}</span>
                    </div>
                  )}
                </motion.div>
              )}

              {/* ═══ SPECIES BREAKDOWN ═══ */}
              {metadata?.environmental?.species && metadata.environmental.species.length > 0 && (
                <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}
                  className="rounded-xl p-4 bg-[var(--bg-secondary)] border border-[var(--border)]"
                >
                  <p className="text-[10px] font-mono text-[var(--text-muted)] mb-3 uppercase">
                    <span className="text-[var(--accent)] opacity-60">// </span>native_species_composition
                  </p>
                  <SpeciesBreakdown species={metadata.environmental.species} />
                </motion.div>
              )}

              {/* ═══ CRE WORKFLOW TIMELINE ═══ */}
              <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.35 }}
                className="rounded-xl p-4 bg-[var(--bg-secondary)] border border-[var(--border)]"
              >
                <p className="text-[10px] font-mono text-[var(--text-muted)] mb-3 uppercase">
                  <span className="text-[var(--accent)] opacity-60">// </span>cre_workflow_milestones
                </p>
                <div className="relative pl-4">
                  <div className="absolute left-[7px] top-2 bottom-2 w-px" style={{ background: 'var(--border)' }} />
                  {milestones.map((m, idx) => (
                    <motion.div key={m.id} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: idx * 0.05 }}
                      className="relative flex items-start gap-3 mb-3 last:mb-0"
                    >
                      <div className="relative z-10 w-4 h-4 rounded-full flex items-center justify-center -ml-4 mt-0.5 shrink-0"
                        style={{
                          background: m.status !== 'pending' ? getStatusColor(m.status) : 'var(--bg-secondary)',
                          border: `2px solid ${getStatusColor(m.status)}`,
                          color: m.status !== 'pending' ? 'white' : getStatusColor(m.status),
                        }}
                      >
                        {m.status === 'completed' && <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>}
                        {m.status === 'active' && <motion.div className="w-1.5 h-1.5 rounded-full bg-current" animate={{ scale: [1, 1.3, 1] }} transition={{ duration: 1.5, repeat: Infinity }} />}
                        {m.status === 'pending' && <div className="w-1 h-1 rounded-full bg-current opacity-40" />}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] font-mono font-bold" style={{ color: getStatusColor(m.status) }}>{m.workflow}</span>
                          <span className="text-xs text-[var(--text-primary)]">{m.label}</span>
                        </div>
                        <p className="text-[10px] text-[var(--text-muted)] font-mono">{m.description}</p>
                      </div>
                    </motion.div>
                  ))}
                </div>
              </motion.div>

              {/* ═══ MARKET DATA ═══ */}
              <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 }}>
                <p className="text-[10px] font-mono text-[var(--text-muted)] mb-3 uppercase">
                  <span className="text-[var(--accent)] opacity-60">// </span>market_data
                </p>
                <div className="mb-4">
                  <div className="flex items-end gap-3">
                    <span className="text-3xl font-bold text-[var(--text-primary)]">{formatNumber(currentPrice, 0)}</span>
                    <span className="text-sm text-[var(--text-muted)] mb-1">${project.symbol}/ETH</span>
                    <span className="text-sm font-medium mb-1" style={{ color: isPositive ? 'var(--success)' : 'var(--error)' }}>
                      {isPositive ? '+' : ''}{priceChange.toFixed(2)}%
                    </span>
                  </div>
                </div>

                <div className="rounded-lg p-4 bg-[var(--bg-secondary)] border border-[var(--border)] mb-4">
                  <div className="h-20">
                    <svg viewBox={`0 0 ${chartWidth} ${chartHeight}`} className="w-full h-full" preserveAspectRatio="none">
                      <defs>
                        <linearGradient id="pdAreaG" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.3" />
                          <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
                        </linearGradient>
                        <linearGradient id="pdEdge" x1="0" y1="0" x2="1" y2="0">
                          <stop offset="0%" stopColor="white" stopOpacity="0" />
                          <stop offset="8%" stopColor="white" stopOpacity="1" />
                          <stop offset="92%" stopColor="white" stopOpacity="1" />
                          <stop offset="100%" stopColor="white" stopOpacity="0" />
                        </linearGradient>
                        <mask id="pdMask"><rect x="0" y="0" width={chartWidth} height={chartHeight} fill="url(#pdEdge)" /></mask>
                      </defs>
                      <g mask="url(#pdMask)">
                        <path d={areaPath} fill="url(#pdAreaG)" />
                        <path d={linePath} fill="none" stroke="var(--accent)" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" />
                      </g>
                    </svg>
                  </div>
                  <div className="flex justify-between mt-2 text-[10px] text-[var(--text-muted)]">
                    <span>30h ago</span><span>now</span>
                  </div>
                </div>

                <div className="grid grid-cols-4 gap-2">
                  {[
                    { label: 'mcap', value: `${formatNumber(marketCap)} ETH` },
                    { label: 'liquidity', value: `${formatNumber(liquidity)} ETH` },
                    { label: 'eth_reserve', value: `${formatNumber(Number(formatUnits(ethReserve, 18)))} ETH` },
                    { label: 'token_reserve', value: formatNumber(Number(formatUnits(tokenReserve, 18))) },
                  ].map((s) => (
                    <div key={s.label} className="p-3 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border)]">
                      <p className="text-[8px] font-mono text-[var(--text-muted)] uppercase mb-1">
                        <span className="text-[var(--accent)] opacity-60">// </span>{s.label}
                      </p>
                      <p className="text-sm font-medium text-[var(--text-primary)]">{s.value}</p>
                    </div>
                  ))}
                </div>

                {project.feeBps !== undefined && (
                  <div className="mt-2 p-2.5 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border)]">
                    <p className="text-[10px] text-[var(--text-muted)] font-mono">// swap fee: {project.feeBps / 100}% — goes to liquidity providers</p>
                  </div>
                )}
              </motion.div>

              {/* ═══ ACTIONS ═══ */}
              <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.45 }} className="flex gap-3 pt-2">
                <GlowButton onClick={() => onTrade(project.ammAddress)} variant="primary" className="flex-1">trade()</GlowButton>
                {explorerAddressUrl ? (
                  <GlowButton onClick={() => window.open(explorerAddressUrl, '_blank')} variant="ghost">view_contract()</GlowButton>
                ) : (
                  <GlowButton onClick={() => navigator.clipboard.writeText(project.ammAddress)} variant="ghost">copy_address()</GlowButton>
                )}
              </motion.div>
            </div>
          )}
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
