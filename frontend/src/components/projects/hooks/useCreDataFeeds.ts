import { useState, useEffect } from 'react';
import { usePublicClient } from 'wagmi';
import { PILOT_SITE_ABI } from '../constants';
import type { CreDataFeedReport, ProjectSummary } from '../types';

interface UseCreDataFeedsParams {
  contractAddress?: string;
  enabled?: boolean;
}

export function useCreDataFeeds({ contractAddress, enabled = true }: UseCreDataFeedsParams) {
  const publicClient = usePublicClient();
  const [report, setReport] = useState<CreDataFeedReport | null>(null);
  const [summary, setSummary] = useState<ProjectSummary | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!publicClient || !contractAddress || !enabled) return;

    const fetchData = async () => {
      setIsLoading(true);
      try {
        const [reportResult, summaryResult] = await Promise.all([
          publicClient.readContract({
            address: contractAddress as `0x${string}`,
            abi: PILOT_SITE_ABI,
            functionName: 'getLatestReport',
          }),
          publicClient.readContract({
            address: contractAddress as `0x${string}`,
            abi: PILOT_SITE_ABI,
            functionName: 'getProjectSummary',
          }),
        ]);

        const r = reportResult as {
          ndviCurrent: bigint;
          ndviPreFire: bigint;
          ndviRecoveryPct: bigint;
          dnbr: bigint;
          soilOrganicCarbon: bigint;
          estimatedLiveTrees: bigint;
          annualCO2: bigint;
          carbonCredits: bigint;
          fireRecoveryIndex: bigint;
          timestamp: bigint;
        };

        setReport({
          ndviCurrent: Number(r.ndviCurrent) / 1000,
          ndviPreFire: Number(r.ndviPreFire) / 1000,
          ndviRecoveryPct: Number(r.ndviRecoveryPct),
          dnbr: Number(r.dnbr) / 1000,
          soilOrganicCarbon: Number(r.soilOrganicCarbon),
          estimatedLiveTrees: Number(r.estimatedLiveTrees),
          annualCO2: Number(r.annualCO2),
          carbonCredits: Number(r.carbonCredits),
          fireRecoveryIndex: Number(r.fireRecoveryIndex),
          timestamp: Number(r.timestamp),
        });

        const s = summaryResult as readonly [bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint];

        setSummary({
          totalTreesPlanted: Number(s[0]),
          estimatedLiveTrees: Number(s[1]),
          survivalRatePct: Number(s[2]),
          fireRecoveryIndex: Number(s[3]),
          ndviRecoveryPct: Number(s[4]),
          annualCO2Kg: Number(s[5]),
          totalReports: Number(s[6]),
          lastUpdateTimestamp: Number(s[7]),
        });

        setError(null);
      } catch (err) {
        console.error('Failed to fetch CRE data feeds:', err);
        setError('Failed to load environmental data');
      } finally {
        setIsLoading(false);
      }
    };

    fetchData();
    const interval = window.setInterval(fetchData, 120000); // 2 min polling
    return () => window.clearInterval(interval);
  }, [publicClient, contractAddress, enabled]);

  return { report, summary, isLoading, error };
}
