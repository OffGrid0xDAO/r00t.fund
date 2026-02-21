/**
 * Railgun Cookbook Service
 *
 * Uses RAILGUN Cookbook to generate cross-contract call data for
 * private token purchases on ZkAMM.
 *
 * The cookbook approach:
 * 1. Recipe generates cross-contract calls (what to execute)
 * 2. User can execute via Railway wallet or broadcaster network
 *
 * This is a LIGHTWEIGHT integration that doesn't require the full
 * Railgun Wallet SDK initialization. Users manage their private
 * balances through Railway, and use our recipes for ZkAMM swaps.
 *
 * Architecture:
 * - Frontend generates recipe output (cross-contract calls)
 * - User opens Railway with pre-filled call data
 * - Railway handles proof generation and execution
 */

import type { Address, Hex, PublicClient } from 'viem';
import { encodeFunctionData } from 'viem';
import { EXTERNAL } from '../config';

// Railgun contract addresses on Arbitrum - imported from config for consistency
export const RAILGUN_ADDRESSES = {
  proxy: EXTERNAL.railgunProxy as Address,
  relayAdapt: EXTERNAL.relayAdapt as Address,
  weth: EXTERNAL.weth as Address,
};

// ZkAMM ABI for reading pool state
const ZKAMM_VIEW_ABI = [
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

// WETH ABI
const WETH_ABI = [
  {
    name: 'withdraw',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'amount', type: 'uint256' }],
    outputs: []
  }
] as const;

// ZkAMM buyPrivate ABI
const ZKAMM_BUY_ABI = [
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
  }
] as const;

export interface CrossContractCall {
  to: Address;
  data: Hex;
  value: bigint;
}

export interface BuyQuoteResult {
  estimatedTokensOut: bigint;
  minTokensOut: bigint;
  ethReserve: bigint;
  tokenReserve: bigint;
  priceImpact: number;
  unshieldAmount: bigint; // Amount to unshield from Railgun (includes fee)
}

export interface RecipeCallData {
  crossContractCalls: CrossContractCall[];
  unshieldAmount: bigint;
  railwayDeepLink: string;
}

/**
 * Get a quote for buying tokens on ZkAMM
 *
 * @param zkAMMAddress - Address of the ZkAMM contract
 * @param ethAmount - Amount of ETH to spend
 * @param publicClient - Viem public client
 * @param slippageBps - Slippage tolerance in basis points (100 = 1%)
 */
export async function getPrivateBuyQuote(
  zkAMMAddress: Address,
  ethAmount: bigint,
  publicClient: PublicClient,
  slippageBps: bigint = 100n
): Promise<BuyQuoteResult> {
  // Get pool reserves
  const [ethReserve, tokenReserve] = await Promise.all([
    publicClient.readContract({
      address: zkAMMAddress,
      abi: ZKAMM_VIEW_ABI,
      functionName: 'ethReserve',
    }),
    publicClient.readContract({
      address: zkAMMAddress,
      abi: ZKAMM_VIEW_ABI,
      functionName: 'tokenReserve',
    }),
  ]);

  // Get estimated tokens out
  const estimatedTokensOut = await publicClient.readContract({
    address: zkAMMAddress,
    abi: ZKAMM_VIEW_ABI,
    functionName: 'getAmountOut',
    args: [ethAmount, ethReserve, tokenReserve],
  });

  // Calculate min tokens with slippage
  const minTokensOut = estimatedTokensOut * (10000n - slippageBps) / 10000n;

  // Calculate price impact
  const spotPrice = Number(tokenReserve) / Number(ethReserve);
  const executionPrice = Number(estimatedTokensOut) / Number(ethAmount);
  const priceImpact = ((spotPrice - executionPrice) / spotPrice) * 100;

  // Calculate unshield amount (includes 0.25% Railgun fee)
  const railgunFee = ethAmount * 25n / 10000n;
  const unshieldAmount = ethAmount + railgunFee;

  return {
    estimatedTokensOut,
    minTokensOut,
    ethReserve,
    tokenReserve,
    priceImpact,
    unshieldAmount,
  };
}

/**
 * Generate cross-contract calls for a private buy on ZkAMM
 *
 * This creates the call data that Railgun will execute:
 * 1. Unwrap WETH to ETH
 * 2. Call buyPrivate on ZkAMM with ETH
 *
 * @param zkAMMAddress - Address of the ZkAMM contract
 * @param ethAmount - Amount of ETH to use for purchase
 * @param commitment - The commitment to store in the Merkle tree
 * @param minTokensOut - Minimum tokens to receive (slippage protection)
 * @param deadline - Timestamp deadline for the transaction
 * @param encryptedNote - Encrypted note data for the commitment
 */
export function generatePrivateBuyCalls(
  zkAMMAddress: Address,
  ethAmount: bigint,
  commitment: bigint,
  minTokensOut: bigint,
  deadline: bigint,
  encryptedNote: Hex
): CrossContractCall[] {
  // Step 1: Unwrap WETH to ETH
  const unwrapCall: CrossContractCall = {
    to: RAILGUN_ADDRESSES.weth,
    data: encodeFunctionData({
      abi: WETH_ABI,
      functionName: 'withdraw',
      args: [ethAmount]
    }),
    value: 0n
  };

  // Step 2: Buy on ZkAMM
  const buyCall: CrossContractCall = {
    to: zkAMMAddress,
    data: encodeFunctionData({
      abi: ZKAMM_BUY_ABI,
      functionName: 'buyPrivate',
      args: [commitment, minTokensOut, deadline, encryptedNote]
    }),
    value: ethAmount
  };

  return [unwrapCall, buyCall];
}

/**
 * Generate Railway deep link for executing the private buy
 *
 * Railway is the official Railgun wallet that can execute
 * cross-contract calls with full privacy.
 *
 * @param calls - The cross-contract calls to execute
 * @param unshieldAmount - Amount of WETH to unshield from Railgun
 */
export function generateRailwayDeepLink(
  calls: CrossContractCall[],
  unshieldAmount: bigint
): string {
  // Encode calls as JSON for Railway
  const callsData = calls.map(call => ({
    to: call.to,
    data: call.data,
    value: call.value.toString()
  }));

  const params = new URLSearchParams({
    action: 'cross-contract',
    network: 'arbitrum',
    token: RAILGUN_ADDRESSES.weth,
    amount: unshieldAmount.toString(),
    calls: JSON.stringify(callsData)
  });

  return `https://app.railway.xyz/swap?${params.toString()}`;
}

/**
 * Complete flow to generate recipe call data for a private buy
 *
 * This uses the cookbook pattern to generate all necessary data
 * for executing a private buy via Railgun.
 */
export async function preparePrivateBuy(params: {
  zkAMMAddress: Address;
  ethAmount: bigint;
  commitment: bigint;
  encryptedNote: Hex;
  publicClient: PublicClient;
  slippageBps?: bigint;
}): Promise<RecipeCallData> {
  const {
    zkAMMAddress,
    ethAmount,
    commitment,
    encryptedNote,
    publicClient,
    slippageBps = 100n
  } = params;

  // Get quote
  const quote = await getPrivateBuyQuote(
    zkAMMAddress,
    ethAmount,
    publicClient,
    slippageBps
  );

  // Generate calls
  // Deadline: 20 minutes from now
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 1200);
  const crossContractCalls = generatePrivateBuyCalls(
    zkAMMAddress,
    ethAmount,
    commitment,
    quote.minTokensOut,
    deadline,
    encryptedNote
  );

  // Generate deep link
  const railwayDeepLink = generateRailwayDeepLink(
    crossContractCalls,
    quote.unshieldAmount
  );

  return {
    crossContractCalls,
    unshieldAmount: quote.unshieldAmount,
    railwayDeepLink,
  };
}

// Note: Cookbook Recipe integration was removed in favor of direct wallet SDK integration
// See railgunEngine.ts for the full anonymous buy implementation

/**
 * Calculate tokens output for UI display
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
 * Railgun fee constants
 */
export const RAILGUN_FEES = {
  shieldFeeBps: 25n,      // 0.25% to shield
  unshieldFeeBps: 25n,    // 0.25% to unshield
  swapFeeBps: 30n,        // 0.3% ZkAMM swap fee
} as const;

/**
 * Calculate total fees for a private buy
 */
export function calculateTotalFees(ethAmount: bigint): {
  railgunFee: bigint;
  swapFee: bigint;
  totalFee: bigint;
  netEthIn: bigint;
} {
  // Railgun unshield fee (0.25%)
  const railgunFee = ethAmount * RAILGUN_FEES.unshieldFeeBps / 10000n;

  // ZkAMM swap fee (0.3%)
  const netEthAfterRailgun = ethAmount - railgunFee;
  const swapFee = netEthAfterRailgun * RAILGUN_FEES.swapFeeBps / 1000n;

  return {
    railgunFee,
    swapFee,
    totalFee: railgunFee + swapFee,
    netEthIn: netEthAfterRailgun - swapFee,
  };
}

/**
 * Open Railway app with the cross-contract call pre-configured
 */
export function openRailwayWithRecipe(recipeData: RecipeCallData): void {
  window.open(recipeData.railwayDeepLink, '_blank');
}

/**
 * Check if user is on Arbitrum network
 */
export function isArbitrumNetwork(chainId: number): boolean {
  return chainId === 42161;
}
