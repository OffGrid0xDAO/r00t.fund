import { BotConfig } from './types';
import { parseEther } from 'viem';

// Default configuration
export const DEFAULT_CONFIG: BotConfig = {
  // Addresses (update after deployment)
  darkPoolAddress: process.env.DARK_POOL_ADDRESS || '0x...',
  uniswapPoolAddress: process.env.UNISWAP_POOL_ADDRESS || '0x...',

  // Trading parameters
  minSpreadBps: Number(process.env.MIN_SPREAD_BPS) || 50, // 0.5% minimum spread
  maxPositionSize: parseEther(process.env.MAX_POSITION_SIZE || '100000'), // 100k tokens
  maxSlippageBps: Number(process.env.MAX_SLIPPAGE_BPS) || 100, // 1% max slippage

  // Gas settings
  maxGasPrice: parseEther(process.env.MAX_GAS_PRICE || '0.00005'), // 50 gwei
  gasBuffer: Number(process.env.GAS_BUFFER) || 1.2, // 20% buffer

  // Risk limits
  maxDailyLoss: parseEther(process.env.MAX_DAILY_LOSS || '1'), // 1 ETH max daily loss
  maxOpenPositions: Number(process.env.MAX_OPEN_POSITIONS) || 3,
  cooldownMs: Number(process.env.COOLDOWN_MS) || 5000, // 5 second cooldown

  // Execution
  dryRun: process.env.DRY_RUN === 'true',
  privateKey: process.env.PRIVATE_KEY,
  rpcUrl: process.env.RPC_URL || 'https://mainnet.base.org',
};

// Uniswap V4 constants
export const UNISWAP_V4_CONSTANTS = {
  POOL_MANAGER: '0x...', // Base mainnet PoolManager
  SWAP_ROUTER: '0x...', // SwapRouter address
  QUOTER: '0x...', // Quoter address

  // Fee tiers (in hundredths of a bip)
  FEE_TIERS: {
    LOWEST: 100, // 0.01%
    LOW: 500, // 0.05%
    MEDIUM: 3000, // 0.3%
    HIGH: 10000, // 1%
  },

  // Tick spacing per fee tier
  TICK_SPACING: {
    100: 1,
    500: 10,
    3000: 60,
    10000: 200,
  },

  // Q96 for price calculations
  Q96: 2n ** 96n,
};

// Dark pool constants
export const DARK_POOL_CONSTANTS = {
  FEE_DENOMINATOR: 10000n,
  DEFAULT_FEE_BPS: 30n, // 0.3%

  // ZK circuit parameters
  MERKLE_DEPTH: 24,
  FIELD_PRIME: 21888242871839275222246405745257275088548364400416034343698204186575808495617n,
};

// Price calculation helpers
export const PRICE_CONSTANTS = {
  PRECISION: 10n ** 18n,
  BPS_DENOMINATOR: 10000n,
};

export function loadConfig(): BotConfig {
  const config = { ...DEFAULT_CONFIG };

  // Validate required fields
  if (!config.privateKey && !config.dryRun) {
    console.warn('No private key provided - running in dry run mode');
    config.dryRun = true;
  }

  if (config.darkPoolAddress === '0x...' || config.uniswapPoolAddress === '0x...') {
    console.warn('Pool addresses not configured - using defaults');
  }

  return config;
}
