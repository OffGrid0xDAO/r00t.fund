// Types for the arbitrage system

export interface PriceQuote {
  price: bigint; // Price in wei (tokens per ETH or ETH per token)
  timestamp: number;
  source: 'darkpool' | 'uniswap';
  liquidity: bigint; // Available liquidity at this price
}

export interface ArbitrageOpportunity {
  id: string;
  direction: 'darkpool_to_uniswap' | 'uniswap_to_darkpool';
  buyPrice: bigint;
  sellPrice: bigint;
  spreadBps: number; // Basis points
  maxSize: bigint; // Maximum profitable trade size
  expectedProfit: bigint;
  gasEstimate: bigint;
  netProfit: bigint;
  timestamp: number;
}

export interface TradeExecution {
  opportunityId: string;
  status: 'pending' | 'buying' | 'selling' | 'completed' | 'failed';
  buyTxHash?: string;
  sellTxHash?: string;
  actualBuyPrice?: bigint;
  actualSellPrice?: bigint;
  actualProfit?: bigint;
  error?: string;
  startTime: number;
  endTime?: number;
}

export interface Position {
  token: string;
  darkPoolBalance: bigint; // Private balance in dark pool
  publicBalance: bigint; // Public ETH/token balance
  commitments: Commitment[];
}

export interface Commitment {
  commitment: string;
  nullifier: bigint;
  secret: bigint;
  amount: bigint;
  leafIndex: number;
  spent: boolean;
}

export interface BotConfig {
  // Pool addresses
  darkPoolAddress: string;
  uniswapPoolAddress: string;

  // Trading parameters
  minSpreadBps: number; // Minimum spread to trade (default: 50 = 0.5%)
  maxPositionSize: bigint; // Maximum position in tokens
  maxSlippageBps: number; // Maximum slippage tolerance

  // Gas settings
  maxGasPrice: bigint;
  gasBuffer: number; // Multiplier for gas estimates

  // Risk limits
  maxDailyLoss: bigint;
  maxOpenPositions: number;
  cooldownMs: number; // Time between trades

  // Execution
  dryRun: boolean; // Simulate without executing
  privateKey?: string;
  rpcUrl: string;
}

export interface MarketState {
  darkPool: {
    ethReserve: bigint;
    tokenReserve: bigint;
    price: bigint; // tokens per ETH
    feeBps: number;
  };
  uniswap: {
    sqrtPriceX96: bigint;
    liquidity: bigint;
    price: bigint; // tokens per ETH
    feeTier: number;
    tick: number;
  };
  spread: {
    absolute: bigint;
    bps: number;
    direction: 'darkpool_cheaper' | 'uniswap_cheaper' | 'equal';
  };
  timestamp: number;
}

export interface ExecutionResult {
  success: boolean;
  txHash?: string;
  gasUsed?: bigint;
  effectivePrice?: bigint;
  error?: string;
}

// Uniswap V4 specific types
export interface UniswapV4PoolKey {
  currency0: string;
  currency1: string;
  fee: number;
  tickSpacing: number;
  hooks: string;
}

export interface SwapParams {
  zeroForOne: boolean;
  amountSpecified: bigint;
  sqrtPriceLimitX96: bigint;
}
