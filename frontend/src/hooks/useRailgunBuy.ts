/**
 * useRailgunBuy - Quick Private Buy (Railgun stripped out)
 *
 * Provides the buyQuickPrivate function that SwapPanel needs.
 * Railgun anonymous mode is disabled on Tenderly VNet.
 */

import { useState, useCallback } from 'react';
import { useAccount, usePublicClient, useWalletClient } from 'wagmi';
import { parseEther, type Address, type Hex } from 'viem';
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

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function useRailgunBuy(_zkAMMAddress: string) {
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

      onProgress?.('Getting pool state...', 20);
      setProgress('Getting pool state...');

      const pairAddress = CONTRACTS.zkAMMPair as Address;
      const [ethReserve, tokenReserve] = await Promise.all([
        publicClient.readContract({
          address: pairAddress,
          abi: ZKAMM_ABI,
          functionName: 'ethReserve',
        }),
        publicClient.readContract({
          address: pairAddress,
          abi: ZKAMM_ABI,
          functionName: 'tokenReserve',
        }),
      ]);

      const routerAddress = CONTRACTS.zkAMMRouter as Address;
      const tokensOut = await publicClient.readContract({
        address: routerAddress,
        abi: ZKAMM_ABI,
        functionName: 'getAmountOut',
        args: [ethAmountWei, ethReserve as bigint, tokenReserve as bigint],
      }) as bigint;

      onProgress?.('Generating commitment...', 30);
      setProgress('Generating commitment...');

      const nullifier = randomFieldElement();
      const secret = randomFieldElement();
      const commitment = poseidonHashCommitment(nullifier, secret, tokensOut);

      const wallet = new Wallet(viewingKey);
      const viewingPublicKey = wallet.signingKey.compressedPublicKey;
      const encryptedNote = await encryptNote(nullifier, secret, tokensOut, viewingPublicKey);

      const minTokensOut = tokensOut * BigInt(10000 - slippageBps) / 10000n;
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 1200);

      onProgress?.('Sending transaction...', 50);
      setProgress('Sending transaction...');

      const hash = await walletClient.writeContract({
        address: routerAddress,
        abi: ZKAMM_ABI,
        functionName: 'buyPrivate',
        args: [commitment, minTokensOut, deadline, encryptedNote as Hex],
        value: ethAmountWei,
        chain: CHAIN,
      });

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
  }, [walletClient, publicClient, address]);

  return {
    isLoading,
    error,
    progress,
    isConnected: !!address,
    hasWallet: false,
    isRailgunReady: false,
    isInitializing: false,
    shieldedBalance: 0n,
    shieldPrivateKey: null,
    spendableWethBalance: 0n,
    pendingWethBalance: 0n,
    railgunAddress: null,
    mnemonic: null,
    hasRailgunWallet: false,
    walletId: null,
    scanProgress: 0,
    scanPhase: null,
    isScanComplete: false,
    scanError: null,
    buyAnonymous: async () => ({ success: false, error: 'Anonymous mode disabled' } as BuyResult),
    buyQuickPrivate,
    initRailgun: async () => {},
    openRailway: () => {},
    shieldETH: async () => {},
    getOrCreateWallet: async () => {},
    exportWallet: async () => {},
    copyMnemonicToClipboard: async () => {},
    clearAndResync: async () => {},
    shieldFeePercent: 0,
    unshieldFeePercent: 0,
  };
}

export default useRailgunBuy;
