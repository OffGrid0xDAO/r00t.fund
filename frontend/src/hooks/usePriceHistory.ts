/**
 * Real-time price history hook
 *
 * Uses Ponder indexer GraphQL API to fetch historical trades and stats.
 * - WebSocket subscription for instant real-time updates (graphql-ws protocol)
 * - Falls back to 5-second polling if WebSocket unavailable
 * - Instant refresh when YOU trade (via TRADE_COMPLETE_EVENT from SwapPanel)
 * - Avoids RPC event watchers which cause "filter not found" errors on public nodes
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { usePublicClient } from 'wagmi';
import { formatEther, formatUnits } from 'viem';
import { NETWORK, TOKEN, CONTRACTS } from '../config';
import { ZKAMM_PRICE_ABI } from '../abis/zkAMM';

// Trade completion event name — shared constant (also exported from PriceChart for back-compat)
export const TRADE_COMPLETE_EVENT = 'r00t-trade-complete';

// Convert HTTP URL to WebSocket URL
function getWebSocketUrl(httpUrl: string): string {
  return httpUrl.replace(/^http/, 'ws') + '/graphql';
}

// GraphQL query to fetch trades from Ponder indexer
// Note: Ponder has a default limit of 1000 items per query
// We fetch ALL trades (no address filter) since we want complete history
const TRADES_QUERY = `
  query GetTrades($limit: Int, $orderBy: String, $orderDirection: String) {
    tradess(limit: $limit, orderBy: $orderBy, orderDirection: $orderDirection) {
      items {
        id
        type
        ethAmount
        tokenAmount
        price
        lpShares
        blockNumber
        timestamp
        transactionHash
        address
      }
    }
  }
`;

// GraphQL query to fetch stats from Ponder indexer
// Stats are global (id: "global"), not per-contract
const STATS_QUERY = `
  query GetStats {
    statss(where: { id: "global" }, limit: 1) {
      items {
        id
        totalVolume
        totalTrades
        lastPrice
        updatedAt
      }
    }
  }
`;

// GraphQL query to fetch pool state (reserves, price) from Ponder
// poolState uses `id` as the contract address (primary key)
const POOL_STATE_QUERY = `
  query GetPoolState($id: String) {
    poolStates(where: { id: $id }, limit: 1) {
      items {
        ethReserve
        tokenReserve
        tokenPrice
        blockNumber
        timestamp
      }
    }
  }
`;

// Fetch data from Ponder GraphQL API
async function queryIndexer<T>(query: string, variables?: Record<string, unknown>): Promise<T | null> {
  if (!NETWORK.indexerUrl) return null;
  try {
    const response = await fetch(`${NETWORK.indexerUrl}/graphql`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, variables }),
    });

    if (!response.ok) {
      console.warn('[usePriceHistory] Indexer request failed:', response.status);
      return null;
    }

    const result = await response.json();
    if (result.errors) {
      console.warn('[usePriceHistory] GraphQL errors:', result.errors);
      return null;
    }

    return result.data as T;
  } catch (err) {
    console.warn('[usePriceHistory] Failed to query indexer:', err);
    return null;
  }
}

export type TimeFrame = '5m' | '1h' | '4h' | '1d' | '7d';

interface PricePoint {
  timestamp: number;
  price: number;
  ethReserve: number;
  tokenReserve: number;
  blockNumber: number;
}

export interface Trade {
  type: 'buy' | 'sell' | 'add_lp' | 'remove_lp' | 'claim_fees';
  ethAmount: number;
  tokenAmount: number;
  price: number;
  lpShares?: number;
  timestamp: number;
  txHash: string;
  blockNumber: number;
}

// Event ABIs removed - using Ponder indexer for trade history instead of RPC event watching
// This avoids "filter not found" errors on public RPC nodes

// Hook to track page visibility
function usePageVisibility() {
  const [isVisible, setIsVisible] = useState(!document.hidden);

  useEffect(() => {
    const handleVisibilityChange = () => {
      setIsVisible(!document.hidden);
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  return isVisible;
}

const TOTAL_SUPPLY = TOKEN.totalSupply;

// LocalStorage helpers - include contract address to avoid mixing data between deployments
const TRADES_VERSION = 7; // Bump this when format changes - v7: added debugging

function getStorageKey(contractAddress: string): string {
  return `zkamm_trades_${contractAddress.toLowerCase()}`;
}

function loadStoredTrades(contractAddress: string): Trade[] {
  if (!contractAddress || contractAddress === '0x...') return [];

  try {
    const storageKey = getStorageKey(contractAddress);
    const versionKey = `${storageKey}_version`;

    const version = localStorage.getItem(versionKey);
    // Clear old data if version doesn't match
    if (version !== String(TRADES_VERSION)) {
      console.log('[usePriceHistory] Clearing old trade data for', contractAddress.slice(0, 10));
      localStorage.removeItem(storageKey);
      localStorage.setItem(versionKey, String(TRADES_VERSION));
      // Also clear old global key if it exists
      localStorage.removeItem('zkamm_trades');
      localStorage.removeItem('zkamm_trades_version');
      return [];
    }

    const stored = localStorage.getItem(storageKey);
    if (stored) {
      const trades = JSON.parse(stored) as Trade[];
      console.log('[usePriceHistory] Loaded', trades.length, 'trades for', contractAddress.slice(0, 10));
      return trades;
    }
  } catch (e) {
    console.error('[usePriceHistory] Failed to load stored trades:', e);
  }
  return [];
}

function saveStoredTrades(contractAddress: string, trades: Trade[]) {
  if (!contractAddress || contractAddress === '0x...') return;

  try {
    const storageKey = getStorageKey(contractAddress);
    // Store up to 10,000 trades in localStorage for offline access
    localStorage.setItem(storageKey, JSON.stringify(trades.slice(0, 10000)));
  } catch (e) {
    console.error('[usePriceHistory] Failed to save trades:', e);
  }
}

/**
 * Hook for real-time price history
 */
export function usePriceHistory(zkAMMAddress: string, timeFrame: TimeFrame = '1d') {
  const publicClient = usePublicClient();
  const isPageVisible = usePageVisibility();

  // Initialize trades from localStorage (per-contract)
  const [trades, setTrades] = useState<Trade[]>(() => loadStoredTrades(zkAMMAddress));
  const [priceHistory, setPriceHistory] = useState<PricePoint[]>([]);
  const [currentPrice, setCurrentPrice] = useState<number>(0);
  const [priceChange, setPriceChange] = useState<number>(0);
  const [volume, setVolume] = useState<number>(0);
  const [allTimeVolume, setAllTimeVolume] = useState<number>(0);
  const [isLoading, setIsLoading] = useState(zkAMMAddress !== '0x...');
  const [ethReserve, setEthReserve] = useState<number>(0);
  const [tokenReserve, setTokenReserve] = useState<number>(0);
  const [marketCap, setMarketCap] = useState<number>(0);
  const [liquidity, setLiquidity] = useState<number>(0);
  const [isConnected, setIsConnected] = useState(false);
  const [ethPrice, setEthPrice] = useState<number>(0);

  // Reload trades when contract address changes
  useEffect(() => {
    const storedTrades = loadStoredTrades(zkAMMAddress);
    console.log(`[usePriceHistory] Loaded ${storedTrades.length} trades from localStorage for ${zkAMMAddress.slice(0, 10)}`);
    setTrades(storedTrades);
  }, [zkAMMAddress]);

  // Fetch ETH price from CoinGecko - only when visible
  useEffect(() => {
    const fetchEthPrice = async () => {
      try {
        const res = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd');
        const data = await res.json();
        if (data.ethereum?.usd) {
          setEthPrice(data.ethereum.usd);
        }
      } catch (err) {
        console.error('[usePriceHistory] Failed to fetch ETH price:', err);
      }
    };

    // Always fetch once on mount/visibility change
    fetchEthPrice();

    // Only poll when page is visible
    if (!isPageVisible) return;

    const interval = window.setInterval(fetchEthPrice, 60000); // Update every minute
    return () => window.clearInterval(interval);
  }, [isPageVisible]);

  // Fetch current reserves
  const fetchReserves = useCallback(async () => {
    if (!publicClient || !zkAMMAddress || zkAMMAddress === '0x...') return;

    // Read from PAIR contract (state), not Router
    const pairAddress = CONTRACTS.zkAMMPair as `0x${string}`;
    try {
      const [ethRes, tokenRes] = await Promise.all([
        publicClient.readContract({
          address: pairAddress,
          abi: ZKAMM_PRICE_ABI,
          functionName: 'ethReserve',
        }),
        publicClient.readContract({
          address: pairAddress,
          abi: ZKAMM_PRICE_ABI,
          functionName: 'tokenReserve',
        }),
      ]);

      const ethReserveNum = Number(formatEther(ethRes));
      const tokenReserveNum = Number(formatUnits(tokenRes, 18));

      setEthReserve(ethReserveNum);
      setTokenReserve(tokenReserveNum);

      if (ethReserveNum > 0 && tokenReserveNum > 0) {
        // Price = ETH per token (how much ETH one token costs)
        // When people buy, ETH reserve increases, token reserve decreases
        // So price goes UP (token becomes more valuable)
        const pricePerToken = ethReserveNum / tokenReserveNum;
        setCurrentPrice(pricePerToken);

        setMarketCap(TOTAL_SUPPLY * pricePerToken);
        setLiquidity(ethReserveNum * 2);
      }

      setIsLoading(false);
    } catch (err) {
      console.error('[usePriceHistory] Failed to fetch reserves:', err);
      setIsLoading(false);
    }
  }, [publicClient, zkAMMAddress]);

  // Store fetchReserves in ref for stable interval
  const fetchReservesRef = useRef(fetchReserves);
  fetchReservesRef.current = fetchReserves;

  // Fetch trades from Ponder indexer GraphQL API with pagination
  const fetchTradesFromIndexer = useCallback(async () => {
    console.log('[usePriceHistory] Fetching trades from indexer with pagination...');

    interface IndexerTrade {
      id: string;
      type: string;
      ethAmount: string;
      tokenAmount: string;
      price: string;
      lpShares: string | null;
      blockNumber: string;
      timestamp: string;
      transactionHash: string;
      address: string;
    }

    interface TradesResponse {
      tradess: {
        items: IndexerTrade[];
      };
    }

    // Fetch all trades using pagination (Ponder max is 1000 per query)
    const allIndexerTrades: IndexerTrade[] = [];
    let hasMore = true;
    let lastTimestamp: string | null = null;
    const BATCH_SIZE = 1000;
    const MAX_BATCHES = 20; // Safety limit: max 20,000 trades
    let batchCount = 0;

    while (hasMore && batchCount < MAX_BATCHES) {
      // Build query with cursor-based pagination using timestamp
      const paginatedQuery: string = lastTimestamp
        ? `query GetTrades($limit: Int, $orderBy: String, $orderDirection: String, $beforeTimestamp: BigInt) {
            tradess(limit: $limit, orderBy: $orderBy, orderDirection: $orderDirection, where: { timestamp_lt: $beforeTimestamp }) {
              items { id type ethAmount tokenAmount price lpShares blockNumber timestamp transactionHash address }
            }
          }`
        : TRADES_QUERY;

      const variables: Record<string, unknown> = {
        limit: BATCH_SIZE,
        orderBy: 'timestamp',
        orderDirection: 'desc',
      };
      if (lastTimestamp) {
        variables.beforeTimestamp = lastTimestamp;
      }

      const data: TradesResponse | null = await queryIndexer<TradesResponse>(paginatedQuery, variables);

      if (data?.tradess?.items && data.tradess.items.length > 0) {
        allIndexerTrades.push(...data.tradess.items);
        const lastItem: IndexerTrade = data.tradess.items[data.tradess.items.length - 1];
        lastTimestamp = lastItem.timestamp;
        hasMore = data.tradess.items.length === BATCH_SIZE;
        batchCount++;
        console.log(`[usePriceHistory] Fetched batch ${batchCount}: ${data.tradess.items.length} trades (total: ${allIndexerTrades.length})`);
      } else {
        hasMore = false;
      }
    }

    if (allIndexerTrades.length > 0) {
      const indexerTrades: Trade[] = allIndexerTrades.map((t) => {
        const ethAmt = Number(t.ethAmount);
        const tokenAmt = Number(t.tokenAmount);
        const isLPOp = ['add_lp', 'remove_lp', 'claim_fees'].includes(t.type);
        return {
          type: t.type as Trade['type'],
          ethAmount: ethAmt,
          tokenAmount: tokenAmt,
          price: isLPOp ? 0 : (tokenAmt > 0 ? ethAmt / tokenAmt : 0), // ETH per token (0 for LP ops)
          lpShares: t.lpShares ? Number(t.lpShares) : undefined,
          timestamp: Number(t.timestamp) * 1000, // Convert to ms
          txHash: t.transactionHash,
          blockNumber: Number(t.blockNumber),
        };
      });

      console.log(`[usePriceHistory] Loaded ${indexerTrades.length} total trades from indexer`);
      setTrades(indexerTrades);
      saveStoredTrades(zkAMMAddress, indexerTrades);
      return indexerTrades;
    }

    return [];
  }, [zkAMMAddress]);

  // Fetch stats from Ponder indexer
  const fetchStatsFromIndexer = useCallback(async () => {
    interface StatsResponse {
      statss: {
        items: Array<{
          totalVolume: string;
          totalTrades: number;
          lastPrice: string;
        }>;
      };
    }

    const data = await queryIndexer<StatsResponse>(STATS_QUERY); // Stats are global, no address filter
    if (data?.statss?.items?.[0]) {
      const stats = data.statss.items[0];
      setAllTimeVolume(Number(stats.totalVolume));
      console.log(`[usePriceHistory] Stats from indexer: volume=${stats.totalVolume}, trades=${stats.totalTrades}`);
    }
  }, []);

  // Fetch pool state from Ponder indexer (reserves, price)
  const fetchPoolStateFromIndexer = useCallback(async (): Promise<boolean> => {
    interface PoolStateResponse {
      poolStates: {
        items: Array<{
          ethReserve: string;
          tokenReserve: string;
          tokenPrice: string;
        }>;
      };
    }

    // Always query pool state by Pair address (reserves live on Pair, not Router)
    const data = await queryIndexer<PoolStateResponse>(POOL_STATE_QUERY, { id: CONTRACTS.zkAMMPair.toLowerCase() });
    if (data?.poolStates?.items?.[0]) {
      const pool = data.poolStates.items[0];
      const ethRes = Number(pool.ethReserve) / 1e18; // Convert from wei
      const tokenRes = Number(pool.tokenReserve) / 1e18;

      if (ethRes > 0 && tokenRes > 0) {
        setEthReserve(ethRes);
        setTokenReserve(tokenRes);
        const pricePerToken = ethRes / tokenRes;
        setCurrentPrice(pricePerToken);
        setMarketCap(TOTAL_SUPPLY * pricePerToken);
        setLiquidity(ethRes * 2);
        console.log(`[usePriceHistory] Pool state from indexer: ethReserve=${ethRes}, tokenReserve=${tokenRes}`);
        return true;
      }
    }
    return false;
  }, []);

  // Fetch trades from Ponder indexer via HTTP polling
  // Note: WebSocket disabled - Ponder doesn't support GraphQL subscriptions
  const lastFetchedAddress = useRef<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const wsReconnectTimeout = useRef<NodeJS.Timeout | null>(null);
  const [useWebSocket, setUseWebSocket] = useState(false); // Disabled - Ponder is HTTP only

  // Fetch function that updates isConnected based on success
  const fetchFromPonder = useCallback(async () => {
    try {
      await fetchTradesFromIndexer();
      await fetchStatsFromIndexer();
      // Try to get pool state from Ponder (faster than RPC)
      const gotPoolState = await fetchPoolStateFromIndexer();
      if (!gotPoolState) {
        // Fall back to RPC if Ponder doesn't have pool state yet
        await fetchReservesRef.current();
      }
      setIsConnected(true);
    } catch (err) {
      console.warn('[usePriceHistory] Ponder fetch failed:', err);
      setIsConnected(false);
      await fetchReservesRef.current();
    }
  }, [fetchTradesFromIndexer, fetchStatsFromIndexer, fetchPoolStateFromIndexer]);

  // WebSocket subscription for real-time updates
  useEffect(() => {
    if (!zkAMMAddress || zkAMMAddress === '0x...' || !useWebSocket || !isPageVisible) {
      return;
    }

    const wsUrl = getWebSocketUrl(NETWORK.indexerUrl);
    let ws: WebSocket | null = null;
    let pingInterval: NodeJS.Timeout | null = null;

    const connect = () => {
      console.log('[usePriceHistory] Connecting WebSocket to:', wsUrl);

      try {
        ws = new WebSocket(wsUrl, 'graphql-transport-ws');
        wsRef.current = ws;

        ws.onopen = () => {
          console.log('[usePriceHistory] WebSocket connected, sending init...');
          // graphql-ws protocol: send connection_init
          ws?.send(JSON.stringify({ type: 'connection_init' }));
        };

        ws.onmessage = (event) => {
          try {
            const message = JSON.parse(event.data);

            switch (message.type) {
              case 'connection_ack':
                console.log('[usePriceHistory] WebSocket connection acknowledged, subscribing...');
                setIsConnected(true);
                // Subscribe to trades updates
                ws?.send(JSON.stringify({
                  id: '1',
                  type: 'subscribe',
                  payload: {
                    query: TRADES_QUERY,
                    variables: {
                      limit: 1000,
                      orderBy: 'timestamp',
                      orderDirection: 'desc',
                    },
                  },
                }));
                // Start ping to keep connection alive
                pingInterval = setInterval(() => {
                  if (ws?.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify({ type: 'ping' }));
                  }
                }, 30000);
                break;

              case 'next':
                // Received data update
                if (message.payload?.data?.tradess?.items) {
                  console.log('[usePriceHistory] WebSocket received trades update');
                  // Trigger a fresh fetch to get all updated data
                  fetchFromPonder();
                }
                break;

              case 'error':
                console.warn('[usePriceHistory] WebSocket subscription error:', message.payload);
                break;

              case 'complete':
                console.log('[usePriceHistory] WebSocket subscription completed');
                break;

              case 'pong':
                // Keep-alive response, ignore
                break;

              default:
                // Unknown message type
                break;
            }
          } catch (err) {
            console.warn('[usePriceHistory] WebSocket message parse error:', err);
          }
        };

        ws.onerror = (error) => {
          console.warn('[usePriceHistory] WebSocket error, falling back to polling:', error);
          setUseWebSocket(false);
        };

        ws.onclose = (event) => {
          console.log('[usePriceHistory] WebSocket closed:', event.code, event.reason);
          if (pingInterval) clearInterval(pingInterval);

          // Reconnect after 5 seconds if not intentionally closed
          if (event.code !== 1000 && useWebSocket) {
            wsReconnectTimeout.current = setTimeout(() => {
              console.log('[usePriceHistory] Attempting WebSocket reconnect...');
              connect();
            }, 5000);
          }
        };
      } catch (err) {
        console.warn('[usePriceHistory] WebSocket connection failed, falling back to polling:', err);
        setUseWebSocket(false);
      }
    };

    // Initial HTTP fetch, then try WebSocket
    fetchFromPonder();
    connect();

    return () => {
      if (pingInterval) clearInterval(pingInterval);
      if (wsReconnectTimeout.current) clearTimeout(wsReconnectTimeout.current);
      if (ws) {
        ws.close(1000, 'Component unmounting');
      }
      wsRef.current = null;
    };
  }, [zkAMMAddress, useWebSocket, isPageVisible, fetchFromPonder]);

  // Fallback polling when WebSocket is not available
  useEffect(() => {
    if (!zkAMMAddress || zkAMMAddress === '0x...' || useWebSocket || !isPageVisible) {
      return;
    }

    console.log('[usePriceHistory] Using polling fallback (5s interval)');

    // Reset on address change
    if (lastFetchedAddress.current !== zkAMMAddress) {
      lastFetchedAddress.current = zkAMMAddress;
      fetchFromPonder();
    }

    const interval = window.setInterval(() => {
      fetchFromPonder();
    }, 5000);

    return () => window.clearInterval(interval);
  }, [zkAMMAddress, useWebSocket, isPageVisible, fetchFromPonder]);

  // Fetch reserves once on mount (not polling to avoid rate limits)
  // The price chart uses trade data from Ponder - reserves are only for initial display
  useEffect(() => {
    if (!publicClient || !zkAMMAddress || zkAMMAddress === '0x...') return;

    // Single fetch on mount - no polling (reduces RPC calls)
    fetchReservesRef.current();
  }, [publicClient, zkAMMAddress]);

  // Listen for local trade events — injects trades directly into state
  // so the live feed works even when Ponder indexer is unreachable
  useEffect(() => {
    const handleLocalTrade = (event: Event) => {
      const detail = (event as CustomEvent).detail as Trade | undefined;
      if (!detail || !detail.type || !detail.txHash) return;

      console.log('[usePriceHistory] Injecting local trade into live feed:', detail.type, detail.txHash?.slice(0, 16));
      setTrades(prev => {
        // Avoid duplicates (Ponder might also deliver this trade)
        if (prev.some(t => t.txHash === detail.txHash)) return prev;
        const updated = [detail, ...prev];
        saveStoredTrades(zkAMMAddress, updated);
        return updated;
      });
    };

    window.addEventListener(TRADE_COMPLETE_EVENT, handleLocalTrade);
    return () => window.removeEventListener(TRADE_COMPLETE_EVENT, handleLocalTrade);
  }, [zkAMMAddress]);

  // Build price history from trades and calculate stats
  useEffect(() => {
    const now = Date.now();
    const timeframeMsMap: Record<TimeFrame, number> = {
      '5m': 5 * 60 * 1000,
      '1h': 60 * 60 * 1000,
      '4h': 4 * 60 * 60 * 1000,
      '1d': 24 * 60 * 60 * 1000,
      '7d': 7 * 24 * 60 * 60 * 1000,
    };
    const timeframeMs = timeframeMsMap[timeFrame];
    const cutoff = now - timeframeMs;

    console.log(`[usePriceHistory] Building history: ${trades.length} trades, timeframe=${timeFrame}, cutoff=${new Date(cutoff).toISOString()}`);

    // Filter trades by timeframe - include trades within the time window
    const filteredTrades = trades.filter((t) => {
      // Include if timestamp is within range
      return t.timestamp >= cutoff;
    });

    console.log(`[usePriceHistory] Filtered to ${filteredTrades.length} trades within timeframe`);

    // Build price history from FILTERED trades (oldest first for chart)
    // This ensures the chart respects the selected timeframe
    const history: PricePoint[] = [...filteredTrades]
      .reverse() // Oldest first
      .map((trade) => ({
        timestamp: trade.timestamp || now,
        price: trade.price,
        ethReserve: 0,
        tokenReserve: 0,
        blockNumber: trade.blockNumber,
      }));

    // Use reserve-based currentPrice as source of truth (set by fetchReserves/fetchPoolState)
    // Only fall back to most recent buy/sell trade price if reserves haven't loaded yet
    const derivedPrice = currentPrice > 0
      ? currentPrice
      : (() => {
          // Find most recent buy/sell trade (skip LP ops which have price 0)
          const lastTrade = trades.find(t => t.type === 'buy' || t.type === 'sell');
          return lastTrade?.price ?? 0;
        })();

    // Add latest price point for chart continuity
    if (derivedPrice > 0) {
      if (history.length === 0) {
        // No trades in timeframe - show flat line at current price
        history.push({
          timestamp: now - 60000,
          price: derivedPrice,
          ethReserve,
          tokenReserve,
          blockNumber: 0,
        });
      }
      // Add current point
      history.push({
        timestamp: now,
        price: derivedPrice,
        ethReserve,
        tokenReserve,
        blockNumber: 0,
      });
    }

    console.log(`[usePriceHistory] Built price history with ${history.length} points, price: ${derivedPrice}`);
    setPriceHistory(history);

    // Calculate volume from filtered trades and all-time
    const filteredVolume = filteredTrades.reduce((sum, t) => sum + t.ethAmount, 0);
    const totalVolume = trades.reduce((sum, t) => sum + t.ethAmount, 0);
    console.log(`[usePriceHistory] Volume - filtered: ${filteredVolume.toFixed(4)} ETH, all-time: ${totalVolume.toFixed(4)} ETH`);
    setVolume(filteredVolume);
    setAllTimeVolume(totalVolume);

    // Calculate price change from oldest to newest TRADE in timeframe
    // Use trade prices only to avoid race conditions with currentPrice updates
    if (filteredTrades.length >= 2) {
      // filteredTrades is sorted newest-first
      const newestTrade = filteredTrades[0];
      const oldestTrade = filteredTrades[filteredTrades.length - 1];
      const newestPrice = newestTrade.price;
      const oldestPrice = oldestTrade.price;

      if (oldestPrice > 0 && newestPrice > 0) {
        const change = ((newestPrice - oldestPrice) / oldestPrice) * 100;
        setPriceChange(isNaN(change) || !isFinite(change) ? 0 : change);
      } else {
        setPriceChange(0);
      }
    } else if (filteredTrades.length === 1 && currentPrice > 0) {
      // Only one trade - compare to current spot price
      const tradePrice = filteredTrades[0].price;
      if (tradePrice > 0) {
        const change = ((currentPrice - tradePrice) / tradePrice) * 100;
        setPriceChange(isNaN(change) || !isFinite(change) ? 0 : change);
      } else {
        setPriceChange(0);
      }
    } else {
      setPriceChange(0);
    }
  }, [trades, timeFrame, currentPrice, ethReserve, tokenReserve]);

  // Calculate USD values
  const marketCapUsd = marketCap * ethPrice;
  const liquidityUsd = liquidity * ethPrice;

  // Manual refresh function - fetches new data without clearing existing state
  // This ensures the chart stays visible during refresh (no flickering)
  const refreshAll = useCallback(async () => {
    console.log('[usePriceHistory] Manual refresh triggered - fetching new data...');

    // Don't clear trades[] - keep showing existing data while fetching
    // The fetchTradesFromIndexer will replace trades with fresh data when ready

    // Refetch everything from indexer (this updates state when data arrives)
    await fetchTradesFromIndexer();
    await fetchStatsFromIndexer();
    await fetchReserves();

    console.log('[usePriceHistory] Refresh complete');
  }, [fetchTradesFromIndexer, fetchStatsFromIndexer, fetchReserves]);

  return {
    priceHistory,
    trades,
    currentPrice,
    priceChange,
    volume,
    allTimeVolume,
    ethReserve,
    tokenReserve,
    marketCap,
    marketCapUsd,
    liquidity,
    liquidityUsd,
    ethPrice,
    isLoading,
    isConnected,
    timeFrame,
    refresh: fetchReserves,
    refreshAll, // Full refresh including historical trades
  };
}
