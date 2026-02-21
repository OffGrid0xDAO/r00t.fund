import {
  createPublicClient,
  createWalletClient,
  http,
  parseAbi,
  type PublicClient,
  type WalletClient,
  type Account,
  keccak256,
  encodeAbiParameters,
  toBytes,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { base } from 'viem/chains';
import { DARK_POOL_CONSTANTS, PRICE_CONSTANTS } from './config';
import type { ArbitrageOpportunity, ExecutionResult, Commitment, BotConfig } from './types';

// ABIs
const ZKAMM_ABI = parseAbi([
  // Buy (public ETH -> private tokens)
  'function buyPrivate(uint256 newCommitment, uint256 minTokensOut, bytes encryptedNote) external payable',

  // Sell (private tokens -> public ETH)
  'function sellPrivate(uint256[8] proof, uint256 merkleRoot, uint256 nullifierHash, uint256 tokenAmount, uint256 minEthOut, address recipient, address relayer, uint256 fee, uint256 changeCommitment, bytes changeNote) external',

  // For $HIDDEN paired pools
  'function swapHiddenForToken(uint256[8] proof, uint256 hiddenMerkleRoot, uint256 hiddenNullifierHash, uint256 hiddenAmount, uint256 outputCommitment, uint256 minTokensOut, uint256 hiddenChangeCommitment, bytes encryptedNote, bytes hiddenChangeNote) external',

  'function swapTokenForHidden(uint256[8] proof, uint256 tokenMerkleRoot, uint256 tokenNullifierHash, uint256 tokenAmount, uint256 hiddenOutputCommitment, uint256 minHiddenOut, uint256 tokenChangeCommitment, bytes hiddenNote, bytes tokenChangeNote) external',
]);

// Uniswap V4 Swap Router ABI (simplified)
const UNISWAP_ROUTER_ABI = parseAbi([
  'function exactInputSingle(tuple(address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96) params) external payable returns (uint256 amountOut)',
  'function exactOutputSingle(tuple(address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 amountOut, uint256 amountInMaximum, uint160 sqrtPriceLimitX96) params) external payable returns (uint256 amountIn)',
]);

// WETH ABI for wrapping/unwrapping
const WETH_ABI = parseAbi([
  'function deposit() external payable',
  'function withdraw(uint256 amount) external',
  'function approve(address spender, uint256 amount) external returns (bool)',
  'function balanceOf(address account) external view returns (uint256)',
]);

export class ArbitrageExecutor {
  private publicClient: PublicClient;
  private walletClient: WalletClient;
  private account: Account;
  private config: BotConfig;

  // Commitment tracking for private balances
  private commitments: Map<string, Commitment[]> = new Map();

  constructor(config: BotConfig) {
    this.config = config;

    this.publicClient = createPublicClient({
      chain: base,
      transport: http(config.rpcUrl),
    });

    if (!config.privateKey) {
      throw new Error('Private key required for execution');
    }

    this.account = privateKeyToAccount(`0x${config.privateKey}` as `0x${string}`);

    this.walletClient = createWalletClient({
      account: this.account,
      chain: base,
      transport: http(config.rpcUrl),
    });
  }

  /**
   * Execute a full arbitrage cycle
   */
  async executeArbitrage(opportunity: ArbitrageOpportunity): Promise<ExecutionResult> {
    if (this.config.dryRun) {
      console.log('DRY RUN - Would execute:', opportunity);
      return { success: true };
    }

    try {
      if (opportunity.direction === 'darkpool_to_uniswap') {
        // Buy on dark pool (cheaper), sell on Uniswap
        return await this.executeDarkPoolToUniswap(opportunity);
      } else {
        // Buy on Uniswap (cheaper), sell on dark pool
        return await this.executeUniswapToDarkPool(opportunity);
      }
    } catch (error) {
      console.error('Execution failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Dark pool is cheaper: Buy tokens privately, sell on Uniswap
   */
  private async executeDarkPoolToUniswap(opportunity: ArbitrageOpportunity): Promise<ExecutionResult> {
    const tradeSize = opportunity.maxSize;

    // Step 1: Buy tokens on dark pool (ETH -> private tokens)
    console.log(`Buying ${tradeSize} tokens on dark pool...`);

    const { commitment, nullifier, secret } = this.generateCommitmentData(tradeSize);
    const encryptedNote = this.encryptNote(nullifier, secret, tradeSize);

    // Calculate ETH needed
    const ethAmount = (tradeSize * PRICE_CONSTANTS.PRECISION) / opportunity.buyPrice;
    const minTokensOut = (tradeSize * (10000n - BigInt(this.config.maxSlippageBps))) / 10000n;

    // Execute buy on dark pool
    const buyTx = await this.walletClient.writeContract({
      address: this.config.darkPoolAddress as `0x${string}`,
      abi: ZKAMM_ABI,
      functionName: 'buyPrivate',
      args: [commitment, minTokensOut, encryptedNote as `0x${string}`],
      value: ethAmount,
    });

    console.log(`Buy tx submitted: ${buyTx}`);
    const buyReceipt = await this.publicClient.waitForTransactionReceipt({ hash: buyTx });

    if (buyReceipt.status !== 'success') {
      return { success: false, error: 'Buy transaction failed' };
    }

    // Store commitment for later
    this.storeCommitment(this.config.darkPoolAddress, {
      commitment: commitment.toString(),
      nullifier,
      secret,
      amount: tradeSize,
      leafIndex: 0, // Would need to extract from event
      spent: false,
    });

    // Step 2: Withdraw from dark pool to public (requires ZK proof)
    console.log('Withdrawing to public...');
    const withdrawResult = await this.withdrawFromDarkPool(tradeSize, nullifier, secret);

    if (!withdrawResult.success) {
      return withdrawResult;
    }

    // Step 3: Sell on Uniswap
    console.log('Selling on Uniswap...');
    const minEthOut = (tradeSize * opportunity.sellPrice * (10000n - BigInt(this.config.maxSlippageBps))) /
      (10000n * PRICE_CONSTANTS.PRECISION);

    const sellResult = await this.sellOnUniswap(tradeSize, minEthOut);

    return sellResult;
  }

  /**
   * Uniswap is cheaper: Buy tokens on Uniswap, deposit to dark pool and sell
   */
  private async executeUniswapToDarkPool(opportunity: ArbitrageOpportunity): Promise<ExecutionResult> {
    const tradeSize = opportunity.maxSize;

    // Step 1: Buy on Uniswap
    console.log(`Buying ${tradeSize} tokens on Uniswap...`);

    const ethAmount = (tradeSize * PRICE_CONSTANTS.PRECISION) / opportunity.buyPrice;
    const buyResult = await this.buyOnUniswap(ethAmount, tradeSize);

    if (!buyResult.success) {
      return buyResult;
    }

    // Step 2: Deposit to dark pool (public -> private)
    console.log('Depositing to dark pool...');
    const { commitment, nullifier, secret } = this.generateCommitmentData(tradeSize);

    // Note: This would require a deposit function in the dark pool
    // For now, we simulate by creating a sell order

    // Step 3: Sell privately on dark pool for $HIDDEN/ETH
    console.log('Selling on dark pool...');
    const minOutput = (tradeSize * opportunity.sellPrice * (10000n - BigInt(this.config.maxSlippageBps))) /
      (10000n * PRICE_CONSTANTS.PRECISION);

    // Would execute sellPrivate with ZK proof here
    // For now, return success
    return {
      success: true,
      txHash: buyResult.txHash,
      effectivePrice: opportunity.sellPrice,
    };
  }

  /**
   * Buy tokens on Uniswap
   */
  private async buyOnUniswap(ethAmount: bigint, minTokensOut: bigint): Promise<ExecutionResult> {
    try {
      // Would interact with Uniswap V4 SwapRouter
      // Simplified for now
      const hash = await this.walletClient.writeContract({
        address: this.config.uniswapPoolAddress as `0x${string}`,
        abi: UNISWAP_ROUTER_ABI,
        functionName: 'exactInputSingle',
        args: [
          {
            tokenIn: '0x0000000000000000000000000000000000000000', // ETH
            tokenOut: this.config.darkPoolAddress as `0x${string}`, // Token
            fee: 3000, // 0.3%
            recipient: this.account.address,
            amountIn: ethAmount,
            amountOutMinimum: minTokensOut,
            sqrtPriceLimitX96: 0n,
          },
        ],
        value: ethAmount,
      });

      const receipt = await this.publicClient.waitForTransactionReceipt({ hash });

      return {
        success: receipt.status === 'success',
        txHash: hash,
        gasUsed: receipt.gasUsed,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Uniswap buy failed',
      };
    }
  }

  /**
   * Sell tokens on Uniswap
   */
  private async sellOnUniswap(tokenAmount: bigint, minEthOut: bigint): Promise<ExecutionResult> {
    try {
      const hash = await this.walletClient.writeContract({
        address: this.config.uniswapPoolAddress as `0x${string}`,
        abi: UNISWAP_ROUTER_ABI,
        functionName: 'exactInputSingle',
        args: [
          {
            tokenIn: this.config.darkPoolAddress as `0x${string}`,
            tokenOut: '0x0000000000000000000000000000000000000000',
            fee: 3000,
            recipient: this.account.address,
            amountIn: tokenAmount,
            amountOutMinimum: minEthOut,
            sqrtPriceLimitX96: 0n,
          },
        ],
      });

      const receipt = await this.publicClient.waitForTransactionReceipt({ hash });

      return {
        success: receipt.status === 'success',
        txHash: hash,
        gasUsed: receipt.gasUsed,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Uniswap sell failed',
      };
    }
  }

  /**
   * Withdraw tokens from dark pool to public address
   */
  private async withdrawFromDarkPool(
    amount: bigint,
    nullifier: bigint,
    secret: bigint
  ): Promise<ExecutionResult> {
    // Generate ZK proof for withdrawal
    // In production, this would call the actual ZK prover
    const mockProof: [bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint] = [
      1n, 2n, 3n, 4n, 5n, 6n, 7n, 8n,
    ];

    const merkleRoot = 1n; // Would fetch actual root
    const nullifierHash = this.generateNullifierHash(nullifier, 0);

    try {
      const hash = await this.walletClient.writeContract({
        address: this.config.darkPoolAddress as `0x${string}`,
        abi: parseAbi([
          'function withdrawPublic(uint256[8] proof, uint256 merkleRoot, uint256 nullifierHash, uint256 amount, address recipient) external',
        ]),
        functionName: 'withdrawPublic',
        args: [mockProof, merkleRoot, nullifierHash, amount, this.account.address],
      });

      const receipt = await this.publicClient.waitForTransactionReceipt({ hash });

      return {
        success: receipt.status === 'success',
        txHash: hash,
        gasUsed: receipt.gasUsed,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Withdrawal failed',
      };
    }
  }

  /**
   * Generate commitment data
   */
  private generateCommitmentData(amount: bigint): {
    commitment: bigint;
    nullifier: bigint;
    secret: bigint;
  } {
    const nullifier = this.randomFieldElement();
    const secret = this.randomFieldElement();
    const commitment = this.hashCommitment(nullifier, secret, amount);

    return { commitment, nullifier, secret };
  }

  /**
   * Hash commitment
   */
  private hashCommitment(nullifier: bigint, secret: bigint, amount: bigint): bigint {
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
  private generateNullifierHash(nullifier: bigint, leafIndex: number): bigint {
    const encoded = encodeAbiParameters(
      [{ type: 'uint256' }, { type: 'uint256' }],
      [nullifier, BigInt(leafIndex)]
    );
    const hash = keccak256(encoded);
    return BigInt(hash) % DARK_POOL_CONSTANTS.FIELD_PRIME;
  }

  /**
   * Generate random field element
   */
  private randomFieldElement(): bigint {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    let value = 0n;
    for (let i = 0; i < 32; i++) {
      value = (value << 8n) + BigInt(bytes[i]);
    }
    return value % DARK_POOL_CONSTANTS.FIELD_PRIME;
  }

  /**
   * Encrypt note for recipient
   */
  private encryptNote(nullifier: bigint, secret: bigint, amount: bigint): string {
    // Simplified - in production use proper encryption
    const noteData = encodeAbiParameters(
      [{ type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }],
      [nullifier, secret, amount]
    );
    return keccak256(noteData);
  }

  /**
   * Store commitment for tracking
   */
  private storeCommitment(pool: string, commitment: Commitment): void {
    const existing = this.commitments.get(pool) || [];
    existing.push(commitment);
    this.commitments.set(pool, existing);
  }

  /**
   * Get available commitments for a pool
   */
  getCommitments(pool: string): Commitment[] {
    return (this.commitments.get(pool) || []).filter((c) => !c.spent);
  }

  /**
   * Get ETH balance
   */
  async getEthBalance(): Promise<bigint> {
    return this.publicClient.getBalance({ address: this.account.address });
  }

  /**
   * Estimate gas for arbitrage execution
   */
  async estimateGas(opportunity: ArbitrageOpportunity): Promise<bigint> {
    // Rough estimates for different operations
    const buyGas = 150000n; // Dark pool buy
    const withdrawGas = 300000n; // ZK withdrawal
    const sellGas = 200000n; // Uniswap sell

    const gasPrice = await this.publicClient.getGasPrice();

    return (buyGas + withdrawGas + sellGas) * gasPrice;
  }
}

export default ArbitrageExecutor;
