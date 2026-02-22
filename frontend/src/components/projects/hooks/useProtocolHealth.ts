import { useState, useEffect } from 'react';
import { usePublicClient } from 'wagmi';
import { PROTOCOL_HEALTH_MONITOR_ABI } from '../constants';
import { CONTRACTS } from '../../../config';
import type { ProtocolHealthReport } from '../types';

export function useProtocolHealth() {
  const publicClient = usePublicClient();
  const [report, setReport] = useState<ProtocolHealthReport | null>(null);
  const [circuitBreakerEnabled, setCircuitBreakerEnabled] = useState<boolean | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const address = CONTRACTS.protocolHealthMonitor as `0x${string}`;

  useEffect(() => {
    if (!publicClient || !address || address === '0x...') return;

    const fetch = async () => {
      setIsLoading(true);
      try {
        const [latest, cbEnabled] = await Promise.all([
          publicClient.readContract({
            address,
            abi: PROTOCOL_HEALTH_MONITOR_ABI,
            functionName: 'latestReport',
          }),
          publicClient.readContract({
            address,
            abi: PROTOCOL_HEALTH_MONITOR_ABI,
            functionName: 'autoCircuitBreakerEnabled',
          }),
        ]);

        const r = latest as readonly [bigint, bigint, bigint, bigint, number, number, bigint];
        setReport({
          ethReserve: r[0],
          tokenReserve: r[1],
          reserveRatio: Number(r[2]),
          shortsUtilization: Number(r[3]),
          overallRiskLevel: r[4],
          recommendedAction: r[5],
          timestamp: Number(r[6]),
        });
        setCircuitBreakerEnabled(cbEnabled as boolean);
        setError(null);
      } catch (err) {
        console.error('Failed to fetch protocol health:', err);
        setError('Failed to load protocol health data');
      } finally {
        setIsLoading(false);
      }
    };

    fetch();
    const interval = window.setInterval(fetch, 30000); // 30s for health monitoring
    return () => window.clearInterval(interval);
  }, [publicClient, address]);

  return { report, circuitBreakerEnabled, isLoading, error };
}
