import { useState, useCallback, useEffect } from 'react';
import { useAccount } from 'wagmi';
import { formatEther } from 'viem';
import { EXTERNAL } from '../config';

// Railgun contract addresses on Arbitrum - imported from config
const RAILGUN_PROXY_ARBITRUM = EXTERNAL.railgunProxy;
const WETH_ARBITRUM = EXTERNAL.weth;

// Railway wallet deep link
const RAILWAY_WALLET_URL = 'https://railway.xyz';

// Lazy load Railgun SDK types
type RailgunSDK = {
  refreshBalances: (chain: { type: number; id: number }, walletIdFilter?: string[]) => Promise<void>;
  walletForID: (id: string) => unknown;
  balanceForERC20Token: (
    txidVersion: string,
    wallet: unknown,
    networkName: string,
    tokenAddress: string,
    onlySpendable: boolean
  ) => Promise<bigint>;
  NETWORK_CONFIG: Record<string, { chain: { type: number; id: number } }>;
  NetworkName: { Arbitrum: string };
  TXIDVersion: { V2_PoseidonMerkle: string };
};

let sdkPromise: Promise<RailgunSDK> | null = null;

async function loadRailgunSDK(): Promise<RailgunSDK> {
  if (sdkPromise) return sdkPromise;

  sdkPromise = (async () => {
    const [sharedModels, wallet] = await Promise.all([
      import('@railgun-community/shared-models'),
      import('@railgun-community/wallet'),
    ]);

    return {
      refreshBalances: wallet.refreshBalances as RailgunSDK['refreshBalances'],
      walletForID: wallet.walletForID as RailgunSDK['walletForID'],
      balanceForERC20Token: wallet.balanceForERC20Token as RailgunSDK['balanceForERC20Token'],
      NETWORK_CONFIG: sharedModels.NETWORK_CONFIG as RailgunSDK['NETWORK_CONFIG'],
      NetworkName: sharedModels.NetworkName,
      TXIDVersion: sharedModels.TXIDVersion,
    };
  })();

  return sdkPromise;
}

interface RailgunState {
  isLoading: boolean;
  isRefreshing: boolean;
  spendableBalance: bigint;
  pendingBalance: bigint;
  totalBalance: bigint;
  error: string | null;
  lastRefresh: number | null;
}

interface UseRailgunProps {
  walletId?: string;
  autoRefresh?: boolean;
  refreshInterval?: number; // in ms, default 30000 (30s)
  isEngineReady?: boolean; // Must be true before balance queries work
  isScanComplete?: boolean; // Must be true before balance queries return accurate results
}

/**
 * Enhanced Railgun hook that provides:
 * - Real-time spendable vs pending balance tracking
 * - Auto-refresh capabilities
 * - Links to Railway wallet for shield/unshield operations
 */
export function useRailgun(props: UseRailgunProps = {}) {
  const { walletId, autoRefresh = false, refreshInterval = 30000, isEngineReady = false, isScanComplete = false } = props;
  const { address, isConnected } = useAccount();

  const [state, setState] = useState<RailgunState>({
    isLoading: false,
    isRefreshing: false,
    spendableBalance: 0n,
    pendingBalance: 0n,
    totalBalance: 0n,
    error: null,
    lastRefresh: null,
  });

  // Refresh balances from Railgun SDK
  const refreshBalances = useCallback(async () => {
    if (!walletId || !isEngineReady) {
      console.log('[useRailgun] Skipping refresh - walletId:', !!walletId, 'isEngineReady:', isEngineReady);
      return;
    }

    // Don't query balances until merkle tree scan is complete
    // Querying before scan completes will return 0 even if funds exist
    if (!isScanComplete) {
      console.log('[useRailgun] Waiting for merkle tree scan to complete before querying balances...');
      setState(prev => ({ ...prev, isRefreshing: false }));
      return;
    }

    setState(prev => ({ ...prev, isRefreshing: true, error: null }));

    try {
      const sdk = await loadRailgunSDK();
      const arbitrumChain = sdk.NETWORK_CONFIG[sdk.NetworkName.Arbitrum].chain;

      // Try to refresh balances - may fail during initial scan
      try {
        await sdk.refreshBalances(arbitrumChain, [walletId]);
      } catch (refreshErr) {
        // Scan errors are common during initial sync, log but continue
        console.warn('[useRailgun] Refresh error (scan in progress?):', refreshErr);
      }

      const walletObj = sdk.walletForID(walletId);
      console.log('[useRailgun] walletForID result:', walletObj ? 'found' : 'NOT FOUND', 'walletId:', walletId);

      if (!walletObj) {
        console.warn('[useRailgun] Wallet not found for ID:', walletId);
        setState(prev => ({
          ...prev,
          isRefreshing: false,
          error: 'Wallet not found - try regenerating',
        }));
        return;
      }

      // Get spendable balance (POI verified)
      let spendable = 0n;
      let total = 0n;

      console.log('[useRailgun] Querying balances for WETH:', WETH_ARBITRUM);
      console.log('[useRailgun] TXIDVersion:', sdk.TXIDVersion.V2_PoseidonMerkle);
      console.log('[useRailgun] NetworkName:', sdk.NetworkName.Arbitrum);

      try {
        spendable = await sdk.balanceForERC20Token(
          sdk.TXIDVersion.V2_PoseidonMerkle,
          walletObj,
          sdk.NetworkName.Arbitrum,
          WETH_ARBITRUM,
          true // onlySpendable = true
        );
        console.log('[useRailgun] Spendable balance result:', spendable.toString());
      } catch (balErr) {
        console.warn('[useRailgun] Error getting spendable balance:', balErr);
      }

      try {
        // Get total balance (includes pending)
        total = await sdk.balanceForERC20Token(
          sdk.TXIDVersion.V2_PoseidonMerkle,
          walletObj,
          sdk.NetworkName.Arbitrum,
          WETH_ARBITRUM,
          false // onlySpendable = false
        );
        console.log('[useRailgun] Total balance result:', total.toString());
      } catch (balErr) {
        console.warn('[useRailgun] Error getting total balance:', balErr);
      }

      const pending = total - spendable;

      setState(prev => ({
        ...prev,
        isRefreshing: false,
        spendableBalance: spendable,
        pendingBalance: pending,
        totalBalance: total,
        lastRefresh: Date.now(),
        error: null,
      }));

      console.log('[useRailgun] Balance refreshed:', {
        spendable: formatEther(spendable),
        pending: formatEther(pending),
        total: formatEther(total),
      });
    } catch (err) {
      console.error('[useRailgun] Failed to refresh balances:', err);
      setState(prev => ({
        ...prev,
        isRefreshing: false,
        error: (err as Error).message || 'Failed to refresh balances',
      }));
    }
  }, [walletId, isEngineReady, isScanComplete]);

  // Auto-refresh when enabled, engine is ready, and scan is complete
  useEffect(() => {
    if (!autoRefresh || !walletId || !isEngineReady || !isScanComplete) return;

    // Initial refresh
    refreshBalances();

    // Set up interval
    const interval = setInterval(refreshBalances, refreshInterval);
    return () => clearInterval(interval);
  }, [autoRefresh, walletId, isEngineReady, isScanComplete, refreshInterval, refreshBalances]);

  // Open Railway wallet for shielding
  const openShield = useCallback(() => {
    window.open(`${RAILWAY_WALLET_URL}`, '_blank');
  }, []);

  // Open Railway wallet for unshielding
  const openUnshield = useCallback(() => {
    window.open(`${RAILWAY_WALLET_URL}`, '_blank');
  }, []);

  // Get Railgun contract info
  const getRailgunInfo = useCallback(() => ({
    proxyAddress: RAILGUN_PROXY_ARBITRUM,
    wethAddress: WETH_ARBITRUM,
    railwayUrl: RAILWAY_WALLET_URL,
    arbiscanUrl: `https://arbiscan.io/address/${RAILGUN_PROXY_ARBITRUM}`,
  }), []);

  // Format balance for display
  const formatBalance = useCallback((balance: bigint): string => {
    const formatted = Number(formatEther(balance));
    if (formatted === 0) return '0';
    if (formatted < 0.0001) return '<0.0001';
    return formatted.toFixed(4);
  }, []);

  // Check if has spendable balance
  const hasSpendableBalance = state.spendableBalance > 0n;
  const hasPendingBalance = state.pendingBalance > 0n;

  return {
    ...state,
    isConnected,
    address,

    // Balance checks
    hasSpendableBalance,
    hasPendingBalance,

    // Formatted balances
    spendableBalanceFormatted: formatBalance(state.spendableBalance),
    pendingBalanceFormatted: formatBalance(state.pendingBalance),
    totalBalanceFormatted: formatBalance(state.totalBalance),

    // Actions
    refreshBalances,
    openShield,
    openUnshield,
    getRailgunInfo,

    // Constants
    RAILGUN_PROXY: RAILGUN_PROXY_ARBITRUM,
    WETH_ADDRESS: WETH_ARBITRUM,
  };
}
