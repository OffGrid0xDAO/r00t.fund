import { useState, useEffect } from 'react';
import { usePublicClient } from 'wagmi';
import { COMPLIANT_PRIVATE_VAULT_ABI } from '../constants';
import { CONTRACTS } from '../../../config';
import type { VaultStats } from '../types';

export function useCompliantVault() {
  const publicClient = usePublicClient();
  const [stats, setStats] = useState<VaultStats | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const address = CONTRACTS.compliantPrivateVault as `0x${string}`;

  useEffect(() => {
    if (!publicClient || !address || address === '0x...') return;

    const fetch = async () => {
      setIsLoading(true);
      try {
        const result = await publicClient.readContract({
          address,
          abi: COMPLIANT_PRIVATE_VAULT_ABI,
          functionName: 'getVaultStats',
        });

        const s = result as readonly [bigint, bigint, bigint, bigint, bigint, bigint];
        setStats({
          totalDeposits: s[0],
          totalWithdrawals: s[1],
          totalDenied: s[2],
          totalVolume: s[3],
          pendingETH: s[4],
          totalRequests: Number(s[5]),
        });
        setError(null);
      } catch {
        // Contract may not have getVaultStats — silently skip
      } finally {
        setIsLoading(false);
      }
    };

    fetch();
    const interval = window.setInterval(fetch, 60000);
    return () => window.clearInterval(interval);
  }, [publicClient, address]);

  return { stats, isLoading, error };
}
