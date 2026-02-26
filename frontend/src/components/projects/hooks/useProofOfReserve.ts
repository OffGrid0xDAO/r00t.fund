import { useState, useEffect } from 'react';
import { usePublicClient } from 'wagmi';
import { REGEN_PROOF_OF_RESERVE_ABI } from '../constants';
import { CONTRACTS } from '../../../config';
import type { ReserveHealth } from '../types';

export function useProofOfReserve() {
  const publicClient = usePublicClient();
  const [data, setData] = useState<ReserveHealth | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const address = CONTRACTS.regenProofOfReserve as `0x${string}`;

  useEffect(() => {
    if (!publicClient || !address || address === '0x...') return;

    const fetch = async () => {
      setIsLoading(true);
      try {
        const [health, tvl] = await Promise.all([
          publicClient.readContract({
            address,
            abi: REGEN_PROOF_OF_RESERVE_ABI,
            functionName: 'getReserveHealth',
          }),
          publicClient.readContract({
            address,
            abi: REGEN_PROOF_OF_RESERVE_ABI,
            functionName: 'getTotalTVL',
          }),
        ]);

        const h = health as readonly [bigint, bigint, bigint, bigint];
        setData({
          ethReserve: h[0],
          tokenReserve: h[1],
          backingRatio: Number(h[2]),
          impactScore: Number(h[3]),
          totalTVL: tvl as bigint,
        });
        setError(null);
      } catch {
        // Contract may not have getReserveHealth — silently skip
      } finally {
        setIsLoading(false);
      }
    };

    fetch();
    const interval = window.setInterval(fetch, 60000);
    return () => window.clearInterval(interval);
  }, [publicClient, address]);

  return { data, isLoading, error };
}
