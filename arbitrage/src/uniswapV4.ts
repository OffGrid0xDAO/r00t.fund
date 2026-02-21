import { createPublicClient, http, type PublicClient, parseAbi } from 'viem';
import { base } from 'viem/chains';
import { UNISWAP_V4_CONSTANTS, PRICE_CONSTANTS } from './config';
import type { UniswapV4PoolKey, SwapParams, PriceQuote } from './types';

// Uniswap V4 Pool Manager ABI (essential functions)
const POOL_MANAGER_ABI = parseAbi([
  'function getSlot0(bytes32 poolId) external view returns (uint160 sqrtPriceX96, int24 tick, uint24 protocolFee, uint24 lpFee)',
  'function getLiquidity(bytes32 poolId) external view returns (uint128)',
  'function getPosition(bytes32 poolId, address owner, int24 tickLower, int24 tickUpper, bytes32 salt) external view returns (uint128 liquidity, uint256 feeGrowthInside0LastX128, uint256 feeGrowthInside1LastX128)',
]);

// Quoter ABI for simulating swaps
const QUOTER_ABI = parseAbi([
  'function quoteExactInputSingle(tuple(address tokenIn, address tokenOut, uint256 amountIn, uint24 fee, uint160 sqrtPriceLimitX96) params) external returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)',
  'function quoteExactOutputSingle(tuple(address tokenIn, address tokenOut, uint256 amount, uint24 fee, uint160 sqrtPriceLimitX96) params) external returns (uint256 amountIn, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)',
]);

// Swap Router ABI
const SWAP_ROUTER_ABI = parseAbi([
  'function swap(bytes32 poolId, tuple(bool zeroForOne, int256 amountSpecified, uint160 sqrtPriceLimitX96) params, bytes hookData) external payable returns (int256 delta0, int256 delta1)',
]);

export class UniswapV4Oracle {
  private client: PublicClient;
  private poolManagerAddress: `0x${string}`;
  private quoterAddress: `0x${string}`;
  private swapRouterAddress: `0x${string}`;

  constructor(
    rpcUrl: string,
    poolManagerAddress?: string,
    quoterAddress?: string,
    swapRouterAddress?: string
  ) {
    this.client = createPublicClient({
      chain: base,
      transport: http(rpcUrl),
    });

    this.poolManagerAddress = (poolManagerAddress || UNISWAP_V4_CONSTANTS.POOL_MANAGER) as `0x${string}`;
    this.quoterAddress = (quoterAddress || UNISWAP_V4_CONSTANTS.QUOTER) as `0x${string}`;
    this.swapRouterAddress = (swapRouterAddress || UNISWAP_V4_CONSTANTS.SWAP_ROUTER) as `0x${string}`;
  }

  /**
   * Compute pool ID from pool key
   */
  computePoolId(poolKey: UniswapV4PoolKey): `0x${string}` {
    // Pool ID is keccak256 of packed pool key
    const { keccak256, encodePacked } = require('viem');
    return keccak256(
      encodePacked(
        ['address', 'address', 'uint24', 'int24', 'address'],
        [
          poolKey.currency0 as `0x${string}`,
          poolKey.currency1 as `0x${string}`,
          poolKey.fee,
          poolKey.tickSpacing,
          poolKey.hooks as `0x${string}`,
        ]
      )
    );
  }

  /**
   * Get current pool state (price, liquidity, tick)
   */
  async getPoolState(poolKey: UniswapV4PoolKey): Promise<{
    sqrtPriceX96: bigint;
    tick: number;
    liquidity: bigint;
    price: bigint;
  }> {
    const poolId = this.computePoolId(poolKey);

    const [slot0, liquidity] = await Promise.all([
      this.client.readContract({
        address: this.poolManagerAddress,
        abi: POOL_MANAGER_ABI,
        functionName: 'getSlot0',
        args: [poolId],
      }),
      this.client.readContract({
        address: this.poolManagerAddress,
        abi: POOL_MANAGER_ABI,
        functionName: 'getLiquidity',
        args: [poolId],
      }),
    ]);

    const [sqrtPriceX96, tick] = slot0 as [bigint, number, number, number];

    // Convert sqrtPriceX96 to actual price
    // price = (sqrtPriceX96 / 2^96)^2
    const price = this.sqrtPriceX96ToPrice(sqrtPriceX96);

    return {
      sqrtPriceX96,
      tick,
      liquidity: liquidity as bigint,
      price,
    };
  }

  /**
   * Convert sqrtPriceX96 to human-readable price (token1 per token0)
   */
  sqrtPriceX96ToPrice(sqrtPriceX96: bigint): bigint {
    const Q96 = UNISWAP_V4_CONSTANTS.Q96;
    // price = (sqrtPriceX96^2 * 10^18) / (2^192)
    const priceX192 = sqrtPriceX96 * sqrtPriceX96;
    return (priceX192 * PRICE_CONSTANTS.PRECISION) / (Q96 * Q96);
  }

  /**
   * Convert price to sqrtPriceX96 for limit orders
   */
  priceToSqrtPriceX96(price: bigint): bigint {
    const Q96 = UNISWAP_V4_CONSTANTS.Q96;
    // sqrtPriceX96 = sqrt(price * 2^192 / 10^18)
    const priceX192 = (price * Q96 * Q96) / PRICE_CONSTANTS.PRECISION;
    return this.sqrt(priceX192);
  }

  /**
   * Integer square root using Newton's method
   */
  private sqrt(x: bigint): bigint {
    if (x === 0n) return 0n;
    let z = x;
    let y = (z + 1n) / 2n;
    while (y < z) {
      z = y;
      y = (z + x / z) / 2n;
    }
    return z;
  }

  /**
   * Quote exact input swap
   */
  async quoteExactInput(
    tokenIn: string,
    tokenOut: string,
    amountIn: bigint,
    fee: number
  ): Promise<{
    amountOut: bigint;
    priceImpact: bigint;
    gasEstimate: bigint;
  }> {
    try {
      const result = await this.client.simulateContract({
        address: this.quoterAddress,
        abi: QUOTER_ABI,
        functionName: 'quoteExactInputSingle',
        args: [
          {
            tokenIn: tokenIn as `0x${string}`,
            tokenOut: tokenOut as `0x${string}`,
            amountIn,
            fee,
            sqrtPriceLimitX96: 0n, // No limit
          },
        ],
      });

      const [amountOut, sqrtPriceX96After, , gasEstimate] = result.result as [bigint, bigint, number, bigint];

      // Calculate price impact
      const effectivePrice = (amountOut * PRICE_CONSTANTS.PRECISION) / amountIn;

      return {
        amountOut,
        priceImpact: effectivePrice,
        gasEstimate,
      };
    } catch (error) {
      console.error('Quote failed:', error);
      throw error;
    }
  }

  /**
   * Get a price quote for the arbitrage system
   */
  async getPriceQuote(poolKey: UniswapV4PoolKey): Promise<PriceQuote> {
    const state = await this.getPoolState(poolKey);

    return {
      price: state.price,
      timestamp: Date.now(),
      source: 'uniswap',
      liquidity: state.liquidity,
    };
  }

  /**
   * Calculate optimal trade size based on liquidity
   */
  calculateOptimalSize(
    liquidity: bigint,
    sqrtPriceX96: bigint,
    maxSlippageBps: number
  ): bigint {
    // Approximate: larger liquidity = larger optimal trade
    // This is simplified; real implementation would use tick math
    const Q96 = UNISWAP_V4_CONSTANTS.Q96;
    const maxSlippage = BigInt(maxSlippageBps);

    // Rough estimate: trade size that moves price by maxSlippage
    const optimalSize = (liquidity * maxSlippage * sqrtPriceX96) / (Q96 * 10000n);

    return optimalSize;
  }

  /**
   * Get tick at a given price
   */
  priceToTick(price: bigint): number {
    // tick = log_1.0001(price)
    // Simplified: tick ≈ log(price) / log(1.0001)
    const priceFloat = Number(price) / Number(PRICE_CONSTANTS.PRECISION);
    const tick = Math.floor(Math.log(priceFloat) / Math.log(1.0001));
    return tick;
  }

  /**
   * Get price at a given tick
   */
  tickToPrice(tick: number): bigint {
    // price = 1.0001^tick
    const priceFloat = Math.pow(1.0001, tick);
    return BigInt(Math.floor(priceFloat * Number(PRICE_CONSTANTS.PRECISION)));
  }
}

export default UniswapV4Oracle;
