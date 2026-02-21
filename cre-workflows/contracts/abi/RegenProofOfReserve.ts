// RegenProofOfReserve ABI — W2: DeFi & Tokenization Track callback contract
export const RegenProofOfReserveABI = [
  {
    type: "function",
    name: "receiveReport",
    inputs: [
      { name: "ethReserve", type: "uint256" },
      { name: "tokenReserve", type: "uint256" },
      { name: "totalTVL", type: "uint256" },
      { name: "backingRatio", type: "uint256" },
      { name: "impactScore", type: "uint256" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  // AggregatorV3Interface compatibility
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
    name: "decimals",
    inputs: [],
    outputs: [{ name: "", type: "uint8" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "getReserveHealth",
    inputs: [],
    outputs: [
      { name: "ethReserve", type: "uint256" },
      { name: "tokenReserve", type: "uint256" },
      { name: "backingRatio", type: "uint256" },
      { name: "impactScore", type: "uint256" },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "getTotalTVL",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "event",
    name: "ReserveReportUpdated",
    inputs: [
      { name: "roundId", type: "uint80", indexed: true },
      { name: "totalTVL", type: "uint256", indexed: false },
      { name: "backingRatio", type: "uint256", indexed: false },
      { name: "impactScore", type: "uint256", indexed: false },
    ],
  },
] as const;
