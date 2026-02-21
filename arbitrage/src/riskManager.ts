import { PRICE_CONSTANTS } from './config';
import type { ArbitrageOpportunity, BotConfig, Position, TradeExecution } from './types';

export interface RiskMetrics {
  dailyPnL: bigint;
  openPositionCount: number;
  totalExposure: bigint;
  winRate: number;
  averageProfit: bigint;
  maxDrawdown: bigint;
  sharpeRatio: number;
}

export interface RiskCheck {
  passed: boolean;
  reason?: string;
  adjustedSize?: bigint;
}

export class RiskManager {
  private config: BotConfig;
  private executions: TradeExecution[] = [];
  private dailyPnL: bigint = 0n;
  private dayStartTimestamp: number;
  private positions: Map<string, Position> = new Map();
  private historicalPnL: bigint[] = [];

  constructor(config: BotConfig) {
    this.config = config;
    this.dayStartTimestamp = this.getDayStart();
  }

  /**
   * Check if an opportunity passes all risk checks
   */
  checkOpportunity(opportunity: ArbitrageOpportunity): RiskCheck {
    // Reset daily PnL if new day
    this.maybeResetDaily();

    // Check 1: Daily loss limit
    if (this.dailyPnL < -this.config.maxDailyLoss) {
      return {
        passed: false,
        reason: `Daily loss limit reached: ${this.formatEth(this.dailyPnL)} ETH`,
      };
    }

    // Check 2: Open position limit
    const openPositions = this.executions.filter(
      (e) => e.status === 'pending' || e.status === 'buying' || e.status === 'selling'
    ).length;

    if (openPositions >= this.config.maxOpenPositions) {
      return {
        passed: false,
        reason: `Max open positions reached: ${openPositions}`,
      };
    }

    // Check 3: Minimum spread
    if (opportunity.spreadBps < this.config.minSpreadBps) {
      return {
        passed: false,
        reason: `Spread too low: ${opportunity.spreadBps} bps (min: ${this.config.minSpreadBps})`,
      };
    }

    // Check 4: Net profit after gas
    if (opportunity.netProfit <= 0n) {
      return {
        passed: false,
        reason: `No net profit after gas: ${this.formatEth(opportunity.netProfit)} ETH`,
      };
    }

    // Check 5: Position size limit
    let adjustedSize = opportunity.maxSize;
    if (adjustedSize > this.config.maxPositionSize) {
      adjustedSize = this.config.maxPositionSize;
    }

    // Check 6: Remaining daily loss capacity
    const maxLossOnTrade = adjustedSize; // Worst case: lose entire position
    const remainingCapacity = this.config.maxDailyLoss + this.dailyPnL;

    if (maxLossOnTrade > remainingCapacity) {
      adjustedSize = remainingCapacity;
      if (adjustedSize <= 0n) {
        return {
          passed: false,
          reason: 'Insufficient daily loss capacity',
        };
      }
    }

    // Check 7: Cooldown between trades
    const lastExecution = this.executions[this.executions.length - 1];
    if (lastExecution) {
      const timeSinceLastTrade = Date.now() - (lastExecution.endTime || lastExecution.startTime);
      if (timeSinceLastTrade < this.config.cooldownMs) {
        return {
          passed: false,
          reason: `Cooldown active: ${this.config.cooldownMs - timeSinceLastTrade}ms remaining`,
        };
      }
    }

    return {
      passed: true,
      adjustedSize,
    };
  }

  /**
   * Record a trade execution
   */
  recordExecution(execution: TradeExecution): void {
    this.executions.push(execution);

    if (execution.status === 'completed' && execution.actualProfit !== undefined) {
      this.dailyPnL += execution.actualProfit;
      this.historicalPnL.push(execution.actualProfit);
    }
  }

  /**
   * Update execution status
   */
  updateExecution(opportunityId: string, update: Partial<TradeExecution>): void {
    const execution = this.executions.find((e) => e.opportunityId === opportunityId);
    if (execution) {
      Object.assign(execution, update);

      if (update.status === 'completed' && update.actualProfit !== undefined) {
        this.dailyPnL += update.actualProfit;
        this.historicalPnL.push(update.actualProfit);
      }
    }
  }

  /**
   * Get current risk metrics
   */
  getMetrics(): RiskMetrics {
    const completedExecutions = this.executions.filter((e) => e.status === 'completed');
    const profitableExecutions = completedExecutions.filter(
      (e) => e.actualProfit !== undefined && e.actualProfit > 0n
    );

    const totalProfit = completedExecutions.reduce(
      (sum, e) => sum + (e.actualProfit || 0n),
      0n
    );

    const openPositionCount = this.executions.filter(
      (e) => e.status === 'pending' || e.status === 'buying' || e.status === 'selling'
    ).length;

    // Calculate max drawdown
    let maxDrawdown = 0n;
    let peak = 0n;
    let runningPnL = 0n;

    for (const pnl of this.historicalPnL) {
      runningPnL += pnl;
      if (runningPnL > peak) {
        peak = runningPnL;
      }
      const drawdown = peak - runningPnL;
      if (drawdown > maxDrawdown) {
        maxDrawdown = drawdown;
      }
    }

    // Calculate Sharpe ratio (simplified)
    const sharpeRatio = this.calculateSharpeRatio();

    return {
      dailyPnL: this.dailyPnL,
      openPositionCount,
      totalExposure: this.calculateTotalExposure(),
      winRate: completedExecutions.length > 0
        ? profitableExecutions.length / completedExecutions.length
        : 0,
      averageProfit: completedExecutions.length > 0
        ? totalProfit / BigInt(completedExecutions.length)
        : 0n,
      maxDrawdown,
      sharpeRatio,
    };
  }

  /**
   * Calculate total exposure across all positions
   */
  private calculateTotalExposure(): bigint {
    let exposure = 0n;
    for (const [, position] of this.positions) {
      exposure += position.darkPoolBalance + position.publicBalance;
    }
    return exposure;
  }

  /**
   * Calculate Sharpe ratio
   */
  private calculateSharpeRatio(): number {
    if (this.historicalPnL.length < 2) return 0;

    const pnlNumbers = this.historicalPnL.map((p) => Number(p) / 1e18);
    const mean = pnlNumbers.reduce((a, b) => a + b, 0) / pnlNumbers.length;

    const variance =
      pnlNumbers.reduce((sum, p) => sum + Math.pow(p - mean, 2), 0) / pnlNumbers.length;
    const stdDev = Math.sqrt(variance);

    if (stdDev === 0) return 0;

    // Annualized Sharpe (assuming ~100 trades per day, 365 days)
    return (mean / stdDev) * Math.sqrt(365 * 100);
  }

  /**
   * Reset daily metrics if new day
   */
  private maybeResetDaily(): void {
    const currentDayStart = this.getDayStart();
    if (currentDayStart > this.dayStartTimestamp) {
      this.dailyPnL = 0n;
      this.dayStartTimestamp = currentDayStart;
      console.log('Daily metrics reset');
    }
  }

  /**
   * Get start of current day (UTC)
   */
  private getDayStart(): number {
    const now = new Date();
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).getTime();
  }

  /**
   * Format ETH amount for display
   */
  private formatEth(wei: bigint): string {
    return (Number(wei) / 1e18).toFixed(6);
  }

  /**
   * Get position for a pool
   */
  getPosition(pool: string): Position | undefined {
    return this.positions.get(pool);
  }

  /**
   * Update position
   */
  updatePosition(pool: string, position: Position): void {
    this.positions.set(pool, position);
  }

  /**
   * Check if we should pause trading
   */
  shouldPause(): { pause: boolean; reason?: string } {
    // Pause if daily loss exceeded
    if (this.dailyPnL < -this.config.maxDailyLoss) {
      return { pause: true, reason: 'Daily loss limit exceeded' };
    }

    // Pause if too many consecutive losses
    const recentExecutions = this.executions.slice(-5);
    const recentLosses = recentExecutions.filter(
      (e) => e.status === 'completed' && e.actualProfit !== undefined && e.actualProfit < 0n
    );

    if (recentLosses.length >= 5) {
      return { pause: true, reason: '5 consecutive losses - manual review required' };
    }

    return { pause: false };
  }

  /**
   * Get execution history
   */
  getExecutionHistory(limit: number = 100): TradeExecution[] {
    return this.executions.slice(-limit);
  }

  /**
   * Export metrics for monitoring
   */
  exportMetrics(): object {
    const metrics = this.getMetrics();
    return {
      timestamp: Date.now(),
      dailyPnL: this.formatEth(metrics.dailyPnL),
      openPositions: metrics.openPositionCount,
      totalExposure: this.formatEth(metrics.totalExposure),
      winRate: (metrics.winRate * 100).toFixed(2) + '%',
      averageProfit: this.formatEth(metrics.averageProfit),
      maxDrawdown: this.formatEth(metrics.maxDrawdown),
      sharpeRatio: metrics.sharpeRatio.toFixed(2),
      totalTrades: this.executions.length,
    };
  }
}

export default RiskManager;
