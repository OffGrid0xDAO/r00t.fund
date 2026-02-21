// RegenPredictionMarket ABI — W4: Prediction Markets Track callback contract
export const RegenPredictionMarketABI = [
  {
    type: "function",
    name: "receiveReport",
    inputs: [
      { name: "marketId", type: "uint256" },
      { name: "outcome", type: "uint8" },
      { name: "actualValue", type: "uint256" },
      { name: "proofHash", type: "bytes32" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "createMarket",
    inputs: [
      { name: "proposalId", type: "uint256" },
      { name: "metric", type: "string" },
      { name: "targetValue", type: "uint256" },
      { name: "resolutionTime", type: "uint256" },
    ],
    outputs: [{ name: "marketId", type: "uint256" }],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "buyShares",
    inputs: [
      { name: "marketId", type: "uint256" },
      { name: "isPositive", type: "bool" },
      { name: "minShares", type: "uint256" },
    ],
    outputs: [{ name: "sharesBought", type: "uint256" }],
    stateMutability: "payable",
  },
  {
    type: "function",
    name: "requestResolution",
    inputs: [{ name: "marketId", type: "uint256" }],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "claimPayout",
    inputs: [{ name: "marketId", type: "uint256" }],
    outputs: [{ name: "payout", type: "uint256" }],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "getMarket",
    inputs: [{ name: "marketId", type: "uint256" }],
    outputs: [
      { name: "proposalId", type: "uint256" },
      { name: "metric", type: "string" },
      { name: "targetValue", type: "uint256" },
      { name: "resolutionTime", type: "uint256" },
      { name: "status", type: "uint8" },
      { name: "totalPositiveShares", type: "uint256" },
      { name: "totalNegativeShares", type: "uint256" },
      { name: "totalPool", type: "uint256" },
    ],
    stateMutability: "view",
  },
  {
    type: "event",
    name: "ResolutionRequested",
    inputs: [
      { name: "marketId", type: "uint256", indexed: true },
      { name: "proposalId", type: "uint256", indexed: true },
      { name: "metric", type: "string", indexed: false },
      { name: "targetValue", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "MarketResolved",
    inputs: [
      { name: "marketId", type: "uint256", indexed: true },
      { name: "outcome", type: "uint8", indexed: false },
      { name: "actualValue", type: "uint256", indexed: false },
    ],
  },
] as const;
