// ZkAMMv3Pair ABI — Key view functions for CRE workflows
export const ZkAMMv3PairABI = [
  // Reserve state
  {
    type: "function",
    name: "ethReserve",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "tokenReserve",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "totalLPShares",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "accumulatedProtocolFees",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "accumulatedLPFees",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "feePerShare",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "getReserves",
    inputs: [],
    outputs: [
      { name: "_ethReserve", type: "uint256" },
      { name: "_tokenReserve", type: "uint256" },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "bootstrapped",
    inputs: [],
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "getCirculatingSupply",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "getLPInfo",
    inputs: [],
    outputs: [
      { name: "_totalShares", type: "uint256" },
      { name: "_feePerShare", type: "uint256" },
      { name: "_accumulatedFees", type: "uint256" },
    ],
    stateMutability: "view",
  },
  // Commitment insertion (for CRE callback)
  {
    type: "function",
    name: "insertCommitment",
    inputs: [
      { name: "commitment", type: "uint256" },
      { name: "encryptedNote", type: "bytes" },
    ],
    outputs: [{ name: "leafIndex", type: "uint256" }],
    stateMutability: "nonpayable",
  },
] as const;
