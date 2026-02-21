/**
 * Tax Strategy - Sell 20% of external buys
 *
 * Monitors for buys from external users (not our wallets).
 * When detected, sells 20% of their buy amount to capture profit
 * while letting 80% of buy pressure remain (price still goes up).
 */

import { BaseStrategy, TradeDecision, MarketState, AgentBalance } from './BaseStrategy.js';

export interface ExternalBuy {
  buyer: string;
  ethAmount: bigint;
  tokenAmount: bigint;
  txHash: string;
  timestamp: number;
}

export class TaxStrategy extends BaseStrategy {
  name = 'Tax';

  private taxPercent = 20; // Sell 20% of external buys
  private pendingTax: ExternalBuy | null = null;
  private processedTxs = new Set<string>();

  /**
   * Called by the reactive monitor when external buy detected
   */
  setExternalBuy(buy: ExternalBuy): void {
    if (this.processedTxs.has(buy.txHash)) return;
    this.pendingTax = buy;
    console.log(`[Tax] External buy detected: ${buy.buyer.slice(0, 10)}... bought ${buy.tokenAmount} tokens`);
  }

  /**
   * Mark a buy as processed
   */
  markProcessed(txHash: string): void {
    this.processedTxs.add(txHash);
    if (this.pendingTax?.txHash === txHash) {
      this.pendingTax = null;
    }
  }

  decide(market: MarketState, balance: AgentBalance): TradeDecision {
    // If there's a pending external buy to tax
    if (this.pendingTax && this.canSell(balance)) {
      const buy = this.pendingTax;
      const taxAmount = (buy.tokenAmount * BigInt(this.taxPercent)) / 100n;

      // Check if we have enough tokens
      const available = balance.tokenNotes?.[0]?.amount ?? balance.tokens;
      const sellAmount = taxAmount > available ? available : taxAmount;

      if (sellAmount > 0n) {
        this.markProcessed(buy.txHash);
        return {
          action: 'SELL',
          amount: sellAmount,
          reason: `Tax ${this.taxPercent}% of ${buy.buyer.slice(0, 8)}... buy`
        };
      }
    }

    return { action: 'HOLD', amount: 0n, reason: 'Waiting for external buys' };
  }
}
