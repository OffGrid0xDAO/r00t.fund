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
    name: 'getLiveProjectCount',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint256' }],
  },
  {
    name: 'deployedAMMs',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'index', type: 'uint256' }],
    outputs: [{ type: 'address' }],
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

// ConfidentialFundingVault ABI (W1: Privacy Track)
export const CONFIDENTIAL_FUNDING_VAULT_ABI = [
  {
    type: 'function',
    name: 'getProjectAttestation',
    inputs: [{ name: 'proposalId', type: 'uint256' }],
    outputs: [
      { name: 'impactScore', type: 'uint256' },
      { name: 'attestationHash', type: 'bytes32' },
      { name: 'timestamp', type: 'uint256' },
      { name: 'verified', type: 'bool' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'isProposalVerified',
    inputs: [{ name: 'proposalId', type: 'uint256' }],
    outputs: [{ type: 'bool' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'meetsImpactThreshold',
    inputs: [{ name: 'proposalId', type: 'uint256' }],
    outputs: [{ type: 'bool' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getVerifiedProposalIds',
    inputs: [],
    outputs: [{ type: 'uint256[]' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getCarbonCredits',
    inputs: [{ name: 'proposalId', type: 'uint256' }],
    outputs: [{ type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getTotalVerifiedCredits',
    inputs: [],
    outputs: [{ type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getTotalCreditValueEur',
    inputs: [],
    outputs: [{ type: 'uint256' }],
    stateMutability: 'view',
  },
] as const;

// RegenProofOfReserve ABI (W2: DeFi/Tokenization Track)
export const REGEN_PROOF_OF_RESERVE_ABI = [
  {
    type: 'function',
    name: 'getReserveHealth',
    inputs: [],
    outputs: [
      { name: 'ethReserve', type: 'uint256' },
      { name: 'tokenReserve', type: 'uint256' },
      { name: 'backingRatio', type: 'uint256' },
      { name: 'impactScore', type: 'uint256' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getTotalTVL',
    inputs: [],
    outputs: [{ type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'latestRoundData',
    inputs: [],
    outputs: [
      { name: 'roundId', type: 'uint80' },
      { name: 'answer', type: 'int256' },
      { name: 'startedAt', type: 'uint256' },
      { name: 'updatedAt', type: 'uint256' },
      { name: 'answeredInRound', type: 'uint80' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'decimals',
    inputs: [],
    outputs: [{ type: 'uint8' }],
    stateMutability: 'view',
  },
] as const;

// AIAgentOrchestrator ABI (W3: CRE & AI Track)
export const AI_AGENT_ORCHESTRATOR_ABI = [
  {
    type: 'function',
    name: 'getLatestAnalysis',
    inputs: [],
    outputs: [
      { name: 'timestamp', type: 'uint256' },
      { name: 'riskLevel', type: 'uint8' },
      { name: 'recommendedAction', type: 'uint8' },
      { name: 'analysisHash', type: 'bytes32' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getGovernanceAdvisory',
    inputs: [{ name: 'proposalId', type: 'uint256' }],
    outputs: [
      { name: 'recommendation', type: 'uint8' },
      { name: 'confidence', type: 'uint256' },
      { name: 'reasoning', type: 'bytes32' },
      { name: 'timestamp', type: 'uint256' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getAdvisedProposalIds',
    inputs: [],
    outputs: [{ type: 'uint256[]' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'isSafeToTrade',
    inputs: [],
    outputs: [{ type: 'bool' }],
    stateMutability: 'view',
  },
] as const;

// RegenPredictionMarket ABI (W4: Prediction Markets Track)
export const REGEN_PREDICTION_MARKET_ABI = [
  {
    type: 'function',
    name: 'createMarket',
    inputs: [
      { name: 'proposalId', type: 'uint256' },
      { name: 'metric', type: 'string' },
      { name: 'targetValue', type: 'uint256' },
      { name: 'resolutionTime', type: 'uint256' },
    ],
    outputs: [{ name: 'marketId', type: 'uint256' }],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'buyShares',
    inputs: [
      { name: 'marketId', type: 'uint256' },
      { name: 'isPositive', type: 'bool' },
      { name: 'minShares', type: 'uint256' },
    ],
    outputs: [{ name: 'sharesBought', type: 'uint256' }],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    name: 'requestResolution',
    inputs: [{ name: 'marketId', type: 'uint256' }],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'claimPayout',
    inputs: [{ name: 'marketId', type: 'uint256' }],
    outputs: [{ name: 'payout', type: 'uint256' }],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'getMarket',
    inputs: [{ name: 'marketId', type: 'uint256' }],
    outputs: [
      { name: 'proposalId', type: 'uint256' },
      { name: 'metric', type: 'string' },
      { name: 'targetValue', type: 'uint256' },
      { name: 'resolutionTime', type: 'uint256' },
      { name: 'status', type: 'uint8' },
      { name: 'totalPositiveShares', type: 'uint256' },
      { name: 'totalNegativeShares', type: 'uint256' },
      { name: 'totalPool', type: 'uint256' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getUserShares',
    inputs: [
      { name: 'marketId', type: 'uint256' },
      { name: 'user', type: 'address' },
    ],
    outputs: [
      { name: 'positive', type: 'uint256' },
      { name: 'negative', type: 'uint256' },
    ],
    stateMutability: 'view',
  },
] as const;

// ProtocolHealthMonitor ABI (W5: Risk & Compliance Track)
export const PROTOCOL_HEALTH_MONITOR_ABI = [
  {
    type: 'function',
    name: 'latestReport',
    inputs: [],
    outputs: [
      { name: 'ethReserve', type: 'uint256' },
      { name: 'tokenReserve', type: 'uint256' },
      { name: 'reserveRatio', type: 'uint256' },
      { name: 'shortsUtilization', type: 'uint256' },
      { name: 'overallRiskLevel', type: 'uint8' },
      { name: 'recommendedAction', type: 'uint8' },
      { name: 'timestamp', type: 'uint256' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'autoCircuitBreakerEnabled',
    inputs: [],
    outputs: [{ type: 'bool' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'riskAlertThreshold',
    inputs: [],
    outputs: [{ type: 'uint8' }],
    stateMutability: 'view',
  },
] as const;

// R00tPolicyEngine ABI (W6: Compliance)
export const POLICY_ENGINE_ABI = [
  {
    type: 'function',
    name: 'isCompliant',
    inputs: [{ name: 'addressHash', type: 'bytes32' }],
    outputs: [{ type: 'bool' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getComplianceLevel',
    inputs: [{ name: 'addressHash', type: 'bytes32' }],
    outputs: [{ type: 'uint8' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getAttestation',
    inputs: [{ name: 'addressHash', type: 'bytes32' }],
    outputs: [
      {
        name: '',
        type: 'tuple',
        components: [
          { name: 'level', type: 'uint8' },
          { name: 'attestedAt', type: 'uint256' },
          { name: 'expiresAt', type: 'uint256' },
          { name: 'attestationHash', type: 'bytes32' },
          { name: 'sanctionsCleared', type: 'bool' },
          { name: 'jurisdictionApproved', type: 'bool' },
          { name: 'riskScore', type: 'uint8' },
          { name: 'active', type: 'bool' },
        ],
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'totalAttestations',
    inputs: [],
    outputs: [{ type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'totalAuthorized',
    inputs: [],
    outputs: [{ type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'totalDenied',
    inputs: [],
    outputs: [{ type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'checkPrivateTransferAllowed',
    inputs: [
      { name: 'fromHash', type: 'bytes32' },
      { name: 'toHash', type: 'bytes32' },
      { name: 'amount', type: 'uint256' },
      { name: 'transferType', type: 'uint8' },
    ],
    outputs: [
      { name: 'allowed', type: 'bool' },
      { name: 'reason', type: 'string' },
    ],
    stateMutability: 'view',
  },
] as const;

// CompliantPrivateVault ABI (W6: Compliance Vault)
export const COMPLIANT_PRIVATE_VAULT_ABI = [
  {
    type: 'function',
    name: 'requestDeposit',
    inputs: [
      { name: 'commitment', type: 'uint256' },
      { name: 'addressHash', type: 'bytes32' },
      { name: 'encryptedNote', type: 'bytes' },
    ],
    outputs: [{ name: 'requestId', type: 'uint256' }],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    name: 'cancelRequest',
    inputs: [{ name: 'requestId', type: 'uint256' }],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'getRequest',
    inputs: [{ name: 'requestId', type: 'uint256' }],
    outputs: [
      {
        name: '',
        type: 'tuple',
        components: [
          { name: 'requestType', type: 'uint8' },
          { name: 'status', type: 'uint8' },
          { name: 'requester', type: 'address' },
          { name: 'amount', type: 'uint256' },
          { name: 'commitment', type: 'uint256' },
          { name: 'senderHash', type: 'bytes32' },
          { name: 'recipientHash', type: 'bytes32' },
          { name: 'encryptedNote', type: 'bytes' },
          { name: 'requestedAt', type: 'uint256' },
          { name: 'expiresAt', type: 'uint256' },
          { name: 'denyReason', type: 'string' },
        ],
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getVaultStats',
    inputs: [],
    outputs: [
      { name: '_totalDeposits', type: 'uint256' },
      { name: '_totalWithdrawals', type: 'uint256' },
      { name: '_totalDenied', type: 'uint256' },
      { name: '_totalVolume', type: 'uint256' },
      { name: '_pendingETH', type: 'uint256' },
      { name: '_totalRequests', type: 'uint256' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'nextRequestId',
    inputs: [],
    outputs: [{ type: 'uint256' }],
    stateMutability: 'view',
  },
] as const;

export const WORLD_ID_APP_ID = import.meta.env.VITE_WORLD_ID_APP_ID || 'app_48f9975905cb184e98b13e654cddde87';
export const WORLD_ID_ACTION = import.meta.env.VITE_WORLD_ID_ACTION || 'r00tdotfund';

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
  { id: 'w1', workflow: 'W1', label: 'Confidential Funding Vault', description: 'ZK-shielded funding for €44,450 project budget' },
  { id: 'w3', workflow: 'W3', label: 'AI Vegetation Analysis', description: 'Multi-model satellite analysis of burn severity & recovery' },
  { id: 'w7', workflow: 'W7', label: 'Serra da Estrela Recovery Feed', description: 'Phase 1: 9 ha clearing (€27,150) → Phase 2: 2,550 trees Sep/Oct 2026 (€17,300)' },
  { id: 'w5', workflow: 'W5', label: 'Ecosystem Health Monitor', description: 'NDVI, soil moisture & fire recovery index tracking' },
] as const;
