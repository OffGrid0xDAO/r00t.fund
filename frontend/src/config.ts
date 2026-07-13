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

// Network: Robinhood Chain (Arbitrum Orbit L2, chainId 4663). Mainnet target for r00t.
// Contracts are not yet deployed here — FALLBACK resolves to placeholder addresses
// until a fresh (non-leaked) deployer broadcasts and the addresses are pasted in.
const chainId = Number(import.meta.env.VITE_CHAIN_ID) || 4663;
const isSepoliaTestnet = false;
const isTenderlyVNet = false;

export const NETWORK = {
  chainId,
  name: 'Robinhood Chain',
  // Prefer a provider endpoint from env (VITE_RPC_URL, e.g. Alchemy); fall back
  // to the public RH RPC. Note: VITE_ vars ship in the browser bundle — use an
  // Alchemy key with a domain allowlist for production.
  rpcUrl: (import.meta.env.VITE_RPC_URL as string) || 'https://rpc.mainnet.chain.robinhood.com',
  explorerUrl: 'https://robinhoodchain.blockscout.com',
  explorerName: 'Blockscout',
  // Ponder indexer (finds commitments + builds merkle proofs). Run `PONDER_NETWORK=robinhood`.
  indexerUrl: (import.meta.env.VITE_INDEXER_URL as string) || 'http://localhost:42069',
  isTestnet: false,
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
  pilotSite: '0x...',
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
  pilotSite: '0xc7bC4a72883ECE729247104A87cAbD3C2Bd3112B',
  confidentialFundingVault: '0x6840B8F438610217265fEBF084E578537c9AA361',
  regenProofOfReserve: '0x47Cbc90f86992004c57BCC25D8c25012cFcc8E21',
  aiAgentOrchestrator: '0xE9D7284DDBF635B35e0C3bCB9d9d0F607D08F824',
  regenPredictionMarket: '0xC8BeE963FB020F41AAf26d79c1BB043C291865e1',
  protocolHealthMonitor: '0x50F8beE2E560F2335B268d0b6dC64F7153cC852d',
  policyEngine: '0x89b493be4262D6786Be6D1b595BD5E829CFd152e',
  compliantPrivateVault: '0x7767DBB69837386202b3cB5204AEE7Ed9bb58f49',
} as const;

// Robinhood Chain (4663) mainnet addresses — DEX stack v2 (redeployed 2026-07-12)
// Fresh Pair+Router+Admin+Registry+Shorts: shorts now owner-tunable (5-min TWAP, 0.001 ETH
// min). Old v1 stack retired (liquidity swept back). New commitment trees start empty.
const ARBITRUM_CONTRACTS = {
  zkAMM: '0xCf31Fc47be6D6fed5300a636d086E7FeAb21717e',       // ZkAMMPair (private DEX)
  zkAMMPair: '0xCf31Fc47be6D6fed5300a636d086E7FeAb21717e',
  zkAMMRouter: '0xED85FDe30469d95473eA423eff991C748039CBbA',
  zkAMMAdmin: '0x94f398a6f44E93A321000393376E245c5bd0C5e8',
  rootToken: '0x7d0bfc2145327CF98f882De2CB71f8F1D7b8f022',   // $R00T (unchanged)
  tokenPool: '0x33a8bA8B91b23Ba5629d0731A36446eE3C958413',   // Pair.tokenPool() — commitment tree
  lpPool: '0x2Ce35681570b8100529da1518507c090D0A3fF6e',       // Pair.lpPool() — LP commitment tree
  nullifierRegistry: '0x6Ae7adf4Cba5eEAc58a70832998bdb18C6588D4A',
  launchpad: '0x...',
  tokenFactory: '0x...',
  poolFactory: '0x...',
  poolRouter: '0x...',
  shortsContract: '0xfD0C2f3EA2f001590Dfc96F2683A7b9c4e04A6cf', // R00TShorts v2 (tunable: 5-min TWAP, 0.001 min)
  worldIdGatekeeper: '0x...',
  // CRE Workflow Contracts
  pilotSite: '0x...',
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
  // Phase-1 parcel funding rail (ParcelLaunchpad) — set after deploy.
  parcelLaunchpad: (import.meta.env.VITE_PARCEL_LAUNCHPAD as string) || '0x...',
  // Multi-tenant land rail (LandFactory) — stewards spin up their own Land.
  // Robinhood Chain (4663) LandVault+ZkParcelPool chain deploy 2026-07-12.
  landFactory: (import.meta.env.VITE_LAND_FACTORY as string) || '0x5663b0F215ccdA109c038D60b37B078393A35911',
  // Deployed swap/deposit/withdraw verifiers (reused by ZkParcelPool). RH v2.
  swapVerifier: (import.meta.env.VITE_SWAP_VERIFIER as string) || '0x63B376A158BCaC3e2b5349297E7D3bdbA357A3b6',
  // Demo parcel (parcelId=1, $OAK) private AMM — trade $OAK↔R00T shielded like R00T.
  // v3 (2026-07-13): anti-arb vesting on R00T claim (90% instant, 10% vests 7d).
  parcelToken: (import.meta.env.VITE_PARCEL_TOKEN as string) || '0xEd2d21a25Ac94C8eCdC9d7326A9ED6d7DFE3f4fB',
  zkParcelPool: (import.meta.env.VITE_ZK_PARCEL_POOL as string) || '0x443740f65780014843dDfe35eb722547A1409fbE',
  // deposit verifier (reused by the pool for shield + output-pin) + withdraw verifier.
  depositVerifier: (import.meta.env.VITE_DEPOSIT_VERIFIER as string) || '0x3B80AABD8c8d52b272Ce836737396186Dc87105c',
  // Uniswap v4 PoolManager — parcel/$R00T pools. Default: Robinhood Chain (4663).
  poolManager: (import.meta.env.VITE_POOL_MANAGER as string) || '0x8366a39CC670B4001A1121B8F6A443A643e40951',
  // Uniswap v4 StateView — live pool-price reads. Default: Robinhood Chain (4663).
  stateView: (import.meta.env.VITE_STATE_VIEW as string) || '0xf3334192D15450cDD385C8B70e03f9A6bD9E673b',
  // The deployed pilot Land (steward: r00t, parcelId=1 "Oak Terrace"/$OAK). LandVault v2 (RH 2026-07-12).
  pilotLand: (import.meta.env.VITE_PILOT_LAND as string) || '0xDd6a4A2014533770991cFBFA9765D13118DBd2c6',
  // LandVault — private plot funding LIVE on RH, now with the ZkParcelPool auto-seed hook.
  // Pay ETH (100% to land treasury) → shielded commitment claimable as R00T (OTC floor,
  // once fully funded) OR the parcel token. Uses the SHARED v2 nullifier registry (no
  // cross-rail double-spend). On full-funding the steward seeds a private parcel↔R00T AMM.
  landVault: (import.meta.env.VITE_LAND_VAULT as string) || '0xD9D0D2E070502c1107c7f82744881564E035BB95',
  // Back-compat alias for Phase-D panels that referenced pledgeVault.
  pledgeVault: (import.meta.env.VITE_LAND_VAULT as string) || '0xD9D0D2E070502c1107c7f82744881564E035BB95',
  // USDC/USDG used for pledges (the LandVault's stablecoin). RH demo = mock USDC minted with the vault.
  usdc: (import.meta.env.VITE_USDC as string) || '0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168',
  // The demo parcel id + OTC pricing. rootPrice is the steward anchor; ethPrice is read LIVE
  // from Chainlink on-chain (these are first-paint fallbacks only).
  pilotParcelId: (import.meta.env.VITE_PILOT_PARCEL_ID as string) || '0x0000000000000000000000000000000000000000000000000000000000000001',
  rootPriceE6: 100000n,   // $0.10 per R00T-equiv (E6) — steward anchor
  ethPriceE6: 1800000000n, // ~$1800 per ETH (E6) — first paint only; Land.ethPriceE6() reads Chainlink live
  // Every map plot is a REAL on-chain parcel (createParcel'd on the Land). Ticker → parcelId
  // so the plot modal funds the right parcel via the LandVault anon-commit flow.
  parcelIdByTicker: {
    OAK: 1, NUT: 2, CARROT: 3, TURNIP: 4, SPUD: 5, BERRY: 6, CACTUS: 7, ROCK: 8, HAY: 9, DRIP: 10,
  } as Record<string, number>,
  tokenPool: FALLBACK.tokenPool,
  lpPool: FALLBACK.lpPool,
  nullifierRegistry: FALLBACK.nullifierRegistry,
  launchpad: FALLBACK.launchpad,
  tokenFactory: FALLBACK.tokenFactory,
  poolFactory: FALLBACK.poolFactory,
  poolRouter: FALLBACK.poolRouter,
  shortsContract: FALLBACK.shortsContract,
  worldIdGatekeeper: FALLBACK.worldIdGatekeeper,
  pilotSite: FALLBACK.pilotSite,
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

  // PledgeCommitment(uint256 indexed commitment, uint256 indexed leafIndex, bytes32 parcelId, bytes note)
  // keccak256('PledgeCommitment(uint256,uint256,bytes32,bytes)')
  pledgeCommitment: '0x73154c9e0472b2b606af43e4badf42bab6a2552312d42059470f2826d79a1758',

  // PledgeClaimed(uint256 indexed nullifierHash, address indexed recipient, bytes32 parcelId, uint256 amount)
  // keccak256('PledgeClaimed(uint256,address,bytes32,uint256)')
  pledgeClaimed: '0xe9dea2c523da175940ce3f05ffd847b0b4b06cf2a12f488f5847e53600b412d0',
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
  id: 4663,
  name: 'Robinhood Chain',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: {
    default: {
      http: [NETWORK.rpcUrl],
    },
  },
  blockExplorers: {
    default: { name: 'Blockscout', url: 'https://robinhoodchain.blockscout.com' },
  },
  testnet: false,
});
