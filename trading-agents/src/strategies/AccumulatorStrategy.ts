/**
 * Accumulator Strategy
 *
 * Steadily accumulates tokens over time (DCA-like).
 * Buys on a schedule regardless of price.
 * Only sells if price pumps significantly.
 */

import { BaseStrategy, TradeDecision, MarketState, AgentBalance } from './BaseStrategy.js';
import { CONFIG } from '../../config.js';

export class AccumulatorStrategy extends BaseStrategy {
  name = 'Accumulator';

  private lastBuyTime = 0;
  private buyInterval = 60000; // Buy every 60 seconds
  private takeProfitThreshold = 0.15; // Sell if up 15%
  private entryPrice = 0;

  decide(market: MarketState, balance: AgentBalance): TradeDecision {
    const now = Date.now();
    const { price } = market;

    // Track entry price for profit calculation
    if (this.entryPrice === 0 && balance.tokens > 0n) {
      this.entryPrice = price;
    }

    // Take profit if up significantly
    if (this.entryPrice > 0 && price > this.entryPrice * (1 + this.takeProfitThreshold)) {
      if (this.canSell(balance)) {
        const note = balance.tokenNotes?.[0];
        const amount = note?.amount ?? balance.tokens;
        this.entryPrice = 0; // Reset
        return {
          action: 'SELL',
          amount,
          reason: `Take profit: +${((price / this.entryPrice - 1) * 100).toFixed(2)}%`
        };
      }
    }

    // Time-based buying (DCA)
    if (now - this.lastBuyTime > this.buyInterval && this.canBuy(balance)) {
      this.lastBuyTime = now;
      // Use consistent amount for DCA
      const amount = CONFIG.MIN_TRADE_ETH + (CONFIG.MAX_TRADE_ETH - CONFIG.MIN_TRADE_ETH) / 2n;
      const safeAmount = amount > balance.eth - CONFIG.GAS_BUFFER ? balance.eth - CONFIG.GAS_BUFFER : amount;

      if (safeAmount > CONFIG.MIN_TRADE_ETH) {
        if (this.entryPrice === 0) this.entryPrice = price;
        return {
          action: 'BUY',
          amount: safeAmount,
          reason: 'Scheduled accumulation'
        };
      }
    }

    return { action: 'HOLD', amount: 0n, reason: 'Waiting for next buy window' };
  }
}
