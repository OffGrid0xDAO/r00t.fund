/**
 * useRailgunBuy - Stubbed out (Railgun is Arbitrum-only, not available on Tenderly VNet)
 *
 * Returns no-op stubs so consumers compile without changes.
 */

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function useRailgunBuy(_zkAMMAddress: string) {
  return {
    isLoading: false,
    error: null,
    progress: '',
    isConnected: false,
    hasWallet: false,
    isRailgunReady: false,
    isInitializing: false,
    shieldedBalance: 0n,
    shieldPrivateKey: null,
    spendableWethBalance: 0n,
    pendingWethBalance: 0n,
    railgunAddress: null,
    mnemonic: null,
    hasRailgunWallet: false,
    walletId: null,
    scanProgress: 0,
    scanPhase: null,
    isScanComplete: false,
    scanError: null,
    buyAnonymous: async () => ({ success: false, error: 'Railgun disabled on Tenderly VNet' }),
    buyQuickPrivate: async () => ({ success: false, error: 'Railgun disabled on Tenderly VNet' }),
    initRailgun: async () => {},
    openRailway: () => {},
    shieldETH: async () => {},
    getOrCreateWallet: async () => {},
    exportWallet: async () => {},
    copyMnemonicToClipboard: async () => {},
    clearAndResync: async () => {},
    shieldFeePercent: 0,
    unshieldFeePercent: 0,
  };
}

export default useRailgunBuy;
