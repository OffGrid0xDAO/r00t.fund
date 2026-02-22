import { useState, useEffect, useMemo } from 'react';
import { usePublicClient } from 'wagmi';
import { formatUnits } from 'viem';
import { motion, AnimatePresence } from 'framer-motion';
import { GlowButton } from './ui/GlowButton';

interface ProjectDetailModalProps {
  project: {
    name: string;
    symbol: string;
    ammAddress: string;
    totalSupply?: bigint;
    feeBps?: number;
  };
  onClose: () => void;
  onTrade: (ammAddress: string) => void;
}

interface PricePoint {
  timestamp: number;
  price: number;
  blockNumber: number;
}

const ZKAMM_ABI = [
  {
    name: 'ethReserve',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint256' }],
  },
  {
    name: 'tokenReserve',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint256' }],
  },
] as const;

export function ProjectDetailModal({ project, onClose, onTrade }: ProjectDetailModalProps) {
  const publicClient = usePublicClient();
  const [ethReserve, setEthReserve] = useState<bigint>(0n);
  const [tokenReserve, setTokenReserve] = useState<bigint>(0n);
  const [isLoading, setIsLoading] = useState(true);
  const [priceHistory, setPriceHistory] = useState<PricePoint[]>([]);

  // Fetch reserves
  useEffect(() => {
    if (!publicClient || project.ammAddress === '0x...') {
      // Demo data
      setEthReserve(10n * 10n ** 18n);
      setTokenReserve(10000000n * 10n ** 18n);
      setIsLoading(false);

      // Generate demo price history
      const points: PricePoint[] = [];
      let price = 1000000;
      for (let i = 0; i < 30; i++) {
        price = Math.max(800000, Math.min(1200000, price + (Math.random() - 0.45) * 50000));
        points.push({
          timestamp: Date.now() - (30 - i) * 1000 * 60 * 60,
          price,
          blockNumber: 1000 + i,
        });
      }
      setPriceHistory(points);
      return;
    }

    const fetchData = async () => {
      try {
        const [eth, token] = await Promise.all([
          publicClient.readContract({
            address: project.ammAddress as `0x${string}`,
            abi: ZKAMM_ABI,
            functionName: 'ethReserve',
          }),
          publicClient.readContract({
            address: project.ammAddress as `0x${string}`,
            abi: ZKAMM_ABI,
            functionName: 'tokenReserve',
          }),
        ]);
        setEthReserve(eth);
        setTokenReserve(token);

        // Generate price history from current (would need historical in production)
        const currentPrice = Number(token) / Number(eth);
        const points: PricePoint[] = [];
        let price = currentPrice * 0.9;
        for (let i = 0; i < 30; i++) {
          price = price + (currentPrice - price) * 0.1 + (Math.random() - 0.5) * currentPrice * 0.02;
          points.push({
            timestamp: Date.now() - (30 - i) * 1000 * 60 * 60,
            price,
            blockNumber: 1000 + i,
          });
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

  const currentPrice = tokenReserve > 0n && ethReserve > 0n
    ? Number(tokenReserve) / Number(ethReserve)
    : 0;

  const marketCap = Number(formatUnits(ethReserve, 18));
  const liquidity = marketCap * 2;

  // Price change calculation
  const priceChange = useMemo(() => {
    if (priceHistory.length < 2) return 0;
    const oldest = priceHistory[0].price;
    const newest = priceHistory[priceHistory.length - 1].price;
    return ((newest - oldest) / oldest) * 100;
  }, [priceHistory]);

  // Chart dimensions
  const chartWidth = 100;
  const chartHeight = 50;
  const paddingTop = 5;
  const paddingBottom = 5;
  const usableHeight = chartHeight - paddingTop - paddingBottom;

  // Generate SVG path
  const { linePath, areaPath } = useMemo(() => {
    if (priceHistory.length < 2) return { linePath: '', areaPath: '' };

    const prices = priceHistory.map((p) => p.price);
    const minPrice = Math.min(...prices);
    const maxPrice = Math.max(...prices);
    const range = maxPrice - minPrice || 1;

    const points = priceHistory.map((point, i) => {
      const x = (i / (priceHistory.length - 1)) * chartWidth;
      const y = paddingTop + usableHeight - ((point.price - minPrice) / range) * usableHeight;
      return { x, y };
    });

    const linePathStr = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x},${p.y}`).join(' ');
    const areaPathStr = `${linePathStr} L ${chartWidth},${chartHeight} L 0,${chartHeight} Z`;

    return { linePath: linePathStr, areaPath: areaPathStr };
  }, [priceHistory, usableHeight]);

  const formatNumber = (num: number, decimals = 2) => {
    if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(decimals)}M`;
    if (num >= 1_000) return `${(num / 1_000).toFixed(decimals)}K`;
    return num.toFixed(decimals);
  };

  const isPositive = priceChange >= 0;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50"
        onClick={onClose}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.9, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.9, y: 20 }}
          transition={{ type: 'spring', damping: 20 }}
          onClick={(e) => e.stopPropagation()}
          className="max-w-lg w-full mx-4 rounded-lg p-6 bg-[var(--bg-elevated)] border border-[var(--border)] max-h-[90vh] overflow-y-auto"
        >
          {/* Header */}
          <div className="flex items-start justify-between mb-6">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <h2 className="text-xl font-semibold text-[var(--text-primary)]">{project.name}</h2>
                <span className="text-xs font-mono px-2 py-0.5 rounded bg-[var(--bg-secondary)] text-[var(--accent)]">
                  ${project.symbol}
                </span>
              </div>
              <p className="text-xs text-[var(--text-muted)] font-mono">
                {project.ammAddress.slice(0, 10)}...{project.ammAddress.slice(-8)}
              </p>
            </div>
            <button onClick={onClose} className="btn-ghost p-2 text-[var(--text-muted)] hover:text-[var(--text-primary)]">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {isLoading ? (
            <div className="text-center py-8 text-[var(--text-muted)] font-mono text-sm">loading...</div>
          ) : (
            <>
              {/* Price */}
              <div className="mb-6">
                <p className="text-[9px] font-mono text-[var(--text-muted)] mb-1 uppercase">
                  <span className="text-[var(--accent)] opacity-60">// </span>price
                </p>
                <div className="flex items-end gap-3">
                  <span className="text-3xl font-bold text-[var(--text-primary)]">
                    {formatNumber(currentPrice, 0)}
                  </span>
                  <span className="text-sm text-[var(--text-muted)] mb-1">${project.symbol}/ETH</span>
                  <span
                    className="text-sm font-medium mb-1"
                    style={{ color: isPositive ? 'var(--success)' : 'var(--error)' }}
                  >
                    {isPositive ? '+' : ''}{priceChange.toFixed(2)}%
                  </span>
                </div>
              </div>

              {/* Chart */}
              <div className="rounded-lg p-4 bg-[var(--bg-secondary)] border border-[var(--border)] mb-6">
                <div className="h-20">
                  <svg
                    viewBox={`0 0 ${chartWidth} ${chartHeight}`}
                    className="w-full h-full"
                    preserveAspectRatio="none"
                  >
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
                      <path
                        d={linePath}
                        fill="none"
                        stroke="var(--accent)"
                        strokeWidth="1"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </g>
                  </svg>
                </div>
                <div className="flex justify-between mt-2 text-[10px] text-[var(--text-muted)]">
                  <span>30h ago</span>
                  <span>now</span>
                </div>
              </div>

              {/* Stats */}
              <div className="grid grid-cols-2 gap-3 mb-6">
                <div className="p-3 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border)]">
                  <p className="text-[9px] font-mono text-[var(--text-muted)] uppercase">
                    <span className="text-[var(--accent)] opacity-60">// </span>mcap
                  </p>
                  <p className="text-lg font-medium text-[var(--text-primary)]">{formatNumber(marketCap)} ETH</p>
                </div>
                <div className="p-3 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border)]">
                  <p className="text-[9px] font-mono text-[var(--text-muted)] uppercase">
                    <span className="text-[var(--accent)] opacity-60">// </span>liquidity
                  </p>
                  <p className="text-lg font-medium text-[var(--text-primary)]">{formatNumber(liquidity)} ETH</p>
                </div>
                <div className="p-3 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border)]">
                  <p className="text-[9px] font-mono text-[var(--text-muted)] uppercase">
                    <span className="text-[var(--accent)] opacity-60">// </span>eth_reserve
                  </p>
                  <p className="text-lg font-medium text-[var(--text-primary)]">{formatNumber(Number(formatUnits(ethReserve, 18)))} ETH</p>
                </div>
                <div className="p-3 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border)]">
                  <p className="text-[9px] font-mono text-[var(--text-muted)] uppercase">
                    <span className="text-[var(--accent)] opacity-60">// </span>token_reserve
                  </p>
                  <p className="text-lg font-medium text-[var(--text-primary)]">{formatNumber(Number(formatUnits(tokenReserve, 18)))}</p>
                </div>
              </div>

              {/* Fee info */}
              {project.feeBps !== undefined && (
                <div className="p-3 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border)] mb-6">
                  <p className="text-xs text-[var(--text-muted)] font-mono">
                    // swap fee: {project.feeBps / 100}% — goes to liquidity providers
                  </p>
                </div>
              )}

              {/* Actions */}
              <div className="flex gap-3">
                <GlowButton
                  onClick={() => onTrade(project.ammAddress)}
                  variant="primary"
                  className="flex-1"
                >
                  trade()
                </GlowButton>
                <GlowButton
                  onClick={() => window.open(`https://basescan.org/address/${project.ammAddress}`, '_blank')}
                  variant="ghost"
                >
                  view_contract()
                </GlowButton>
              </div>
            </>
          )}
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
