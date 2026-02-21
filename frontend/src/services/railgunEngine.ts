/**
 * Railgun Engine Service
 *
 * Full Railgun SDK integration for anonymous transactions.
 * This service handles:
 * - Engine initialization (once per session)
 * - Wallet creation/loading
 * - Cross-contract call proof generation
 * - Transaction submission via broadcasters
 *
 * The engine uses ~50MB of WASM artifacts for ZK proofs.
 * First load will download these, subsequent loads are cached.
 *
 * Updated for @railgun-community/wallet v10 and shared-models v8
 */

import localforage from 'localforage';
import type { Address } from 'viem';
import type { TXIDVersion, NetworkName, EVMGasType } from '@railgun-community/shared-models';

// Service state
let isEngineStarted = false;
let isProviderLoaded = false;
let currentWalletId: string | null = null;
let initializationPromise: Promise<void> | null = null;

// Lazy-loaded SDK modules
interface SDKModules {
  // Shared models
  NetworkName: typeof NetworkName;
  TXIDVersion: typeof TXIDVersion;
  EVMGasType: typeof EVMGasType;
  // Wallet functions
  startRailgunEngine: (
    walletSource: string,
    db: unknown,
    shouldDebug: boolean,
    artifactStore: unknown,
    useNativeArtifacts: boolean,
    skipMerkletreeScans: boolean,
    poiNodeURLs?: string[],
    customPOILists?: unknown[],
    verboseScanLogging?: boolean
  ) => Promise<void>;
  loadProvider: (
    fallbackProviderJsonConfig: unknown,
    networkName: NetworkName,
    pollingInterval?: number
  ) => Promise<unknown>;
  createRailgunWallet: (
    encryptionKey: string,
    mnemonic: string,
    opts: object
  ) => Promise<{ id: string; railgunAddress: string }>;
  setLoggers: (log: (msg: string) => void, err: (err: unknown) => void) => void;
  setOnUTXOMerkletreeScanCallback: (cb: (data: { progress: number }) => void) => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ArtifactStore: any;
  // Proof generation
  gasEstimateForUnprovenCrossContractCalls: (
    txidVersion: TXIDVersion,
    networkName: NetworkName,
    ...args: unknown[]
  ) => Promise<{ gasEstimate: bigint }>;
  generateCrossContractCallsProof: (
    txidVersion: TXIDVersion,
    networkName: NetworkName,
    ...args: unknown[]
  ) => Promise<void>;
  populateProvedCrossContractCalls: (
    txidVersion: TXIDVersion,
    networkName: NetworkName,
    ...args: unknown[]
  ) => Promise<{ transaction: { to?: string; data?: string; value?: bigint } }>;
}

let sdk: SDKModules | null = null;

/**
 * Load SDK modules dynamically to avoid crypto issues at startup
 */
async function loadSDK(): Promise<SDKModules> {
  if (sdk) return sdk;

  console.log('[RailgunEngine] Loading SDK modules...');

  const [sharedModels, wallet] = await Promise.all([
    import('@railgun-community/shared-models'),
    import('@railgun-community/wallet'),
  ]);

  sdk = {
    NetworkName: sharedModels.NetworkName,
    TXIDVersion: sharedModels.TXIDVersion,
    EVMGasType: sharedModels.EVMGasType,
    startRailgunEngine: wallet.startRailgunEngine as SDKModules['startRailgunEngine'],
    loadProvider: wallet.loadProvider as SDKModules['loadProvider'],
    createRailgunWallet: wallet.createRailgunWallet as SDKModules['createRailgunWallet'],
    setLoggers: wallet.setLoggers,
    setOnUTXOMerkletreeScanCallback: wallet.setOnUTXOMerkletreeScanCallback,
    ArtifactStore: wallet.ArtifactStore,
    gasEstimateForUnprovenCrossContractCalls: wallet.gasEstimateForUnprovenCrossContractCalls as SDKModules['gasEstimateForUnprovenCrossContractCalls'],
    generateCrossContractCallsProof: wallet.generateCrossContractCallsProof as SDKModules['generateCrossContractCallsProof'],
    populateProvedCrossContractCalls: wallet.populateProvedCrossContractCalls as SDKModules['populateProvedCrossContractCalls'],
  };

  console.log('[RailgunEngine] SDK modules loaded');
  return sdk;
}

/**
 * Create browser artifact store using localforage
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function createArtifactStore(ArtifactStoreClass: any) {
  const store = localforage.createInstance({
    name: 'railgun-artifacts',
    storeName: 'artifacts',
  });

  return new ArtifactStoreClass(
    async (path: string) => {
      const data = await store.getItem<string | ArrayBuffer>(path);
      if (!data) return null;
      return typeof data === 'string' ? data : Buffer.from(data);
    },
    async (dir: string, path: string, item: string | Uint8Array) => {
      const fullPath = dir ? `${dir}/${path}` : path;
      await store.setItem(fullPath, item);
    },
    async (path: string) => {
      return (await store.getItem(path)) !== null;
    }
  );
}

/**
 * Initialize the Railgun engine
 * Must be called before any other operations
 */
export async function initializeEngine(
  onProgress?: (message: string, percent: number) => void
): Promise<void> {
  if (isEngineStarted) return;
  if (initializationPromise) return initializationPromise;

  initializationPromise = (async () => {
    try {
      onProgress?.('Loading Railgun SDK...', 10);
      const modules = await loadSDK();

      // Set up logging
      modules.setLoggers(
        (msg: string) => console.log('[Railgun]', msg),
        (err: unknown) => console.error('[Railgun Error]', err)
      );

      // Set up merkle tree scan callback
      modules.setOnUTXOMerkletreeScanCallback((data) => {
        if (data.progress > 0) {
          onProgress?.(`Scanning merkle tree: ${data.progress}%`, 30 + data.progress * 0.3);
        }
      });

      onProgress?.('Creating artifact store...', 20);
      const artifactStore = createArtifactStore(modules.ArtifactStore);

      onProgress?.('Creating database...', 25);
      // @ts-expect-error level-js doesn't have types
      const LevelDB = (await import('level-js')).default;
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call
      const db = new LevelDB('railgun-engine-db');

      onProgress?.('Starting engine...', 30);

      // POI (Proof of Innocence) node URLs - required for networks like Arbitrum
      const poiNodeURLs = [
        'https://poi-node.railgun.org',
      ];

      await modules.startRailgunEngine(
        'r00t.fund',     // walletSource
        db,              // database
        true,            // shouldDebug
        artifactStore,   // artifactStore
        false,           // useNativeArtifacts (false = WASM)
        false,           // skipMerkletreeScans (false = enable scans for wallet balances)
        poiNodeURLs,     // poiNodeURLs - required for POI networks
        [],              // customPOILists
        true             // verboseScanLogging
      );

      isEngineStarted = true;
      onProgress?.('Engine started!', 60);
      console.log('[RailgunEngine] Engine initialized');

    } catch (err) {
      console.error('[RailgunEngine] Init error:', err);
      throw err;
    }
  })();

  try {
    await initializationPromise;
  } finally {
    initializationPromise = null;
  }
}

/**
 * Load the Arbitrum network provider
 */
export async function loadArbitrumProvider(
  rpcUrl: string = import.meta.env.VITE_RPC_URL || 'https://arb1.arbitrum.io/rpc',
  onProgress?: (message: string, percent: number) => void
): Promise<void> {
  if (!isEngineStarted) {
    throw new Error('Engine not started. Call initializeEngine() first.');
  }
  if (isProviderLoaded) return;

  onProgress?.('Loading Arbitrum provider...', 65);
  const modules = await loadSDK();

  // SDK v10 uses FallbackProviderJsonConfig format
  // FallbackProvider requires total weight >= 2 for quorum
  const fallbackProviders = {
    chainId: 42161,
    providers: [
      {
        provider: rpcUrl,
        priority: 1,
        weight: 2,
        stallTimeout: 2500,
      },
    ],
  };

  console.log('[RailgunEngine] Loading provider with config:', JSON.stringify(fallbackProviders, null, 2));

  try {
    const fees = await modules.loadProvider(
      fallbackProviders,
      modules.NetworkName.Arbitrum,
      60000 // pollingInterval - increased to 60s to reduce RPC load
    );

    isProviderLoaded = true;
    onProgress?.('Provider loaded!', 75);
    console.log('[RailgunEngine] Provider loaded, fees:', fees);
  } catch (err) {
    console.error('[RailgunEngine] Failed to load provider:', err);
    // Log full error object for debugging
    console.error('[RailgunEngine] Full error:', JSON.stringify(err, Object.getOwnPropertyNames(err as object)));
    throw err;
  }
}

/**
 * Create a Railgun wallet from mnemonic
 */
export async function createWallet(
  encryptionKey: string,
  mnemonic: string,
  onProgress?: (message: string, percent: number) => void
): Promise<{ walletId: string; railgunAddress: string }> {
  if (!isEngineStarted) {
    throw new Error('Engine not started. Call initializeEngine() first.');
  }

  if (!encryptionKey || typeof encryptionKey !== 'string') {
    throw new Error('Invalid encryption key provided');
  }

  if (!mnemonic || typeof mnemonic !== 'string') {
    throw new Error('Invalid mnemonic provided');
  }

  onProgress?.('Creating wallet...', 80);
  const modules = await loadSDK();

  // Ensure encryptionKey is properly formatted (no 0x prefix, exactly 64 hex chars)
  let formattedKey = encryptionKey;
  if (formattedKey.startsWith('0x')) {
    formattedKey = formattedKey.slice(2);
  }
  // Ensure it's 64 characters (32 bytes)
  if (formattedKey.length < 64) {
    formattedKey = formattedKey.padStart(64, '0');
  } else if (formattedKey.length > 64) {
    formattedKey = formattedKey.slice(0, 64);
  }

  console.log('[RailgunEngine] Creating wallet with encryptionKey length:', formattedKey.length);
  console.log('[RailgunEngine] Mnemonic word count:', mnemonic.split(' ').length);

  try {
    const result = await modules.createRailgunWallet(formattedKey, mnemonic, {});

    if (!result || !result.id || !result.railgunAddress) {
      console.error('[RailgunEngine] Invalid wallet result:', result);
      throw new Error('Wallet creation returned invalid result');
    }

    currentWalletId = result.id;
    onProgress?.('Wallet created!', 90);
    console.log('[RailgunEngine] Wallet created:', result.railgunAddress);

    return {
      walletId: result.id,
      railgunAddress: result.railgunAddress,
    };
  } catch (err) {
    console.error('[RailgunEngine] createRailgunWallet error:', err);
    console.error('[RailgunEngine] Error stack:', (err as Error).stack);
    throw new Error(`Failed to create Railgun wallet: ${(err as Error).message}`);
  }
}

/**
 * Generate and execute an anonymous cross-contract call
 */
export async function executeAnonymousCrossContractCall(params: {
  walletId: string;
  encryptionKey: string;
  unshieldTokenAddress: Address;
  unshieldAmount: bigint;
  crossContractCalls: Array<{
    to: string;
    data: string;
    value: bigint;
  }>;
  onProgress?: (message: string, percent: number) => void;
}): Promise<{ transaction: { to: string; data: string; value?: string } }> {
  const { walletId, encryptionKey, unshieldTokenAddress, unshieldAmount, crossContractCalls, onProgress } = params;

  if (!isEngineStarted || !isProviderLoaded) {
    throw new Error('Engine or provider not ready');
  }

  const modules = await loadSDK();

  // Unshield amounts (SDK v8+ uses bigint for amount)
  const unshieldERC20Amounts = [{
    tokenAddress: unshieldTokenAddress,
    amount: unshieldAmount,
  }];

  // Gas details - use Type2 (EIP-1559) for Arbitrum
  const gasDetails = {
    evmGasType: modules.EVMGasType.Type2 as typeof modules.EVMGasType.Type2,
    gasEstimate: 1000000n,
    maxFeePerGas: 100000000n,
    maxPriorityFeePerGas: 100000000n,
  };

  onProgress?.('Estimating gas...', 20);
  const gasResponse = await modules.gasEstimateForUnprovenCrossContractCalls(
    modules.TXIDVersion.V2_PoseidonMerkle,
    modules.NetworkName.Arbitrum,
    walletId,
    encryptionKey,
    unshieldERC20Amounts,
    [], // unshieldNFTAmounts
    [], // shieldERC20Recipients
    [], // shieldNFTRecipients
    crossContractCalls,
    gasDetails,
    undefined,
    false,
    500000n
  );

  onProgress?.('Generating ZK proof...', 30);
  await modules.generateCrossContractCallsProof(
    modules.TXIDVersion.V2_PoseidonMerkle,
    modules.NetworkName.Arbitrum,
    walletId,
    encryptionKey,
    unshieldERC20Amounts,
    [],
    [],
    [],
    crossContractCalls,
    undefined,
    false,
    undefined,
    500000n,
    (progress: number) => {
      onProgress?.(`Generating proof: ${Math.round(progress * 100)}%`, 30 + progress * 50);
    }
  );

  onProgress?.('Populating transaction...', 85);
  const { transaction } = await modules.populateProvedCrossContractCalls(
    modules.TXIDVersion.V2_PoseidonMerkle,
    modules.NetworkName.Arbitrum,
    walletId,
    unshieldERC20Amounts,
    [],
    [],
    [],
    crossContractCalls,
    undefined,
    false,
    undefined,
    {
      ...gasDetails,
      gasEstimate: gasResponse.gasEstimate,
    }
  );

  onProgress?.('Transaction ready!', 100);

  return {
    transaction: {
      to: transaction.to!,
      data: transaction.data!,
      value: transaction.value?.toString(),
    },
  };
}

/**
 * Check if engine is ready
 */
export function isEngineReady(): boolean {
  return isEngineStarted && isProviderLoaded;
}

/**
 * Get current wallet ID
 */
export function getCurrentWalletId(): string | null {
  return currentWalletId;
}
