// r00t.fund Arbitrage Bot
// Market making between dark pool and Uniswap V4

export { ArbitrageBot } from './bot';
export { InstantArbitrageBot } from './instantArbitrage';
export { UniswapV4Oracle } from './uniswapV4';
export { DarkPoolOracle } from './darkPool';
export { ArbitrageExecutor } from './executor';
export { RiskManager } from './riskManager';
export { loadConfig, DEFAULT_CONFIG } from './config';
export * from './types';

// Quick start
import ArbitrageBot from './bot';

export async function startBot(config?: Partial<import('./types').BotConfig>): Promise<ArbitrageBot> {
  const bot = new ArbitrageBot(config);
  await bot.start();
  return bot;
}

export default ArbitrageBot;
