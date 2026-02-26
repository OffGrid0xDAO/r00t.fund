import { useState, useEffect } from 'react';
import { usePublicClient } from 'wagmi';
import { POLICY_ENGINE_ABI } from '../constants';
import { CONTRACTS } from '../../../config';
import type { PolicyStats } from '../types';

export function usePolicyEngine() {
  const publicClient = usePublicClient();
  const [stats, setStats] = useState<PolicyStats | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const address = CONTRACTS.policyEngine as `0x${string}`;

  useEffect(() => {
    if (!publicClient || !address || address === '0x...') return;

    const fetch = async () => {
      setIsLoading(true);
      try {
        const [attestations, authorized, denied] = await Promise.all([
          publicClient.readContract({
            address,
            abi: POLICY_ENGINE_ABI,
            functionName: 'totalAttestations',
          }),
          publicClient.readContract({
            address,
            abi: POLICY_ENGINE_ABI,
            functionName: 'totalAuthorized',
          }),
          publicClient.readContract({
            address,
            abi: POLICY_ENGINE_ABI,
            functionName: 'totalDenied',
          }),
        ]);

        setStats({
          totalAttestations: Number(attestations as bigint),
          totalAuthorized: Number(authorized as bigint),
          totalDenied: Number(denied as bigint),
        });
        setError(null);
      } catch {
        // Contract may not have totalAttestations — silently skip
      } finally {
        setIsLoading(false);
      }
    };

    fetch();
    const interval = window.setInterval(fetch, 120000);
    return () => window.clearInterval(interval);
  }, [publicClient, address]);

  return { stats, isLoading, error };
}
