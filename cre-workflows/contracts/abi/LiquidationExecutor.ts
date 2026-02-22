// LiquidationExecutor ABI — W2: CRE batch liquidation executor
export const LiquidationExecutorABI = [
  {
    type: "function",
    name: "executeLiquidations",
    inputs: [
      { name: "positionIds", type: "uint256[]" },
      { name: "maxRepurchaseCosts", type: "uint256[]" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "event",
    name: "LiquidationBatchExecuted",
    inputs: [
      { name: "count", type: "uint256", indexed: false },
      { name: "totalBonus", type: "uint256", indexed: false },
    ],
  },
] as const;
