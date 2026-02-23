import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { usePublicClient } from 'wagmi';
import { formatUnits } from 'viem';
import { motion, AnimatePresence } from 'framer-motion';
import { GlowButton } from './ui/GlowButton';
import { MilestoneTimeline } from './projects/proposals/MilestoneTimeline';
import { DataFeedGauge } from './projects/live/DataFeedGauge';
import { NdviMiniChart } from './projects/live/NdviMiniChart';
import { SpeciesBreakdown } from './projects/live/SpeciesBreakdown';
import { getExplorerAddressUrl } from '../config';
import type {
  CreDataFeedReport,
  ProjectSummary,
  CreWorkflowStatus,
  ProposalMetadata,
  MilestoneNode,
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

const ZKAMM_ABI = [
  { name: 'ethReserve', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { name: 'tokenReserve', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
] as const;

const CRE_WORKFLOWS = [
  { id: 'w7', label: 'W7', name: 'Serra Estrela NDVI', desc: 'Sentinel-2 vegetation index tracking via CRE DON', color: '#10b981', key: 'serraEstrela' as const },
  { id: 'w2', label: 'W2', name: 'Proof of Reserve', desc: 'On-chain treasury backing verification', color: '#22c55e', key: 'proofOfReserve' as const },
  { id: 'w3', label: 'W3', name: 'AI Risk Oracle', desc: 'Multi-model risk analysis + trade signals', color: '#06b6d4', key: 'aiOrchestrator' as const },
  { id: 'w5', label: 'W5', name: 'Protocol Health', desc: 'Reserve ratio + shorts utilization monitor', color: '#3b82f6', key: 'protocolHealth' as const },
  { id: 'w6', label: 'W6', name: 'Compliance Engine', desc: 'Privacy-preserving KYC/AML attestations', color: '#ec4899', key: 'policyEngine' as const },
  { id: 'w1', label: 'W1', name: 'Confidential Vault', desc: 'ZK-proof verified funding operations', color: '#8b5cf6', key: 'confidentialFunding' as const },
  { id: 'w4', label: 'W4', name: 'Prediction Markets', desc: 'Environmental outcome betting markets', color: '#f59e0b', key: 'predictionMarket' as const },
  { id: 'w8', label: 'W8', name: 'World ID Gate', desc: 'Worldcoin sybil-resistant verification', color: '#14b8a6', key: undefined },
] as const;

const IMPL_PHASES = [
  {
    title: 'Satellite Assessment',
    subtitle: 'Sentinel-2 dNBR Analysis',
    desc: 'High-resolution multispectral imagery from ESA Sentinel-2 satellites mapping burn severity and baseline vegetation across the project area.',
    g1: '#0c4a6e', g2: '#164e63',
    phase: 1,
    status: 'completed' as const,
  },
  {
    title: 'Species Selection',
    subtitle: 'Native Biodiversity Planning',
    desc: 'Climate-resilient native species selected including Quercus pyrenaica, Betula celtiberica, and Castanea sativa based on CO2 rates and survival modeling.',
    g1: '#14532d', g2: '#064e3b',
    phase: 2,
    status: 'completed' as const,
  },
  {
    title: 'Seedling Cultivation',
    subtitle: 'Nursery Propagation',
    desc: 'Controlled nursery environment for seed germination and hardening protocols preparing seedlings for mountain terrain at 800-1500m elevation.',
    g1: '#713f12', g2: '#365314',
    phase: 3,
    status: 'completed' as const,
  },
  {
    title: 'Field Deployment',
    subtitle: 'GPS-Tagged Planting',
    desc: 'Strategic planting across fire-damaged zones with GPS tagging per tree, soil amendment application, and protective guards for each seedling.',
    g1: '#3f6212', g2: '#15803d',
    phase: 4,
    status: 'active' as const,
  },
  {
    title: 'IoT Monitoring Grid',
    subtitle: 'Sensor + Drone Network',
    desc: 'Deployment of soil moisture sensors, weather stations, and autonomous drone flight corridors for continuous environmental data collection.',
    g1: '#312e81', g2: '#4c1d95',
    phase: 5,
    status: 'active' as const,
  },
  {
    title: 'Carbon Verification',
    subtitle: 'On-Chain Certification',
    desc: 'tCO2/year measurements validated through Chainlink CRE oracle data feeds and proof-of-reserve. Carbon credits minted on-chain.',
    g1: '#065f46', g2: '#0e7490',
    phase: 6,
    status: 'pending' as const,
  },
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

function isWorkflowActive(key: string | undefined, status?: CreWorkflowStatus): boolean {
  if (!status || !key) return false;
  const entry = status[key as keyof CreWorkflowStatus];
  return entry ? (entry as { active: boolean }).active : false;
}

function getOracleMetric(key: string | undefined, status?: CreWorkflowStatus, report?: CreDataFeedReport | null): { value: string; label: string } | null {
  if (!status || !key) return null;
  switch (key) {
    case 'serraEstrela':
      return report ? { value: report.ndviCurrent.toFixed(2), label: 'NDVI' } : null;
    case 'proofOfReserve':
      return status.proofOfReserve.active ? { value: `${(status.proofOfReserve.backingRatio / 100).toFixed(0)}%`, label: 'backing' } : null;
    case 'aiOrchestrator':
      return status.aiOrchestrator.active ? { value: RISK_LABELS[status.aiOrchestrator.riskLevel] || '?', label: 'risk' } : null;
    case 'protocolHealth':
      return status.protocolHealth.active ? { value: RISK_LABELS[status.protocolHealth.riskLevel] || '?', label: 'health' } : null;
    case 'policyEngine':
      return status.policyEngine.active ? { value: `${status.policyEngine.totalAttestations}`, label: 'attested' } : null;
    case 'confidentialFunding':
      return status.confidentialFunding.active ? { value: `${status.confidentialFunding.verifiedProposals}`, label: 'verified' } : null;
    case 'predictionMarket':
      return status.predictionMarket.active ? { value: `${status.predictionMarket.openMarkets}`, label: 'markets' } : null;
    default:
      return null;
  }
}

function formatNumber(num: number, decimals = 2) {
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(decimals)}M`;
  if (num >= 1_000) return `${(num / 1_000).toFixed(decimals)}K`;
  return num.toFixed(decimals);
}

// === Sub-components ===

function PhaseIllustration({ phase, size = 64 }: { phase: number; size?: number }) {
  const s = size;
  const cx = s / 2;
  const cy = s / 2;
  const r = s * 0.32;

  switch (phase) {
    case 1: // Satellite
      return (
        <svg width={s} height={s} viewBox={`0 0 ${s} ${s}`} fill="none">
          <circle cx={cx} cy={cy} r={r} stroke="rgba(255,255,255,0.15)" strokeWidth="0.75" strokeDasharray="3 2" />
          <circle cx={cx} cy={cy} r={r * 0.55} stroke="rgba(255,255,255,0.25)" strokeWidth="0.75" />
          <circle cx={cx} cy={cy} r={2} fill="rgba(255,255,255,0.7)" />
          {[0, 1, 2].map(i => (
            <line key={i} x1={cx - r * 0.8} y1={cy - r * 0.3 + i * r * 0.3} x2={cx + r * 0.8} y2={cy - r * 0.3 + i * r * 0.3}
              stroke="rgba(255,255,255,0.08)" strokeWidth="0.5" />
          ))}
        </svg>
      );
    case 2: // Species/Trees
      return (
        <svg width={s} height={s} viewBox={`0 0 ${s} ${s}`} fill="none">
          {[{ x: cx - 14, h: 22, w: 10 }, { x: cx - 2, h: 28, w: 12 }, { x: cx + 10, h: 18, w: 8 }].map((t, i) => (
            <g key={i}>
              <polygon points={`${t.x},${cy + 8} ${t.x + t.w / 2},${cy + 8 - t.h} ${t.x + t.w},${cy + 8}`}
                fill="rgba(255,255,255,0.12)" stroke="rgba(255,255,255,0.25)" strokeWidth="0.5" />
              <line x1={t.x + t.w / 2} y1={cy + 8} x2={t.x + t.w / 2} y2={cy + 13}
                stroke="rgba(255,255,255,0.25)" strokeWidth="1" />
            </g>
          ))}
          <line x1={cx - 22} y1={cy + 13} x2={cx + 22} y2={cy + 13} stroke="rgba(255,255,255,0.15)" strokeWidth="0.5" />
        </svg>
      );
    case 3: // Seedling
      return (
        <svg width={s} height={s} viewBox={`0 0 ${s} ${s}`} fill="none">
          <path d={`M${cx - 8} ${cy + 4} L${cx - 6} ${cy + 14} L${cx + 6} ${cy + 14} L${cx + 8} ${cy + 4} Z`}
            fill="rgba(255,255,255,0.1)" stroke="rgba(255,255,255,0.25)" strokeWidth="0.5" />
          <path d={`M${cx} ${cy + 4} Q${cx} ${cy - 6} ${cx} ${cy - 12}`}
            stroke="rgba(255,255,255,0.35)" strokeWidth="1.5" fill="none" />
          <ellipse cx={cx - 6} cy={cy - 8} rx={5} ry={2.5} transform={`rotate(-30 ${cx - 6} ${cy - 8})`}
            fill="rgba(255,255,255,0.15)" stroke="rgba(255,255,255,0.25)" strokeWidth="0.5" />
          <ellipse cx={cx + 4} cy={cy - 11} rx={4} ry={2} transform={`rotate(20 ${cx + 4} ${cy - 11})`}
            fill="rgba(255,255,255,0.15)" stroke="rgba(255,255,255,0.25)" strokeWidth="0.5" />
        </svg>
      );
    case 4: // GPS Planting Grid
      return (
        <svg width={s} height={s} viewBox={`0 0 ${s} ${s}`} fill="none">
          <path d={`M${cx - 24} ${cy + 14} L${cx - 10} ${cy - 6} L${cx + 2} ${cy + 4} L${cx + 14} ${cy - 10} L${cx + 26} ${cy + 14}`}
            fill="rgba(255,255,255,0.06)" stroke="rgba(255,255,255,0.15)" strokeWidth="0.5" />
          {[-12, -4, 4, 12].map((x, i) =>
            [-4, 4].map((y, j) => (
              <circle key={`${i}-${j}`} cx={cx + x} cy={cy + y} r={1.5} fill="rgba(255,255,255,0.4)" />
            ))
          )}
          <path d={`M${cx - 12} ${cy - 4} L${cx + 12} ${cy - 4}`} stroke="rgba(255,255,255,0.1)" strokeWidth="0.5" strokeDasharray="2 2" />
          <path d={`M${cx - 12} ${cy + 4} L${cx + 12} ${cy + 4}`} stroke="rgba(255,255,255,0.1)" strokeWidth="0.5" strokeDasharray="2 2" />
        </svg>
      );
    case 5: // IoT Network
      return (
        <svg width={s} height={s} viewBox={`0 0 ${s} ${s}`} fill="none">
          <circle cx={cx} cy={cy} r={3} fill="rgba(255,255,255,0.35)" />
          <circle cx={cx} cy={cy} r={10} stroke="rgba(255,255,255,0.12)" strokeWidth="0.5" fill="none" />
          {[0, 60, 120, 180, 240, 300].map((angle, i) => {
            const rad = (angle * Math.PI) / 180;
            const nx = cx + Math.cos(rad) * 18;
            const ny = cy + Math.sin(rad) * 18;
            return (
              <g key={i}>
                <line x1={cx} y1={cy} x2={nx} y2={ny} stroke="rgba(255,255,255,0.1)" strokeWidth="0.5" />
                <circle cx={nx} cy={ny} r={2} fill="rgba(255,255,255,0.25)" stroke="rgba(255,255,255,0.4)" strokeWidth="0.5" />
              </g>
            );
          })}
        </svg>
      );
    case 6: // Carbon Certification
      return (
        <svg width={s} height={s} viewBox={`0 0 ${s} ${s}`} fill="none">
          <circle cx={cx} cy={cy} r={r * 0.85} stroke="rgba(255,255,255,0.25)" strokeWidth="1.5" />
          <path d={`M${cx - 8} ${cy} L${cx - 2} ${cy + 7} L${cx + 10} ${cy - 8}`}
            stroke="rgba(255,255,255,0.7)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
          <text x={cx} y={cy + r * 0.85 + 10} textAnchor="middle" fill="rgba(255,255,255,0.3)" fontSize="7" fontFamily="monospace">tCO2</text>
        </svg>
      );
    default:
      return null;
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
        const currentPrice = Number(token) / Number(eth);
        const points: PricePoint[] = [];
        let price = currentPrice * 0.9;
        for (let i = 0; i < 30; i++) {
          price = price + (currentPrice - price) * 0.1 + (Math.random() - 0.5) * currentPrice * 0.02;
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

  // Scroll carousel to active phase
  const scrollToPhase = useCallback((idx: number) => {
    setActivePhase(idx);
    if (carouselRef.current) {
      const children = carouselRef.current.children;
      if (children[idx]) {
        (children[idx] as HTMLElement).scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
      }
    }
  }, []);

  // Generate NDVI history for chart
  const ndviHistory = useMemo(() => {
    if (!creReport) return [];
    const base = creReport.ndviPreFire > 0 ? creReport.ndviPreFire : 0.6;
    const current = creReport.ndviCurrent;
    const points: number[] = [];
    for (let i = 0; i < 12; i++) {
      const t = i / 11;
      const val = base * 0.3 + (current - base * 0.3) * Math.pow(t, 0.6) + (Math.random() - 0.5) * 0.02;
      points.push(Math.max(0, Math.min(1, val)));
    }
    return points;
  }, [creReport]);

  // Build milestones for timeline
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
    const oldest = priceHistory[0].price;
    const newest = priceHistory[priceHistory.length - 1].price;
    return ((newest - oldest) / oldest) * 100;
  }, [priceHistory]);

  // Chart SVG path
  const chartWidth = 100;
  const chartHeight = 50;
  const { linePath, areaPath } = useMemo(() => {
    if (priceHistory.length < 2) return { linePath: '', areaPath: '' };
    const prices = priceHistory.map(p => p.price);
    const minP = Math.min(...prices);
    const maxP = Math.max(...prices);
    const range = maxP - minP || 1;
    const pts = priceHistory.map((point, i) => ({
      x: (i / (priceHistory.length - 1)) * chartWidth,
      y: 5 + 40 - ((point.price - minP) / range) * 40,
    }));
    const linePathStr = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x},${p.y}`).join(' ');
    return { linePath: linePathStr, areaPath: `${linePathStr} L ${chartWidth},${chartHeight} L 0,${chartHeight} Z` };
  }, [priceHistory]);

  const isPositive = priceChange >= 0;

  const explorerAddressUrl = getExplorerAddressUrl(project.ammAddress);

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4"
        onClick={onClose}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.92, y: 30 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.92, y: 30 }}
          transition={{ type: 'spring', damping: 22, stiffness: 300 }}
          onClick={(e) => e.stopPropagation()}
          className="max-w-3xl w-full rounded-xl bg-[var(--bg-elevated)] border border-[var(--border)] max-h-[92vh] overflow-y-auto scrollbar-thin"
          style={{ scrollbarWidth: 'thin', scrollbarColor: 'var(--border) transparent' }}
        >
          {/* ═══ HEADER ═══ */}
          <div className="sticky top-0 z-10 bg-[var(--bg-elevated)]/95 backdrop-blur-md border-b border-[var(--border)] px-6 py-4">
            <div className="flex items-start justify-between">
              <div>
                <div className="flex items-center gap-2.5 mb-1">
                  <h2 className="text-xl font-bold text-[var(--text-primary)]">{project.name}</h2>
                  <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded-md bg-[var(--accent)]/10 text-[var(--accent)] border border-[var(--accent)]/20">
                    ${project.symbol}
                  </span>
                  <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-[var(--success)]/10 text-[var(--success)] border border-[var(--success)]/20">
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
            <div className="px-6 pb-6 space-y-6">

              {/* ═══ DESCRIPTION ═══ */}
              {metadata?.description && (
                <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}
                  className="pt-4"
                >
                  <p className="text-sm text-[var(--text-secondary)] leading-relaxed">{metadata.description}</p>
                  {metadata.environmental && (
                    <div className="flex flex-wrap gap-3 mt-3">
                      {metadata.environmental.latitude && metadata.environmental.longitude && (
                        <span className="inline-flex items-center gap-1.5 text-[10px] font-mono text-[var(--text-muted)] px-2 py-1 rounded-md bg-[var(--bg-secondary)] border border-[var(--border)]">
                          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                          </svg>
                          {Number(metadata.environmental.latitude).toFixed(4)}, {Number(metadata.environmental.longitude).toFixed(4)}
                        </span>
                      )}
                      {metadata.environmental.landAreaHectares && (
                        <span className="text-[10px] font-mono text-[var(--text-muted)] px-2 py-1 rounded-md bg-[var(--bg-secondary)] border border-[var(--border)]">
                          {metadata.environmental.landAreaHectares} ha
                        </span>
                      )}
                      {metadata.environmental.carbonTargetTco2Year && (
                        <span className="text-[10px] font-mono text-[var(--text-muted)] px-2 py-1 rounded-md bg-[var(--bg-secondary)] border border-[var(--border)]">
                          target: {metadata.environmental.carbonTargetTco2Year} tCO2/yr
                        </span>
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
                      <button
                        key={idx}
                        onClick={() => scrollToPhase(idx)}
                        className="transition-all duration-300"
                        style={{
                          width: activePhase === idx ? 16 : 6,
                          height: 6,
                          borderRadius: 3,
                          background: activePhase === idx ? 'var(--accent)' : 'var(--border)',
                        }}
                      />
                    ))}
                  </div>
                </div>

                <div
                  ref={carouselRef}
                  className="flex gap-3 overflow-x-auto pb-2 snap-x snap-mandatory"
                  style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
                  onScroll={(e) => {
                    const container = e.currentTarget;
                    const scrollPos = container.scrollLeft;
                    const cardWidth = container.firstElementChild?.clientWidth || 260;
                    const gap = 12;
                    const idx = Math.round(scrollPos / (cardWidth + gap));
                    if (idx !== activePhase && idx >= 0 && idx < IMPL_PHASES.length) {
                      setActivePhase(idx);
                    }
                  }}
                >
                  {IMPL_PHASES.map((phase, idx) => (
                    <motion.div
                      key={idx}
                      initial={{ opacity: 0, scale: 0.9 }}
                      animate={{ opacity: 1, scale: 1 }}
                      transition={{ delay: idx * 0.05 }}
                      className="min-w-[260px] max-w-[260px] rounded-xl overflow-hidden snap-center shrink-0 relative group cursor-default"
                      style={{
                        background: `linear-gradient(135deg, ${phase.g1}, ${phase.g2})`,
                      }}
                    >
                      {/* Phase number watermark */}
                      <div className="absolute top-2 right-3 text-[48px] font-black text-white/[0.06] font-mono leading-none select-none">
                        {String(phase.phase).padStart(2, '0')}
                      </div>

                      <div className="relative p-4 pb-3 flex flex-col justify-between min-h-[180px]">
                        {/* Status badge */}
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-[9px] font-mono font-bold uppercase tracking-wider"
                            style={{
                              color: phase.status === 'completed' ? '#86efac' : phase.status === 'active' ? '#fbbf24' : 'rgba(255,255,255,0.4)',
                            }}
                          >
                            {phase.status === 'completed' && (
                              <span className="inline-flex items-center gap-1">
                                <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                                </svg>
                                completed
                              </span>
                            )}
                            {phase.status === 'active' && (
                              <span className="inline-flex items-center gap-1">
                                <span className="w-1.5 h-1.5 rounded-full bg-current animate-pulse" />
                                in progress
                              </span>
                            )}
                            {phase.status === 'pending' && 'upcoming'}
                          </span>
                          <PhaseIllustration phase={phase.phase} size={48} />
                        </div>

                        {/* Text */}
                        <div>
                          <h4 className="text-sm font-bold text-white/90 mb-0.5">{phase.title}</h4>
                          <p className="text-[10px] font-mono text-white/50 mb-2">{phase.subtitle}</p>
                          <p className="text-[10px] text-white/60 leading-relaxed line-clamp-3">{phase.desc}</p>
                        </div>
                      </div>

                      {/* Bottom progress bar */}
                      <div className="h-0.5 w-full bg-white/5">
                        <div
                          className="h-full transition-all duration-500"
                          style={{
                            width: phase.status === 'completed' ? '100%' : phase.status === 'active' ? '60%' : '0%',
                            background: phase.status === 'completed' ? '#86efac' : '#fbbf24',
                          }}
                        />
                      </div>
                    </motion.div>
                  ))}
                </div>
              </motion.div>

              {/* ═══ CRE ORACLE DATA SOURCES ═══ */}
              <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
                <p className="text-[10px] font-mono text-[var(--text-muted)] mb-3 uppercase">
                  <span className="text-[var(--accent)] opacity-60">// </span>chainlink_cre_oracle_data_sources
                </p>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {CRE_WORKFLOWS.map((wf, idx) => {
                    const active = isWorkflowActive(wf.key, creWorkflowStatus);
                    const metric = getOracleMetric(wf.key, creWorkflowStatus, creReport);

                    return (
                      <motion.div
                        key={wf.id}
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.25 + idx * 0.04 }}
                        className="rounded-lg p-3 border transition-all duration-300"
                        style={{
                          background: active
                            ? `color-mix(in srgb, ${wf.color} 6%, var(--bg-secondary))`
                            : 'var(--bg-secondary)',
                          borderColor: active
                            ? `color-mix(in srgb, ${wf.color} 25%, transparent)`
                            : 'var(--border)',
                        }}
                      >
                        {/* Header row */}
                        <div className="flex items-center gap-1.5 mb-1.5">
                          <div
                            className="w-1.5 h-1.5 rounded-full shrink-0"
                            style={{ background: active ? wf.color : 'var(--text-muted)', opacity: active ? 1 : 0.4 }}
                          />
                          <span className="text-[9px] font-mono font-bold" style={{ color: active ? wf.color : 'var(--text-muted)' }}>
                            {wf.label}
                          </span>
                        </div>

                        {/* Name */}
                        <p className="text-[10px] font-medium text-[var(--text-primary)] mb-0.5 leading-tight">{wf.name}</p>
                        <p className="text-[8px] text-[var(--text-muted)] leading-snug line-clamp-2 mb-2">{wf.desc}</p>

                        {/* Metric */}
                        {metric ? (
                          <div className="flex items-baseline gap-1.5">
                            <span className="text-sm font-bold font-mono" style={{ color: wf.color }}>{metric.value}</span>
                            <span className="text-[8px] text-[var(--text-muted)] font-mono">{metric.label}</span>
                          </div>
                        ) : (
                          <span className="text-[8px] font-mono text-[var(--text-muted)] opacity-50">
                            {active ? 'monitoring' : 'awaiting data'}
                          </span>
                        )}
                      </motion.div>
                    );
                  })}
                </div>
              </motion.div>

              {/* ═══ ENVIRONMENTAL GAUGES ═══ */}
              {(creReport || creSummary) && (
                <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}
                  className="rounded-xl p-4 bg-[var(--bg-secondary)] border border-[var(--border)]"
                >
                  <p className="text-[10px] font-mono text-[var(--text-muted)] mb-3 uppercase">
                    <span className="text-[var(--accent)] opacity-60">// </span>environmental_metrics
                  </p>
                  <div className="flex justify-around mb-3">
                    <DataFeedGauge
                      label="NDVI"
                      value={creReport?.ndviCurrent ?? 0}
                      max={1}
                      unit=""
                      color="var(--success)"
                      size={80}
                    />
                    <DataFeedGauge
                      label="CO2/yr"
                      value={creSummary?.annualCO2Kg ? creSummary.annualCO2Kg / 1000 : (creReport?.annualCO2 ?? 0) / 1000}
                      max={100}
                      unit="tCO2"
                      color="var(--accent)"
                      size={80}
                    />
                    <DataFeedGauge
                      label="FRI"
                      value={creReport?.fireRecoveryIndex ?? (creSummary?.fireRecoveryIndex ?? 0)}
                      max={100}
                      unit="%"
                      size={80}
                    />
                    <DataFeedGauge
                      label="SOC"
                      value={creReport?.soilOrganicCarbon ?? 0}
                      max={100}
                      unit="g/kg"
                      color="#f59e0b"
                      size={80}
                    />
                  </div>

                  {/* NDVI Recovery Chart */}
                  {ndviHistory.length > 0 && (
                    <div className="mt-2">
                      <p className="text-[8px] font-mono text-[var(--text-muted)] mb-1 uppercase">ndvi recovery curve</p>
                      <NdviMiniChart values={ndviHistory} width={480} height={44} />
                    </div>
                  )}

                  {/* Summary stats */}
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
                <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.35 }}
                  className="rounded-xl p-4 bg-[var(--bg-secondary)] border border-[var(--border)]"
                >
                  <p className="text-[10px] font-mono text-[var(--text-muted)] mb-3 uppercase">
                    <span className="text-[var(--accent)] opacity-60">// </span>native_species_composition
                  </p>
                  <SpeciesBreakdown species={metadata.environmental.species} />
                </motion.div>
              )}

              {/* ═══ IMPLEMENTATION TIMELINE ═══ */}
              <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 }}
                className="rounded-xl p-4 bg-[var(--bg-secondary)] border border-[var(--border)]"
              >
                <p className="text-[10px] font-mono text-[var(--text-muted)] mb-3 uppercase">
                  <span className="text-[var(--accent)] opacity-60">// </span>cre_workflow_milestones
                </p>
                <MilestoneTimeline milestones={milestones} />
              </motion.div>

              {/* ═══ MARKET DATA ═══ */}
              <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.45 }}>
                <p className="text-[10px] font-mono text-[var(--text-muted)] mb-3 uppercase">
                  <span className="text-[var(--accent)] opacity-60">// </span>market_data
                </p>

                {/* Price */}
                <div className="mb-4">
                  <div className="flex items-end gap-3">
                    <span className="text-3xl font-bold text-[var(--text-primary)]">
                      {formatNumber(currentPrice, 0)}
                    </span>
                    <span className="text-sm text-[var(--text-muted)] mb-1">${project.symbol}/ETH</span>
                    <span className="text-sm font-medium mb-1" style={{ color: isPositive ? 'var(--success)' : 'var(--error)' }}>
                      {isPositive ? '+' : ''}{priceChange.toFixed(2)}%
                    </span>
                  </div>
                </div>

                {/* Chart */}
                <div className="rounded-lg p-4 bg-[var(--bg-secondary)] border border-[var(--border)] mb-4">
                  <div className="h-20">
                    <svg viewBox={`0 0 ${chartWidth} ${chartHeight}`} className="w-full h-full" preserveAspectRatio="none">
                      <defs>
                        <linearGradient id="projectAreaGradient" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.3" />
                          <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
                        </linearGradient>
                        <linearGradient id="projectEdgeFade" x1="0" y1="0" x2="1" y2="0">
                          <stop offset="0%" stopColor="white" stopOpacity="0" />
                          <stop offset="8%" stopColor="white" stopOpacity="1" />
                          <stop offset="92%" stopColor="white" stopOpacity="1" />
                          <stop offset="100%" stopColor="white" stopOpacity="0" />
                        </linearGradient>
                        <mask id="projectEdgeMask">
                          <rect x="0" y="0" width={chartWidth} height={chartHeight} fill="url(#projectEdgeFade)" />
                        </mask>
                      </defs>
                      <g mask="url(#projectEdgeMask)">
                        <path d={areaPath} fill="url(#projectAreaGradient)" />
                        <path d={linePath} fill="none" stroke="var(--accent)" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" />
                      </g>
                    </svg>
                  </div>
                  <div className="flex justify-between mt-2 text-[10px] text-[var(--text-muted)]">
                    <span>30h ago</span>
                    <span>now</span>
                  </div>
                </div>

                {/* Stats */}
                <div className="grid grid-cols-4 gap-2">
                  <div className="p-3 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border)]">
                    <p className="text-[8px] font-mono text-[var(--text-muted)] uppercase mb-1">
                      <span className="text-[var(--accent)] opacity-60">// </span>mcap
                    </p>
                    <p className="text-sm font-medium text-[var(--text-primary)]">{formatNumber(marketCap)} ETH</p>
                  </div>
                  <div className="p-3 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border)]">
                    <p className="text-[8px] font-mono text-[var(--text-muted)] uppercase mb-1">
                      <span className="text-[var(--accent)] opacity-60">// </span>liquidity
                    </p>
                    <p className="text-sm font-medium text-[var(--text-primary)]">{formatNumber(liquidity)} ETH</p>
                  </div>
                  <div className="p-3 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border)]">
                    <p className="text-[8px] font-mono text-[var(--text-muted)] uppercase mb-1">
                      <span className="text-[var(--accent)] opacity-60">// </span>eth_reserve
                    </p>
                    <p className="text-sm font-medium text-[var(--text-primary)]">{formatNumber(Number(formatUnits(ethReserve, 18)))} ETH</p>
                  </div>
                  <div className="p-3 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border)]">
                    <p className="text-[8px] font-mono text-[var(--text-muted)] uppercase mb-1">
                      <span className="text-[var(--accent)] opacity-60">// </span>token_reserve
                    </p>
                    <p className="text-sm font-medium text-[var(--text-primary)]">{formatNumber(Number(formatUnits(tokenReserve, 18)))}</p>
                  </div>
                </div>

                {/* Fee info */}
                {project.feeBps !== undefined && (
                  <div className="mt-2 p-2.5 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border)]">
                    <p className="text-[10px] text-[var(--text-muted)] font-mono">
                      // swap fee: {project.feeBps / 100}% — goes to liquidity providers
                    </p>
                  </div>
                )}
              </motion.div>

              {/* ═══ ACTIONS ═══ */}
              <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.5 }}
                className="flex gap-3 pt-2"
              >
                <GlowButton onClick={() => onTrade(project.ammAddress)} variant="primary" className="flex-1">
                  trade()
                </GlowButton>
                {explorerAddressUrl ? (
                  <GlowButton onClick={() => window.open(explorerAddressUrl, '_blank')} variant="ghost">
                    view_contract()
                  </GlowButton>
                ) : (
                  <GlowButton onClick={() => navigator.clipboard.writeText(project.ammAddress)} variant="ghost">
                    copy_address()
                  </GlowButton>
                )}
              </motion.div>
            </div>
          )}
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
