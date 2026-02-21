/**
 * OHLCV Candlestick Chart Types
 *
 * Type definitions for candlestick chart data structures
 * including raw trades, aggregated candles, and gap handling.
 */

/** Raw trade from Ponder indexer */
export interface Trade {
  timestamp: number;      // Unix timestamp in milliseconds
  price: number;          // Trade price (ETH per token)
  amount: number;         // Trade volume
  side?: 'buy' | 'sell';  // Trade direction
  txHash?: string;        // Transaction hash
  blockNumber?: number;   // Block number
}

/** Aggregated OHLCV candle */
export interface Candle {
  time: number;           // Candle open timestamp (ms)
  open: number;           // Opening price
  high: number;           // Highest price
  low: number;            // Lowest price
  close: number;          // Closing price
  volume: number;         // Total volume
  tradeCount: number;     // Number of trades in candle
  gapBefore?: boolean;    // Indicates time discontinuity (no trades in previous periods)
  gapDuration?: number;   // Duration of gap in milliseconds
}

/** Chart view mode */
export type ChartViewMode = 'line' | 'candles';

/** OHLCV Chart component props */
export interface OHLCVChartProps {
  /** Raw trades from Ponder indexer */
  trades: Trade[];
  /** Trading pair symbol (e.g., "R00T/ETH") */
  symbol?: string;
  /** Candle timeframe in minutes (default: 5) */
  timeframe?: number;
  /** Chart height in pixels or CSS value */
  height?: number | string;
  /** Show volume subplot */
  showVolume?: boolean;
  /** Additional CSS classes */
  className?: string;
  /** Callback when hovering over a candle */
  onCandleHover?: (candle: Candle | null) => void;
  /** Callback when clicking a candle */
  onCandleClick?: (candle: Candle) => void;
  /** Current price for live price line */
  currentPrice?: number;
  /** Whether price is positive change */
  isPositive?: boolean;
  /** Loading state */
  isLoading?: boolean;
}

/** Chart toggle switch props */
export interface ChartToggleProps {
  /** Current view mode */
  mode: ChartViewMode;
  /** Callback when mode changes */
  onChange: (mode: ChartViewMode) => void;
  /** Additional CSS classes */
  className?: string;
}

/** Candle aggregation options */
export interface AggregationOptions {
  /** Candle interval in milliseconds */
  intervalMs: number;
  /** Whether to fill gaps with empty candles (default: false - glue behavior) */
  fillGaps?: boolean;
}

/** Tooltip data for crosshair */
export interface TooltipData {
  candle: Candle;
  x: number;
  y: number;
  priceY: number;
}
