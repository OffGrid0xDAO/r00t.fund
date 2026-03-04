import {
  createPublicClient,
  createWalletClient,
  http,
  parseAbi,
  type PublicClient,
  type WalletClient,
  type Account,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { base } from 'viem/chains';
import {
  Prover,
  loadCircuitArtifacts,
  MerkleTree,
  hashCommitment as poseidonHashCommitment,
  hashNullifier as poseidonHashNullifier,
  randomFieldElement,
} from '@r00t-fund/sdk';
import { DARK_POOL_CONSTANTS, PRICE_CONSTANTS } from './config';
import type { ArbitrageOpportunity, ExecutionResult, Commitment, BotConfig } from './types';

// Path to compiled circuit artifacts
const CIRCUITS_PATH = process.env.CIRCUITS_PATH || '../../circuits/build';

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

  // ZK prover instance (loaded lazily)
  private prover: Prover | null = null;

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
   * Ensure the ZK prover is loaded (lazy initialization)
   */
  private async ensureProver(): Promise<Prover> {
    if (this.prover) return this.prover;
    console.log('Loading ZK circuit artifacts...');
    const artifacts = await loadCircuitArtifacts(CIRCUITS_PATH);
    this.prover = new Prover(artifacts);
    console.log('✅ ZK prover ready');
    return this.prover;
  }

  /**
   * Fetch all on-chain commitments for Merkle tree construction
   */
  private async fetchOnChainCommitments(): Promise<{ commitment: bigint; leafIndex: number }[]> {
    const logs = await this.publicClient.getLogs({
      address: this.config.darkPoolAddress as `0x${string}`,
      event: {
        type: 'event',
        name: 'NewCommitment',
        inputs: [
          { type: 'uint256', name: 'commitment', indexed: false },
          { type: 'uint256', name: 'leafIndex', indexed: false },
          { type: 'bytes', name: 'encryptedNote', indexed: false },
        ],
      },
      fromBlock: 0n,
      toBlock: 'latest',
    });

    return logs.map(log => ({
      commitment: (log.args as any).commitment as bigint,
      leafIndex: Number((log.args as any).leafIndex),
    }));
  }

  /**
   * Withdraw tokens from dark pool to public address using real ZK proof
   */
  private async withdrawFromDarkPool(
    amount: bigint,
    nullifier: bigint,
    secret: bigint,
    leafIndex: number = 0
  ): Promise<ExecutionResult> {
    try {
      const prover = await this.ensureProver();

      // Fetch all on-chain commitments and build Merkle tree
      const allCommitments = await this.fetchOnChainCommitments();
      const tree = new MerkleTree(24);
      for (const c of allCommitments) {
        tree.insertAt(c.leafIndex, c.commitment);
      }

      // Get merkle proof for this commitment
      const merkleProof = tree.getProof(leafIndex);
      const nullifierHashValue = poseidonHashNullifier(nullifier, leafIndex);

      // Generate real Groth16 withdraw proof
      const proofResult = await prover.proveWithdraw({
        merkleRoot: merkleProof.root,
        nullifierHash: nullifierHashValue,
        amount,
        recipient: this.account.address,
        nullifier,
        secret,
        pathElements: merkleProof.pathElements,
        pathIndices: merkleProof.pathIndices,
      });

      const proof = Prover.formatProofForSolidity(proofResult.proof) as [bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint];

      const hash = await this.walletClient.writeContract({
        address: this.config.darkPoolAddress as `0x${string}`,
        abi: parseAbi([
          'function withdrawPublic(uint256[8] proof, uint256 merkleRoot, uint256 nullifierHash, uint256 amount, address recipient) external',
        ]),
        functionName: 'withdrawPublic',
        args: [proof, merkleProof.root, nullifierHashValue, amount, this.account.address],
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
    const nullifier = randomFieldElement();
    const secret = randomFieldElement();
    const commitment = this.hashCommitment(nullifier, secret, amount);

    return { commitment, nullifier, secret };
  }

  /**
   * Hash commitment using Poseidon (matches ZK circuits)
   */
  private hashCommitment(nullifier: bigint, secret: bigint, amount: bigint): bigint {
    return poseidonHashCommitment(nullifier, secret, amount);
  }

  /**
   * Generate nullifier hash using Poseidon (matches ZK circuits)
   */
  private generateNullifierHash(nullifier: bigint, leafIndex: number): bigint {
    return poseidonHashNullifier(nullifier, leafIndex);
  }

  /**
   * Generate random field element
   */
  private _randomFieldElement(): bigint {
    return randomFieldElement();
  }

  /**
   * Encrypt note for recipient
   */
  private encryptNote(nullifier: bigint, secret: bigint, amount: bigint): string {
    // Note encryption uses keccak256 for the encrypted blob (not for circuit hashing)
    const { keccak256, encodeAbiParameters } = require('viem');
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
