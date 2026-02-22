import { useState, useCallback } from 'react';
import { usePublicClient, useWalletClient, useAccount } from 'wagmi';
import { REGEN_PREDICTION_MARKET_ABI } from '../constants';
import { CONTRACTS, CHAIN } from '../../../config';
import type { PredictionMarket } from '../types';

export function usePredictionMarket() {
  const publicClient = usePublicClient();
  const { data: walletClient } = useWalletClient();
  const { address: userAddress } = useAccount();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const contractAddress = CONTRACTS.regenPredictionMarket as `0x${string}`;

  const getMarket = useCallback(async (marketId: number): Promise<PredictionMarket | null> => {
    if (!publicClient || !contractAddress || contractAddress === '0x...') return null;
    try {
      const result = await publicClient.readContract({
        address: contractAddress,
        abi: REGEN_PREDICTION_MARKET_ABI,
        functionName: 'getMarket',
        args: [BigInt(marketId)],
      });
      const r = result as readonly [bigint, string, bigint, bigint, number, bigint, bigint, bigint];
      return {
        proposalId: Number(r[0]),
        metric: r[1],
        targetValue: r[2],
        resolutionTime: Number(r[3]),
        status: r[4],
        totalPositiveShares: r[5],
        totalNegativeShares: r[6],
        totalPool: r[7],
      };
    } catch {
      return null;
    }
  }, [publicClient, contractAddress]);

  const getUserShares = useCallback(async (marketId: number): Promise<{ positive: bigint; negative: bigint } | null> => {
    if (!publicClient || !contractAddress || contractAddress === '0x...' || !userAddress) return null;
    try {
      const result = await publicClient.readContract({
        address: contractAddress,
        abi: REGEN_PREDICTION_MARKET_ABI,
        functionName: 'getUserShares',
        args: [BigInt(marketId), userAddress],
      });
      const r = result as readonly [bigint, bigint];
      return { positive: r[0], negative: r[1] };
    } catch {
      return null;
    }
  }, [publicClient, contractAddress, userAddress]);

  const buyShares = useCallback(async (marketId: number, isPositive: boolean, ethAmount: bigint) => {
    if (!walletClient || !contractAddress || contractAddress === '0x...') {
      setError('Wallet not connected');
      return null;
    }
    setIsLoading(true);
    setError(null);
    try {
      const hash = await walletClient.writeContract({
        address: contractAddress,
        abi: REGEN_PREDICTION_MARKET_ABI,
        functionName: 'buyShares',
        args: [BigInt(marketId), isPositive, 0n],
        value: ethAmount,
        chain: CHAIN,
      });
      const receipt = await publicClient!.waitForTransactionReceipt({ hash });
      return receipt;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to buy shares');
      return null;
    } finally {
      setIsLoading(false);
    }
  }, [walletClient, publicClient, contractAddress]);

  const claimPayout = useCallback(async (marketId: number) => {
    if (!walletClient || !contractAddress || contractAddress === '0x...') {
      setError('Wallet not connected');
      return null;
    }
    setIsLoading(true);
    setError(null);
    try {
      const hash = await walletClient.writeContract({
        address: contractAddress,
        abi: REGEN_PREDICTION_MARKET_ABI,
        functionName: 'claimPayout',
        args: [BigInt(marketId)],
        chain: CHAIN,
      });
      const receipt = await publicClient!.waitForTransactionReceipt({ hash });
      return receipt;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to claim payout');
      return null;
    } finally {
      setIsLoading(false);
    }
  }, [walletClient, publicClient, contractAddress]);

  return { getMarket, getUserShares, buyShares, claimPayout, isLoading, error };
}
