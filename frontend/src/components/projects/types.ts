// Shared types for the Projects panel

export interface Proposal {
  id: number;
  creator: string;
  pledgedR00t: bigint;
  name: string;
  symbol: string;
  metadataHash: string;
  totalSupply: bigint;
  feeBps: number;
  deployerBps: number;
  votesFor: bigint;
  votesAgainst: bigint;
  votingEnds: bigint;
  status: number;
  ammAddress: string;
  tokenAddress: string;
  createdAt: bigint;
}

export interface CommitmentsResult {
  commitments: { commitment: bigint; leafIndex: number }[];
  treeState?: {
    filledSubtrees: bigint[];
    root: bigint;
  };
}

export interface WalletCommitment {
  commitment: string;
  amount: string;
  leafIndex: number;
  spent: boolean;
  nullifier?: string;
  secret?: string;
}

// Wizard form data
export interface SpeciesEntry {
  name: string;
  count: number;
  co2RateKgYear: number;
  survivalRate: number;
}

export interface EnvironmentalData {
  latitude: string;
  longitude: string;
  landAreaHectares: string;
  projectType: 'reforestation' | 'soil_restoration' | 'carbon_credits' | 'mixed';
  species: SpeciesEntry[];
  targetNdvi: string;
  baselineNdvi: string;
  carbonTargetTco2Year: string;
  preFireDate: string;
}

export interface WizardFormData {
  // Step 1: World ID (no form data — verification state)
  // Step 2: Project details
  name: string;
  symbol: string;
  description: string;
  docsUrl: string;
  twitterUrl: string;
  coverImageUrl: string;
  // Step 3: Environmental data
  environmental: EnvironmentalData;
  // Step 4: Tokenomics
  totalSupply: string;
  feeBps: string;
  deployerBps: string;
  pledgeAmount: string;
}

// CRE Data Feed types
export interface CreDataFeedReport {
  ndviCurrent: number;
  ndviPreFire: number;
  ndviRecoveryPct: number;
  dnbr: number;
  soilOrganicCarbon: number;
  estimatedLiveTrees: number;
  annualCO2: number;
  carbonCredits: number;
  fireRecoveryIndex: number;
  timestamp: number;
}

export interface ProjectSummary {
  totalTreesPlanted: number;
  estimatedLiveTrees: number;
  survivalRatePct: number;
  fireRecoveryIndex: number;
  ndviRecoveryPct: number;
  annualCO2Kg: number;
  totalReports: number;
  lastUpdateTimestamp: number;
}

// Milestone tracking for CRE workflows
export type MilestoneStatus = 'pending' | 'active' | 'completed' | 'failed';

export interface MilestoneNode {
  id: string;
  label: string;
  workflow: string; // W8, W1, W3, W7, W5
  status: MilestoneStatus;
  description: string;
}

// Metadata stored in localStorage (keyed by metadataHash)
export interface ProposalMetadata {
  version: 2;
  description: string;
  docsUrl: string;
  twitterUrl: string;
  coverImageUrl: string;
  environmental: EnvironmentalData;
  createdAt: number;
}

// CRE W1: Confidential Funding Vault
export interface ProjectAttestation {
  impactScore: number;
  attestationHash: string;
  timestamp: number;
  verified: boolean;
}

// CRE W2: Proof of Reserve
export interface ReserveHealth {
  ethReserve: bigint;
  tokenReserve: bigint;
  backingRatio: number; // basis points
  impactScore: number;
  totalTVL: bigint;
}

// CRE W3: AI Agent Orchestrator
export interface AIAnalysis {
  timestamp: number;
  riskLevel: number; // 0=NONE, 1=LOW, 2=MEDIUM, 3=HIGH, 4=CRITICAL
  recommendedAction: number; // 0=HOLD, 1=BUY, 2=SELL, 3=HEDGE, 4=PAUSE
  analysisHash: string;
}

export interface GovernanceAdvisory {
  recommendation: number; // 0=ABSTAIN, 1=FOR, 2=AGAINST
  confidence: number; // 0-100
  reasoning: string;
  timestamp: number;
}

// CRE W4: Prediction Market
export interface PredictionMarket {
  proposalId: number;
  metric: string;
  targetValue: bigint;
  resolutionTime: number;
  status: number; // 0=OPEN, 1=RESOLVED_YES, 2=RESOLVED_NO, 3=CANCELLED
  totalPositiveShares: bigint;
  totalNegativeShares: bigint;
  totalPool: bigint;
}

// CRE W5: Protocol Health Monitor
export interface ProtocolHealthReport {
  ethReserve: bigint;
  tokenReserve: bigint;
  reserveRatio: number; // basis points
  shortsUtilization: number; // basis points
  overallRiskLevel: number; // 0=NONE, 1=LOW, 2=MEDIUM, 3=HIGH, 4=CRITICAL
  recommendedAction: number; // 0=NONE, 1=REDUCE_EXPOSURE, 2=PAUSE_SHORTS, 3=CIRCUIT_BREAK
  timestamp: number;
}

// CRE W6: Policy Engine
export interface ComplianceAttestation {
  level: number; // 0=NONE, 1=BASIC, 2=STANDARD, 3=ENHANCED
  attestedAt: number;
  expiresAt: number;
  attestationHash: string;
  sanctionsCleared: boolean;
  jurisdictionApproved: boolean;
  riskScore: number;
  active: boolean;
}

export interface PolicyStats {
  totalAttestations: number;
  totalAuthorized: number;
  totalDenied: number;
}

// CRE W6: Compliant Private Vault
export interface VaultStats {
  totalDeposits: bigint;
  totalWithdrawals: bigint;
  totalDenied: bigint;
  totalVolume: bigint;
  pendingETH: bigint;
  totalRequests: number;
}

// Aggregated CRE workflow status for a project/protocol
export interface CreWorkflowStatus {
  pilotSite: { active: boolean; lastUpdate: number };
  proofOfReserve: { active: boolean; backingRatio: number; tvl: bigint };
  aiOrchestrator: { active: boolean; riskLevel: number; safeToTrade: boolean };
  predictionMarket: { active: boolean; openMarkets: number };
  protocolHealth: { active: boolean; riskLevel: number };
  policyEngine: { active: boolean; totalAttestations: number };
  compliantVault: { active: boolean; totalRequests: number };
  confidentialFunding: { active: boolean; verifiedProposals: number };
}

export type TabType = 'proposals' | 'live' | 'create';
