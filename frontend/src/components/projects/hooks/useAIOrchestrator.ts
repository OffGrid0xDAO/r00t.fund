import { useState, useEffect } from 'react';
import { usePublicClient } from 'wagmi';
import { AI_AGENT_ORCHESTRATOR_ABI } from '../constants';
import { CONTRACTS } from '../../../config';
import type { AIAnalysis, GovernanceAdvisory } from '../types';

export function useAIOrchestrator() {
  const publicClient = usePublicClient();
  const [analysis, setAnalysis] = useState<AIAnalysis | null>(null);
  const [safeToTrade, setSafeToTrade] = useState<boolean | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const address = CONTRACTS.aiAgentOrchestrator as `0x${string}`;

  useEffect(() => {
    if (!publicClient || !address || address === '0x...') return;

    const fetch = async () => {
      setIsLoading(true);
      try {
        const [latestAnalysis, safe] = await Promise.all([
          publicClient.readContract({
            address,
            abi: AI_AGENT_ORCHESTRATOR_ABI,
            functionName: 'getLatestAnalysis',
          }),
          publicClient.readContract({
            address,
            abi: AI_AGENT_ORCHESTRATOR_ABI,
            functionName: 'isSafeToTrade',
          }),
        ]);

        const a = latestAnalysis as readonly [bigint, number, number, string];
        setAnalysis({
          timestamp: Number(a[0]),
          riskLevel: a[1],
          recommendedAction: a[2],
          analysisHash: a[3],
        });
        setSafeToTrade(safe as boolean);
        setError(null);
      } catch {
        // Contract may not have getLatestAnalysis — silently skip
      } finally {
        setIsLoading(false);
      }
    };

    fetch();
    const interval = window.setInterval(fetch, 60000);
    return () => window.clearInterval(interval);
  }, [publicClient, address]);

  const getGovernanceAdvisory = async (proposalId: number): Promise<GovernanceAdvisory | null> => {
    if (!publicClient || !address || address === '0x...') return null;
    try {
      const result = await publicClient.readContract({
        address,
        abi: AI_AGENT_ORCHESTRATOR_ABI,
        functionName: 'getGovernanceAdvisory',
        args: [BigInt(proposalId)],
      });
      const r = result as readonly [number, bigint, string, bigint];
      return {
        recommendation: r[0],
        confidence: Number(r[1]),
        reasoning: r[2],
        timestamp: Number(r[3]),
      };
    } catch {
      return null;
    }
  };

  return { analysis, safeToTrade, isLoading, error, getGovernanceAdvisory };
}
