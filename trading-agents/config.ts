/**
 * Trading Agents Configuration
 *
 * ⚙️ EDIT THIS FILE to configure your trading bot
 *
 * To use with a different token/DEX:
 * 1. Update CONTRACT addresses
 * 2. Adjust TRADING parameters
 * 3. Set your PRIVATE_KEY in .env
 */

import { parseEther } from 'ethers';

export const CONFIG = {
  // ===================
  // 🌐 NETWORK
  // ===================
  RPC_URL: process.env.RPC_URL || 'https://eth-sepolia.g.alchemy.com/v2/demo',
  CHAIN_ID: 11155111, // Sepolia

  // ===================
  // 📄 CONTRACTS (Fresh deploy 2026-01-24)
  // ===================
  // ZkAMM contracts (change these for different DEX/token)
  DEX_ROUTER: '0x82a72fb9e51f52f0A38138791879563a7e64E45e',
  DEX_PAIR: '0xb794FE99149440EA619ae9d80D7cB0cB01210b8c',
  TOKEN_POOL: '0xb2cf2146016C1B7Fe6aE3e4B1AdA8AEAf62F0e58',

  // ===================
  // 👥 AGENTS
  // ===================
  NUM_AGENTS: 33,                    // Number of trading wallets
  FUND_AMOUNT: parseEther('0.05'),   // ETH to send each agent when funding

  // ===================
  // 💰 TRADING
  // ===================
  MIN_TRADE_ETH: parseEther('0.01'),  // Minimum trade size
  MAX_TRADE_ETH: parseEther('0.15'),  // Maximum trade size
  GAS_BUFFER: parseEther('0.005'),    // Keep for gas fees

  // ===================
  // ⏱️ TIMING
  // ===================
  TRADE_INTERVAL_MS: 15000,   // Time between trading rounds (ms)
  MAX_ROUNDS: 100,            // Total rounds before stopping (0 = infinite)
  AGENTS_PER_ROUND: 3,        // How many agents trade each round

  // ===================
  // 📊 STRATEGY
  // ===================
  // Default strategy distribution (sum should = NUM_AGENTS)
  STRATEGY_DISTRIBUTION: {
    momentum: 8,       // Buy when price rising
    meanReversion: 8,  // Buy dips, sell pumps
    random: 7,         // Random trades for volume
    grid: 5,           // Grid trading
    accumulator: 5,    // DCA / steady buying
  },

  // Strategy-specific params
  MOMENTUM_THRESHOLD: 0.02,      // 2% price move triggers trade
  MEAN_REVERSION_THRESHOLD: 0.03, // 3% deviation from mean
  GRID_SPACING: 0.05,            // 5% between grid levels

  // ===================
  // 🔐 ZK PROOFS (for private sells)
  // ===================
  CIRCUITS_PATH: '../circuits/build',
  USE_ZK_SELLS: true,  // Set false for regular DEX sells

  // ===================
  // 📝 LOGGING
  // ===================
  LOG_LEVEL: 'info',  // 'debug' | 'info' | 'warn' | 'error'
  LOG_TRADES: true,   // Log each trade
  LOG_FILE: './trades.log',
} as const;

export type Config = typeof CONFIG;
