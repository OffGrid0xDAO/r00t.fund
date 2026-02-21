import { useMemo, useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { usePriceHistory, TimeFrame } from '../hooks/usePriceHistory';
import { TOKEN, getExplorerTxUrl } from '../config';
import { OHLCVChart, ChartToggle, DisplayToggle, type ChartViewMode, type DisplayMode } from './OHLCVChart';
import { ExpandChartButton } from './ChartModal';

// Custom event name for trade completion notifications
export const TRADE_COMPLETE_EVENT = 'r00t-trade-complete';

interface PriceChartProps {
  zkAMMAddress: string;
  onExpand?: () => void;
  isExpanded?: boolean;
}

const TIMEFRAMES: { value: TimeFrame; label: string }[] = [
  { value: '5m', label: '5m' },
  { value: '1h', label: '1H' },
  { value: '4h', label: '4H' },
  { value: '1d', label: '1D' },
  { value: '7d', label: '7D' },
];

const TIMEFRAME_LABELS: Record<TimeFrame, string> = {
  '5m': '5 min',
  '1h': '1 hour',
  '4h': '4 hours',
  '1d': '24 hours',
  '7d': '7 days',
};

// Stat card component
function StatCard({
  label,
  value,
  delay = 0,
}: {
  label: string;
  value: string;
  delay?: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay }}
      whileHover={{ scale: 1.02, y: -2 }}
      className="p-3 rounded-md bg-[var(--bg-secondary)] border border-[var(--border)] hover:border-[var(--accent)] transition-colors"
    >
      <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider font-mono">
        // {label}
      </p>
      <p className="text-sm font-medium text-[var(--text-primary)] mt-1">
        {value}
      </p>
    </motion.div>
  );
}

// Trade type colors and labels
const TRADE_TYPE_CONFIG: Record<string, { color: string; label: string; icon: string }> = {
  buy: { color: 'var(--success)', label: 'buy', icon: '+' },
  sell: { color: 'var(--error)', label: 'sell', icon: '-' },
  add_lp: { color: 'var(--accent)', label: 'add_lp', icon: '+' },
  remove_lp: { color: '#FF8C00', label: 'rem_lp', icon: '-' },
  claim_fees: { color: '#9333EA', label: 'claim', icon: '$' },
};

// Trade row component
function TradeRow({
  trade,
  index,
}: {
  trade: {
    type: 'buy' | 'sell' | 'add_lp' | 'remove_lp' | 'claim_fees';
    txHash: string;
    tokenAmount: number;
    ethAmount: number;
    lpShares?: number;
    timestamp: number;
  };
  index: number;
}) {
  const formatNumber = (num: number, decimals = 2) => {
    if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(decimals)}M`;
    if (num >= 1_000) return `${(num / 1_000).toFixed(decimals)}K`;
    return num.toFixed(decimals);
  };

  const config = TRADE_TYPE_CONFIG[trade.type] || TRADE_TYPE_CONFIG.buy;
  const isLPOperation = ['add_lp', 'remove_lp', 'claim_fees'].includes(trade.type);

  return (
    <motion.a
      initial={{ opacity: 0, x: -10 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.3, delay: index * 0.05 }}
      href={getExplorerTxUrl(trade.txHash)}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-center justify-between px-3 py-2.5 hover:bg-[var(--bg-secondary)] transition-all duration-200 cursor-pointer group"
    >
      <div className="flex items-center gap-2.5">
        <motion.span
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ type: 'spring', stiffness: 500, delay: index * 0.05 + 0.1 }}
          className="w-2 h-2 rounded-full"
          style={{
            background: config.color,
            boxShadow: `0 0 8px ${config.color}`,
          }}
        />
        <span
          className="text-xs font-mono font-medium"
          style={{ color: config.color }}
        >
          {config.label}()
        </span>
        <span className="text-[10px] text-[var(--text-muted)] font-mono opacity-60 group-hover:opacity-100 transition-opacity">
          {trade.txHash?.slice(0, 6)}...{trade.txHash?.slice(-4)}
        </span>
      </div>
      <div className="text-right">
        {isLPOperation ? (
          <>
            <div className="text-xs text-[var(--text-primary)] font-medium">
              {trade.ethAmount.toFixed(4)} ETH
            </div>
            {trade.lpShares && trade.lpShares > 0 && (
              <div className="text-[10px] text-[var(--text-muted)]">
                {formatNumber(trade.lpShares, 2)} LP
              </div>
            )}
          </>
        ) : (
          <>
            <div className="text-xs text-[var(--text-primary)] font-medium">
              {formatNumber(trade.tokenAmount, 0)} ${TOKEN.symbol}
            </div>
            <div className="text-[10px] text-[var(--text-muted)]">
              {trade.ethAmount.toFixed(4)} ETH
            </div>
          </>
        )}
      </div>
    </motion.a>
  );
}

export function PriceChart({ zkAMMAddress, onExpand, isExpanded = false }: PriceChartProps) {
  const [timeFrame, setTimeFrame] = useState<TimeFrame>('5m');
  const [chartView, setChartView] = useState<ChartViewMode>('candles');
  const [displayMode, setDisplayMode] = useState<DisplayMode>('mcap');

  const {
    currentPrice,
    priceChange,
    volume,
    allTimeVolume,
    trades,
    marketCapUsd,
    liquidityUsd,
    isLoading,
    isConnected,
    refreshAll,
    ethPrice,
  } = usePriceHistory(zkAMMAddress, timeFrame);

  // Transform data for market cap display mode
  // For OHLCV chart: pass ALL trades (user can scroll), timeframe controls candle size
  // For line chart: filter by timeframe
  const totalSupply = TOKEN.totalSupply;
  const chartData = useMemo(() => {
    const now = Date.now();
    const timeframeMsMap: Record<TimeFrame, number> = {
      '5m': 5 * 60 * 1000,
      '1h': 60 * 60 * 1000,
      '4h': 4 * 60 * 60 * 1000,
      '1d': 24 * 60 * 60 * 1000,
      '7d': 7 * 24 * 60 * 60 * 1000,
    };
    const cutoff = now - timeframeMsMap[timeFrame];

    // Filtered trades for line chart and stats
    const filteredTrades = trades.filter((t) => t.timestamp >= cutoff);

    // ALL trades for OHLCV chart (sorted oldest first)
    const allTradesSorted = [...trades].sort((a, b) => a.timestamp - b.timestamp);

    // Build history from filtered trades for line chart (oldest first)
    const historyFromTrades = [...filteredTrades]
      .sort((a, b) => a.timestamp - b.timestamp)
      .map((t) => ({
        timestamp: t.timestamp,
        price: t.price,
        ethReserve: 0,
        tokenReserve: 0,
        blockNumber: t.blockNumber,
      }));

    // Add current price point for continuity
    if (currentPrice > 0) {
      if (historyFromTrades.length === 0) {
        // No trades in timeframe - show flat line
        historyFromTrades.push({
          timestamp: now - 60000,
          price: currentPrice,
          ethReserve: 0,
          tokenReserve: 0,
          blockNumber: 0,
        });
      }
      historyFromTrades.push({
        timestamp: now,
        price: currentPrice,
        ethReserve: 0,
        tokenReserve: 0,
        blockNumber: 0,
      });
    }

    if (displayMode === 'price') {
      return {
        history: historyFromTrades,
        current: currentPrice,
        trades: filteredTrades,
        allTrades: allTradesSorted, // All trades for OHLCV chart
      };
    }
    // Market cap mode: price * totalSupply * ethPrice (USD)
    return {
      history: historyFromTrades.map((p) => ({
        ...p,
        price: p.price * totalSupply * ethPrice,
      })),
      current: currentPrice * totalSupply * ethPrice,
      trades: filteredTrades.map((t) => ({
        ...t,
        price: t.price * totalSupply * ethPrice,
      })),
      allTrades: allTradesSorted.map((t) => ({
        ...t,
        price: t.price * totalSupply * ethPrice,
      })),
    };
  }, [displayMode, currentPrice, trades, totalSupply, ethPrice, timeFrame]);

  const [isRefreshing, setIsRefreshing] = useState(false);
  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);
    try {
      await refreshAll();
    } finally {
      setIsRefreshing(false);
    }
  }, [refreshAll]);

  // Listen for trade completion events from SwapPanel to auto-refresh
  useEffect(() => {
    const onTradeComplete = () => {
      console.log('[PriceChart] Trade complete event received, refreshing...');
      handleRefresh();
    };
    window.addEventListener(TRADE_COMPLETE_EVENT, onTradeComplete);
    return () => window.removeEventListener(TRADE_COMPLETE_EVENT, onTradeComplete);
  }, [handleRefresh]);

  const hasData = zkAMMAddress !== '0x...';

  // Chart dimensions
  const chartWidth = 100;
  const chartHeight = 60;
  const paddingTop = 5;
  const paddingBottom = 5;
  const usableHeight = chartHeight - paddingTop - paddingBottom;

  // Generate SVG path for price/mcap line and area
  const { linePath, areaPath, lastPoint } = useMemo(() => {
    if (chartData.history.length < 2) {
      return { linePath: '', areaPath: '', lastPoint: null };
    }

    const values = chartData.history.map((p) => p.price);
    const minValue = Math.min(...values);
    const maxValue = Math.max(...values);
    const valueRange = maxValue - minValue || minValue * 0.1 || 1; // Add some range if flat

    // Use actual data timestamps for x-axis (adapts to data range)
    const timestamps = chartData.history.map((p) => p.timestamp);
    const minTime = Math.min(...timestamps);
    const maxTime = Math.max(...timestamps);
    const timeSpan = maxTime - minTime || 1;

    const points = chartData.history.map((point) => {
      // Calculate x position based on timestamp within data range
      const timeFraction = (point.timestamp - minTime) / timeSpan;
      const x = timeFraction * chartWidth;
      const y = paddingTop + usableHeight - ((point.price - minValue) / valueRange) * usableHeight;
      return { x, y };
    });

    const linePathStr = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x},${p.y}`).join(' ');
    const areaPathStr = `${linePathStr} L ${chartWidth},${chartHeight} L 0,${chartHeight} Z`;

    return {
      linePath: linePathStr,
      areaPath: areaPathStr,
      lastPoint: points[points.length - 1],
    };
  }, [chartData.history, usableHeight]);

  const isPositive = priceChange >= 0;

  // Format numbers
  const formatNumber = (num: number, decimals = 2) => {
    if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(decimals)}M`;
    if (num >= 1_000) return `${(num / 1_000).toFixed(decimals)}K`;
    return num.toFixed(decimals);
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="flex items-start justify-between"
      >
        <div className="flex items-start gap-3">
          {/* Expand button */}
          {onExpand && !isExpanded && (
            <motion.div
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.2 }}
            >
              <ExpandChartButton onClick={onExpand} />
            </motion.div>
          )}
          <div>
            <p className="text-xs font-mono text-[var(--text-muted)] mb-2">
              <span className="text-[var(--accent)] opacity-60">// </span>
              {displayMode === 'price' ? 'price' : 'market_cap'}
              {!hasData && (
                <span className="ml-2 px-1.5 py-0.5 text-[10px] rounded-sm bg-[var(--bg-secondary)] border border-[var(--border)]">
                  not connected
                </span>
              )}
            </p>
          <AnimatePresence mode="wait">
            <motion.div
              key={`${displayMode}-${displayMode === 'price' ? currentPrice : marketCapUsd}`}
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={{ duration: 0.2 }}
              className="flex items-baseline gap-2"
            >
              {displayMode === 'price' ? (
                <>
                  <span className="text-xl text-[var(--text-primary)] font-mono font-medium">
                    {currentPrice > 0 ? currentPrice.toExponential(2) : '—'}
                  </span>
                  <span className="text-xs text-[var(--text-muted)] font-mono">
                    ETH/${TOKEN.symbol}
                  </span>
                </>
              ) : (
                <>
                  <span className="text-xl text-[var(--text-primary)] font-mono font-medium">
                    {marketCapUsd > 0 ? `$${formatNumber(marketCapUsd)}` : '—'}
                  </span>
                  <span className="text-xs text-[var(--text-muted)] font-mono">
                    USD
                  </span>
                </>
              )}
            </motion.div>
          </AnimatePresence>
          </div>
        </div>
        <div className="text-right">
          <motion.div
            key={priceChange}
            initial={{ opacity: 0, y: -5 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
            className="text-sm font-mono"
            style={{
              color: isPositive ? 'var(--success)' : 'var(--error)',
            }}
          >
            {isPositive ? '+' : ''}
            {priceChange.toFixed(2)}%
          </motion.div>
          <div className="text-[10px] text-[var(--text-muted)] font-mono mt-0.5">{TIMEFRAME_LABELS[timeFrame]}</div>
        </div>
      </motion.div>

      {/* Chart Container */}
      <AnimatePresence mode="wait">
        {chartView === 'candles' ? (
          <motion.div
            key="candles-view"
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.98 }}
            transition={{ duration: 0.3 }}
          >
            <OHLCVChart
              trades={chartData.allTrades as any}
              symbol={displayMode === 'price' ? `${TOKEN.symbol}/ETH` : `${TOKEN.symbol} MCap`}
              timeframe={timeFrame === '5m' ? 1 : timeFrame === '1h' ? 5 : timeFrame === '4h' ? 15 : timeFrame === '1d' ? 30 : 60}
              height={isExpanded ? 500 : 320}
              showVolume={true}
              currentPrice={chartData.current}
              isPositive={isPositive}
              isLoading={isLoading}
            />
          </motion.div>
        ) : (
          <motion.div
            key="line-view"
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.98 }}
            transition={{ duration: 0.3 }}
            className="relative rounded-2xl p-4 bg-[var(--bg-secondary)] border border-[var(--border)] overflow-hidden"
          >
            {/* Background glow effect */}
            <div
              className="absolute inset-0 opacity-30 pointer-events-none"
              style={{
                background: `radial-gradient(ellipse at 70% 30%, ${isPositive ? 'var(--success)' : 'var(--error)'}15 0%, transparent 60%)`,
              }}
            />

            <AnimatePresence mode="wait">
              {isLoading ? (
                <motion.div
                  key="loading"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="h-24 flex items-center justify-center"
                >
                  <div className="flex items-center gap-2">
                    <motion.div
                      animate={{ rotate: 360 }}
                      transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
                      className="w-4 h-4 border-2 border-[var(--accent)] border-t-transparent rounded-full"
                    />
                    <span className="text-[var(--text-muted)] text-sm font-mono">loading...</span>
                  </div>
                </motion.div>
              ) : chartData.history.length < 2 ? (
                <motion.div
                  key="empty"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="h-24 flex items-center justify-center text-[var(--text-muted)] text-sm font-mono"
                >
                  // no trades yet
                </motion.div>
              ) : (
                <motion.div
                  key="chart"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="h-24 relative"
                >
                  <svg
                    viewBox={`0 0 ${chartWidth} ${chartHeight}`}
                    className="w-full h-full"
                    preserveAspectRatio="none"
                  >
                    {/* Enhanced gradient definitions */}
                    <defs>
                      {/* Area gradient */}
                      <linearGradient id="areaGradientNew" x1="0" y1="0" x2="0" y2="1">
                        <stop
                          offset="0%"
                          stopColor={isPositive ? 'var(--success)' : 'var(--error)'}
                          stopOpacity="0.4"
                        />
                        <stop
                          offset="50%"
                          stopColor={isPositive ? 'var(--success)' : 'var(--error)'}
                          stopOpacity="0.15"
                        />
                        <stop
                          offset="100%"
                          stopColor={isPositive ? 'var(--success)' : 'var(--error)'}
                          stopOpacity="0"
                        />
                      </linearGradient>

                      {/* Line glow gradient */}
                      <linearGradient id="lineGlow" x1="0" y1="0" x2="1" y2="0">
                        <stop offset="0%" stopColor={isPositive ? 'var(--success)' : 'var(--error)'} stopOpacity="0.5" />
                        <stop offset="50%" stopColor={isPositive ? 'var(--success)' : 'var(--error)'} stopOpacity="1" />
                        <stop offset="100%" stopColor={isPositive ? 'var(--success)' : 'var(--error)'} stopOpacity="1" />
                      </linearGradient>

                      {/* Edge fade mask */}
                      <linearGradient id="edgeFadeNew" x1="0" y1="0" x2="1" y2="0">
                        <stop offset="0%" stopColor="white" stopOpacity="0" />
                        <stop offset="5%" stopColor="white" stopOpacity="1" />
                        <stop offset="95%" stopColor="white" stopOpacity="1" />
                        <stop offset="100%" stopColor="white" stopOpacity="0.8" />
                      </linearGradient>
                      <mask id="edgeMaskNew">
                        <rect x="0" y="0" width={chartWidth} height={chartHeight} fill="url(#edgeFadeNew)" />
                      </mask>

                      {/* Glow filter */}
                      <filter id="chartGlow" x="-20%" y="-20%" width="140%" height="140%">
                        <feGaussianBlur stdDeviation="1.5" result="coloredBlur" />
                        <feMerge>
                          <feMergeNode in="coloredBlur" />
                          <feMergeNode in="SourceGraphic" />
                        </feMerge>
                      </filter>
                    </defs>

                    {/* Area fill */}
                    <g mask="url(#edgeMaskNew)">
                      <motion.path
                        d={areaPath}
                        fill="url(#areaGradientNew)"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ duration: 0.8, delay: 0.3 }}
                      />
                    </g>

                    {/* Price line with glow */}
                    <g mask="url(#edgeMaskNew)" filter="url(#chartGlow)">
                      <motion.path
                        d={linePath}
                        fill="none"
                        stroke="url(#lineGlow)"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        initial={{ pathLength: 0 }}
                        animate={{ pathLength: 1 }}
                        transition={{ duration: 1.2, ease: 'easeOut' }}
                      />
                    </g>

                    {/* Current price dot with pulse */}
                    {lastPoint && (
                      <g>
                        {/* Pulse ring */}
                        <motion.circle
                          cx={lastPoint.x}
                          cy={lastPoint.y}
                          r="3"
                          fill="none"
                          stroke={isPositive ? 'var(--success)' : 'var(--error)'}
                          strokeWidth="1"
                          initial={{ scale: 0, opacity: 0 }}
                          animate={{
                            scale: [1, 1.8, 1],
                            opacity: [0.8, 0, 0.8],
                          }}
                          transition={{
                            duration: 2,
                            repeat: Infinity,
                            ease: 'easeOut',
                            delay: 1.2,
                          }}
                        />
                        {/* Main dot */}
                        <motion.circle
                          cx={lastPoint.x}
                          cy={lastPoint.y}
                          r="2.5"
                          fill={isPositive ? 'var(--success)' : 'var(--error)'}
                          initial={{ scale: 0 }}
                          animate={{ scale: 1 }}
                          transition={{
                            type: 'spring',
                            stiffness: 300,
                            damping: 15,
                            delay: 1,
                          }}
                          style={{
                            filter: `drop-shadow(0 0 4px ${isPositive ? 'var(--success)' : 'var(--error)'})`,
                          }}
                        />
                      </g>
                    )}
                  </svg>
                </motion.div>
              )}
            </AnimatePresence>

            {/* X-axis labels */}
            {chartData.history.length >= 2 && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.5 }}
                className="flex justify-between mt-2"
              >
                <span className="text-[10px] text-[var(--text-muted)] font-mono">
                  {(() => {
                    const timestamps = chartData.history.map((p) => p.timestamp);
                    const minTime = Math.min(...timestamps);
                    const ageMs = Date.now() - minTime;
                    if (ageMs < 60 * 1000) return `${Math.round(ageMs / 1000)}s ago`;
                    if (ageMs < 60 * 60 * 1000) return `${Math.round(ageMs / 60000)}m ago`;
                    if (ageMs < 24 * 60 * 60 * 1000) return `${(ageMs / 3600000).toFixed(1)}h ago`;
                    return `${(ageMs / 86400000).toFixed(1)}d ago`;
                  })()}
                </span>
                <span className="text-[10px] text-[var(--text-muted)] font-mono">now</span>
              </motion.div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Chart Controls - Below Chart */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.3, delay: 0.2 }}
        className="flex items-center justify-between"
      >
        <ChartToggle mode={chartView} onChange={setChartView} />
        <DisplayToggle mode={displayMode} onChange={setDisplayMode} />
      </motion.div>

      {/* Timeframe Selector - Bottom */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.1 }}
        className="flex gap-1 p-1 rounded-md bg-[var(--bg-secondary)] border border-[var(--border)]"
      >
        {TIMEFRAMES.map((tf) => (
          <motion.button
            key={tf.value}
            onClick={() => setTimeFrame(tf.value)}
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            className={`relative flex-1 px-3 py-1.5 text-xs font-mono rounded-lg transition-colors ${
              timeFrame === tf.value
                ? 'text-[var(--text-primary)]'
                : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
            }`}
          >
            {timeFrame === tf.value && (
              <motion.div
                layoutId="timeframeIndicator"
                className="absolute inset-0 rounded-lg"
                style={{
                  background: 'var(--bg-secondary)',
                  border: '1px solid var(--accent)',
                  boxShadow: '0 0 15px var(--accent)20',
                }}
                transition={{ type: 'spring', stiffness: 400, damping: 30 }}
              />
            )}
            <span className="relative z-10">{tf.label}</span>
          </motion.button>
        ))}
      </motion.div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 gap-2">
        <StatCard
          label="mcap"
          value={marketCapUsd > 0 ? `$${formatNumber(marketCapUsd)}` : '—'}
          delay={0.3}
        />
        <StatCard
          label="liquidity"
          value={liquidityUsd > 0 ? `$${formatNumber(liquidityUsd)}` : '—'}
          delay={0.35}
        />
        <StatCard
          label={volume > 0 ? `${timeFrame} vol` : 'all vol'}
          value={`${(volume > 0 ? volume : allTimeVolume).toFixed(4)} ETH`}
          delay={0.4}
        />
        <StatCard label="trades" value={trades.length.toString()} delay={0.45} />
      </div>

      {/* Live Trades Feed */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.5 }}
        className="rounded-2xl bg-[var(--bg-secondary)] border border-[var(--border)] overflow-hidden"
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border)]">
          <p className="text-xs text-[var(--text-muted)] uppercase tracking-wider font-mono">
            <span className="text-[var(--accent)] opacity-60">// </span>
            live_feed
          </p>
          <div className="flex items-center gap-3">
            <motion.button
              onClick={handleRefresh}
              disabled={isRefreshing}
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              className="text-[10px] text-[var(--text-muted)] font-mono hover:text-[var(--accent)] transition-colors disabled:opacity-50"
            >
              {isRefreshing ? (
                <motion.span
                  animate={{ rotate: 360 }}
                  transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
                  className="inline-block"
                >
                  ↻
                </motion.span>
              ) : (
                '↻ refresh'
              )}
            </motion.button>
            <div className="flex items-center gap-2">
              <motion.span
                animate={{
                  scale: isConnected ? [1, 1.2, 1] : 1,
                  opacity: isConnected ? 1 : 0.5,
                }}
                transition={{
                  duration: 1.5,
                  repeat: isConnected ? Infinity : 0,
                  ease: 'easeInOut',
                }}
                className="w-2 h-2 rounded-full"
                style={{
                  background: isConnected ? 'var(--success)' : 'var(--warning)',
                  boxShadow: isConnected ? '0 0 8px var(--success)' : 'none',
                }}
              />
              <span className="text-[10px] text-[var(--text-muted)] font-mono">
                {isConnected ? 'connected' : 'connecting...'}
              </span>
            </div>
          </div>
        </div>

        <div className="max-h-36 overflow-y-auto">
          <AnimatePresence>
            {trades.length === 0 ? (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="text-center text-[var(--text-muted)] text-xs font-mono py-6"
              >
                // waiting for trades...
              </motion.div>
            ) : (
              <div className="divide-y divide-[var(--border)]">
                {trades.slice(0, 8).map((trade, i) => (
                  <TradeRow key={trade.txHash || i} trade={trade} index={i} />
                ))}
              </div>
            )}
          </AnimatePresence>
        </div>
      </motion.div>
    </div>
  );
}
