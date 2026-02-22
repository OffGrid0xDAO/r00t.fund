// Constants for the Projects panel — ABIs, enums, World ID config

export const ProposalStatus = {
  Active: 0,
  Approved: 1,
  Rejected: 2,
  Cancelled: 3,
  Executed: 4,
} as const;

export const LAUNCHPAD_ABI = [
  {
    name: 'createProposal',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      {
        name: 'params',
        type: 'tuple',
        components: [
          { name: 'name', type: 'string' },
          { name: 'symbol', type: 'string' },
          { name: 'metadataHash', type: 'bytes32' },
          { name: 'totalSupply', type: 'uint256' },
          { name: 'feeBps', type: 'uint256' },
          { name: 'deployerBps', type: 'uint256' },
        ],
      },
      { name: 'proof', type: 'uint256[8]' },
      { name: 'merkleRoot', type: 'uint256' },
      { name: 'nullifierHash', type: 'uint256' },
      { name: 'pledgeAmount', type: 'uint256' },
      { name: 'publicInputsBinding', type: 'uint256' },
    ],
    outputs: [{ type: 'uint256' }],
  },
  {
    name: 'votePrivate',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'proposalId', type: 'uint256' },
      { name: 'proof', type: 'uint256[8]' },
      { name: 'merkleRoot', type: 'uint256' },
      { name: 'nullifierHash', type: 'uint256' },
      { name: 'voteWeight', type: 'uint256' },
      { name: 'support', type: 'bool' },
    ],
    outputs: [],
  },
  {
    name: 'executeProposal',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'proposalId', type: 'uint256' }],
    outputs: [],
  },
  {
    name: 'cancelProposal',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'proposalId', type: 'uint256' }],
    outputs: [],
  },
  {
    name: 'finalizeRejected',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'proposalId', type: 'uint256' }],
    outputs: [],
  },
  {
    name: 'withdrawRejected',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'proposalId', type: 'uint256' }],
    outputs: [],
  },
  {
    name: 'getProposal',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'proposalId', type: 'uint256' }],
    outputs: [
      {
        type: 'tuple',
        components: [
          { name: 'creator', type: 'address' },
          { name: 'pledgedR00t', type: 'uint256' },
          { name: 'name', type: 'string' },
          { name: 'symbol', type: 'string' },
          { name: 'metadataHash', type: 'bytes32' },
          { name: 'totalSupply', type: 'uint256' },
          { name: 'feeBps', type: 'uint256' },
          { name: 'deployerBps', type: 'uint256' },
          { name: 'votesFor', type: 'uint256' },
          { name: 'votesAgainst', type: 'uint256' },
          { name: 'votingEnds', type: 'uint256' },
          { name: 'status', type: 'uint8' },
          { name: 'ammAddress', type: 'address' },
          { name: 'tokenAddress', type: 'address' },
          { name: 'createdAt', type: 'uint256' },
        ],
      },
    ],
  },
  {
    name: 'proposalCount',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint256' }],
  },
  {
    name: 'getActiveProposals',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint256[]' }],
  },
  {
    name: 'getLiveProjects',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'address[]' }],
  },
  {
    name: 'MIN_VOTES_FOR_QUORUM',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint256' }],
  },
] as const;

export const WORLD_ID_GATEKEEPER_ABI = [
  {
    name: 'isVerified',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'user', type: 'address' }],
    outputs: [{ type: 'bool' }],
  },
  {
    name: 'requestVerification',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'nullifierHash', type: 'bytes32' },
      { name: 'merkleRoot', type: 'bytes32' },
      { name: 'proof', type: 'uint256[8]' },
      { name: 'verificationLevel', type: 'string' },
    ],
    outputs: [{ name: 'requestId', type: 'uint256' }],
  },
  {
    name: 'appId',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'string' }],
  },
] as const;

// SerraEstrelaNativeForest ABI (subset for frontend reads)
export const SERRA_ESTRELA_ABI = [
  {
    type: 'function',
    name: 'getLatestReport',
    inputs: [],
    outputs: [
      {
        name: '',
        type: 'tuple',
        components: [
          { name: 'ndviCurrent', type: 'int256' },
          { name: 'ndviPreFire', type: 'int256' },
          { name: 'ndviRecoveryPct', type: 'uint256' },
          { name: 'dnbr', type: 'int256' },
          { name: 'soilOrganicCarbon', type: 'uint256' },
          { name: 'estimatedLiveTrees', type: 'uint256' },
          { name: 'annualCO2', type: 'uint256' },
          { name: 'carbonCredits', type: 'uint256' },
          { name: 'fireRecoveryIndex', type: 'uint256' },
          { name: 'timestamp', type: 'uint256' },
        ],
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getProjectSummary',
    inputs: [],
    outputs: [
      { name: 'totalTreesPlanted', type: 'uint256' },
      { name: 'estimatedLiveTrees', type: 'uint256' },
      { name: 'survivalRatePct', type: 'uint256' },
      { name: 'fireRecoveryIndex', type: 'uint256' },
      { name: 'ndviRecoveryPct', type: 'uint256' },
      { name: 'annualCO2Kg', type: 'uint256' },
      { name: 'totalReports', type: 'uint256' },
      { name: 'lastUpdateTimestamp', type: 'uint256' },
    ],
    stateMutability: 'view',
  },
] as const;

export const WORLD_ID_APP_ID = import.meta.env.VITE_WORLD_ID_APP_ID || 'app_48f9975905cb184e98b13e654cddde87';
export const WORLD_ID_ACTION = import.meta.env.VITE_WORLD_ID_ACTION || 'create-proposal';

// Default species presets for Serra da Estrela
export const SERRA_DA_ESTRELA_SPECIES: { name: string; count: number; co2RateKgYear: number; survivalRate: number }[] = [
  { name: 'Quercus pyrenaica', count: 300, co2RateKgYear: 22, survivalRate: 85 },
  { name: 'Betula celtiberica', count: 200, co2RateKgYear: 18, survivalRate: 78 },
  { name: 'Ilex aquifolium', count: 150, co2RateKgYear: 12, survivalRate: 90 },
  { name: 'Pinus sylvestris', count: 100, co2RateKgYear: 25, survivalRate: 72 },
  { name: 'Castanea sativa', count: 100, co2RateKgYear: 28, survivalRate: 80 },
  { name: 'Arbutus unedo', count: 75, co2RateKgYear: 10, survivalRate: 88 },
];

// CRE workflow milestone definitions
export const CRE_MILESTONES = [
  { id: 'w8', workflow: 'W8', label: 'World ID Verification', description: 'Sybil-resistant identity proof via Worldcoin orb' },
  { id: 'w1', workflow: 'W1', label: 'NDVI Satellite Monitor', description: 'Sentinel-2 vegetation index tracking via CRE DON' },
  { id: 'w3', workflow: 'W3', label: 'Carbon Accounting', description: 'tCO₂/year estimation from biomass growth models' },
  { id: 'w7', workflow: 'W7', label: 'Fire Recovery Index', description: 'dNBR burn severity + recovery trajectory' },
  { id: 'w5', workflow: 'W5', label: 'Proof of Reserve', description: 'On-chain treasury verification via Chainlink PoR' },
] as const;
