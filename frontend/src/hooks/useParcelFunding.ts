/**
 * useParcelFunding — reads REAL on-chain funding for every deployed parcel.
 *
 * Returns a map keyed by ticker → { fundedUsd, targetUsd } sourced from the LandVault
 * (raisedR00TByParcel / parcelTargetR00T × $0.10). The map surface + summary use this so
 * nothing is imagined. Refreshes on an interval and can be poked.
 */
import { useCallback, useEffect, useState } from 'react';
import { usePublicClient } from 'wagmi';
import { formatEther, parseAbi } from 'viem';
import { CONTRACTS } from '../config';

const vaultAbi = parseAbi([
  'function raisedR00TByParcel(bytes32) view returns (uint256)',
  'function parcelTargetR00T(bytes32) view returns (uint256)',
]);
const landPriceAbi = parseAbi(['function rootPriceE6() view returns (uint256)']);

export interface ParcelFunding { fundedUsd: number; targetUsd: number; }

function pidHex(id: number): `0x${string}` { return ('0x' + id.toString(16).padStart(64, '0')) as `0x${string}`; }

export function useParcelFunding(): { funding: Record<string, ParcelFunding>; ready: boolean; refresh: () => void } {
  const publicClient = usePublicClient();
  const vault = (CONTRACTS.landVault || CONTRACTS.pledgeVault) as `0x${string}`;
  const isReady = !!vault && vault !== '0x...' && vault.length === 42;
  const [funding, setFunding] = useState<Record<string, ParcelFunding>>({});
  const [ready, setReady] = useState(false);

  const refresh = useCallback(async () => {
    if (!publicClient || !isReady) return;
    const entries = Object.entries(CONTRACTS.parcelIdByTicker);
    // live OTC price from the Land so $ values track the steward's price (not hardcoded)
    let rootUsd = Number(CONTRACTS.rootPriceE6) / 1e6;
    try {
      const rp = await publicClient.readContract({ address: CONTRACTS.pilotLand as `0x${string}`, abi: landPriceAbi, functionName: 'rootPriceE6' });
      rootUsd = Number(rp as bigint) / 1e6;
    } catch { /* keep fallback */ }
    try {
      const results = await Promise.all(entries.map(async ([ticker, id]) => {
        try {
          const [raised, target] = await Promise.all([
            publicClient.readContract({ address: vault, abi: vaultAbi, functionName: 'raisedR00TByParcel', args: [pidHex(id)] }),
            publicClient.readContract({ address: vault, abi: vaultAbi, functionName: 'parcelTargetR00T', args: [pidHex(id)] }),
          ]);
          return [ticker, { fundedUsd: Number(formatEther(raised as bigint)) * rootUsd, targetUsd: Number(formatEther(target as bigint)) * rootUsd }] as const;
        } catch { return [ticker, { fundedUsd: 0, targetUsd: 0 }] as const; }
      }));
      const map: Record<string, ParcelFunding> = {};
      for (const [t, f] of results) map[t] = f;
      setFunding(map);
      setReady(true);
    } catch { /* ignore */ }
  }, [publicClient, isReady, vault]);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 20000);
    return () => clearInterval(t);
  }, [refresh]);

  return { funding, ready, refresh };
}
