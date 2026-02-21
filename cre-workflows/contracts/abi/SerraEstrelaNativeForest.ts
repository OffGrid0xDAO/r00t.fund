/**
 * SerraEstrelaNativeForest ABI — Custom Data Feed for real reforestation project
 * Serra da Estrela Natural Park, Portugal — 9ha native forest restoration
 */
export const SerraEstrelaNativeForestABI = [
  // CRE DON callback
  {
    type: "function",
    name: "receiveReport",
    inputs: [
      { name: "ndviCurrent", type: "int256" },
      { name: "ndviPreFire", type: "int256" },
      { name: "ndviRecoveryPct", type: "uint256" },
      { name: "dnbr", type: "int256" },
      { name: "soilOrganicCarbon", type: "uint256" },
      { name: "estimatedLiveTrees", type: "uint256" },
      { name: "annualCO2", type: "uint256" },
      { name: "carbonCredits", type: "uint256" },
      { name: "fireRecoveryIndex", type: "uint256" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  // AggregatorV3Interface
  {
    type: "function",
    name: "latestRoundData",
    inputs: [],
    outputs: [
      { name: "roundId", type: "uint80" },
      { name: "answer", type: "int256" },
      { name: "startedAt", type: "uint256" },
      { name: "updatedAt", type: "uint256" },
      { name: "answeredInRound", type: "uint80" },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "getRoundData",
    inputs: [{ name: "_roundId", type: "uint80" }],
    outputs: [
      { name: "roundId", type: "uint80" },
      { name: "answer", type: "int256" },
      { name: "startedAt", type: "uint256" },
      { name: "updatedAt", type: "uint256" },
      { name: "answeredInRound", type: "uint80" },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "decimals",
    inputs: [],
    outputs: [{ name: "", type: "uint8" }],
    stateMutability: "pure",
  },
  {
    type: "function",
    name: "description",
    inputs: [],
    outputs: [{ name: "", type: "string" }],
    stateMutability: "pure",
  },
  {
    type: "function",
    name: "version",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "pure",
  },
  // Extended view functions
  {
    type: "function",
    name: "getLatestReport",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
          { name: "ndviCurrent", type: "int256" },
          { name: "ndviPreFire", type: "int256" },
          { name: "ndviRecoveryPct", type: "uint256" },
          { name: "dnbr", type: "int256" },
          { name: "soilOrganicCarbon", type: "uint256" },
          { name: "estimatedLiveTrees", type: "uint256" },
          { name: "annualCO2", type: "uint256" },
          { name: "carbonCredits", type: "uint256" },
          { name: "fireRecoveryIndex", type: "uint256" },
          { name: "timestamp", type: "uint256" },
        ],
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "getProjectSummary",
    inputs: [],
    outputs: [
      { name: "totalTreesPlanted", type: "uint256" },
      { name: "estimatedLiveTrees", type: "uint256" },
      { name: "survivalRatePct", type: "uint256" },
      { name: "fireRecoveryIndex", type: "uint256" },
      { name: "ndviRecoveryPct", type: "uint256" },
      { name: "annualCO2Kg", type: "uint256" },
      { name: "totalReports", type: "uint256" },
      { name: "lastUpdateTimestamp", type: "uint256" },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "getEstimatedLiveTrees",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "getTreeSurvivalRate",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "getAnnualCO2",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "getCarbonCredits",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "getCumulativeCarbonCredits",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "getFireRecoveryIndex",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
  // Constants
  {
    type: "function",
    name: "TOTAL_TREES_PLANTED",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "AREA_HECTARES_X100",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
  // Events
  {
    type: "event",
    name: "RestorationReportPublished",
    inputs: [
      { name: "roundId", type: "uint80", indexed: true },
      { name: "ndviCurrent", type: "int256", indexed: false },
      { name: "ndviRecoveryPct", type: "uint256", indexed: false },
      { name: "estimatedLiveTrees", type: "uint256", indexed: false },
      { name: "annualCO2", type: "uint256", indexed: false },
      { name: "carbonCredits", type: "uint256", indexed: false },
      { name: "fireRecoveryIndex", type: "uint256", indexed: false },
      { name: "timestamp", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "MilestoneReached",
    inputs: [
      { name: "milestone", type: "string", indexed: false },
      { name: "value", type: "uint256", indexed: false },
      { name: "timestamp", type: "uint256", indexed: false },
    ],
  },
] as const;
