import { v4 as uuidv4 } from 'uuid';
import { UniswapV4Oracle } from './uniswapV4';
import { DarkPoolOracle } from './darkPool';
import { ArbitrageExecutor } from './executor';
import { RiskManager } from './riskManager';
import { loadConfig, PRICE_CONSTANTS } from './config';
import type {
  BotConfig,
  MarketState,
  ArbitrageOpportunity,
  UniswapV4PoolKey,
  TradeExecution,
} from './types';

export class ArbitrageBot {
  private config: BotConfig;
  private uniswapOracle: UniswapV4Oracle;
  private darkPoolOracle: DarkPoolOracle;
  private executor: ArbitrageExecutor;
  private riskManager: RiskManager;

  private isRunning: boolean = false;
  private poolKey?: UniswapV4PoolKey;
  private pollInterval?: NodeJS.Timeout;

  constructor(config?: Partial<BotConfig>) {
    this.config = { ...loadConfig(), ...config };

    this.uniswapOracle = new UniswapV4Oracle(this.config.rpcUrl);
    this.darkPoolOracle = new DarkPoolOracle(this.config.rpcUrl, this.config.darkPoolAddress);
    this.executor = new ArbitrageExecutor(this.config);
    this.riskManager = new RiskManager(this.config);

    console.log('Arbitrage Bot initialized');
    console.log('Config:', {
      darkPool: this.config.darkPoolAddress,
      uniswapPool: this.config.uniswapPoolAddress,
      minSpreadBps: this.config.minSpreadBps,
      maxPositionSize: this.config.maxPositionSize.toString(),
      dryRun: this.config.dryRun,
    });
  }

  /**
   * Initialize the bot (fetch pool info, etc.)
   */
  async initialize(): Promise<void> {
    console.log('Initializing...');

    // Initialize dark pool oracle
    await this.darkPoolOracle.initialize();

    // Set up Uniswap pool key (would be configured based on actual deployment)
    this.poolKey = {
      currency0: '0x0000000000000000000000000000000000000000', // ETH
      currency1: this.config.darkPoolAddress, // Token
      fee: 3000, // 0.3%
      tickSpacing: 60,
      hooks: '0x0000000000000000000000000000000000000000', // No hooks
    };

    console.log('Initialization complete');
  }

  /**
   * Start the arbitrage bot
   */
  async start(pollIntervalMs: number = 1000): Promise<void> {
    if (this.isRunning) {
      console.log('Bot already running');
      return;
    }

    await this.initialize();

    this.isRunning = true;
    console.log(`Starting arbitrage bot (polling every ${pollIntervalMs}ms)...`);

    // Main loop
    this.pollInterval = setInterval(async () => {
      try {
        await this.tick();
      } catch (error) {
        console.error('Tick error:', error);
      }
    }, pollIntervalMs);

    // Initial tick
    await this.tick();
  }

  /**
   * Stop the bot
   */
  stop(): void {
    this.isRunning = false;
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = undefined;
    }
    console.log('Bot stopped');
  }

  /**
   * Main tick - check for opportunities and execute
   */
  private async tick(): Promise<void> {
    // Check if we should pause
    const pauseCheck = this.riskManager.shouldPause();
    if (pauseCheck.pause) {
      console.log(`Trading paused: ${pauseCheck.reason}`);
      return;
    }

    // Fetch current market state
    const marketState = await this.getMarketState();

    // Log current state
    this.logMarketState(marketState);

    // Check for arbitrage opportunity
    const opportunity = this.findOpportunity(marketState);

    if (!opportunity) {
      return;
    }

    console.log('\n🎯 Opportunity found!');
    console.log(`  Direction: ${opportunity.direction}`);
    console.log(`  Spread: ${opportunity.spreadBps} bps`);
    console.log(`  Expected profit: ${this.formatEth(opportunity.expectedProfit)} ETH`);
    console.log(`  Net profit: ${this.formatEth(opportunity.netProfit)} ETH`);

    // Risk check
    const riskCheck = this.riskManager.checkOpportunity(opportunity);

    if (!riskCheck.passed) {
      console.log(`  ❌ Risk check failed: ${riskCheck.reason}`);
      return;
    }

    // Adjust size if needed
    if (riskCheck.adjustedSize && riskCheck.adjustedSize < opportunity.maxSize) {
      console.log(`  ⚠️ Size adjusted: ${opportunity.maxSize} -> ${riskCheck.adjustedSize}`);
      opportunity.maxSize = riskCheck.adjustedSize;
    }

    // Execute
    console.log('  ✅ Executing...');

    const execution: TradeExecution = {
      opportunityId: opportunity.id,
      status: 'pending',
      startTime: Date.now(),
    };

    this.riskManager.recordExecution(execution);

    const result = await this.executor.executeArbitrage(opportunity);

    // Update execution record
    this.riskManager.updateExecution(opportunity.id, {
      status: result.success ? 'completed' : 'failed',
      actualProfit: result.success ? opportunity.netProfit : 0n,
      error: result.error,
      endTime: Date.now(),
    });

    if (result.success) {
      console.log(`  ✅ Execution successful! TX: ${result.txHash}`);
    } else {
      console.log(`  ❌ Execution failed: ${result.error}`);
    }

    // Log metrics
    const metrics = this.riskManager.exportMetrics();
    console.log('\n📊 Metrics:', metrics);
  }

  /**
   * Get current market state from both pools
   */
  private async getMarketState(): Promise<MarketState> {
    const [darkPoolState, uniswapState] = await Promise.all([
      this.darkPoolOracle.getPoolState(),
      this.poolKey ? this.uniswapOracle.getPoolState(this.poolKey) : null,
    ]);

    // Calculate spread
    const darkPoolPrice = darkPoolState.price;
    const uniswapPrice = uniswapState?.price || 0n;

    let spreadDirection: 'darkpool_cheaper' | 'uniswap_cheaper' | 'equal';
    let spreadBps: number;
    let spreadAbsolute: bigint;

    if (uniswapPrice === 0n) {
      spreadDirection = 'equal';
      spreadBps = 0;
      spreadAbsolute = 0n;
    } else if (darkPoolPrice < uniswapPrice) {
      spreadDirection = 'darkpool_cheaper';
      spreadAbsolute = uniswapPrice - darkPoolPrice;
      spreadBps = Number((spreadAbsolute * 10000n) / uniswapPrice);
    } else if (uniswapPrice < darkPoolPrice) {
      spreadDirection = 'uniswap_cheaper';
      spreadAbsolute = darkPoolPrice - uniswapPrice;
      spreadBps = Number((spreadAbsolute * 10000n) / darkPoolPrice);
    } else {
      spreadDirection = 'equal';
      spreadBps = 0;
      spreadAbsolute = 0n;
    }

    return {
      darkPool: {
        ethReserve: darkPoolState.hiddenReserve,
        tokenReserve: darkPoolState.tokenReserve,
        price: darkPoolPrice,
        feeBps: darkPoolState.feeBps,
      },
      uniswap: {
        sqrtPriceX96: uniswapState?.sqrtPriceX96 || 0n,
        liquidity: uniswapState?.liquidity || 0n,
        price: uniswapPrice,
        feeTier: 3000, // 0.3%
        tick: uniswapState?.tick || 0,
      },
      spread: {
        absolute: spreadAbsolute,
        bps: spreadBps,
        direction: spreadDirection,
      },
      timestamp: Date.now(),
    };
  }

  /**
   * Find arbitrage opportunity from market state
   */
  private findOpportunity(state: MarketState): ArbitrageOpportunity | null {
    // No opportunity if spread is too low
    if (state.spread.bps < this.config.minSpreadBps) {
      return null;
    }

    // No opportunity if pools are equal
    if (state.spread.direction === 'equal') {
      return null;
    }

    // Calculate optimal trade size
    const maxSize = this.calculateMaxSize(state);

    if (maxSize <= 0n) {
      return null;
    }

    // Calculate expected profit
    const buyPrice = state.spread.direction === 'darkpool_cheaper'
      ? state.darkPool.price
      : state.uniswap.price;

    const sellPrice = state.spread.direction === 'darkpool_cheaper'
      ? state.uniswap.price
      : state.darkPool.price;

    // Gross profit = (sellPrice - buyPrice) * size / PRECISION
    const expectedProfit = ((sellPrice - buyPrice) * maxSize) / PRICE_CONSTANTS.PRECISION;

    // Estimate gas costs
    const gasEstimate = 500000n * 50n * 10n ** 9n; // 500k gas * 50 gwei

    // Net profit
    const netProfit = expectedProfit - gasEstimate;

    if (netProfit <= 0n) {
      return null;
    }

    return {
      id: uuidv4(),
      direction: state.spread.direction === 'darkpool_cheaper'
        ? 'darkpool_to_uniswap'
        : 'uniswap_to_darkpool',
      buyPrice,
      sellPrice,
      spreadBps: state.spread.bps,
      maxSize,
      expectedProfit,
      gasEstimate,
      netProfit,
      timestamp: state.timestamp,
    };
  }

  /**
   * Calculate maximum profitable trade size
   */
  private calculateMaxSize(state: MarketState): bigint {
    // Limited by:
    // 1. Available liquidity on both sides
    // 2. Price impact constraints
    // 3. Position size limits

    const darkPoolLiquidity = state.darkPool.tokenReserve / 10n; // Max 10% of pool
    const uniswapLiquidity = state.uniswap.liquidity / 10n;

    // Take minimum of available liquidity
    let maxSize = darkPoolLiquidity < uniswapLiquidity ? darkPoolLiquidity : uniswapLiquidity;

    // Apply position size limit
    if (maxSize > this.config.maxPositionSize) {
      maxSize = this.config.maxPositionSize;
    }

    // Apply slippage constraint (rough approximation)
    // For x*y=k, 1% of reserves ≈ 2% price impact
    const slippageConstraint = (state.darkPool.tokenReserve * BigInt(this.config.maxSlippageBps)) / 20000n;

    if (maxSize > slippageConstraint) {
      maxSize = slippageConstraint;
    }

    return maxSize;
  }

  /**
   * Log market state
   */
  private logMarketState(state: MarketState): void {
    console.log('\n--- Market State ---');
    console.log(`Dark Pool: ${this.formatPrice(state.darkPool.price)} tokens/ETH`);
    console.log(`  Reserves: ${this.formatEth(state.darkPool.ethReserve)} ETH / ${this.formatTokens(state.darkPool.tokenReserve)} tokens`);

    if (state.uniswap.price > 0n) {
      console.log(`Uniswap: ${this.formatPrice(state.uniswap.price)} tokens/ETH`);
      console.log(`  Liquidity: ${state.uniswap.liquidity}`);
    } else {
      console.log('Uniswap: No data');
    }

    console.log(`Spread: ${state.spread.bps} bps (${state.spread.direction})`);
  }

  /**
   * Format helpers
   */
  private formatEth(wei: bigint): string {
    return (Number(wei) / 1e18).toFixed(6);
  }

  private formatTokens(amount: bigint): string {
    return (Number(amount) / 1e18).toLocaleString();
  }

  private formatPrice(price: bigint): string {
    return (Number(price) / 1e18).toLocaleString();
  }

  /**
   * Get current metrics
   */
  getMetrics(): object {
    return this.riskManager.exportMetrics();
  }

  /**
   * Get execution history
   */
  getHistory(limit: number = 100): TradeExecution[] {
    return this.riskManager.getExecutionHistory(limit);
  }
}

// CLI entry point
async function main() {
  const bot = new ArbitrageBot();

  // Handle shutdown
  process.on('SIGINT', () => {
    console.log('\nShutting down...');
    bot.stop();
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    console.log('\nShutting down...');
    bot.stop();
    process.exit(0);
  });

  // Start bot
  await bot.start(2000); // Poll every 2 seconds
}

// Run if called directly
if (require.main === module) {
  main().catch(console.error);
}

export default ArbitrageBot;
