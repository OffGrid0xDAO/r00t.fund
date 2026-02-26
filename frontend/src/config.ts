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

// Network: hardcoded to Tenderly VNet for now. Change when deploying to mainnet.
const chainId = 73571;
const isSepoliaTestnet = false;
const isTenderlyVNet = true;

export const NETWORK = {
  chainId,
  name: 'Tenderly VNet',
  rpcUrl: 'https://virtual.sepolia.eu.rpc.tenderly.co/39fe020c-836e-4173-8786-5e726d0b3ba1',
  explorerUrl: '',
  explorerName: 'Tenderly Explorer',
  indexerUrl: '',
  isTestnet: true,
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
  // CRE Workflow Contracts
  serraEstrela: '0x...',
  confidentialFundingVault: '0x...',
  regenProofOfReserve: '0x...',
  aiAgentOrchestrator: '0x...',
  regenPredictionMarket: '0x...',
  protocolHealthMonitor: '0x...',
  policyEngine: '0x...',
  compliantPrivateVault: '0x...',
} as const;

// Tenderly VNet fallback addresses (CRE contracts deployed here)
const TENDERLY_CONTRACTS = {
  zkAMM: '0xE9D2De4bfEadC1923B90B09C3c8b197Ae5eE979d',
  zkAMMPair: '0xE9D2De4bfEadC1923B90B09C3c8b197Ae5eE979d',
  zkAMMRouter: '0x79D52AB5EdaCFdC868c53DF8dd685f309cA20884',
  zkAMMAdmin: '0xe99aD5A43ed5Fa986d396b18deE1ceFb48630A79',
  rootToken: '0x89eb61a19B55257a91B3a5FCE7e36fC1668A1C29',
  tokenPool: '0x5B1abBF8A76dF814B04E35C0BE4c5baB25bf6b07',
  lpPool: '0xc4FA24F7411e32087B0D913bA213C3810d4923E1',
  nullifierRegistry: '0x05553e6cf1a44b23c18d9707e8a7affbc2ba35de',
  launchpad: '0x7f2f22329D8Cc84837D541DE7fCf7EB8f853649B',
  tokenFactory: '0xBaEe818E3559b6F528f1C43266c9D400A0456078',
  poolFactory: '0x0A413597731b4627412530847f281Fc93F4c557c',
  poolRouter: '0x97300a37b7a5f550fb9975655d355174e57fa416',
  shortsContract: '0xCc67e5664a4996C13ab8499E9ABD4c57B11b0107',
  worldIdGatekeeper: '0x512d4a66760Aba053f4162205d729c8540d00145',
  // CRE Workflow Contracts
  serraEstrela: '0xc7bC4a72883ECE729247104A87cAbD3C2Bd3112B',
  confidentialFundingVault: '0x6840B8F438610217265fEBF084E578537c9AA361',
  regenProofOfReserve: '0x47Cbc90f86992004c57BCC25D8c25012cFcc8E21',
  aiAgentOrchestrator: '0xE9D7284DDBF635B35e0C3bCB9d9d0F607D08F824',
  regenPredictionMarket: '0xC8BeE963FB020F41AAf26d79c1BB043C291865e1',
  protocolHealthMonitor: '0x50F8beE2E560F2335B268d0b6dC64F7153cC852d',
  policyEngine: '0x89b493be4262D6786Be6D1b595BD5E829CFd152e',
  compliantPrivateVault: '0x7767DBB69837386202b3cB5204AEE7Ed9bb58f49',
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
  // CRE Workflow Contracts
  serraEstrela: '0x...',
  confidentialFundingVault: '0x...',
  regenProofOfReserve: '0x...',
  aiAgentOrchestrator: '0x...',
  regenPredictionMarket: '0x...',
  protocolHealthMonitor: '0x...',
  policyEngine: '0x...',
  compliantPrivateVault: '0x...',
} as const;

// Select the right fallback based on network
const FALLBACK = isTenderlyVNet ? TENDERLY_CONTRACTS : isSepoliaTestnet ? SEPOLIA_CONTRACTS : ARBITRUM_CONTRACTS;

// Contract addresses — use hardcoded network-specific addresses directly.
// Env var overrides removed to prevent stale/wrong addresses in CI/Vercel.
export const CONTRACTS = {
  zkAMM: FALLBACK.zkAMM,
  zkAMMPair: FALLBACK.zkAMMPair,
  zkAMMRouter: FALLBACK.zkAMMRouter,
  zkAMMAdmin: FALLBACK.zkAMMAdmin,
  rootToken: FALLBACK.rootToken,
  tokenPool: FALLBACK.tokenPool,
  lpPool: FALLBACK.lpPool,
  nullifierRegistry: FALLBACK.nullifierRegistry,
  launchpad: FALLBACK.launchpad,
  tokenFactory: FALLBACK.tokenFactory,
  poolFactory: FALLBACK.poolFactory,
  poolRouter: FALLBACK.poolRouter,
  shortsContract: FALLBACK.shortsContract,
  worldIdGatekeeper: FALLBACK.worldIdGatekeeper,
  serraEstrela: FALLBACK.serraEstrela,
  confidentialFundingVault: FALLBACK.confidentialFundingVault,
  regenProofOfReserve: FALLBACK.regenProofOfReserve,
  aiAgentOrchestrator: FALLBACK.aiAgentOrchestrator,
  regenPredictionMarket: FALLBACK.regenPredictionMarket,
  protocolHealthMonitor: FALLBACK.protocolHealthMonitor,
  policyEngine: FALLBACK.policyEngine,
  compliantPrivateVault: FALLBACK.compliantPrivateVault,
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
  if (!NETWORK.explorerUrl) return '';
  return `${NETWORK.explorerUrl}/tx/${txHash}`;
}

export function getExplorerAddressUrl(address: string): string {
  if (!NETWORK.explorerUrl) return '';
  return `${NETWORK.explorerUrl}/address/${address}`;
}

export function hasExplorer(): boolean {
  return !!NETWORK.explorerUrl;
}

export function isContractDeployed(address: string): boolean {
  return address !== '0x...' && address.length === 42;
}

// Re-export chain for use in viem/wagmi writeContract calls
import { defineChain } from 'viem';

export const CHAIN = defineChain({
  id: 73571,
  name: 'Tenderly VNet',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: {
    default: {
      http: [NETWORK.rpcUrl],
    },
  },
  testnet: true,
});
