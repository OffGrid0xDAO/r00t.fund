/**
 * Mean Reversion Strategy
 *
 * Buys when price is below moving average (oversold)
 * Sells when price is above moving average (overbought)
 * Classic contrarian approach.
 */

import { BaseStrategy, TradeDecision, MarketState, AgentBalance } from './BaseStrategy.js';
import { CONFIG } from '../../config.js';

export class MeanReversionStrategy extends BaseStrategy {
  name = 'MeanReversion';

  private threshold = CONFIG.MEAN_REVERSION_THRESHOLD;
  private smaPeriod = 10;

  decide(market: MarketState, balance: AgentBalance): TradeDecision {
    const { priceHistory, price } = market;

    // Need enough data for SMA
    if (priceHistory.length < this.smaPeriod) {
      return { action: 'HOLD', amount: 0n, reason: 'Insufficient data for SMA' };
    }

    const mean = this.sma(priceHistory, this.smaPeriod);
    const deviation = (price - mean) / mean;

    // Price below mean → BUY the dip
    if (deviation < -this.threshold && this.canBuy(balance)) {
      const amount = this.organicAmount(CONFIG.MIN_TRADE_ETH, CONFIG.MAX_TRADE_ETH, balance.eth - CONFIG.GAS_BUFFER);
      return {
        action: 'BUY',
        amount,
        reason: `Below mean: ${(deviation * 100).toFixed(2)}%`
      };
    }

    // Price above mean → SELL the pump
    if (deviation > this.threshold && this.canSell(balance)) {
      const note = balance.tokenNotes?.[0];
      const amount = note?.amount ?? balance.tokens;
      return {
        action: 'SELL',
        amount,
        reason: `Above mean: ${(deviation * 100).toFixed(2)}%`
      };
    }

    return { action: 'HOLD', amount: 0n, reason: `Near mean: ${(deviation * 100).toFixed(2)}%` };
  }
}
