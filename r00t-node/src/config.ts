import { z } from 'zod';

// Environment configuration schema
const ConfigSchema = z.object({
  // Node identity
  nodeIndex: z.number().int().min(0).max(2),
  nodePrivateKey: z.string().regex(/^0x[a-fA-F0-9]{64}$/, 'Invalid private key format'),

  // Ethereum configuration
  ethereum: z.object({
    rpcUrl: z.string().url(),
    chainId: z.number().int().positive(),
    xmrBridgeAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
    nodeRegistryAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
    reserveTrackerAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  }),

  // Monero configuration
  monero: z.object({
    walletRpcUrl: z.string().url(),
    walletRpcUser: z.string().optional(),
    walletRpcPassword: z.string().optional(),
    networkType: z.enum(['mainnet', 'stagenet', 'testnet']),
    requiredConfirmations: z.number().int().min(1).default(10),
  }),

  // FROST configuration
  frost: z.object({
    threshold: z.number().int().min(2).default(2),
    totalNodes: z.number().int().min(3).default(3),
    signingTimeout: z.number().int().positive().default(30000), // ms
  }),

  // P2P configuration
  p2p: z.object({
    listenPort: z.number().int().min(1024).max(65535).default(9000),
    bootstrapPeers: z.array(z.string()).default([]),
    maxPeers: z.number().int().positive().default(10),
  }),

  // API configuration
  api: z.object({
    port: z.number().int().min(1024).max(65535).default(3000),
    host: z.string().default('0.0.0.0'),
    corsOrigins: z.array(z.string()).default(['*']),
    rateLimit: z.object({
      windowMs: z.number().int().positive().default(60000),
      maxRequests: z.number().int().positive().default(100),
    }),
  }),

  // Database configuration
  database: z.object({
    url: z.string(),
    maxConnections: z.number().int().positive().default(10),
  }),

  // Operational parameters
  operations: z.object({
    depositScanInterval: z.number().int().positive().default(10000), // ms
    withdrawalProcessInterval: z.number().int().positive().default(5000), // ms
    maxPendingDeposits: z.number().int().positive().default(1000),
    maxPendingWithdrawals: z.number().int().positive().default(100),
  }),

  // Logging
  logging: z.object({
    level: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
    format: z.enum(['json', 'pretty']).default('json'),
  }),
});

export type Config = z.infer<typeof ConfigSchema>;

// Load configuration from environment
export function loadConfig(): Config {
  const config: Config = {
    nodeIndex: parseInt(process.env['NODE_INDEX'] ?? '0', 10),
    nodePrivateKey: process.env['NODE_PRIVATE_KEY'] ?? '',

    ethereum: {
      rpcUrl: process.env['ETHEREUM_RPC_URL'] ?? 'http://localhost:8545',
      chainId: parseInt(process.env['ETHEREUM_CHAIN_ID'] ?? '11155111', 10), // Sepolia
      xmrBridgeAddress: process.env['XMR_BRIDGE_ADDRESS'] ?? '',
      nodeRegistryAddress: process.env['NODE_REGISTRY_ADDRESS'] ?? '',
      reserveTrackerAddress: process.env['RESERVE_TRACKER_ADDRESS'] ?? '',
    },

    monero: {
      walletRpcUrl: process.env['MONERO_WALLET_RPC_URL'] ?? 'http://localhost:18082',
      walletRpcUser: process.env['MONERO_WALLET_RPC_USER'],
      walletRpcPassword: process.env['MONERO_WALLET_RPC_PASSWORD'],
      networkType: (process.env['MONERO_NETWORK_TYPE'] as 'mainnet' | 'stagenet' | 'testnet') ?? 'stagenet',
      requiredConfirmations: parseInt(process.env['MONERO_REQUIRED_CONFIRMATIONS'] ?? '10', 10),
    },

    frost: {
      threshold: parseInt(process.env['FROST_THRESHOLD'] ?? '2', 10),
      totalNodes: parseInt(process.env['FROST_TOTAL_NODES'] ?? '3', 10),
      signingTimeout: parseInt(process.env['FROST_SIGNING_TIMEOUT'] ?? '30000', 10),
    },

    p2p: {
      listenPort: parseInt(process.env['P2P_LISTEN_PORT'] ?? '9000', 10),
      bootstrapPeers: process.env['P2P_BOOTSTRAP_PEERS']?.split(',').filter(Boolean) ?? [],
      maxPeers: parseInt(process.env['P2P_MAX_PEERS'] ?? '10', 10),
    },

    api: {
      port: parseInt(process.env['API_PORT'] ?? '3000', 10),
      host: process.env['API_HOST'] ?? '0.0.0.0',
      corsOrigins: process.env['API_CORS_ORIGINS']?.split(',').filter(Boolean) ?? ['*'],
      rateLimit: {
        windowMs: parseInt(process.env['API_RATE_LIMIT_WINDOW'] ?? '60000', 10),
        maxRequests: parseInt(process.env['API_RATE_LIMIT_MAX'] ?? '100', 10),
      },
    },

    database: {
      url: process.env['DATABASE_URL'] ?? 'postgres://localhost:5432/r00t_node',
      maxConnections: parseInt(process.env['DATABASE_MAX_CONNECTIONS'] ?? '10', 10),
    },

    operations: {
      depositScanInterval: parseInt(process.env['DEPOSIT_SCAN_INTERVAL'] ?? '10000', 10),
      withdrawalProcessInterval: parseInt(process.env['WITHDRAWAL_PROCESS_INTERVAL'] ?? '5000', 10),
      maxPendingDeposits: parseInt(process.env['MAX_PENDING_DEPOSITS'] ?? '1000', 10),
      maxPendingWithdrawals: parseInt(process.env['MAX_PENDING_WITHDRAWALS'] ?? '100', 10),
    },

    logging: {
      level: (process.env['LOG_LEVEL'] as Config['logging']['level']) ?? 'info',
      format: (process.env['LOG_FORMAT'] as Config['logging']['format']) ?? 'json',
    },
  };

  // Validate configuration
  const result = ConfigSchema.safeParse(config);
  if (!result.success) {
    console.error('Invalid configuration:', result.error.format());
    throw new Error('Invalid configuration');
  }

  return result.data;
}

// Singleton config instance
let configInstance: Config | null = null;

export function getConfig(): Config {
  if (!configInstance) {
    configInstance = loadConfig();
  }
  return configInstance;
}
