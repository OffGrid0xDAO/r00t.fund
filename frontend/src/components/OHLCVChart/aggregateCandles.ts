/**
 * Candle Aggregation Logic
 *
 * Aggregates raw trades into OHLCV candles with intelligent gap handling.
 *
 * KEY BEHAVIOR: When no trades exist in a time period, we "glue" candles together
 * rather than creating empty candles. This provides visual continuity while
 * marking time discontinuities with gapBefore flag.
 *
 * Algorithm:
 * 1. Group trades by time bucket (e.g., 5-minute intervals)
 * 2. For each bucket WITH trades, calculate OHLCV
 * 3. Skip empty buckets entirely (glue behavior)
 * 4. Track gaps: if previous candle was >1 interval ago, mark gapBefore=true
 * 5. Carry forward: new candle's open = previous candle's close (price continuity)
 */

import type { Trade, Candle, AggregationOptions } from './types';

/** Default 5-minute candle interval */
const DEFAULT_INTERVAL_MS = 5 * 60 * 1000;

/**
 * Aggregates raw trades into OHLCV candles
 *
 * @param trades - Raw trades from Ponder (should be sorted by timestamp)
 * @param options - Aggregation options
 * @returns Array of candles with gap indicators
 */
export function aggregateToCandles(
  trades: Trade[],
  options: Partial<AggregationOptions> = {}
): Candle[] {
  const { intervalMs = DEFAULT_INTERVAL_MS } = options;

  if (!trades.length) return [];

  // Sort trades by timestamp (oldest first)
  const sortedTrades = [...trades].sort((a, b) => a.timestamp - b.timestamp);

  // Group trades by time bucket
  const buckets = new Map<number, Trade[]>();

  for (const trade of sortedTrades) {
    // Floor timestamp to bucket start
    const bucketTime = Math.floor(trade.timestamp / intervalMs) * intervalMs;

    if (!buckets.has(bucketTime)) {
      buckets.set(bucketTime, []);
    }
    buckets.get(bucketTime)!.push(trade);
  }

  // Convert buckets to candles (sorted by time)
  const bucketTimes = Array.from(buckets.keys()).sort((a, b) => a - b);
  const candles: Candle[] = [];

  let previousClose: number | null = null;
  let previousTime: number | null = null;

  for (const bucketTime of bucketTimes) {
    const bucketTrades = buckets.get(bucketTime)!;

    // Calculate OHLCV from bucket trades
    const prices = bucketTrades.map((t) => t.price);
    const volumes = bucketTrades.map((t) => t.amount);

    // Determine if there's a time gap
    // A gap exists if more than one interval has passed since the last candle
    const hasGap = previousTime !== null && bucketTime - previousTime > intervalMs;
    const gapDuration = hasGap && previousTime !== null ? bucketTime - previousTime - intervalMs : undefined;

    // Open price: use previous close for continuity, or first trade price
    const open = previousClose !== null ? previousClose : prices[0];

    const candle: Candle = {
      time: bucketTime,
      open,
      high: Math.max(...prices),
      low: Math.min(...prices),
      close: prices[prices.length - 1],
      volume: volumes.reduce((sum, v) => sum + v, 0),
      tradeCount: bucketTrades.length,
      gapBefore: hasGap,
      gapDuration,
    };

    candles.push(candle);

    previousClose = candle.close;
    previousTime = bucketTime;
  }

  return candles;
}

/**
 * Converts existing usePriceHistory trades to our Trade format
 * The existing hook returns trades with different field names
 */
export function convertPriceHistoryTrades(
  historyTrades: Array<{
    type: 'buy' | 'sell' | 'add_lp' | 'remove_lp' | 'claim_fees';
    ethAmount: number;
    tokenAmount: number;
    price: number;
    timestamp: number;
    txHash: string;
    blockNumber: number;
  }>
): Trade[] {
  // Filter to only buy/sell trades (LP operations don't have meaningful prices)
  return historyTrades
    .filter((t) => t.type === 'buy' || t.type === 'sell')
    .map((t) => ({
      timestamp: t.timestamp,
      price: t.price,
      amount: t.ethAmount, // Use ETH amount as volume
      side: t.type as 'buy' | 'sell',
      txHash: t.txHash,
      blockNumber: t.blockNumber,
    }));
}

/**
 * Calculate price range for chart scaling
 */
export function calculatePriceRange(candles: Candle[]): { min: number; max: number; range: number } {
  if (!candles.length) return { min: 0, max: 0, range: 0 };

  const highs = candles.map((c) => c.high);
  const lows = candles.map((c) => c.low);

  const max = Math.max(...highs);
  const min = Math.min(...lows);
  const range = max - min || max * 0.1 || 1; // Prevent zero range

  return { min, max, range };
}

/**
 * Calculate volume range for subplot scaling
 */
export function calculateVolumeRange(candles: Candle[]): { max: number } {
  if (!candles.length) return { max: 0 };
  return { max: Math.max(...candles.map((c) => c.volume)) };
}

/**
 * Get gap duration formatted string
 */
export function formatGapDuration(ms: number): string {
  const minutes = Math.floor(ms / 60000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ${hours % 24}h`;
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  return `${minutes}m`;
}
