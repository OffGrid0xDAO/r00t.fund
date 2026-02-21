/**
 * Momentum Strategy
 *
 * Buys when price is rising, sells when price is falling.
 * Classic trend-following approach.
 */

import { BaseStrategy, TradeDecision, MarketState, AgentBalance } from './BaseStrategy.js';
import { CONFIG } from '../../config.js';

export class MomentumStrategy extends BaseStrategy {
  name = 'Momentum';

  private threshold = CONFIG.MOMENTUM_THRESHOLD;

  decide(market: MarketState, balance: AgentBalance): TradeDecision {
    const { priceHistory } = market;

    // Need at least 3 price points
    if (priceHistory.length < 3) {
      return { action: 'HOLD', amount: 0n, reason: 'Insufficient data' };
    }

    // Calculate momentum (price change over recent period)
    const momentum = this.momentum(priceHistory, 3);
    const priceChange = momentum / priceHistory[priceHistory.length - 3];

    // Price rising → BUY
    if (priceChange > this.threshold && this.canBuy(balance)) {
      const amount = this.organicAmount(CONFIG.MIN_TRADE_ETH, CONFIG.MAX_TRADE_ETH, balance.eth - CONFIG.GAS_BUFFER);
      return {
        action: 'BUY',
        amount,
        reason: `Momentum UP: ${(priceChange * 100).toFixed(2)}%`
      };
    }

    // Price falling → SELL
    if (priceChange < -this.threshold && this.canSell(balance)) {
      const note = balance.tokenNotes?.[0];
      const amount = note?.amount ?? balance.tokens;
      return {
        action: 'SELL',
        amount,
        reason: `Momentum DOWN: ${(priceChange * 100).toFixed(2)}%`
      };
    }

    return { action: 'HOLD', amount: 0n, reason: `Momentum neutral: ${(priceChange * 100).toFixed(2)}%` };
  }
}
