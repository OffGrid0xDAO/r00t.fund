/**
 * useRailgunBuy - Anonymous Buying via Railgun
 *
 * This hook provides complete in-app anonymous token purchasing.
 * Re-exports the useAnonymousBuy hook with a compatible interface.
 *
 * Two modes:
 * 1. Quick Private: Direct buyPrivate (tokens private, tx visible)
 * 2. Full Anonymous: Shield ETH → Unshield+Swap via cross-contract call (complete privacy)
 */

import { useAnonymousBuy } from './useAnonymousBuy';

/**
 * Complete hook for anonymous buying via Railgun
 * This is a re-export of useAnonymousBuy with the interface SwapPanel expects
 */
export function useRailgunBuy(zkAMMAddress: string) {
  const {
    // State
    isLoading,
    error,
    progress,
    isConnected,
    hasWallet,
    isEngineReady,
    shieldedBalance,
    railgunAddress,
    mnemonic,
    hasRailgunWallet,
    walletId,

    // Balance from callbacks (the correct way per Railgun docs)
    spendableWethBalance,
    pendingWethBalance,

    // Scan state
    scanProgress,
    scanPhase,
    isScanComplete,
    scanError,

    // Actions
    executeAnonymousBuy,
    buyQuickPrivate,
    shieldETH,
    initializeEngine,
    getOrCreateWallet,
    exportWallet,
    copyMnemonicToClipboard,
    openRailway,
    clearAndResync,

    // Info
    shieldFeePercent,
    unshieldFeePercent,
  } = useAnonymousBuy(zkAMMAddress);

  // Map executeAnonymousBuy to buyAnonymous for backward compatibility
  const buyAnonymous = async (params: {
    ethAmount: string;
    viewingKey: string;
    railgunAddress?: string;
    onProgress?: (step: string, percent: number) => void;
    slippageBps?: number;
  }) => {
    return executeAnonymousBuy(params.ethAmount, params.viewingKey, params.onProgress, params.slippageBps);
  };

  // Wrap buyQuickPrivate to match expected interface
  const buyQuickPrivateWrapped = async (params: {
    ethAmount: string;
    viewingKey: string;
    onProgress?: (step: string, percent: number) => void;
    slippageBps?: number;
  }) => {
    return buyQuickPrivate(params.ethAmount, params.viewingKey, params.onProgress, params.slippageBps);
  };

  return {
    // State
    isLoading,
    error,
    progress,
    isConnected,
    hasWallet,
    isRailgunReady: isEngineReady,
    isInitializing: isLoading,
    shieldedBalance,
    shieldPrivateKey: null, // Not used anymore - managed internally

    // Balance from callbacks (the correct way per Railgun docs)
    spendableWethBalance, // Spendable WETH in Railgun
    pendingWethBalance,   // Pending WETH (shields waiting for POI)

    // Railgun wallet info
    railgunAddress,
    mnemonic, // 12-word seed phrase for export to Railway
    hasRailgunWallet,
    walletId, // Used for balance queries in useRailgun

    // Scan state - for UI progress display
    scanProgress,
    scanPhase, // 'txid' or 'utxo'
    isScanComplete,
    scanError,

    // Actions
    buyAnonymous,
    buyQuickPrivate: buyQuickPrivateWrapped,
    initRailgun: initializeEngine,
    openRailway,
    shieldETH,

    // New actions for wallet export
    getOrCreateWallet,
    exportWallet,
    copyMnemonicToClipboard,
    clearAndResync, // Clear database and resync

    // Info
    shieldFeePercent,
    unshieldFeePercent,
  };
}

export default useRailgunBuy;
