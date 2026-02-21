/**
 * Base Strategy - Abstract class for all trading strategies
 *
 * To create a new strategy:
 * 1. Extend this class
 * 2. Implement the `decide()` method
 * 3. Add to strategy factory in index.ts
 */

import { CONFIG } from '../../config.js';
import type { TradeDecision, MarketState, AgentBalance } from '../types.js';

export abstract class BaseStrategy {
  /** Strategy name for logging */
  abstract name: string;

  /** Reference to config */
  protected config = CONFIG;

  /**
   * Decide what trade to make based on market state and balance
   *
   * @param market - Current market state (price, reserves, history)
   * @param balance - Agent's current balance (ETH and tokens)
   * @returns Trade decision (BUY, SELL, or HOLD with amount and reason)
   */
  abstract decide(market: MarketState, balance: AgentBalance): TradeDecision;

  /**
   * Generate a random trade amount within configured bounds
   */
  protected randomAmount(min: bigint = CONFIG.MIN_TRADE_ETH, max: bigint = CONFIG.MAX_TRADE_ETH): bigint {
    if (max <= min) return min;
    const range = max - min;
    const random = Math.random();
    return min + BigInt(Math.floor(Number(range) * random));
  }

  /**
   * Generate organic-looking trade amount (clustered around middle)
   */
  protected organicAmount(min: bigint, max: bigint, available: bigint): bigint {
    const effectiveMax = max < available ? max : available;
    if (effectiveMax <= min) return min;

    const range = effectiveMax - min;

    // Beta-like distribution for natural clustering
    const r1 = Math.random();
    const r2 = Math.random();
    const r3 = Math.random();
    const betaLike = (r1 + r2 + r3) / 3;

    // Add noise for variety
    const noise = (Math.random() - 0.5) * 0.3;
    const factor = Math.max(0, Math.min(1, betaLike + noise));

    return min + BigInt(Math.floor(Number(range) * factor));
  }

  /**
   * Check if we have enough ETH to trade
   */
  protected canBuy(balance: AgentBalance, minAmount: bigint = CONFIG.MIN_TRADE_ETH): boolean {
    return balance.eth > minAmount + CONFIG.GAS_BUFFER;
  }

  /**
   * Check if we have tokens to sell
   */
  protected canSell(balance: AgentBalance): boolean {
    return balance.tokens > 0n || (balance.tokenNotes?.length ?? 0) > 0;
  }

  /**
   * Calculate simple moving average
   */
  protected sma(prices: number[], period: number): number {
    if (prices.length < period) return prices[prices.length - 1] || 0;
    const slice = prices.slice(-period);
    return slice.reduce((a, b) => a + b, 0) / period;
  }

  /**
   * Calculate price momentum (rate of change)
   */
  protected momentum(prices: number[], period: number = 3): number {
    if (prices.length < period) return 0;
    const recent = prices.slice(-period);
    return recent[recent.length - 1] - recent[0];
  }

  /**
   * Calculate RSI (Relative Strength Index)
   */
  protected rsi(prices: number[], period: number = 14): number {
    if (prices.length < period + 1) return 50; // Neutral if not enough data

    let gains = 0;
    let losses = 0;

    for (let i = prices.length - period; i < prices.length; i++) {
      const change = prices[i] - prices[i - 1];
      if (change > 0) gains += change;
      else losses -= change;
    }

    if (losses === 0) return 100;
    const rs = gains / losses;
    return 100 - (100 / (1 + rs));
  }
}

// Re-export types for convenience
export type { TradeDecision, MarketState, AgentBalance };
