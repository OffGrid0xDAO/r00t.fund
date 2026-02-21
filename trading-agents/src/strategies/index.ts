/**
 * Strategy Factory
 *
 * Creates and assigns strategies to agents.
 * Add new strategies here to make them available.
 */

import { BaseStrategy } from './BaseStrategy.js';
import { MomentumStrategy } from './MomentumStrategy.js';
import { MeanReversionStrategy } from './MeanReversionStrategy.js';
import { RandomStrategy } from './RandomStrategy.js';
import { AccumulatorStrategy } from './AccumulatorStrategy.js';
import { CONFIG } from '../../config.js';

// Export all strategies
export { BaseStrategy } from './BaseStrategy.js';
export { MomentumStrategy } from './MomentumStrategy.js';
export { MeanReversionStrategy } from './MeanReversionStrategy.js';
export { RandomStrategy } from './RandomStrategy.js';
export { AccumulatorStrategy } from './AccumulatorStrategy.js';

// Strategy registry - add new strategies here
const STRATEGIES: Record<string, new () => BaseStrategy> = {
  momentum: MomentumStrategy,
  meanReversion: MeanReversionStrategy,
  random: RandomStrategy,
  accumulator: AccumulatorStrategy,
  // Add more strategies here:
  // grid: GridStrategy,
  // rsi: RSIStrategy,
};

/**
 * Create a strategy by name
 */
export function createStrategy(name: string): BaseStrategy {
  const StrategyClass = STRATEGIES[name];
  if (!StrategyClass) {
    console.warn(`Unknown strategy: ${name}, falling back to Random`);
    return new RandomStrategy();
  }
  return new StrategyClass();
}

/**
 * Assign strategies to agents based on config distribution
 */
export function assignStrategies(numAgents: number): BaseStrategy[] {
  const strategies: BaseStrategy[] = [];
  const distribution = CONFIG.STRATEGY_DISTRIBUTION;

  // Build array based on distribution
  for (const [name, count] of Object.entries(distribution)) {
    for (let i = 0; i < count && strategies.length < numAgents; i++) {
      strategies.push(createStrategy(name));
    }
  }

  // Fill remaining with random if distribution doesn't cover all agents
  while (strategies.length < numAgents) {
    strategies.push(new RandomStrategy());
  }

  // Shuffle for variety
  return strategies.sort(() => Math.random() - 0.5);
}

/**
 * Get list of available strategy names
 */
export function getAvailableStrategies(): string[] {
  return Object.keys(STRATEGIES);
}
