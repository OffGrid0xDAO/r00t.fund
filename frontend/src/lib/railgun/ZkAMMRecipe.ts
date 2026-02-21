/**
 * ZkAMM Recipe for Railgun Cookbook
 *
 * This recipe enables anonymous buying and selling on ZkAMM
 * by wrapping the transaction in Railgun's privacy layer:
 *
 * Buy Flow:
 * 1. Unshield WETH from private balance
 * 2. Unwrap WETH to ETH
 * 3. Call buyPrivate() on ZkAMM
 * 4. Receive private commitment (automatically shielded in ZkAMM)
 *
 * Sell Flow:
 * 1. Generate ZK proof for token ownership
 * 2. Call sellPrivate() on ZkAMM
 * 3. Shield received ETH back into Railgun
 */

import { encodeFunctionData, type Address, type Hex } from 'viem';

// ZkAMM contract ABI for trading functions
export const ZKAMM_ABI = [
  {
    name: 'buyPrivate',
    type: 'function',
    stateMutability: 'payable',
    inputs: [
      { name: 'newCommitment', type: 'uint256' },
      { name: 'minTokensOut', type: 'uint256' },
      { name: 'deadline', type: 'uint256' },
      { name: 'encryptedNote', type: 'bytes' }
    ],
    outputs: []
  },
  {
    name: 'sellPrivate',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'proof', type: 'uint256[8]' },
      { name: 'merkleRoot', type: 'uint256' },
      { name: 'nullifierHash', type: 'uint256' },
      { name: 'tokenAmount', type: 'uint256' },
      { name: 'minEthOut', type: 'uint256' },
      { name: 'recipient', type: 'address' },
      { name: 'relayer', type: 'address' },
      { name: 'fee', type: 'uint256' },
      { name: 'changeCommitment', type: 'uint256' },
      { name: 'deadline', type: 'uint256' },
      { name: 'changeNote', type: 'bytes' }
    ],
    outputs: []
  },
  {
    name: 'getAmountOut',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'amountIn', type: 'uint256' },
      { name: 'reserveIn', type: 'uint256' },
      { name: 'reserveOut', type: 'uint256' }
    ],
    outputs: [{ type: 'uint256' }]
  },
  {
    name: 'ethReserve',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint256' }]
  },
  {
    name: 'tokenReserve',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint256' }]
  }
] as const;

// WETH ABI for wrapping/unwrapping
export const WETH_ABI = [
  {
    name: 'deposit',
    type: 'function',
    stateMutability: 'payable',
    inputs: [],
    outputs: []
  },
  {
    name: 'withdraw',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'amount', type: 'uint256' }],
    outputs: []
  },
  {
    name: 'approve',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' }
    ],
    outputs: [{ type: 'bool' }]
  }
] as const;

// Railgun Relay Adapt ABI for cross-contract calls
export const RELAY_ADAPT_ABI = [
  {
    name: 'relay',
    type: 'function',
    stateMutability: 'payable',
    inputs: [
      { name: 'calls', type: 'tuple[]', components: [
        { name: 'to', type: 'address' },
        { name: 'data', type: 'bytes' },
        { name: 'value', type: 'uint256' }
      ]}
    ],
    outputs: []
  }
] as const;

export interface CrossContractCall {
  to: Address;
  data: Hex;
  value: bigint;
}

export interface RecipeInput {
  networkName: string;
  zkAMMAddress: Address;
  wethAddress: Address;
  relayAdaptAddress: Address;
  ethAmount: bigint;
  minTokensOut: bigint;
  deadline: bigint;
  commitment: bigint;
  encryptedNote: Hex;
}

export interface RecipeOutput {
  crossContractCalls: CrossContractCall[];
  totalValue: bigint;
  unshieldAmount: bigint;
  estimatedTokensOut: bigint;
}

/**
 * ZkAMM Buy Recipe
 *
 * Creates cross-contract calls for buying tokens anonymously:
 * 1. Unwrap WETH to ETH (from unshielded balance)
 * 2. Buy tokens on ZkAMM with ETH
 *
 * The result (token commitment) is stored privately in ZkAMM.
 */
export class ZkAMMBuyRecipe {
  private zkAMMAddress: Address;
  private wethAddress: Address;

  constructor(
    zkAMMAddress: Address,
    wethAddress: Address,
    _slippagePercent: number = 1
  ) {
    this.zkAMMAddress = zkAMMAddress;
    this.wethAddress = wethAddress;
  }

  /**
   * Generate cross-contract calls for the buy recipe
   *
   * @param input Recipe input parameters
   * @returns Array of cross-contract calls and metadata
   */
  getRecipeOutput(input: RecipeInput): RecipeOutput {
    const { ethAmount, minTokensOut, deadline, commitment, encryptedNote } = input;

    // Calculate unshield fee (0.25%)
    const unshieldFee = ethAmount * 25n / 10000n;
    const unshieldAmount = ethAmount + unshieldFee;

    // Step 1: Unwrap WETH to ETH
    const unwrapCall: CrossContractCall = {
      to: this.wethAddress,
      data: encodeFunctionData({
        abi: WETH_ABI,
        functionName: 'withdraw',
        args: [ethAmount]
      }),
      value: 0n
    };

    // Step 2: Buy tokens on ZkAMM
    const buyCall: CrossContractCall = {
      to: this.zkAMMAddress,
      data: encodeFunctionData({
        abi: ZKAMM_ABI,
        functionName: 'buyPrivate',
        args: [commitment, minTokensOut, deadline, encryptedNote]
      }),
      value: ethAmount
    };

    return {
      crossContractCalls: [unwrapCall, buyCall],
      totalValue: ethAmount,
      unshieldAmount,
      estimatedTokensOut: minTokensOut // Caller should calculate this from reserves
    };
  }
}

/**
 * ZkAMM Sell Recipe
 *
 * Creates cross-contract calls for selling tokens anonymously:
 * 1. Call sellPrivate on ZkAMM (uses ZK proof)
 * 2. Wrap received ETH to WETH
 *
 * The ETH is then re-shielded back into Railgun.
 */
export class ZkAMMSellRecipe {
  private zkAMMAddress: Address;
  private wethAddress: Address;

  constructor(
    zkAMMAddress: Address,
    wethAddress: Address,
    _slippagePercent: number = 1
  ) {
    this.zkAMMAddress = zkAMMAddress;
    this.wethAddress = wethAddress;
  }

  /**
   * Generate cross-contract calls for the sell recipe
   *
   * Note: The sellPrivate call requires a ZK proof which must be generated
   * by the caller using the ZkAMM's proof system.
   *
   * @param input Sell recipe input parameters
   * @returns Array of cross-contract calls
   */
  getRecipeOutput(input: {
    proof: readonly [bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint];
    merkleRoot: bigint;
    nullifierHash: bigint;
    tokenAmount: bigint;
    minEthOut: bigint;
    recipient: Address;
    changeCommitment: bigint;
    deadline: bigint;
    changeNote: Hex;
  }): { crossContractCalls: CrossContractCall[]; estimatedEthOut: bigint } {
    const {
      proof,
      merkleRoot,
      nullifierHash,
      tokenAmount,
      minEthOut,
      recipient,
      changeCommitment,
      deadline,
      changeNote
    } = input;

    // Step 1: Sell tokens on ZkAMM (returns ETH)
    const sellCall: CrossContractCall = {
      to: this.zkAMMAddress,
      data: encodeFunctionData({
        abi: ZKAMM_ABI,
        functionName: 'sellPrivate',
        args: [
          [...proof] as [bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint],
          merkleRoot,
          nullifierHash,
          tokenAmount,
          minEthOut,
          recipient,
          '0x0000000000000000000000000000000000000000' as Address, // no relayer
          0n, // no fee
          changeCommitment,
          deadline,
          changeNote
        ]
      }),
      value: 0n
    };

    // Step 2: Wrap received ETH to WETH (for re-shielding)
    const wrapCall: CrossContractCall = {
      to: this.wethAddress,
      data: encodeFunctionData({
        abi: WETH_ABI,
        functionName: 'deposit',
        args: []
      }),
      value: minEthOut // Will be replaced with actual received amount
    };

    return {
      crossContractCalls: [sellCall, wrapCall],
      estimatedEthOut: minEthOut
    };
  }
}

/**
 * Helper to calculate token output from ETH input
 */
export function calculateTokensOut(
  ethIn: bigint,
  ethReserve: bigint,
  tokenReserve: bigint
): bigint {
  const amountInWithFee = ethIn * 997n;
  const numerator = amountInWithFee * tokenReserve;
  const denominator = ethReserve * 1000n + amountInWithFee;
  return numerator / denominator;
}

/**
 * Helper to calculate ETH output from token input
 */
export function calculateEthOut(
  tokensIn: bigint,
  ethReserve: bigint,
  tokenReserve: bigint
): bigint {
  const amountInWithFee = tokensIn * 997n;
  const numerator = amountInWithFee * ethReserve;
  const denominator = tokenReserve * 1000n + amountInWithFee;
  return numerator / denominator;
}

/**
 * Calculate minimum output with slippage
 */
export function withSlippage(amount: bigint, slippagePercent: number): bigint {
  const slippageBps = BigInt(Math.floor(slippagePercent * 100));
  return amount * (10000n - slippageBps) / 10000n;
}
