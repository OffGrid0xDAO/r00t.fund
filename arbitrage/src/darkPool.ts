import { createPublicClient, http, type PublicClient, parseAbi, keccak256, encodeAbiParameters } from 'viem';
import { base } from 'viem/chains';
import { DARK_POOL_CONSTANTS, PRICE_CONSTANTS } from './config';
import type { PriceQuote, Commitment, Position } from './types';

// ZkAMM / ZkAMMPair ABI
const ZKAMM_ABI = parseAbi([
  // View functions
  'function hiddenReserve() external view returns (uint256)',
  'function tokenReserve() external view returns (uint256)',
  'function getAmountOut(uint256 amountIn, uint256 reserveIn, uint256 reserveOut) external view returns (uint256)',
  'function getTokenPrice() external view returns (uint256)',
  'function getHiddenPrice() external view returns (uint256)',
  'function getReserves() external view returns (uint256 hiddenReserve, uint256 tokenReserve)',
  'function FEE_BPS() external view returns (uint256)',
  'function FEE_DENOMINATOR() external view returns (uint256)',
  'function nullifiers(uint256) external view returns (bool)',

  // TokenPool functions
  'function projectTokenPool() external view returns (address)',

  // Events for tracking commitments
  'event NewCommitment(uint256 indexed commitment, uint256 indexed leafIndex, bytes encryptedNote)',
  'event NullifierSpent(uint256 indexed nullifierHash)',
]);

// TokenPool ABI
const TOKEN_POOL_ABI = parseAbi([
  'function root() external view returns (uint256)',
  'function isKnownRoot(uint256 root) external view returns (bool)',
  'function getNextIndex() external view returns (uint256)',
  'function filledSubtrees(uint256 index) external view returns (uint256)',
  'function roots(uint256 index) external view returns (uint256)',
]);

export class DarkPoolOracle {
  private client: PublicClient;
  private darkPoolAddress: `0x${string}`;
  private tokenPoolAddress?: `0x${string}`;

  constructor(rpcUrl: string, darkPoolAddress: string) {
    this.client = createPublicClient({
      chain: base,
      transport: http(rpcUrl),
    });
    this.darkPoolAddress = darkPoolAddress as `0x${string}`;
  }

  /**
   * Initialize by fetching token pool address
   */
  async initialize(): Promise<void> {
    try {
      const poolAddress = await this.client.readContract({
        address: this.darkPoolAddress,
        abi: ZKAMM_ABI,
        functionName: 'projectTokenPool',
      });
      this.tokenPoolAddress = poolAddress as `0x${string}`;
    } catch {
      // Might be the old ZkAMM contract without projectTokenPool
      console.log('Could not fetch projectTokenPool - using legacy mode');
    }
  }

  /**
   * Get current pool state
   */
  async getPoolState(): Promise<{
    hiddenReserve: bigint;
    tokenReserve: bigint;
    price: bigint;
    feeBps: number;
  }> {
    const [reserves, price, feeBps] = await Promise.all([
      this.client.readContract({
        address: this.darkPoolAddress,
        abi: ZKAMM_ABI,
        functionName: 'getReserves',
      }),
      this.client.readContract({
        address: this.darkPoolAddress,
        abi: ZKAMM_ABI,
        functionName: 'getTokenPrice',
      }),
      this.client.readContract({
        address: this.darkPoolAddress,
        abi: ZKAMM_ABI,
        functionName: 'FEE_BPS',
      }),
    ]);

    const [hiddenReserve, tokenReserve] = reserves as [bigint, bigint];

    return {
      hiddenReserve,
      tokenReserve,
      price: price as bigint,
      feeBps: Number(feeBps),
    };
  }

  /**
   * Calculate output for a given input using constant product formula
   */
  async getAmountOut(
    amountIn: bigint,
    direction: 'hidden_to_token' | 'token_to_hidden'
  ): Promise<bigint> {
    const state = await this.getPoolState();

    const reserveIn = direction === 'hidden_to_token' ? state.hiddenReserve : state.tokenReserve;
    const reserveOut = direction === 'hidden_to_token' ? state.tokenReserve : state.hiddenReserve;

    // x * y = k formula with fee
    const amountInWithFee = amountIn * (DARK_POOL_CONSTANTS.FEE_DENOMINATOR - BigInt(state.feeBps));
    const numerator = amountInWithFee * reserveOut;
    const denominator = reserveIn * DARK_POOL_CONSTANTS.FEE_DENOMINATOR + amountInWithFee;

    return numerator / denominator;
  }

  /**
   * Calculate price impact for a trade
   */
  async getPriceImpact(amountIn: bigint, direction: 'hidden_to_token' | 'token_to_hidden'): Promise<number> {
    const state = await this.getPoolState();
    const amountOut = await this.getAmountOut(amountIn, direction);

    // Current price vs effective price
    const currentPrice = state.price;
    const effectivePrice =
      direction === 'hidden_to_token'
        ? (amountOut * PRICE_CONSTANTS.PRECISION) / amountIn
        : (amountIn * PRICE_CONSTANTS.PRECISION) / amountOut;

    const impact = Number(((currentPrice - effectivePrice) * 10000n) / currentPrice);
    return Math.abs(impact);
  }

  /**
   * Get price quote for arbitrage system
   */
  async getPriceQuote(): Promise<PriceQuote> {
    const state = await this.getPoolState();

    return {
      price: state.price,
      timestamp: Date.now(),
      source: 'darkpool',
      liquidity: state.tokenReserve, // Use token reserve as liquidity indicator
    };
  }

  /**
   * Get current merkle root
   */
  async getMerkleRoot(): Promise<bigint> {
    if (!this.tokenPoolAddress) {
      throw new Error('Token pool not initialized');
    }

    const root = await this.client.readContract({
      address: this.tokenPoolAddress,
      abi: TOKEN_POOL_ABI,
      functionName: 'root',
    });

    return root as bigint;
  }

  /**
   * Check if a nullifier has been spent
   */
  async isNullifierSpent(nullifierHash: bigint): Promise<boolean> {
    const spent = await this.client.readContract({
      address: this.darkPoolAddress,
      abi: ZKAMM_ABI,
      functionName: 'nullifiers',
      args: [nullifierHash],
    });

    return spent as boolean;
  }

  /**
   * Watch for new commitments (for tracking private balance)
   */
  watchCommitments(callback: (commitment: bigint, leafIndex: bigint, encryptedNote: string) => void): () => void {
    const unwatch = this.client.watchContractEvent({
      address: this.darkPoolAddress,
      abi: ZKAMM_ABI,
      eventName: 'NewCommitment',
      onLogs: (logs) => {
        for (const log of logs) {
          const { commitment, leafIndex, encryptedNote } = log.args as {
            commitment: bigint;
            leafIndex: bigint;
            encryptedNote: string;
          };
          callback(commitment, leafIndex, encryptedNote);
        }
      },
    });

    return unwatch;
  }

  /**
   * Generate commitment from secret data
   */
  generateCommitment(nullifier: bigint, secret: bigint, amount: bigint): bigint {
    // Hash(nullifier, secret, amount) - simplified using keccak256
    // In production, use Poseidon hash
    const encoded = encodeAbiParameters(
      [{ type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }],
      [nullifier, secret, amount]
    );
    const hash = keccak256(encoded);
    return BigInt(hash) % DARK_POOL_CONSTANTS.FIELD_PRIME;
  }

  /**
   * Generate nullifier hash
   */
  generateNullifierHash(nullifier: bigint, leafIndex: number): bigint {
    const encoded = encodeAbiParameters(
      [{ type: 'uint256' }, { type: 'uint256' }],
      [nullifier, BigInt(leafIndex)]
    );
    const hash = keccak256(encoded);
    return BigInt(hash) % DARK_POOL_CONSTANTS.FIELD_PRIME;
  }

  /**
   * Calculate optimal trade size based on reserves and desired slippage
   */
  calculateOptimalSize(targetSlippageBps: number): { hiddenIn: bigint; tokenOut: bigint } {
    // For a given slippage, calculate max trade size
    // Simplified: for x*y=k, price impact ≈ amountIn / reserveIn
    // So amountIn = reserveIn * targetSlippage
    return this.client
      .readContract({
        address: this.darkPoolAddress,
        abi: ZKAMM_ABI,
        functionName: 'getReserves',
      })
      .then((reserves) => {
        const [hiddenReserve, tokenReserve] = reserves as [bigint, bigint];
        const slippageMultiplier = BigInt(targetSlippageBps);

        const hiddenIn = (hiddenReserve * slippageMultiplier) / 10000n;
        const tokenOut = this.getAmountOut(hiddenIn, 'hidden_to_token');

        return tokenOut.then((out) => ({
          hiddenIn,
          tokenOut: out,
        }));
      });
  }
}

export default DarkPoolOracle;
