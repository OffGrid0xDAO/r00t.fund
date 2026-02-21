/**
 * useAnonymousBuy - Complete In-App Anonymous Token Purchase
 *
 * This hook provides TRUE end-to-end anonymity without leaving the dApp:
 *
 * Step 1: Shield ETH to Railgun (if not already shielded)
 *   - ETH is wrapped to WETH and shielded to Railgun privacy pool
 *   - User gets shielded WETH in their Railgun wallet
 *
 * Step 2: Execute cross-contract call (unshield → unwrap → buy)
 *   - Generates ZK proof for the cross-contract call
 *   - Unshields WETH from Railgun
 *   - Unwraps WETH to ETH
 *   - Calls buyPrivate() on ZkAMM
 *   - All in ONE anonymous transaction
 *
 * The key: Cross-contract calls allow us to use shielded funds for
 * arbitrary contract interactions while maintaining privacy.
 */

import { useState, useCallback, useEffect } from 'react';
import { useAccount, usePublicClient, useWalletClient } from 'wagmi';
import {
  parseEther,
  keccak256,
  toBytes,
  encodeFunctionData,
  type Address,
  type Hex,
} from 'viem';
import { hashCommitment as poseidonHashCommitment, randomFieldElement, encryptNote } from '@r00t-fund/sdk';
import { Wallet } from 'ethers';
import { hexToBytes } from 'viem';
import { entropyToMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';
import { EVENTS, NETWORK, CHAIN, CONTRACTS, EXTERNAL } from '../config';

// Railgun SDK imports (lazy loaded - ONLY when Anonymous mode is used)
type Chain = { type: number; id: number };
type AbstractWallet = unknown; // The actual wallet object from the SDK

// Balance update event structure from Railgun SDK
type RailgunBalancesEvent = {
  txidVersion: string;
  chain: Chain;
  railgunWalletID: string;
  balanceBucket: string; // 'Spendable', 'ShieldPending', etc.
  erc20Amounts: Array<{ tokenAddress: string; amount: bigint }>;
  nftAmounts: unknown[];
};

type RailgunSDK = {
  startRailgunEngine: (...args: unknown[]) => Promise<void>;
  loadProvider: (...args: unknown[]) => Promise<unknown>;
  // createRailgunWallet signature: (encryptionKey, mnemonic, creationBlockNumbers, derivationIndex)
  // Railway.xyz uses derivationIndex=0 by default, so we must use 0 for compatibility
  createRailgunWallet: (
    encryptionKey: string,
    mnemonic: string,
    creationBlockNumbers: Record<string, number> | undefined,
    derivationIndex?: number
  ) => Promise<{ id: string; railgunAddress: string }>;
  setLoggers: (log: (msg: string) => void, err: (err: unknown) => void) => void;
  setOnUTXOMerkletreeScanCallback: (cb: (data: { progress: number; status?: string }) => void) => void;
  setOnTXIDMerkletreeScanCallback: (cb: (data: { progress: number; status?: string }) => void) => void;
  setOnBalanceUpdateCallback: (cb: (event: RailgunBalancesEvent) => void) => void;
  ArtifactStore: unknown;
  populateShieldBaseToken: (...args: unknown[]) => Promise<{ transaction: { to?: string; data?: string; value?: bigint } }>;
  gasEstimateForUnprovenCrossContractCalls: (...args: unknown[]) => Promise<{ gasEstimate: bigint }>;
  generateCrossContractCallsProof: (...args: unknown[]) => Promise<void>;
  populateProvedCrossContractCalls: (...args: unknown[]) => Promise<{ transaction: { to?: string; data?: string; value?: bigint } }>;
  // Balance checking functions - need correct signatures per SDK
  // refreshBalances takes (chain: Chain, walletIdFilter?: string[])
  refreshBalances: (chain: Chain, walletIdFilter?: string[]) => Promise<void>;
  // walletForID gets the wallet object from a walletId
  walletForID: (id: string) => AbstractWallet;
  // balanceForERC20Token takes (txidVersion, wallet, networkName, tokenAddress, onlySpendable) and returns bigint directly
  balanceForERC20Token: (
    txidVersion: string,
    wallet: AbstractWallet,
    networkName: string,
    tokenAddress: string,
    onlySpendable: boolean
  ) => Promise<bigint>;
  // NETWORK_CONFIG to get chain and deployment block from networkName
  NETWORK_CONFIG: Record<string, { chain: Chain; deploymentBlock: number }>;
  NetworkName: { Arbitrum: string };
  TXIDVersion: { V2_PoseidonMerkle: string };
  EVMGasType: { Type2: number };
};

let sdkPromise: Promise<RailgunSDK> | null = null;
let engineInitPromise: Promise<void> | null = null;

/**
 * Lazy load Railgun SDK - ONLY called when Anonymous mode is explicitly used
 * This prevents the SDK from loading for Quick Private mode
 */
async function loadRailgunSDK(): Promise<RailgunSDK> {
  if (sdkPromise) return sdkPromise;

  console.log('[useAnonymousBuy] Loading Railgun SDK for Anonymous mode...');

  sdkPromise = (async () => {
    const [sharedModels, wallet] = await Promise.all([
      import('@railgun-community/shared-models'),
      import('@railgun-community/wallet'),
    ]);

    return {
      startRailgunEngine: wallet.startRailgunEngine as RailgunSDK['startRailgunEngine'],
      loadProvider: wallet.loadProvider as RailgunSDK['loadProvider'],
      createRailgunWallet: wallet.createRailgunWallet as RailgunSDK['createRailgunWallet'],
      setLoggers: wallet.setLoggers,
      setOnUTXOMerkletreeScanCallback: wallet.setOnUTXOMerkletreeScanCallback,
      setOnTXIDMerkletreeScanCallback: wallet.setOnTXIDMerkletreeScanCallback,
      setOnBalanceUpdateCallback: wallet.setOnBalanceUpdateCallback as RailgunSDK['setOnBalanceUpdateCallback'],
      ArtifactStore: wallet.ArtifactStore,
      populateShieldBaseToken: wallet.populateShieldBaseToken as RailgunSDK['populateShieldBaseToken'],
      gasEstimateForUnprovenCrossContractCalls: wallet.gasEstimateForUnprovenCrossContractCalls as RailgunSDK['gasEstimateForUnprovenCrossContractCalls'],
      generateCrossContractCallsProof: wallet.generateCrossContractCallsProof as RailgunSDK['generateCrossContractCallsProof'],
      populateProvedCrossContractCalls: wallet.populateProvedCrossContractCalls as RailgunSDK['populateProvedCrossContractCalls'],
      // Balance checking functions - use correct SDK function names
      refreshBalances: wallet.refreshBalances as RailgunSDK['refreshBalances'],
      walletForID: wallet.walletForID as RailgunSDK['walletForID'],
      balanceForERC20Token: wallet.balanceForERC20Token as RailgunSDK['balanceForERC20Token'],
      // Network config for chain lookup
      NETWORK_CONFIG: sharedModels.NETWORK_CONFIG as RailgunSDK['NETWORK_CONFIG'],
      NetworkName: sharedModels.NetworkName,
      TXIDVersion: sharedModels.TXIDVersion,
      EVMGasType: sharedModels.EVMGasType,
    };
  })();

  return sdkPromise;
}

// Contract addresses - import from config for consistency
const WETH_ADDRESS = EXTERNAL.weth as Address;
const RELAY_ADAPT = EXTERNAL.relayAdapt as Address;

// ABIs
const ZKAMM_ABI = [
  {
    name: 'buyPrivate',
    type: 'function',
    stateMutability: 'payable',
    inputs: [
      { name: 'newCommitment', type: 'uint256' },
      { name: 'minTokensOut', type: 'uint256' },
      { name: 'deadline', type: 'uint256' },
      { name: 'encryptedNote', type: 'bytes' },
    ],
    outputs: [],
  },
  { name: 'ethReserve', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { name: 'tokenReserve', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { name: 'getAmountOut', type: 'function', stateMutability: 'view', inputs: [{ name: 'amountIn', type: 'uint256' }, { name: 'reserveIn', type: 'uint256' }, { name: 'reserveOut', type: 'uint256' }], outputs: [{ type: 'uint256' }] },
] as const;

const WETH_ABI = [
  { name: 'withdraw', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'amount', type: 'uint256' }], outputs: [] },
] as const;

// Storage keys
const WALLET_MESSAGE = `Sign to generate your r00t.fund private wallet.

This signature creates a deterministic Railgun address for anonymous transactions.

It does NOT grant access to your funds.`;

const SHIELDED_BALANCE_KEY = 'r00t_shielded_balance';
const IMPORTED_MNEMONIC_KEY = 'r00t_imported_mnemonic';
const WALLET_INFO_KEY = 'r00t_wallet_info';

interface CrossContractCall {
  to: Address;
  data: Hex;
  value: bigint;
}

interface BuyResult {
  success: boolean;
  txHash?: string;
  commitment?: bigint;
  nullifier?: bigint;
  secret?: bigint;
  tokensReceived?: bigint;
  leafIndex?: number;
  error?: string;
}

interface WalletInfo {
  walletId: string;
  railgunAddress: string;
  encryptionKey: string;
  mnemonic: string; // 12-word seed phrase for Railway export
  isImported?: boolean; // Whether this wallet was imported from Railway
}

/**
 * Complete hook for anonymous buying within the dApp
 */
export function useAnonymousBuy(zkAMMAddress: string) {
  const { address, isConnected } = useAccount();
  const publicClient = usePublicClient();
  const { data: walletClient } = useWalletClient();

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState({ step: '', percent: 0 });
  const [shieldedBalance, setShieldedBalance] = useState(0n);
  const [walletInfo, setWalletInfo] = useState<WalletInfo | null>(null);
  const [isEngineReady, setIsEngineReady] = useState(false);

  // Scan state tracking - prevents premature balance queries
  const [utxoScanProgress, setUtxoScanProgress] = useState(0);
  const [txidScanProgress, setTxidScanProgress] = useState(0);
  const [utxoScanComplete, setUtxoScanComplete] = useState(false);
  const [txidScanComplete, setTxidScanComplete] = useState(false);
  const [balanceCallbackReceived, setBalanceCallbackReceived] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);

  // Balance cache from setOnBalanceUpdateCallback - the proper way to track balances
  // This gets updated automatically by the SDK as balances change during scanning
  const [spendableWethBalance, setSpendableWethBalance] = useState(0n);
  const [pendingWethBalance, setPendingWethBalance] = useState(0n);

  // Scan is complete when BOTH scans finish AND balance callback fires
  // This ensures we have accurate balance data before marking complete
  const isScanComplete = txidScanComplete && utxoScanComplete && balanceCallbackReceived;

  // Combined sequential progress: TXID 0-30%, UTXO 30-100%
  // Only reaches 100% when both scans complete
  // NOTE: If UTXO progress is non-zero, TXID scan must be done (even if callback didn't fire)
  const scanProgress = utxoScanProgress > 0
    ? 30 + (utxoScanProgress * 0.7)  // UTXO phase: 30-100% (TXID must be done if UTXO started)
    : txidScanProgress * 0.3;        // TXID phase: 0-30%
  const scanPhase = utxoScanProgress > 0 ? (!utxoScanComplete ? 'utxo' : 'complete') : 'txid';

  // Load shielded balance from storage
  useEffect(() => {
    if (address) {
      const saved = localStorage.getItem(`${SHIELDED_BALANCE_KEY}_${address}`);
      if (saved) {
        setShieldedBalance(BigInt(saved));
      }
    }
  }, [address]);

  // Load wallet info from localStorage on mount (per address)
  useEffect(() => {
    console.log('[useAnonymousBuy] Checking for saved wallet, address:', address);
    if (address) {
      const storageKey = `${WALLET_INFO_KEY}_${address}`;
      console.log('[useAnonymousBuy] Looking for key:', storageKey);
      const saved = localStorage.getItem(storageKey);
      console.log('[useAnonymousBuy] Found saved data:', saved ? 'YES' : 'NO');
      if (saved) {
        try {
          const parsed = JSON.parse(saved) as WalletInfo;
          setWalletInfo(parsed);
          console.log('[useAnonymousBuy] Loaded saved wallet:', parsed.railgunAddress?.slice(0, 20) + '...');
          console.log('[useAnonymousBuy] Wallet has mnemonic:', !!parsed.mnemonic);
        } catch (err) {
          console.error('[useAnonymousBuy] Failed to parse saved wallet info:', err);
          localStorage.removeItem(`${WALLET_INFO_KEY}_${address}`);
        }
      } else {
        console.log('[useAnonymousBuy] No saved wallet found for this address');
      }
    }
  }, [address]);

  // NOTE: Auto-initialization DISABLED to prevent RPC spam from Railgun merkle tree scanning.
  // Railgun engine will only initialize when user explicitly uses anonymous mode.
  // This saves significant RPC calls since Railgun scans its own contracts (not ours).
  // Users can still use "quick private" mode without Railgun initialization.
  /*
  useEffect(() => {
    // If we have saved wallet info but engine isn't ready, initialize it
    if (walletInfo && !isEngineReady && !isLoading) {
      console.log('[useAnonymousBuy] Saved wallet detected, auto-initializing engine...');
      // ... auto-init code disabled
    }
  }, [walletInfo, isEngineReady, isLoading]);
  */

  // Re-create wallet object after engine init (SDK wallet is lost on page refresh)
  useEffect(() => {
    async function recreateWallet() {
      if (!walletInfo?.mnemonic || !isEngineReady) {
        console.log('[useAnonymousBuy] recreateWallet skipped - mnemonic:', !!walletInfo?.mnemonic, 'isEngineReady:', isEngineReady);
        return;
      }

      try {
        console.log('[useAnonymousBuy] Starting wallet recreation...');
        console.log('[useAnonymousBuy] Stored walletId:', walletInfo.walletId);
        console.log('[useAnonymousBuy] Stored railgunAddress:', walletInfo.railgunAddress);

        const sdk = await loadRailgunSDK();

        // Check if wallet already exists in SDK
        const existingWallet = sdk.walletForID(walletInfo.walletId);
        console.log('[useAnonymousBuy] existingWallet check:', existingWallet ? 'FOUND' : 'NOT FOUND');

        if (existingWallet) {
          console.log('[useAnonymousBuy] Wallet already loaded in SDK');
          // Trigger refreshBalances to start the scan process, but don't await
          // This allows scans to run in background without blocking
          const arbitrumChain = sdk.NETWORK_CONFIG[sdk.NetworkName.Arbitrum].chain;
          console.log('[useAnonymousBuy] Starting background scan...');
          sdk.refreshBalances(arbitrumChain, [walletInfo.walletId]).catch(err => {
            // Errors are expected during initial sync - they're logged via setLoggers
            console.warn('[useAnonymousBuy] Background scan error (expected during sync):', err);
          });
          return;
        }

        // Re-create wallet from saved mnemonic
        console.log('[useAnonymousBuy] Re-creating wallet from saved mnemonic...');
        console.log('[useAnonymousBuy] Using mnemonic (first 3 words):', walletInfo.mnemonic.split(' ').slice(0, 3).join(' ') + '...');

        // Use deployment block for creation block numbers to optimize scanning
        // This ensures we scan from the beginning of Railgun deployment on Arbitrum
        const deploymentBlock = sdk.NETWORK_CONFIG[sdk.NetworkName.Arbitrum].deploymentBlock;
        const creationBlockNumbers = {
          [sdk.NetworkName.Arbitrum]: deploymentBlock,
        };
        console.log('[useAnonymousBuy] Using creation block:', deploymentBlock);

        const { id: newWalletId, railgunAddress: newAddress } = await sdk.createRailgunWallet(
          walletInfo.encryptionKey,
          walletInfo.mnemonic,
          creationBlockNumbers,
          0 // derivationIndex must be 0 for Railway compatibility
        );
        console.log('[useAnonymousBuy] Wallet recreated!');
        console.log('[useAnonymousBuy] New walletId:', newWalletId);
        console.log('[useAnonymousBuy] New railgunAddress:', newAddress);
        console.log('[useAnonymousBuy] Address matches stored?', newAddress === walletInfo.railgunAddress);

        // CRITICAL FIX: Update walletInfo state with new walletId
        // The SDK generates a new walletId on each createRailgunWallet call
        // If we don't update the state, useRailgun will query with stale walletId
        if (newWalletId !== walletInfo.walletId) {
          console.log('[useAnonymousBuy] Updating walletId:', walletInfo.walletId, '→', newWalletId);
          const updatedInfo = { ...walletInfo, walletId: newWalletId };
          setWalletInfo(updatedInfo);

          // Also update localStorage so the new walletId persists
          if (address) {
            localStorage.setItem(`${WALLET_INFO_KEY}_${address}`, JSON.stringify(updatedInfo));
          }
        }

        // Trigger refreshBalances to start the scan process, but don't await
        // This allows scans to run in background without blocking
        const arbitrumChain = sdk.NETWORK_CONFIG[sdk.NetworkName.Arbitrum].chain;
        console.log('[useAnonymousBuy] Wallet recreated - starting background scan...');
        sdk.refreshBalances(arbitrumChain, [newWalletId]).catch(err => {
          // Errors are expected during initial sync - they're logged via setLoggers
          console.warn('[useAnonymousBuy] Background scan error (expected during sync):', err);
        });
      } catch (err) {
        console.error('[useAnonymousBuy] Failed to recreate wallet:', err);
        // Surface error to UI
        const errMsg = String(err);
        if (errMsg.includes('ciphertext') || errMsg.includes('commitment') || errMsg.includes('TXID')) {
          setScanError('Sync error detected. Try clearing database & resyncing.');
        }
      }
    }

    recreateWallet();
  }, [walletInfo, isEngineReady, address]);

  /**
   * Initialize Railgun engine (once per session)
   * Uses module-level promise singleton to prevent race conditions
   */
  const initializeEngine = useCallback(async (
    onProgress?: (step: string, percent: number) => void
  ): Promise<void> => {
    // If already initialized, return immediately
    if (engineInitPromise) {
      await engineInitPromise;
      setIsEngineReady(true);
      return;
    }

    // Reset scan state at start of initialization
    setTxidScanProgress(0);
    setUtxoScanProgress(0);
    setUtxoScanComplete(false);
    setTxidScanComplete(false);
    setBalanceCallbackReceived(false);
    setScanError(null);

    // Create the initialization promise (singleton)
    engineInitPromise = (async () => {
      onProgress?.('Loading Railgun SDK...', 5);
      const sdk = await loadRailgunSDK();

      onProgress?.('Creating artifact store...', 10);
      const localforage = (await import('localforage')).default;
      const store = localforage.createInstance({ name: 'railgun-artifacts', storeName: 'artifacts' });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const ArtifactStore = sdk.ArtifactStore as any;
      const artifactStore = new ArtifactStore(
        async (path: string) => {
          const data = await store.getItem<string | ArrayBuffer>(path);
          if (!data) return null;
          return typeof data === 'string' ? data : Buffer.from(data);
        },
        async (dir: string, path: string, item: string | Uint8Array) => {
          const fullPath = dir ? `${dir}/${path}` : path;
          await store.setItem(fullPath, item);
        },
        async (path: string) => (await store.getItem(path)) !== null
      );

      onProgress?.('Creating database...', 15);
      // Ensure process.nextTick is available for memdown's internal streams
      // This is needed because vite-plugin-node-polyfills doesn't always polyfill it correctly
      if (typeof globalThis.process === 'undefined') {
        // @ts-expect-error - polyfill process object
        globalThis.process = {};
      }
      if (typeof globalThis.process.nextTick !== 'function') {
        globalThis.process.nextTick = (fn: () => void, ...args: unknown[]) => {
          queueMicrotask(() => fn.apply(null, args as []));
        };
      }

      // Use memdown - pure in-memory leveldown implementation
      // This bypasses IndexedDB issues but data won't persist across refreshes
      // TODO: Switch to persistent storage once we find a compatible implementation
      const memdown = (await import('memdown')).default;
      const db = memdown();

      onProgress?.('Starting engine...', 20);

      // POI (Private Proof of Innocence) aggregator nodes
      // See: https://docs.railgun.org/developer-guide/wallet/getting-started/1.-start-the-railgun-privacy-engine
      const poiNodeURLs = ['https://ppoi-agg.horsewithsixlegs.xyz'];

      await sdk.startRailgunEngine(
        'r00t.fund',
        db,
        true,
        artifactStore,
        false, // useNativeArtifacts
        false, // skipMerkletreeScans - must be false for wallet balances
        poiNodeURLs
      );

      // Set up logging AFTER engine is started
      // Also detect scan errors from log messages
      sdk.setLoggers(
        (msg: string) => {
          console.log('[Railgun]', msg);
          // Detect sync mismatch errors
          if (msg.includes('Stopping queue of Railgun TXIDs') ||
              msg.includes('missing a commitment or unshield')) {
            setScanError('Database sync mismatch detected. Try clearing & resyncing.');
          }
        },
        (err: unknown) => console.error('[Railgun Error]', err)
      );

      // Set up merkle tree scan callbacks AFTER engine is started
      // Both UTXO and TXID callbacks are required per SDK docs
      // TXID scan runs first, then UTXO scan for wallet balances

      // TXID scan callback - tracks transaction ID merkle tree sync (runs first)
      sdk.setOnTXIDMerkletreeScanCallback((data) => {
        console.log('[useAnonymousBuy] TXID Merkle scan progress:', data);
        const progressPercent = (data.progress || 0) * 100;
        setTxidScanProgress(progressPercent);

        if (data.progress > 0) {
          onProgress?.(`Syncing TXIDs: ${progressPercent.toFixed(1)}%`, 25 + data.progress * 0.25);
        }

        // Mark TXID scan as complete when it reaches ~100%
        if (data.progress >= 0.99) {
          console.log('[useAnonymousBuy] TXID Merkle scan complete!');
          setTxidScanComplete(true);
        }
      });

      // UTXO scan callback - tracks unspent outputs (runs after TXID, contains balances)
      sdk.setOnUTXOMerkletreeScanCallback((data) => {
        console.log('[useAnonymousBuy] UTXO Merkle scan progress:', data);
        const progressPercent = (data.progress || 0) * 100;
        setUtxoScanProgress(progressPercent);

        if (data.progress > 0) {
          onProgress?.(`Scanning UTXOs: ${progressPercent.toFixed(1)}%`, 50 + data.progress * 0.5);
        }

        // Mark UTXO scan as complete when it reaches ~100%
        if (data.progress >= 0.99) {
          console.log('[useAnonymousBuy] UTXO Merkle scan complete!');
          setUtxoScanComplete(true);
          setScanError(null);
        }
      });

      // Set up balance update callback - THE CORRECT WAY to get balances per Railgun docs
      // This is called automatically by SDK when balances are discovered/updated during scanning
      // See: https://docs.railgun.org/developer-guide/wallet/private-balances/balance-and-sync-callbacks
      sdk.setOnBalanceUpdateCallback((event) => {
        console.log('[useAnonymousBuy] Balance update received:', {
          walletID: event.railgunWalletID,
          bucket: event.balanceBucket,
          erc20Count: event.erc20Amounts?.length || 0,
          amounts: event.erc20Amounts?.map(a => ({
            token: a.tokenAddress,
            amount: a.amount?.toString()
          }))
        });

        // Find WETH balance in the update
        const wethAmount = event.erc20Amounts?.find(
          a => a.tokenAddress?.toLowerCase() === WETH_ADDRESS.toLowerCase()
        );

        if (wethAmount) {
          const balance = wethAmount.amount || 0n;
          console.log(`[useAnonymousBuy] WETH ${event.balanceBucket} balance:`, balance.toString());

          // Update the appropriate balance based on bucket type
          if (event.balanceBucket === 'Spendable') {
            setSpendableWethBalance(balance);
            // Also update the legacy shieldedBalance for backward compatibility
            setShieldedBalance(balance);
          } else if (event.balanceBucket === 'ShieldPending') {
            setPendingWethBalance(balance);
          }
        }

        // Mark that we've received at least one balance callback
        // This ensures isScanComplete waits for balance data
        setBalanceCallbackReceived(true);
      });

      onProgress?.('Loading Arbitrum provider...', 40);

      // Use sequential fallback: try primary RPC first, then fallbacks
      // Primary RPC from config (Alchemy) has higher rate limits
      const rpcEndpoints = [
        NETWORK.rpcUrl,                              // Primary from config (Alchemy)
        'https://arb1.arbitrum.io/rpc',              // Arbitrum official fallback
      ];

      let providerLoaded = false;

      for (const rpcUrl of rpcEndpoints) {
        try {
          onProgress?.(`Connecting to Arbitrum...`, 42);
          // Valid FallbackProviderJsonConfig format
          // NOTE: totalWeight must be >= 2 for SDK quorum validation
          const providerConfig = {
            chainId: 42161,
            providers: [
              { provider: rpcUrl, priority: 1, weight: 2 },
            ],
          };
          await sdk.loadProvider(providerConfig, sdk.NetworkName.Arbitrum, 60000);
          console.log('[useAnonymousBuy] Railgun provider loaded successfully via:', rpcUrl);
          providerLoaded = true;
          break;
        } catch (err) {
          console.warn(`[useAnonymousBuy] Failed to connect via ${rpcUrl}:`, err);
          // Brief delay before trying next provider
          await new Promise(r => setTimeout(r, 1000));
        }
      }

      // If all providers failed, throw error
      if (!providerLoaded) {
        throw new Error(`Failed to connect to Arbitrum network. Please check your internet connection and try again.`);
      }

      console.log('[useAnonymousBuy] ✅ Railgun engine fully initialized!');
    })();

    await engineInitPromise;
    setIsEngineReady(true);
    onProgress?.('Engine ready!', 50);
  }, []);

  /**
   * Generate/load Railgun wallet from signature
   * OPTIMIZED: Request signature immediately while engine initializes in parallel
   */
  const getOrCreateWallet = useCallback(async (
    onProgress?: (step: string, percent: number) => void
  ): Promise<WalletInfo> => {
    if (walletInfo) return walletInfo;
    if (!walletClient || !address) throw new Error('Wallet not connected');

    // OPTIMIZATION: Request signature IMMEDIATELY while engine initializes in parallel
    // This way MetaMask popup appears instantly instead of after 10+ seconds
    onProgress?.('Requesting signature...', 5);
    const signaturePromise = walletClient.signMessage({ message: WALLET_MESSAGE });

    // Start engine initialization in parallel with signature request
    const enginePromise = initializeEngine(onProgress);

    // Wait for signature (user interaction - usually the slower part)
    const signature = await signaturePromise;

    // Derive mnemonic from signature (fast, no SDK needed)
    const entropyHash = keccak256(toBytes(signature));
    const entropyBytes = hexToBytes(entropyHash as `0x${string}`).slice(0, 16);
    const mnemonic = entropyToMnemonic(entropyBytes, wordlist);

    // Encryption key from different part
    const encryptionKey = keccak256(toBytes(signature + 'encryption')).slice(2); // Remove 0x

    // Now wait for engine to be ready (may already be done if user took time to sign)
    await enginePromise;

    onProgress?.('Creating Railgun wallet...', 55);
    const sdk = await loadRailgunSDK();

    // Use deployment block for creation block numbers
    // For new wallets, we can use current block to optimize scanning
    // but for Railway compatibility, use deployment block to find any existing funds
    const deploymentBlock = sdk.NETWORK_CONFIG[sdk.NetworkName.Arbitrum].deploymentBlock;
    const creationBlockNumbers = {
      [sdk.NetworkName.Arbitrum]: deploymentBlock,
    };

    // IMPORTANT: Use derivationIndex=0 to match Railway.xyz's default
    // This ensures the same mnemonic produces the same 0zk address
    const { id: walletId, railgunAddress } = await sdk.createRailgunWallet(
      encryptionKey,
      mnemonic,
      creationBlockNumbers,
      0          // derivationIndex - MUST be 0 to match Railway.xyz
    );

    const info = { walletId, railgunAddress, encryptionKey, mnemonic };
    setWalletInfo(info);

    // Persist wallet info to localStorage
    if (address) {
      localStorage.setItem(`${WALLET_INFO_KEY}_${address}`, JSON.stringify(info));
      console.log('[useAnonymousBuy] Saved wallet info to localStorage');
    }

    onProgress?.('Wallet ready!', 60);
    console.log('[useAnonymousBuy] Wallet created:', railgunAddress.slice(0, 20) + '...');

    return info;
  }, [walletClient, address, walletInfo, initializeEngine]);

  /**
   * Shield ETH to Railgun
   */
  const shieldETH = useCallback(async (
    ethAmount: string,
    onProgress?: (step: string, percent: number) => void
  ): Promise<{ txHash: string; amountShielded: bigint }> => {
    if (!walletClient || !publicClient || !address) {
      throw new Error('Wallet not connected');
    }

    const sdk = await loadRailgunSDK();
    const wallet = await getOrCreateWallet(onProgress);
    const ethAmountWei = parseEther(ethAmount);

    onProgress?.('Preparing shield transaction...', 65);

    // Get shield private key from signature
    // IMPORTANT: Must use exact message 'RAILGUN_SHIELD' per SDK requirement
    // See: @railgun-community/engine/dist/note/shield-note.js getShieldPrivateKeySignatureMessage()
    const SHIELD_SIGNATURE_MESSAGE = 'RAILGUN_SHIELD';
    const spkSignature = await walletClient.signMessage({
      message: SHIELD_SIGNATURE_MESSAGE
    });
    const shieldPrivateKey = keccak256(toBytes(spkSignature));

    const wrappedERC20Amount = {
      tokenAddress: WETH_ADDRESS,
      amount: ethAmountWei,
    };

    const response = await sdk.populateShieldBaseToken(
      sdk.TXIDVersion.V2_PoseidonMerkle,
      sdk.NetworkName.Arbitrum,
      wallet.railgunAddress,
      shieldPrivateKey,
      wrappedERC20Amount
    );

    if (!response.transaction) {
      throw new Error('Failed to generate shield transaction');
    }

    onProgress?.('Sending shield transaction...', 70);

    const hash = await walletClient.sendTransaction({
      to: response.transaction.to as Address,
      data: response.transaction.data as Hex,
      value: ethAmountWei,
      chain: CHAIN,
    });

    onProgress?.('Confirming shield...', 80);
    await publicClient.waitForTransactionReceipt({ hash });

    // Calculate net amount after 0.25% fee
    const fee = ethAmountWei * 25n / 10000n;
    const netAmount = ethAmountWei - fee;

    // Update local balance tracking
    const newBalance = shieldedBalance + netAmount;
    setShieldedBalance(newBalance);
    localStorage.setItem(`${SHIELDED_BALANCE_KEY}_${address}`, newBalance.toString());

    onProgress?.('Shield complete!', 85);
    console.log('[useAnonymousBuy] Shielded:', netAmount.toString(), 'wei');

    return { txHash: hash, amountShielded: netAmount };
  }, [walletClient, publicClient, address, getOrCreateWallet, shieldedBalance]);

  /**
   * Execute anonymous buy using cross-contract calls
   * This is the KEY function that makes everything work in-app!
   * @param slippageBps - Slippage tolerance in basis points (100 = 1%)
   */
  const executeAnonymousBuy = useCallback(async (
    ethAmount: string,
    viewingKey: string,
    onProgress?: (step: string, percent: number) => void,
    slippageBps: number = 100 // Default 1%
  ): Promise<BuyResult> => {
    if (!walletClient || !publicClient || !address) {
      return { success: false, error: 'Wallet not connected' };
    }

    setIsLoading(true);
    setError(null);

    const updateProgress = (step: string, percent: number) => {
      setProgress({ step, percent });
      onProgress?.(step, percent);
    };

    try {
      const ethAmountWei = parseEther(ethAmount);

      // Step 1: Initialize engine
      updateProgress('Initializing privacy engine...', 5);
      await initializeEngine(updateProgress);

      // Step 2: Get/create wallet
      const wallet = await getOrCreateWallet(updateProgress);

      // Step 3: Get pool state for commitment generation
      // Read from PAIR contract (state), not Router
      updateProgress('Getting pool state...', 62);
      const pairAddress = CONTRACTS.zkAMMPair as Address;
      const [ethReserve, tokenReserve] = await Promise.all([
        publicClient.readContract({
          address: pairAddress,
          abi: ZKAMM_ABI,
          functionName: 'ethReserve',
        }),
        publicClient.readContract({
          address: pairAddress,
          abi: ZKAMM_ABI,
          functionName: 'tokenReserve',
        }),
      ]);

      // getAmountOut is on the Router contract, not Pair
      const routerAddress = CONTRACTS.zkAMMRouter as Address;
      const tokensOut = await publicClient.readContract({
        address: routerAddress,
        abi: ZKAMM_ABI,
        functionName: 'getAmountOut',
        args: [ethAmountWei, ethReserve, tokenReserve],
      });

      // Step 4: Generate commitment
      updateProgress('Generating commitment...', 65);
      const nullifier = randomFieldElement();
      const secret = randomFieldElement();
      const commitment = poseidonHashCommitment(nullifier, secret, tokensOut);

      // Use proper ECDH + AES-GCM encryption so secrets can be recovered from chain
      const viewingWallet = new Wallet(viewingKey);
      const viewingPublicKey = viewingWallet.signingKey.compressedPublicKey;
      const encryptedNote = await encryptNote(nullifier, secret, tokensOut, viewingPublicKey) as Hex;

      // Step 5: Load SDK early (needed for balance polling)
      const sdk = await loadRailgunSDK();

      // Step 6: Check if we have enough shielded balance
      const unshieldFee = ethAmountWei * 25n / 10000n;
      const requiredShielded = ethAmountWei + unshieldFee;

      if (shieldedBalance < requiredShielded) {
        // Need to shield first
        updateProgress('Shielding ETH first...', 68);
        console.log('[useAnonymousBuy] Shielding to 0zk address:', wallet.railgunAddress);
        await shieldETH(ethAmount, updateProgress);

        // Wait for Railgun to detect the shielded balance
        updateProgress('Waiting for privacy pool sync...', 72);
        console.log('[useAnonymousBuy] Waiting for shielded balance to be detected...');

        const POLL_INTERVAL = 3000; // 3 seconds
        const MAX_WAIT = 120000; // 2 minutes max
        const startTime = Date.now();
        let detectedBalance = 0n;

        while (Date.now() - startTime < MAX_WAIT) {
          try {
            // Get the chain object for Arbitrum from NETWORK_CONFIG
            const arbitrumChain = sdk.NETWORK_CONFIG[sdk.NetworkName.Arbitrum].chain;

            // Refresh balances for this wallet - takes (chain, walletIdFilter)
            await sdk.refreshBalances(arbitrumChain, [wallet.walletId]);

            // Get the wallet object from walletId
            const walletObj = sdk.walletForID(wallet.walletId);

            // Check WETH balance in Railgun wallet - takes (txidVersion, wallet, networkName, tokenAddress, onlySpendable)
            // Returns bigint directly (not wrapped in object)
            detectedBalance = await sdk.balanceForERC20Token(
              sdk.TXIDVersion.V2_PoseidonMerkle,
              walletObj,
              sdk.NetworkName.Arbitrum,
              WETH_ADDRESS,
              false // onlySpendable - check total balance first
            );

            console.log('[useAnonymousBuy] Detected shielded WETH balance:', detectedBalance.toString());

            if (detectedBalance >= requiredShielded) {
              updateProgress('Balance detected! Preparing transaction...', 74);
              break;
            }
          } catch (scanErr) {
            console.warn('[useAnonymousBuy] Balance check error:', scanErr);
          }

          const elapsed = Math.round((Date.now() - startTime) / 1000);
          updateProgress(`Syncing privacy pool (${elapsed}s)...`, 72);
          await new Promise(r => setTimeout(r, POLL_INTERVAL));
        }

        // Final check - if still no balance after timeout
        if (detectedBalance < requiredShielded) {
          throw new Error(
            `Shielded balance not detected after 2 minutes. ` +
            `Expected: ${requiredShielded.toString()} wei, Got: ${detectedBalance.toString()} wei. ` +
            `Your 0zk address: ${wallet.railgunAddress.slice(0, 30)}...`
          );
        }
      }

      // Step 7: Generate cross-contract calls
      updateProgress('Preparing anonymous transaction...', 70);

      // Call 1: Unwrap WETH to ETH
      const unwrapCall: CrossContractCall = {
        to: WETH_ADDRESS,
        data: encodeFunctionData({
          abi: WETH_ABI,
          functionName: 'withdraw',
          args: [ethAmountWei],
        }),
        value: 0n,
      };

      // Calculate minimum tokens out based on slippage tolerance
      const minTokensOut = tokensOut * BigInt(10000 - slippageBps) / 10000n;

      // Deadline: 20 minutes from now
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 1200);

      // Call 2: Buy on ZkAMM Router (must go through Router so Ponder indexes the trade)
      const buyCall: CrossContractCall = {
        to: (CONTRACTS.zkAMMRouter || zkAMMAddress) as Address,
        data: encodeFunctionData({
          abi: ZKAMM_ABI,
          functionName: 'buyPrivate',
          args: [commitment, minTokensOut, deadline, encryptedNote],
        }),
        value: ethAmountWei,
      };

      const crossContractCalls = [unwrapCall, buyCall];

      // Step 8: Generate ZK proof and execute

      const unshieldERC20Amounts = [{
        tokenAddress: WETH_ADDRESS,
        amount: requiredShielded,
      }];

      const gasDetails = {
        evmGasType: sdk.EVMGasType.Type2,
        gasEstimate: 1000000n,
        maxFeePerGas: 100000000n,
        maxPriorityFeePerGas: 100000000n,
      };

      updateProgress('Estimating gas...', 75);

      const gasResponse = await sdk.gasEstimateForUnprovenCrossContractCalls(
        sdk.TXIDVersion.V2_PoseidonMerkle,
        sdk.NetworkName.Arbitrum,
        wallet.walletId,
        wallet.encryptionKey,
        unshieldERC20Amounts,
        [], // unshieldNFTAmounts
        [], // shieldERC20Recipients
        [], // shieldNFTRecipients
        crossContractCalls.map(c => ({ to: c.to, data: c.data, value: c.value })),
        gasDetails,
        undefined, // broadcasterFeeERC20AmountRecipient - not using broadcaster
        true,      // sendWithPublicWallet - we send from connected wallet
        500000n
      );

      updateProgress('Generating ZK proof (this takes 30-60s)...', 80);

      await sdk.generateCrossContractCallsProof(
        sdk.TXIDVersion.V2_PoseidonMerkle,
        sdk.NetworkName.Arbitrum,
        wallet.walletId,
        wallet.encryptionKey,
        unshieldERC20Amounts,
        [],
        [],
        [],
        crossContractCalls.map(c => ({ to: c.to, data: c.data, value: c.value })),
        undefined, // broadcasterFeeERC20AmountRecipient
        true,      // sendWithPublicWallet
        undefined,
        500000n,
        (proofProgress: number) => {
          updateProgress(`Generating proof: ${Math.round(proofProgress * 100)}%`, 80 + proofProgress * 10);
        }
      );

      updateProgress('Populating transaction...', 92);

      const { transaction } = await sdk.populateProvedCrossContractCalls(
        sdk.TXIDVersion.V2_PoseidonMerkle,
        sdk.NetworkName.Arbitrum,
        wallet.walletId,
        unshieldERC20Amounts,
        [],
        [],
        [],
        crossContractCalls.map(c => ({ to: c.to, data: c.data, value: c.value })),
        undefined, // broadcasterFeeERC20AmountRecipient
        true,      // sendWithPublicWallet
        undefined,
        { ...gasDetails, gasEstimate: gasResponse.gasEstimate }
      );

      updateProgress('Sending anonymous transaction...', 95);

      // Send via Relay Adapt contract
      const hash = await walletClient.sendTransaction({
        to: (transaction.to || RELAY_ADAPT) as Address,
        data: transaction.data as Hex,
        value: transaction.value || 0n,
        chain: CHAIN,
      });

      updateProgress('Confirming...', 98);
      const receipt = await publicClient.waitForTransactionReceipt({ hash });

      // Extract leafIndex from NewCommitment event
      const commitmentLog = receipt.logs.find(log =>
        log.topics[0] === EVENTS.newCommitment
      );
      const leafIndex = commitmentLog ? Number(BigInt(commitmentLog.topics[2] || '0')) : 0;

      // Update shielded balance
      const newBalance = shieldedBalance - requiredShielded;
      setShieldedBalance(newBalance > 0n ? newBalance : 0n);
      localStorage.setItem(`${SHIELDED_BALANCE_KEY}_${address}`, (newBalance > 0n ? newBalance : 0n).toString());

      updateProgress('Anonymous buy complete!', 100);

      return {
        success: true,
        txHash: hash,
        commitment,
        nullifier,
        secret,
        tokensReceived: tokensOut,
        leafIndex,
      };

    } catch (err) {
      const errorMsg = (err as Error).message || 'Anonymous buy failed';
      console.error('[useAnonymousBuy] Error:', err);
      setError(errorMsg);
      return { success: false, error: errorMsg };
    } finally {
      setIsLoading(false);
    }
  }, [
    walletClient, publicClient, address, zkAMMAddress,
    initializeEngine, getOrCreateWallet, shieldedBalance, shieldETH
  ]);

  /**
   * Quick private buy (tokens private, but tx visible)
   * Fallback for when full anonymity isn't needed
   * @param slippageBps - Slippage tolerance in basis points (100 = 1%)
   */
  const buyQuickPrivate = useCallback(async (
    ethAmount: string,
    viewingKey: string,
    onProgress?: (step: string, percent: number) => void,
    slippageBps: number = 100 // Default 1%
  ): Promise<BuyResult> => {
    if (!walletClient || !publicClient || !address) {
      return { success: false, error: 'Wallet not connected' };
    }

    setIsLoading(true);
    setError(null);

    try {
      const ethAmountWei = parseEther(ethAmount);

      onProgress?.('Getting pool state...', 20);

      // Read from PAIR contract (state), not Router
      const pairAddress = CONTRACTS.zkAMMPair as Address;
      const [ethReserve, tokenReserve] = await Promise.all([
        publicClient.readContract({
          address: pairAddress,
          abi: ZKAMM_ABI,
          functionName: 'ethReserve',
        }),
        publicClient.readContract({
          address: pairAddress,
          abi: ZKAMM_ABI,
          functionName: 'tokenReserve',
        }),
      ]);

      // getAmountOut is on the Router contract, not Pair
      const routerAddress = CONTRACTS.zkAMMRouter as Address;
      const tokensOut = await publicClient.readContract({
        address: routerAddress,
        abi: ZKAMM_ABI,
        functionName: 'getAmountOut',
        args: [ethAmountWei, ethReserve, tokenReserve],
      });

      onProgress?.('Generating commitment...', 30);

      const nullifier = randomFieldElement();
      const secret = randomFieldElement();
      const commitment = poseidonHashCommitment(nullifier, secret, tokensOut);

      // Use proper ECDH + AES-GCM encryption so secrets can be recovered from chain
      // Get public key from viewing key (which is already a 32-byte hex from signature)
      const wallet = new Wallet(viewingKey);
      const viewingPublicKey = wallet.signingKey.compressedPublicKey;
      const encryptedNote = await encryptNote(nullifier, secret, tokensOut, viewingPublicKey);

      // Calculate minimum tokens out based on slippage tolerance
      const minTokensOut = tokensOut * BigInt(10000 - slippageBps) / 10000n;

      // Deadline: 20 minutes from now
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 1200);

      onProgress?.('Sending transaction...', 50);

      // Must go through Router so Ponder indexes the trade (TokensPurchased event)
      const routerAddr = (CONTRACTS.zkAMMRouter || zkAMMAddress) as Address;
      const hash = await walletClient.writeContract({
        address: routerAddr,
        abi: ZKAMM_ABI,
        functionName: 'buyPrivate',
        args: [commitment, minTokensOut, deadline, encryptedNote as Hex],
        value: ethAmountWei,
        chain: CHAIN,
      });

      onProgress?.('Confirming...', 80);
      const receipt = await publicClient.waitForTransactionReceipt({ hash });

      const commitmentLog = receipt.logs.find(log =>
        log.topics[0] === EVENTS.newCommitment
      );
      const leafIndex = commitmentLog ? Number(BigInt(commitmentLog.topics[2] || '0')) : 0;

      onProgress?.('Complete!', 100);

      return {
        success: true,
        txHash: hash,
        commitment,
        nullifier,
        secret,
        tokensReceived: tokensOut,
        leafIndex,
      };

    } catch (err) {
      const errorMsg = (err as Error).message || 'Transaction failed';
      setError(errorMsg);
      return { success: false, error: errorMsg };
    } finally {
      setIsLoading(false);
    }
  }, [walletClient, publicClient, address, zkAMMAddress]);

  /**
   * Export wallet info for use in Railway or other Railgun wallets
   * WARNING: Keep this mnemonic secret! Anyone with it can access your funds.
   */
  const exportWallet = useCallback(async (): Promise<{
    railgunAddress: string;
    mnemonic: string;
  } | null> => {
    const wallet = walletInfo || await getOrCreateWallet();
    if (!wallet) return null;

    return {
      railgunAddress: wallet.railgunAddress,
      mnemonic: wallet.mnemonic,
    };
  }, [walletInfo, getOrCreateWallet]);

  /**
   * Copy mnemonic to clipboard (with warning)
   */
  const copyMnemonicToClipboard = useCallback(async (): Promise<boolean> => {
    const wallet = walletInfo || await getOrCreateWallet();
    if (!wallet?.mnemonic) return false;

    try {
      await navigator.clipboard.writeText(wallet.mnemonic);
      return true;
    } catch {
      return false;
    }
  }, [walletInfo, getOrCreateWallet]);

  /**
   * Import an existing Railgun wallet from Railway using mnemonic
   * This allows users to see balances from wallets created in Railway
   */
  const importWallet = useCallback(async (
    mnemonic: string,
    onProgress?: (step: string, percent: number) => void
  ): Promise<WalletInfo> => {
    // Validate mnemonic (should be 12 or 24 words)
    const words = mnemonic.trim().split(/\s+/);
    if (words.length !== 12 && words.length !== 24) {
      throw new Error('Invalid mnemonic: must be 12 or 24 words');
    }

    // MUST initialize engine first before creating wallet
    await initializeEngine(onProgress);

    onProgress?.('Importing wallet...', 55);
    const sdk = await loadRailgunSDK();

    // Generate encryption key from mnemonic
    const encryptionKey = keccak256(toBytes(mnemonic + 'r00t.fund')).slice(2);

    // Use deployment block for creation block numbers
    // This ensures we scan from the beginning to find existing funds
    const deploymentBlock = sdk.NETWORK_CONFIG[sdk.NetworkName.Arbitrum].deploymentBlock;
    const creationBlockNumbers = {
      [sdk.NetworkName.Arbitrum]: deploymentBlock,
    };

    // Create wallet with imported mnemonic
    // Use derivationIndex=0 to match Railway.xyz
    const { id: walletId, railgunAddress } = await sdk.createRailgunWallet(
      encryptionKey,
      mnemonic.trim(),
      creationBlockNumbers,
      0          // derivationIndex - MUST be 0 to match Railway.xyz
    );

    const info: WalletInfo = {
      walletId,
      railgunAddress,
      encryptionKey,
      mnemonic: mnemonic.trim(),
      isImported: true,
    };
    setWalletInfo(info);

    // Save wallet info and mnemonic to localStorage
    if (address) {
      localStorage.setItem(`${WALLET_INFO_KEY}_${address}`, JSON.stringify(info));
      localStorage.setItem(`${IMPORTED_MNEMONIC_KEY}_${address}`, mnemonic.trim());
      console.log('[useAnonymousBuy] Saved imported wallet to localStorage');
    }

    onProgress?.('Wallet imported!', 60);
    console.log('[useAnonymousBuy] Imported wallet:', railgunAddress.slice(0, 30) + '...');

    return info;
  }, [initializeEngine, address]);

  /**
   * Load previously imported wallet from storage
   */
  const loadImportedWallet = useCallback(async (
    onProgress?: (step: string, percent: number) => void
  ): Promise<WalletInfo | null> => {
    if (!address) return null;

    const savedMnemonic = localStorage.getItem(`${IMPORTED_MNEMONIC_KEY}_${address}`);
    if (!savedMnemonic) return null;

    try {
      return await importWallet(savedMnemonic, onProgress);
    } catch (err) {
      console.error('[useAnonymousBuy] Failed to load imported wallet:', err);
      return null;
    }
  }, [address, importWallet]);

  /**
   * Clear imported wallet (revert to generated wallet)
   */
  const clearImportedWallet = useCallback(() => {
    if (address) {
      localStorage.removeItem(`${IMPORTED_MNEMONIC_KEY}_${address}`);
    }
    setWalletInfo(null);
  }, [address]);

  /**
   * Clear Railgun database and force resync
   * Useful when scan errors occur (merkle root mismatch, invalid commitments, etc.)
   */
  const clearAndResync = useCallback(async () => {
    try {
      console.log('[useAnonymousBuy] Starting aggressive database clear...');

      // Clear ALL IndexedDB databases (not just railgun ones)
      // This is more aggressive but ensures a clean slate
      const databases = await indexedDB.databases();
      const deletedDbs: string[] = [];

      for (const db of databases) {
        if (db.name) {
          // Delete any database that might be related to Railgun
          const shouldDelete =
            db.name.includes('railgun') ||
            db.name.includes('browser-level') ||
            db.name.includes('level') ||
            db.name.includes('localforage') ||
            db.name.includes('artifacts') ||
            db.name === 'railgun-artifacts' ||
            db.name === 'railgun-engine-db';

          if (shouldDelete) {
            console.log('[useAnonymousBuy] Deleting database:', db.name);
            indexedDB.deleteDatabase(db.name);
            deletedDbs.push(db.name);
          }
        }
      }

      console.log('[useAnonymousBuy] Deleted databases:', deletedDbs);

      // Clear localStorage items related to wallet (but keep wallet info for re-creation)
      // Don't clear wallet info so user doesn't have to regenerate

      // Clear wallet state but keep walletInfo for recreation after refresh
      setIsEngineReady(false);
      setUtxoScanProgress(0);
      setTxidScanProgress(0);
      setUtxoScanComplete(false);
      setTxidScanComplete(false);
      setBalanceCallbackReceived(false);
      setScanError(null);
      setSpendableWethBalance(0n);
      setPendingWethBalance(0n);

      // Reset module-level singletons
      engineInitPromise = null;
      sdkPromise = null;

      console.log('[useAnonymousBuy] ✅ Database cleared! Please refresh the page to resync.');
      return true;
    } catch (err) {
      console.error('[useAnonymousBuy] Failed to clear database:', err);
      return false;
    }
  }, []);

  /**
   * Open Railway wallet
   */
  const openRailway = useCallback(() => {
    window.open('https://app.railway.xyz', '_blank');
  }, []);

  return {
    // State
    isLoading,
    error,
    progress,
    isConnected,
    hasWallet: !!walletClient,
    isEngineReady,
    shieldedBalance,
    railgunAddress: walletInfo?.railgunAddress,
    mnemonic: walletInfo?.mnemonic, // 12-word seed phrase (keep secret!)
    hasRailgunWallet: !!walletInfo,
    walletId: walletInfo?.walletId, // For balance queries

    // Balance from callbacks (the correct way per Railgun docs)
    spendableWethBalance, // Spendable WETH in Railgun
    pendingWethBalance,   // Pending WETH (shields waiting for POI)

    // Scan state - for tracking merkle tree sync progress
    scanProgress,
    scanPhase, // 'txid' or 'utxo'
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
    loadImportedWallet,
    clearImportedWallet,

    // Info
    shieldFeePercent: 0.25,
    unshieldFeePercent: 0.25,
  };
}

export default useAnonymousBuy;
