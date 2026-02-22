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

export type TabType = 'proposals' | 'live' | 'create';
