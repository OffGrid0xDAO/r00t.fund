import { useState, useEffect, useCallback } from 'react';
import { usePublicClient } from 'wagmi';
import { CONFIDENTIAL_FUNDING_VAULT_ABI } from '../constants';
import { CONTRACTS } from '../../../config';
import type { ProjectAttestation } from '../types';

export function useConfidentialFunding() {
  const publicClient = usePublicClient();
  const [verifiedCount, setVerifiedCount] = useState(0);
  const [totalCredits, setTotalCredits] = useState<bigint>(0n);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const address = CONTRACTS.confidentialFundingVault as `0x${string}`;

  useEffect(() => {
    if (!publicClient || !address || address === '0x...') return;

    const fetch = async () => {
      setIsLoading(true);
      try {
        const [verifiedIds, credits] = await Promise.all([
          publicClient.readContract({
            address,
            abi: CONFIDENTIAL_FUNDING_VAULT_ABI,
            functionName: 'getVerifiedProposalIds',
          }),
          publicClient.readContract({
            address,
            abi: CONFIDENTIAL_FUNDING_VAULT_ABI,
            functionName: 'getTotalVerifiedCredits',
          }),
        ]);

        setVerifiedCount((verifiedIds as bigint[]).length);
        setTotalCredits(credits as bigint);
        setError(null);
      } catch {
        // Contract may not have getVerifiedProposalIds — silently skip
      } finally {
        setIsLoading(false);
      }
    };

    fetch();
    const interval = window.setInterval(fetch, 120000);
    return () => window.clearInterval(interval);
  }, [publicClient, address]);

  const getProjectAttestation = useCallback(async (proposalId: number): Promise<ProjectAttestation | null> => {
    if (!publicClient || !address || address === '0x...') return null;
    try {
      const result = await publicClient.readContract({
        address,
        abi: CONFIDENTIAL_FUNDING_VAULT_ABI,
        functionName: 'getProjectAttestation',
        args: [BigInt(proposalId)],
      });
      const r = result as readonly [bigint, string, bigint, boolean];
      return {
        impactScore: Number(r[0]),
        attestationHash: r[1],
        timestamp: Number(r[2]),
        verified: r[3],
      };
    } catch {
      return null;
    }
  }, [publicClient, address]);

  return { verifiedCount, totalCredits, isLoading, error, getProjectAttestation };
}
