// AIAgentOrchestrator ABI — W3: CRE & AI Track callback contract
export const AIAgentOrchestratorABI = [
  {
    type: "function",
    name: "receiveReport",
    inputs: [
      { name: "riskLevel", type: "uint8" },
      { name: "recommendedAction", type: "uint8" },
      { name: "analysisHash", type: "bytes32" },
      { name: "strategyData", type: "bytes" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "receiveGovernanceAdvisory",
    inputs: [
      { name: "proposalId", type: "uint256" },
      { name: "recommendation", type: "uint8" },
      { name: "confidence", type: "uint256" },
      { name: "reasoning", type: "bytes32" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "getLatestAnalysis",
    inputs: [],
    outputs: [
      { name: "timestamp", type: "uint256" },
      { name: "riskLevel", type: "uint8" },
      { name: "recommendedAction", type: "uint8" },
      { name: "analysisHash", type: "bytes32" },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "getGovernanceAdvisory",
    inputs: [{ name: "proposalId", type: "uint256" }],
    outputs: [
      { name: "recommendation", type: "uint8" },
      { name: "confidence", type: "uint256" },
      { name: "reasoning", type: "bytes32" },
      { name: "timestamp", type: "uint256" },
    ],
    stateMutability: "view",
  },
  {
    type: "event",
    name: "AIStrategyUpdate",
    inputs: [
      { name: "timestamp", type: "uint256", indexed: true },
      { name: "riskLevel", type: "uint8", indexed: false },
      { name: "recommendedAction", type: "uint8", indexed: false },
      { name: "analysisHash", type: "bytes32", indexed: false },
    ],
  },
  {
    type: "event",
    name: "AIGovernanceAdvisory",
    inputs: [
      { name: "proposalId", type: "uint256", indexed: true },
      { name: "recommendation", type: "uint8", indexed: false },
      { name: "confidence", type: "uint256", indexed: false },
    ],
  },
] as const;
