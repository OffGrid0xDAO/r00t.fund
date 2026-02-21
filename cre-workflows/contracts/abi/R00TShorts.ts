// R00TShorts ABI — Key view functions for CRE workflows
export const R00TShortsABI = [
  {
    type: "function",
    name: "totalOpenInterest",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "totalCollateralLocked",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "openPositionCount",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "accumulatedFees",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "maxOpenInterestBps",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "nextPositionId",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "getPosition",
    inputs: [{ name: "positionId", type: "uint256" }],
    outputs: [
      {
        name: "position",
        type: "tuple",
        components: [
          { name: "ethCollateral", type: "uint256" },
          { name: "ethFromSale", type: "uint256" },
          { name: "tokenAmountShorted", type: "uint256" },
          { name: "entryPrice", type: "uint256" },
          { name: "openedAt", type: "uint256" },
          { name: "isOpen", type: "bool" },
        ],
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "isLiquidatable",
    inputs: [{ name: "positionId", type: "uint256" }],
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "calculatePnL",
    inputs: [{ name: "positionId", type: "uint256" }],
    outputs: [
      { name: "pnl", type: "int256" },
      { name: "repurchaseCost", type: "uint256" },
    ],
    stateMutability: "view",
  },
  // New view functions added for CRE
  {
    type: "function",
    name: "getPositionCount",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "getLiquidatablePositionCount",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
] as const;
