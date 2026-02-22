/**
 * r00t.fund Configuration
 *
 * All contract addresses and network settings in one place.
 * Update these values when deploying to mainnet.
 *
 * To update for mainnet:
 * 1. Set values in .env file, OR
 * 2. Update the fallback addresses below
 */

// Determine which network we're on
const chainId = Number(import.meta.env.VITE_CHAIN_ID) || 11155111;
const isSepoliaTestnet = chainId === 11155111;

// Network configuration - supports both Arbitrum and Sepolia
export const NETWORK = {
  chainId,
  name: isSepoliaTestnet ? 'Sepolia Testnet' : 'Arbitrum One',
  rpcUrl: import.meta.env.VITE_RPC_URL || (isSepoliaTestnet
    ? 'https://eth-sepolia.g.alchemy.com/v2/demo'
    : 'https://arbitrum-one.publicnode.com'),
  explorerUrl: isSepoliaTestnet ? 'https://sepolia.etherscan.io' : 'https://arbiscan.io',
  explorerName: isSepoliaTestnet ? 'Etherscan (Sepolia)' : 'Arbiscan',
  // Ponder indexer URL for querying trades, stats, and merkle tree data
  indexerUrl: import.meta.env.VITE_INDEXER_URL || 'https://ponder-indexer-production-50c3.up.railway.app',
  isTestnet: isSepoliaTestnet,
} as const;

// Sepolia fallback addresses (fresh deploy - 2026-02-06, configurable OI limit + liquidation fix)
const SEPOLIA_CONTRACTS = {
  zkAMM: '0xdacF977d96840748EB5624508BF98fc5E8CC84E1',
  zkAMMPair: '0xdacF977d96840748EB5624508BF98fc5E8CC84E1',
  zkAMMRouter: '0xd1b972eb47626B67Fe700ee9F3Ab4Fe76751b630',
  zkAMMAdmin: '0xA0BD95af436e8a6d6d3dd8700E2c72209C6Fb164',
  rootToken: '0x1c5452b40432060Bf196989E709d70df1cfad8d0',
  tokenPool: '0xC8301Eafed00a003751292F268f3653CdACa2467',
  lpPool: '0x6b0b337D69C3f79f7f0Aac59cc5eaf953D0F8580',
  nullifierRegistry: '0x68a422602b4833A2558fa1FA803F906CDE2d4e56',
  launchpad: '0xE11B0Cf1b8C1eD907F4eF27A5a3c83F17cBCdF7B',
  tokenFactory: '0x8A0123D9968e1863BC44327A06054F596a261482',
  poolFactory: '0xf729F57242F42ff23f3Ec55770F5B8B06aEb4b0C',
  poolRouter: '0x4b89761B1FB4532499B37aCA664A6E34aCC4F7fA',
  shortsContract: '0xE76cb3eb5253f3cFaEEab29bF44F27af9c66dF6C',
  worldIdGatekeeper: '0x512d4a66760Aba053f4162205d729c8540d00145',
} as const;

// Arbitrum mainnet fallback addresses (update when deployed)
const ARBITRUM_CONTRACTS = {
  zkAMM: '0xc7E7fD3bC101621F588a3A47cf03343BFAC05451',
  zkAMMPair: '0x...',
  zkAMMRouter: '0x...',
  zkAMMAdmin: '0x...',
  rootToken: '0x...',
  tokenPool: '0x...',
  lpPool: '0x...',
  nullifierRegistry: '0x...',
  launchpad: '0x...',
  tokenFactory: '0x...',
  poolFactory: '0x...',
  poolRouter: '0x...',
  shortsContract: '0x...',
  worldIdGatekeeper: '0x...',
} as const;

// Select the right fallback based on network
const FALLBACK = isSepoliaTestnet ? SEPOLIA_CONTRACTS : ARBITRUM_CONTRACTS;

// Contract addresses - reads from env with network-specific fallbacks
export const CONTRACTS = {
  // Core ZkAMM contracts (split architecture)
  zkAMM: import.meta.env.VITE_ZKAMM_ADDRESS || FALLBACK.zkAMM,
  zkAMMPair: import.meta.env.VITE_ZKAMM_PAIR_ADDRESS || FALLBACK.zkAMMPair,
  zkAMMRouter: import.meta.env.VITE_ZKAMM_ROUTER_ADDRESS || FALLBACK.zkAMMRouter,
  zkAMMAdmin: import.meta.env.VITE_ZKAMM_ADMIN_ADDRESS || FALLBACK.zkAMMAdmin,

  // ROOT token ERC20
  rootToken: import.meta.env.VITE_ROOT_TOKEN_ADDRESS || FALLBACK.rootToken,

  // TokenPool for merkle tree commitments
  tokenPool: import.meta.env.VITE_TOKEN_POOL_ADDRESS || FALLBACK.tokenPool,

  // LP Pool for liquidity provider commitments
  lpPool: import.meta.env.VITE_LP_POOL_ADDRESS || FALLBACK.lpPool,

  // Nullifier Registry
  nullifierRegistry: import.meta.env.VITE_NULLIFIER_REGISTRY_ADDRESS || FALLBACK.nullifierRegistry,

  // Launchpad contracts
  launchpad: import.meta.env.VITE_LAUNCHPAD_ADDRESS || FALLBACK.launchpad,
  tokenFactory: import.meta.env.VITE_TOKEN_FACTORY_ADDRESS || FALLBACK.tokenFactory,
  poolFactory: import.meta.env.VITE_POOL_FACTORY_ADDRESS || FALLBACK.poolFactory,
  poolRouter: import.meta.env.VITE_POOL_ROUTER_ADDRESS || FALLBACK.poolRouter,

  // Shorts contract for leveraged shorting
  shortsContract: import.meta.env.VITE_SHORTS_CONTRACT_ADDRESS || FALLBACK.shortsContract,

  // World ID Gatekeeper for sybil-resistant proposal creation (CRE W8)
  worldIdGatekeeper: import.meta.env.VITE_WORLD_ID_GATEKEEPER_ADDRESS || FALLBACK.worldIdGatekeeper,
} as const;

// External contract addresses (Arbitrum mainnet)
export const EXTERNAL = {
  // WETH on Arbitrum
  weth: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1',

  // Railgun proxy for shielding (Arbitrum)
  railgunProxy: '0xFA7093CDD9EE6932B4eb2c9e1cde7CE00B1FA4b9',

  // Railgun Relay Adapt for cross-contract calls
  relayAdapt: '0x0355B7B8cb128fA5692729Ab3AAa199C1753f726',
} as const;

// Token settings
export const TOKEN = {
  name: import.meta.env.VITE_TOKEN_NAME || 'r00t',
  symbol: import.meta.env.VITE_TOKEN_SYMBOL || 'ROOT',
  decimals: 18,
  totalSupply: 69_000_000,
} as const;

// Event signatures for log parsing
export const EVENTS = {
  // TokensPurchased(uint256 ethIn, uint256 tokensOut)
  // keccak256('TokensPurchased(uint256,uint256)')
  tokensPurchased: '0x2a03ce910939b5a6fe6bfa3c4099f7af3dedb45b7078e6e7173c2216032ac054',

  // TokensSold(uint256 tokensIn, uint256 ethOut)
  // keccak256('TokensSold(uint256,uint256)')
  tokensSold: '0x9745885914207e14787933537f5e0fc3685e9b3a89eeeecbc1d10207baa4c790',

  // NewCommitment(uint256 indexed commitment, uint256 indexed leafIndex, bytes encryptedNote)
  newCommitment: '0xe5b9fcee308349a880a3033e7bf8f0d7192658e7dbdaf7481ecc63f3d7addf03',
} as const;

// Helper functions
export function getExplorerTxUrl(txHash: string): string {
  return `${NETWORK.explorerUrl}/tx/${txHash}`;
}

export function getExplorerAddressUrl(address: string): string {
  return `${NETWORK.explorerUrl}/address/${address}`;
}

export function isContractDeployed(address: string): boolean {
  return address !== '0x...' && address.length === 42;
}

// Re-export chain for use in viem/wagmi writeContract calls
// This avoids hardcoding arbitrum everywhere
import { arbitrum, sepolia } from 'wagmi/chains';
export const CHAIN = NETWORK.chainId === 11155111 ? sepolia : arbitrum;
