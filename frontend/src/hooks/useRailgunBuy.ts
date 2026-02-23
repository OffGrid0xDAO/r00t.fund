/**
 * useRailgunBuy - Private Buy Hook
 *
 * Handles buying ROOT tokens (ETH → ROOT) and project tokens (ETH → ROOT → Token).
 * Uses ZK commitments for privacy — tokens are stored as commitments on-chain.
 */

import { useState, useCallback } from 'react';
import { useAccount, usePublicClient, useWalletClient } from 'wagmi';
import { parseEther, keccak256, toBytes, type Address, type Hex } from 'viem';
import { hashCommitment as poseidonHashCommitment, randomFieldElement, encryptNote } from '@r00t-fund/sdk';
import { Wallet } from 'ethers';
import { EVENTS, CHAIN, CONTRACTS } from '../config';
import { ZKAMM_ABI } from '../abis/zkAMM';

interface BuyResult {
  success: boolean;
  error?: string;
  txHash?: string;
  commitment?: bigint;
  nullifier?: bigint;
  secret?: bigint;
  tokensReceived?: bigint;
  leafIndex?: number;
}

interface UseRailgunBuyOptions {
  isProjectToken?: boolean;
  projectPoolAddress?: string;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function useRailgunBuy(_zkAMMAddress: string, options?: UseRailgunBuyOptions) {
  const { address } = useAccount();
  const publicClient = usePublicClient();
  const { data: walletClient } = useWalletClient();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState('');

  const buyQuickPrivate = useCallback(async (params: {
    ethAmount: string;
    viewingKey: string;
    onProgress?: (step: string, percent: number) => void;
    slippageBps?: number;
  }): Promise<BuyResult> => {
    const { ethAmount, viewingKey, onProgress, slippageBps = 100 } = params;

    if (!walletClient || !publicClient || !address) {
      return { success: false, error: 'Wallet not connected' };
    }

    setIsLoading(true);
    setError(null);

    try {
      const ethAmountWei = parseEther(ethAmount);
      const routerAddress = CONTRACTS.zkAMMRouter as Address;
      const pairAddress = CONTRACTS.zkAMMPair as Address;
      const isProject = options?.isProjectToken && options?.projectPoolAddress;

      onProgress?.('Getting pool state...', 20);
      setProgress('Getting pool state...');

      // Always read ROOT/ETH reserves (needed for both ROOT and project token buys)
      const [ethReserve, rootReserve] = await Promise.all([
        publicClient.readContract({ address: pairAddress, abi: ZKAMM_ABI, functionName: 'ethReserve' }),
        publicClient.readContract({ address: pairAddress, abi: ZKAMM_ABI, functionName: 'tokenReserve' }),
      ]);

      let tokensOut: bigint;

      if (isProject) {
        // Two-hop: ETH → ROOT → ProjectToken
        // Hop 1: estimate ROOT output
        const rootOut = await publicClient.readContract({
          address: routerAddress, abi: ZKAMM_ABI, functionName: 'getAmountOut',
          args: [ethAmountWei, ethReserve as bigint, rootReserve as bigint],
        }) as bigint;

        // Hop 2: estimate project token output from project pool reserves
        const poolAddress = options!.projectPoolAddress as Address;
        const [r00tRes, projTokenRes] = await Promise.all([
          publicClient.readContract({ address: poolAddress, abi: ZKAMM_ABI, functionName: 'r00tReserve' }),
          publicClient.readContract({ address: poolAddress, abi: ZKAMM_ABI, functionName: 'tokenReserve' }),
        ]);

        tokensOut = await publicClient.readContract({
          address: routerAddress, abi: ZKAMM_ABI, functionName: 'getAmountOut',
          args: [rootOut, r00tRes as bigint, projTokenRes as bigint],
        }) as bigint;

        console.log('[usePrivateBuy] Two-hop estimate:', {
          ethIn: ethAmountWei.toString(),
          rootOut: rootOut.toString(),
          tokensOut: tokensOut.toString(),
          pool: poolAddress,
        });
      } else {
        // Single hop: ETH → ROOT
        tokensOut = await publicClient.readContract({
          address: routerAddress, abi: ZKAMM_ABI, functionName: 'getAmountOut',
          args: [ethAmountWei, ethReserve as bigint, rootReserve as bigint],
        }) as bigint;
      }

      onProgress?.('Generating commitment...', 30);
      setProgress('Generating commitment...');

      const nullifier = randomFieldElement();
      const secret = randomFieldElement();
      const commitment = poseidonHashCommitment(nullifier, secret, tokensOut);

      const wallet = new Wallet(viewingKey);
      const viewingPublicKey = wallet.signingKey.compressedPublicKey;
      const encryptedNoteData = await encryptNote(nullifier, secret, tokensOut, viewingPublicKey);

      const minTokensOut = tokensOut * BigInt(10000 - slippageBps) / 10000n;
      // Deadline: use chain's block timestamp (Tenderly VNet timestamps can differ from real time)
      const latestBlock = await publicClient.getBlock();
      const deadline = latestBlock.timestamp + 1200n;

      onProgress?.('Sending transaction...', 50);
      setProgress('Sending transaction...');

      let hash: `0x${string}`;

      if (isProject) {
        // Project token buy: ETH → ROOT → Token via Router's swapETHForProjectToken
        const minR00TOut = 0n; // Let minTokensOut protect the final output
        const userEntropy = keccak256(toBytes(`${nullifier}${secret}${Date.now()}`));

        hash = await walletClient.writeContract({
          address: routerAddress,
          abi: ZKAMM_ABI,
          functionName: 'swapETHForProjectToken',
          args: [
            options!.projectPoolAddress as Address,
            minR00TOut,
            minTokensOut,
            commitment,
            deadline,
            encryptedNoteData as Hex,
            userEntropy as Hex,
          ],
          value: ethAmountWei,
          chain: CHAIN,
        });
      } else {
        // ROOT buy: ETH → ROOT via buyPrivate
        hash = await walletClient.writeContract({
          address: routerAddress,
          abi: ZKAMM_ABI,
          functionName: 'buyPrivate',
          args: [commitment, minTokensOut, deadline, encryptedNoteData as Hex],
          value: ethAmountWei,
          chain: CHAIN,
        });
      }

      onProgress?.('Confirming...', 80);
      setProgress('Confirming...');
      const receipt = await publicClient.waitForTransactionReceipt({ hash });

      const commitmentLog = receipt.logs.find(log =>
        log.topics[0] === EVENTS.newCommitment
      );
      const leafIndex = commitmentLog ? Number(BigInt(commitmentLog.topics[2] || '0')) : 0;

      onProgress?.('Complete!', 100);
      setProgress('');

      return {
        success: true,
        txHash: hash,
        commitment,
        nullifier,
        secret,
        tokensReceived: tokensOut,
        leafIndex,
      };

    } catch (err) {
      const errorMsg = (err as Error).message || 'Transaction failed';
      setError(errorMsg);
      return { success: false, error: errorMsg };
    } finally {
      setIsLoading(false);
      setProgress('');
    }
  }, [walletClient, publicClient, address, options]);

  return {
    isLoading,
    error,
    progress,
    buyQuickPrivate,
  };
}

export default useRailgunBuy;
