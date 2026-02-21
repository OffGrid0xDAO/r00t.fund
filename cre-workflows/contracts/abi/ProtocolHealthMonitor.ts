// ProtocolHealthMonitor ABI — W5: Risk & Compliance Track callback contract
export const ProtocolHealthMonitorABI = [
  {
    type: "function",
    name: "receiveReport",
    inputs: [
      { name: "ethReserve", type: "uint256" },
      { name: "tokenReserve", type: "uint256" },
      { name: "reserveRatio", type: "uint256" },
      { name: "shortsUtilization", type: "uint256" },
      { name: "overallRiskLevel", type: "uint8" },
      { name: "recommendedAction", type: "uint8" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "latestReport",
    inputs: [],
    outputs: [
      { name: "ethReserve", type: "uint256" },
      { name: "tokenReserve", type: "uint256" },
      { name: "reserveRatio", type: "uint256" },
      { name: "shortsUtilization", type: "uint256" },
      { name: "overallRiskLevel", type: "uint8" },
      { name: "recommendedAction", type: "uint8" },
      { name: "timestamp", type: "uint256" },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "autoCircuitBreakerEnabled",
    inputs: [],
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "riskAlertThreshold",
    inputs: [],
    outputs: [{ name: "", type: "uint8" }],
    stateMutability: "view",
  },
  {
    type: "event",
    name: "HealthReportPublished",
    inputs: [
      { name: "timestamp", type: "uint256", indexed: true },
      { name: "overallRiskLevel", type: "uint8", indexed: false },
      { name: "reserveRatio", type: "uint256", indexed: false },
      { name: "shortsUtilization", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "RiskAlert",
    inputs: [
      { name: "timestamp", type: "uint256", indexed: true },
      { name: "riskLevel", type: "uint8", indexed: false },
      { name: "recommendedAction", type: "uint8", indexed: false },
    ],
  },
  {
    type: "event",
    name: "CircuitBreakerTriggered",
    inputs: [
      { name: "timestamp", type: "uint256", indexed: true },
      { name: "riskLevel", type: "uint8", indexed: false },
    ],
  },
] as const;
