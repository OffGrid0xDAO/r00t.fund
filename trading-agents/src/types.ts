/**
 * Core Types for Trading Agents
 */

export type TradeAction = 'BUY' | 'SELL' | 'HOLD';

export interface TradeDecision {
  action: TradeAction;
  amount: bigint;
  reason: string;
}

export interface MarketState {
  price: number;
  priceHistory: number[];
  ethReserve: bigint;
  tokenReserve: bigint;
  volume24h?: bigint;
  timestamp: number;
}

export interface AgentBalance {
  eth: bigint;
  tokens: bigint;
  tokenNotes?: TokenNote[];  // For ZK-based tokens
}

export interface TokenNote {
  commitment: string;
  nullifier: string;
  secret: string;
  amount: bigint;
  leafIndex: number;
  spent: boolean;
}

export interface Agent {
  id: number;
  address: string;
  strategyName: string;
}

export interface TradeResult {
  success: boolean;
  txHash?: string;
  error?: string;
  ethSpent?: bigint;
  tokensReceived?: bigint;
  tokensSold?: bigint;
  ethReceived?: bigint;
}

export interface AgentStats {
  totalBuys: number;
  totalSells: number;
  totalEthSpent: bigint;
  totalEthReceived: bigint;
  totalTokensBought: bigint;
  totalTokensSold: bigint;
  realizedPnL: bigint;
}
