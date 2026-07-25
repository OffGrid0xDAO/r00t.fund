// Minimal ABIs for the ETHGlobal hackathon stack on Sepolia:
//   - Uniswap v4 PoolManager `Swap` (one per public trade; `id` = poolId, indexed)
//   - RegenArbHook `SpreadCaptured` (one per real cross-pool rebalance; carries both pool prices)

export const PoolManagerV4Abi = [
  {
    type: "event",
    name: "Swap",
    inputs: [
      { type: "bytes32", indexed: true, name: "id" },
      { type: "address", indexed: true, name: "sender" },
      { type: "int128", indexed: false, name: "amount0" },
      { type: "int128", indexed: false, name: "amount1" },
      { type: "uint160", indexed: false, name: "sqrtPriceX96" },
      { type: "uint128", indexed: false, name: "liquidity" },
      { type: "int24", indexed: false, name: "tick" },
      { type: "uint24", indexed: false, name: "fee" },
    ],
  },
] as const;

export const RegenArbHookAbi = [
  {
    type: "event",
    name: "SpreadCaptured",
    inputs: [
      { type: "bytes32", indexed: true, name: "marketId" },
      { type: "uint256", indexed: false, name: "profit" },
      { type: "uint256", indexed: false, name: "uniPriceE18" },
      { type: "uint256", indexed: false, name: "privPriceE18" },
    ],
  },
  // Emitted on every register() — the AUTO-DISCOVERY feed: a new market appears here the instant a
  // token launches (clearAndLaunch / base-market wiring). One shared hook → one feed for all markets.
  {
    type: "event",
    name: "MarketRegistered",
    inputs: [
      { type: "bytes32", indexed: true, name: "poolId" },
      { type: "bytes32", indexed: true, name: "marketId" },
      { type: "address", indexed: false, name: "privatePool" },
      { type: "address", indexed: false, name: "treasury" },
    ],
  },
] as const;
