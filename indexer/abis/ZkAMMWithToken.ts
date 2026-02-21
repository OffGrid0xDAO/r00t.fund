export const ZkAMMWithTokenAbi = [
  // Events
  {
    type: "event",
    name: "TokensPurchased",
    inputs: [
      { type: "uint256", indexed: false, name: "ethIn" },
      { type: "uint256", indexed: false, name: "tokensOut" },
      { type: "uint256", indexed: false, name: "protocolFee" },
      { type: "uint256", indexed: false, name: "lpFee" },
    ],
  },
  {
    type: "event",
    name: "TokensSold",
    inputs: [
      { type: "uint256", indexed: false, name: "tokensIn" },
      { type: "uint256", indexed: false, name: "ethOut" },
      { type: "uint256", indexed: false, name: "protocolFee" },
      { type: "uint256", indexed: false, name: "lpFee" },
    ],
  },
  {
    type: "event",
    name: "NewCommitment",
    inputs: [
      { type: "uint256", indexed: true, name: "commitment" },
      { type: "uint256", indexed: true, name: "leafIndex" },
      { type: "bytes", indexed: false, name: "encryptedNote" },
    ],
  },
  {
    type: "event",
    name: "NullifierSpent",
    inputs: [{ type: "uint256", indexed: true, name: "nullifierHash" }],
  },
  {
    type: "event",
    name: "PublicWithdrawal",
    inputs: [
      { type: "uint256", indexed: true, name: "nullifierHash" },
      { type: "address", indexed: true, name: "recipient" },
      { type: "uint256", indexed: false, name: "amount" },
    ],
  },
  // LP Events (ZkAMMv3)
  {
    type: "event",
    name: "NewLPCommitment",
    inputs: [
      { type: "uint256", indexed: true, name: "commitment" },
      { type: "uint256", indexed: true, name: "leafIndex" },
      { type: "uint256", indexed: false, name: "lpShares" },
      { type: "bytes", indexed: false, name: "encryptedNote" },
    ],
  },
  {
    type: "event",
    name: "LPNullifierSpent",
    inputs: [{ type: "uint256", indexed: true, name: "nullifierHash" }],
  },
  {
    type: "event",
    name: "LiquidityAddedPrivate",
    inputs: [
      { type: "uint256", indexed: true, name: "commitment" },
      { type: "uint256", indexed: false, name: "ethAmount" },
      { type: "uint256", indexed: false, name: "tokenAmount" },
      { type: "uint256", indexed: false, name: "lpShares" },
    ],
  },
  {
    type: "event",
    name: "LiquidityRemovedPrivate",
    inputs: [
      { type: "uint256", indexed: true, name: "nullifierHash" },
      { type: "uint256", indexed: false, name: "ethOut" },
      { type: "uint256", indexed: false, name: "tokensOut" },
    ],
  },
  {
    type: "event",
    name: "LPFeesClaimed",
    inputs: [
      { type: "uint256", indexed: true, name: "claimNullifier" },
      { type: "address", indexed: true, name: "recipient" },
      { type: "uint256", indexed: false, name: "amount" },
      { type: "uint256", indexed: false, name: "feeEpoch" },
    ],
  },
  // View functions for pool state
  {
    type: "function",
    name: "ethReserve",
    inputs: [],
    outputs: [{ type: "uint256", name: "" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "tokenReserve",
    inputs: [],
    outputs: [{ type: "uint256", name: "" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "getTokenPrice",
    inputs: [],
    outputs: [{ type: "uint256", name: "" }],
    stateMutability: "view",
  },
] as const;
