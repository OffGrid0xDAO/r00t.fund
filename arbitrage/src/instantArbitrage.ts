/**
 * Instant Arbitrage - Inventory-Based Market Making
 *
 * Instead of: Buy → ZK Proof → Withdraw → Sell (slow, risky)
 * We do: Sell public inventory immediately, rebalance later
 *
 * Requires holding inventory on BOTH sides:
 * - Public ETH + tokens (for Uniswap)
 * - Private commitments (for dark pool)
 *
 * This eliminates the ZK proof latency from the critical path.
 */

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
  hashCommitment,
  hashNullifier,
  randomFieldElement,
} from '@r00t-fund/sdk';
import { PRICE_CONSTANTS } from './config';
import type { BotConfig, Commitment, ArbitrageOpportunity } from './types';

// Path to compiled circuit artifacts
const CIRCUITS_PATH = process.env.CIRCUITS_PATH || '../../circuits/build';

interface Inventory {
  // Public side (Uniswap ready)
  publicEth: bigint;
  publicTokens: bigint;

  // Private side (Dark pool ready)
  privateCommitments: Commitment[];
  privateTotalBalance: bigint;

  // Target allocations
  targetPublicEth: bigint;
  targetPublicTokens: bigint;
  targetPrivateBalance: bigint;
}

interface InstantTrade {
  id: string;
  direction: 'buy_dark_sell_uni' | 'buy_uni_sell_dark';
  size: bigint;
  entryPrice: bigint;
  exitPrice: bigint;
  profit: bigint;
  timestamp: number;
}

export class InstantArbitrageBot {
  private config: BotConfig;
  private publicClient: PublicClient;
  private walletClient: WalletClient;
  private account: Account;

  private inventory: Inventory;
  private pendingRebalance: boolean = false;
  private trades: InstantTrade[] = [];

  // Pre-generated proofs for instant withdrawal
  private precomputedProofs: Map<string, {
    proof: bigint[];
    nullifierHash: bigint;
    merkleRoot: bigint;
    commitment: Commitment;
  }> = new Map();

  // ZK prover instance (loaded lazily)
  private prover: Prover | null = null;

  constructor(config: BotConfig) {
    this.config = config;

    this.publicClient = createPublicClient({
      chain: base,
      transport: http(config.rpcUrl),
    });

    this.account = privateKeyToAccount(`0x${config.privateKey}` as `0x${string}`);

    this.walletClient = createWalletClient({
      account: this.account,
      chain: base,
      transport: http(config.rpcUrl),
    });

    // Initialize empty inventory
    this.inventory = {
      publicEth: 0n,
      publicTokens: 0n,
      privateCommitments: [],
      privateTotalBalance: 0n,
      targetPublicEth: config.maxPositionSize / 2n,
      targetPublicTokens: config.maxPositionSize / 2n,
      targetPrivateBalance: config.maxPositionSize / 2n,
    };
  }

  /**
   * INSTANT EXECUTION - No ZK proof in critical path
   *
   * When dark pool is cheaper:
   * 1. IMMEDIATELY sell public tokens on Uniswap (we already have them)
   * 2. IMMEDIATELY buy on dark pool to replenish private inventory
   * 3. Later: rebalance by withdrawing from dark pool (async, not time-critical)
   */
  async executeInstant(opportunity: ArbitrageOpportunity): Promise<{
    success: boolean;
    profit: bigint;
    txHash?: string;
  }> {
    const size = opportunity.maxSize;

    if (opportunity.direction === 'darkpool_to_uniswap') {
      // Dark pool cheaper: we want to "buy dark, sell uni"
      // But we do it with INVENTORY:

      // Step 1: Check we have public tokens to sell
      if (this.inventory.publicTokens < size) {
        console.log('Insufficient public token inventory');
        return { success: false, profit: 0n };
      }

      // Step 2: INSTANT - Sell tokens on Uniswap
      console.log('⚡ INSTANT: Selling tokens on Uniswap...');
      const sellResult = await this.sellOnUniswapInstant(size, opportunity.sellPrice);

      if (!sellResult.success) {
        return { success: false, profit: 0n };
      }

      // Step 3: INSTANT - Buy on dark pool to replenish
      console.log('⚡ INSTANT: Buying on dark pool...');
      const buyResult = await this.buyOnDarkPoolInstant(sellResult.ethReceived, opportunity.buyPrice);

      // Calculate actual profit
      const profit = sellResult.ethReceived - buyResult.ethSpent;

      // Update inventory
      this.inventory.publicTokens -= size;
      this.inventory.publicEth += profit;
      // Private balance increased (new commitment created)

      // Schedule async rebalance
      this.scheduleRebalance();

      return {
        success: true,
        profit,
        txHash: sellResult.txHash,
      };

    } else {
      // Uniswap cheaper: "buy uni, sell dark"

      // Step 1: Check we have private balance to sell
      if (this.inventory.privateTotalBalance < size) {
        console.log('Insufficient private inventory');
        return { success: false, profit: 0n };
      }

      // Step 2: Check we have pre-computed proof ready
      const readyProof = this.getReadyProof(size);
      if (!readyProof) {
        console.log('No pre-computed proof available - falling back to async');
        return { success: false, profit: 0n };
      }

      // Step 3: INSTANT - Sell on dark pool using pre-computed proof
      console.log('⚡ INSTANT: Selling on dark pool with pre-computed proof...');
      const sellResult = await this.sellOnDarkPoolInstant(readyProof, size);

      if (!sellResult.success) {
        return { success: false, profit: 0n };
      }

      // Step 4: INSTANT - Buy on Uniswap
      console.log('⚡ INSTANT: Buying on Uniswap...');
      const buyResult = await this.buyOnUniswapInstant(size, opportunity.buyPrice);

      const profit = sellResult.ethReceived - buyResult.ethSpent;

      // Update inventory
      this.inventory.publicTokens += size;
      this.inventory.privateTotalBalance -= size;

      // Mark commitment as spent
      readyProof.commitment.spent = true;

      // Schedule async rebalance
      this.scheduleRebalance();

      return {
        success: true,
        profit,
        txHash: sellResult.txHash,
      };
    }
  }

  /**
   * Sell tokens on Uniswap - INSTANT (we already have tokens)
   */
  private async sellOnUniswapInstant(
    tokenAmount: bigint,
    expectedPrice: bigint
  ): Promise<{ success: boolean; ethReceived: bigint; txHash?: string }> {
    try {
      const minEthOut = (tokenAmount * expectedPrice * 99n) / (100n * PRICE_CONSTANTS.PRECISION);

      // Direct swap - no waiting for deposits/withdrawals
      const hash = await this.walletClient.writeContract({
        address: this.config.uniswapPoolAddress as `0x${string}`,
        abi: parseAbi([
          'function exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96)) external returns (uint256 amountOut)',
        ]),
        functionName: 'exactInputSingle',
        args: [{
          tokenIn: this.config.darkPoolAddress as `0x${string}`,
          tokenOut: '0x0000000000000000000000000000000000000000' as `0x${string}`,
          fee: 3000,
          recipient: this.account.address,
          amountIn: tokenAmount,
          amountOutMinimum: minEthOut,
          sqrtPriceLimitX96: 0n,
        }],
      });

      const receipt = await this.publicClient.waitForTransactionReceipt({ hash });

      // Parse actual ETH received from logs
      const ethReceived = minEthOut; // Simplified - would parse from receipt

      return {
        success: receipt.status === 'success',
        ethReceived,
        txHash: hash,
      };
    } catch (error) {
      console.error('Uniswap sell failed:', error);
      return { success: false, ethReceived: 0n };
    }
  }

  /**
   * Buy on dark pool - INSTANT (just sending ETH)
   */
  private async buyOnDarkPoolInstant(
    ethAmount: bigint,
    expectedPrice: bigint
  ): Promise<{ success: boolean; ethSpent: bigint; txHash?: string }> {
    try {
      // Generate new commitment for the tokens we're buying
      const nullifier = this._randomFieldElement();
      const secret = this._randomFieldElement();
      const expectedTokens = (ethAmount * expectedPrice) / PRICE_CONSTANTS.PRECISION;
      const commitment = this._hashCommitment(nullifier, secret, expectedTokens);

      const minTokensOut = (expectedTokens * 99n) / 100n;

      const hash = await this.walletClient.writeContract({
        address: this.config.darkPoolAddress as `0x${string}`,
        abi: parseAbi([
          'function buyPrivate(uint256 newCommitment, uint256 minTokensOut, bytes encryptedNote) external payable',
        ]),
        functionName: 'buyPrivate',
        args: [commitment, minTokensOut, '0x' as `0x${string}`],
        value: ethAmount,
      });

      const receipt = await this.publicClient.waitForTransactionReceipt({ hash });

      if (receipt.status === 'success') {
        // Store new commitment
        const newCommitment: Commitment = {
          commitment: commitment.toString(),
          nullifier,
          secret,
          amount: expectedTokens,
          leafIndex: 0, // Would extract from event
          spent: false,
        };

        this.inventory.privateCommitments.push(newCommitment);
        this.inventory.privateTotalBalance += expectedTokens;

        // Pre-compute proof for this commitment (async, for future use)
        this.precomputeProof(newCommitment);
      }

      return {
        success: receipt.status === 'success',
        ethSpent: ethAmount,
        txHash: hash,
      };
    } catch (error) {
      console.error('Dark pool buy failed:', error);
      return { success: false, ethSpent: 0n };
    }
  }

  /**
   * Buy on Uniswap - INSTANT
   */
  private async buyOnUniswapInstant(
    tokenAmount: bigint,
    expectedPrice: bigint
  ): Promise<{ success: boolean; ethSpent: bigint; txHash?: string }> {
    try {
      const maxEthIn = (tokenAmount * PRICE_CONSTANTS.PRECISION * 101n) / (expectedPrice * 100n);

      const hash = await this.walletClient.writeContract({
        address: this.config.uniswapPoolAddress as `0x${string}`,
        abi: parseAbi([
          'function exactOutputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 amountOut, uint256 amountInMaximum, uint160 sqrtPriceLimitX96)) external payable returns (uint256 amountIn)',
        ]),
        functionName: 'exactOutputSingle',
        args: [{
          tokenIn: '0x0000000000000000000000000000000000000000' as `0x${string}`,
          tokenOut: this.config.darkPoolAddress as `0x${string}`,
          fee: 3000,
          recipient: this.account.address,
          amountOut: tokenAmount,
          amountInMaximum: maxEthIn,
          sqrtPriceLimitX96: 0n,
        }],
        value: maxEthIn,
      });

      const receipt = await this.publicClient.waitForTransactionReceipt({ hash });

      return {
        success: receipt.status === 'success',
        ethSpent: maxEthIn, // Simplified
        txHash: hash,
      };
    } catch (error) {
      console.error('Uniswap buy failed:', error);
      return { success: false, ethSpent: 0n };
    }
  }

  /**
   * Sell on dark pool using PRE-COMPUTED proof - INSTANT
   */
  private async sellOnDarkPoolInstant(
    proofData: {
      proof: bigint[];
      nullifierHash: bigint;
      merkleRoot: bigint;
      commitment: Commitment;
    },
    tokenAmount: bigint
  ): Promise<{ success: boolean; ethReceived: bigint; txHash?: string }> {
    try {
      const proof = proofData.proof as [bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint];

      const hash = await this.walletClient.writeContract({
        address: this.config.darkPoolAddress as `0x${string}`,
        abi: parseAbi([
          'function sellPrivate(uint256[8] proof, uint256 merkleRoot, uint256 nullifierHash, uint256 tokenAmount, uint256 minEthOut, address recipient, address relayer, uint256 fee, uint256 changeCommitment, bytes changeNote) external',
        ]),
        functionName: 'sellPrivate',
        args: [
          proof,
          proofData.merkleRoot,
          proofData.nullifierHash,
          tokenAmount,
          0n, // minEthOut - would calculate properly
          this.account.address,
          '0x0000000000000000000000000000000000000000' as `0x${string}`,
          0n,
          0n,
          '0x' as `0x${string}`,
        ],
      });

      const receipt = await this.publicClient.waitForTransactionReceipt({ hash });

      return {
        success: receipt.status === 'success',
        ethReceived: tokenAmount, // Simplified
        txHash: hash,
      };
    } catch (error) {
      console.error('Dark pool sell failed:', error);
      return { success: false, ethReceived: 0n };
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
   * PRE-COMPUTE proofs in background for instant use later
   * This is the key optimization - we generate proofs BEFORE we need them
   */
  private async precomputeProof(commitment: Commitment): Promise<void> {
    console.log('🔄 Pre-computing sell proof for commitment...');

    // Generate proofs in background, not blocking trades
    setTimeout(async () => {
      try {
        const prover = await this.ensureProver();

        // Fetch all on-chain commitments to build Merkle tree
        const allCommitments = await this.fetchOnChainCommitments();

        // Build Merkle tree
        const tree = new MerkleTree(24);
        for (const c of allCommitments) {
          tree.insertAt(c.leafIndex, c.commitment);
        }

        // Get merkle proof for this commitment
        const merkleProof = tree.getProof(commitment.leafIndex);

        // Compute nullifier hash using Poseidon (matches the circuit)
        const nullifierHashValue = hashNullifier(commitment.nullifier, commitment.leafIndex);

        // Generate real Groth16 sell proof
        const proofResult = await prover.proveSell({
          merkleRoot: merkleProof.root,
          nullifierHash: nullifierHashValue,
          tokenAmount: commitment.amount,
          minEthOut: 0n,
          recipient: this.account.address,
          relayer: '0x0000000000000000000000000000000000000000',
          fee: 0n,
          changeCommitment: 0n,
          nullifier: commitment.nullifier,
          secret: commitment.secret,
          amount: commitment.amount,
          pathElements: merkleProof.pathElements,
          pathIndices: merkleProof.pathIndices,
          changeNullifier: 0n,
          changeSecret: 0n,
        });

        const proof = Prover.formatProofForSolidity(proofResult.proof);

        // Store for instant use
        this.precomputedProofs.set(commitment.commitment, {
          proof,
          nullifierHash: nullifierHashValue,
          merkleRoot: merkleProof.root,
          commitment,
        });

        console.log('✅ Real Groth16 proof pre-computed and ready');
      } catch (error) {
        console.error('Proof pre-computation failed:', error);
      }
    }, 100); // Start async immediately
  }

  /**
   * Get a ready proof for the given size
   */
  private getReadyProof(size: bigint): {
    proof: bigint[];
    nullifierHash: bigint;
    merkleRoot: bigint;
    commitment: Commitment;
  } | null {
    // Find a commitment with pre-computed proof that covers the size
    for (const [key, proofData] of this.precomputedProofs) {
      if (!proofData.commitment.spent && proofData.commitment.amount >= size) {
        return proofData;
      }
    }
    return null;
  }

  /**
   * Generate a real Groth16 sell proof for a commitment
   */
  private async generateProof(commitment: Commitment): Promise<bigint[]> {
    const prover = await this.ensureProver();
    const allCommitments = await this.fetchOnChainCommitments();

    const tree = new MerkleTree(24);
    for (const c of allCommitments) {
      tree.insertAt(c.leafIndex, c.commitment);
    }

    const merkleProof = tree.getProof(commitment.leafIndex);
    const nullifierHashValue = hashNullifier(commitment.nullifier, commitment.leafIndex);

    const proofResult = await prover.proveSell({
      merkleRoot: merkleProof.root,
      nullifierHash: nullifierHashValue,
      tokenAmount: commitment.amount,
      minEthOut: 0n,
      recipient: this.account.address,
      relayer: '0x0000000000000000000000000000000000000000',
      fee: 0n,
      changeCommitment: 0n,
      nullifier: commitment.nullifier,
      secret: commitment.secret,
      amount: commitment.amount,
      pathElements: merkleProof.pathElements,
      pathIndices: merkleProof.pathIndices,
      changeNullifier: 0n,
      changeSecret: 0n,
    });

    return Prover.formatProofForSolidity(proofResult.proof);
  }

  /**
   * Schedule rebalancing of inventory (async, not time-critical)
   */
  private scheduleRebalance(): void {
    if (this.pendingRebalance) return;

    this.pendingRebalance = true;

    // Rebalance after a delay - this is NOT time-critical
    setTimeout(async () => {
      await this.rebalanceInventory();
      this.pendingRebalance = false;
    }, 60000); // Rebalance every minute
  }

  /**
   * Rebalance inventory to maintain target allocations
   */
  private async rebalanceInventory(): Promise<void> {
    console.log('🔄 Rebalancing inventory...');

    const publicTokenDelta = this.inventory.targetPublicTokens - this.inventory.publicTokens;
    const privateDelta = this.inventory.targetPrivateBalance - this.inventory.privateTotalBalance;

    // If we need more public tokens, withdraw from dark pool
    if (publicTokenDelta > 0n && this.inventory.privateTotalBalance > publicTokenDelta) {
      // This is where we do the slow ZK withdrawal - but we're NOT in a hurry
      console.log(`Withdrawing ${publicTokenDelta} tokens from dark pool...`);
      // await this.withdrawFromDarkPool(publicTokenDelta);
    }

    // If we need more private balance, deposit to dark pool
    if (privateDelta > 0n && this.inventory.publicTokens > privateDelta) {
      console.log(`Depositing ${privateDelta} tokens to dark pool...`);
      // await this.depositToDarkPool(privateDelta);
    }

    // Pre-compute proofs for all unspent commitments
    for (const commitment of this.inventory.privateCommitments) {
      if (!commitment.spent && !this.precomputedProofs.has(commitment.commitment)) {
        this.precomputeProof(commitment);
      }
    }

    console.log('✅ Rebalance complete');
  }

  /**
   * Initialize inventory from on-chain state
   */
  async initializeInventory(): Promise<void> {
    console.log('Initializing inventory...');

    // Fetch public balances
    this.inventory.publicEth = await this.publicClient.getBalance({
      address: this.account.address,
    });

    // Fetch token balance
    const tokenBalance = await this.publicClient.readContract({
      address: this.config.darkPoolAddress as `0x${string}`,
      abi: parseAbi(['function balanceOf(address) view returns (uint256)']),
      functionName: 'balanceOf',
      args: [this.account.address],
    });
    this.inventory.publicTokens = tokenBalance as bigint;

    // Private commitments would be loaded from local storage/database
    // and verified against on-chain state

    console.log('Inventory initialized:');
    console.log(`  Public ETH: ${Number(this.inventory.publicEth) / 1e18}`);
    console.log(`  Public Tokens: ${Number(this.inventory.publicTokens) / 1e18}`);
    console.log(`  Private Balance: ${Number(this.inventory.privateTotalBalance) / 1e18}`);
  }

  // Helper functions — use SDK's Poseidon hashing (matches ZK circuits)
  private _randomFieldElement(): bigint {
    return randomFieldElement();
  }

  private _hashCommitment(nullifier: bigint, secret: bigint, amount: bigint): bigint {
    return hashCommitment(nullifier, secret, amount);
  }

  private _hashNullifier(nullifier: bigint, leafIndex: number): bigint {
    return hashNullifier(nullifier, leafIndex);
  }
}

export default InstantArbitrageBot;
