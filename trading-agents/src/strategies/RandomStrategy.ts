/**
 * Random Strategy
 *
 * Makes random buy/sell decisions.
 * Useful for generating organic-looking volume.
 */

import { BaseStrategy, TradeDecision, MarketState, AgentBalance } from './BaseStrategy.js';
import { CONFIG } from '../../config.js';

export class RandomStrategy extends BaseStrategy {
  name = 'Random';

  private buyProbability = 0.4;   // 40% chance to buy
  private sellProbability = 0.3;  // 30% chance to sell
  // 30% chance to hold

  decide(market: MarketState, balance: AgentBalance): TradeDecision {
    const rand = Math.random();

    // Random buy
    if (rand < this.buyProbability && this.canBuy(balance)) {
      const amount = this.organicAmount(CONFIG.MIN_TRADE_ETH, CONFIG.MAX_TRADE_ETH, balance.eth - CONFIG.GAS_BUFFER);
      return {
        action: 'BUY',
        amount,
        reason: 'Random buy'
      };
    }

    // Random sell
    if (rand < this.buyProbability + this.sellProbability && this.canSell(balance)) {
      const note = balance.tokenNotes?.[0];
      const amount = note?.amount ?? balance.tokens;
      return {
        action: 'SELL',
        amount,
        reason: 'Random sell'
      };
    }

    return { action: 'HOLD', amount: 0n, reason: 'Random hold' };
  }
}
