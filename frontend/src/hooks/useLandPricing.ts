/**
 * useLandPricing — reads the LIVE OTC pricing from the deployed Land, so the funding UI
 * isn't hardcoded. rootPriceE6 ($/R00T-equiv) and ethPriceE6 ($/ETH) are steward-settable
 * (setRootPrice / setEthPrice), so:
 *   • updating ETH price on-chain flows straight through to the ETH cost, and
 *   • when the steward raises the OTC R00T price (tracking market at their chosen discount),
 *     every $ value on the map + panels rises with it.
 * Also derives the live R00T MARKET price from the zkAMM pool for reference (never used to
 * price funding — that would be flash-loan-manipulable; funding uses the steward OTC rate).
 */
import { useCallback, useEffect, useState } from 'react';
import { usePublicClient } from 'wagmi';
import { parseAbi } from 'viem';
import { CONTRACTS } from '../config';

const landAbi = parseAbi([
  'function rootPriceE6() view returns (uint256)',
  'function ethPriceE6() view returns (uint256)',
]);
const pairAbi = parseAbi([
  'function ethReserve() view returns (uint256)',
  'function tokenReserve() view returns (uint256)',
]);

export interface LandPricing {
  rootPriceE6: bigint;   // OTC $/R00T-equiv (steward-set) — funding + $ display use this
  ethPriceE6: bigint;    // $/ETH (steward-set)
  rootPriceUsd: number;  // convenience
  ethPriceUsd: number;
  rootMarketUsd: number | null; // live pool-derived R00T market price (reference only)
}

export function useLandPricing(): LandPricing {
  const publicClient = usePublicClient();
  const land = CONTRACTS.pilotLand as `0x${string}`;
  const pair = CONTRACTS.zkAMMPair as `0x${string}`;
  // sensible fallbacks = the current on-chain values, so first paint isn't $0
  const [rootPriceE6, setRootPriceE6] = useState<bigint>(CONTRACTS.rootPriceE6);
  const [ethPriceE6, setEthPriceE6] = useState<bigint>(CONTRACTS.ethPriceE6);
  const [rootMarketUsd, setRootMarketUsd] = useState<number | null>(null);

  const refresh = useCallback(async () => {
    if (!publicClient) return;
    try {
      const [rp, ep] = await Promise.all([
        publicClient.readContract({ address: land, abi: landAbi, functionName: 'rootPriceE6' }),
        publicClient.readContract({ address: land, abi: landAbi, functionName: 'ethPriceE6' }),
      ]);
      setRootPriceE6(rp as bigint);
      setEthPriceE6(ep as bigint);
      // R00T market price (reference): (ethUsd) / (R00T per ETH from the pool)
      try {
        const [er, tr] = await Promise.all([
          publicClient.readContract({ address: pair, abi: pairAbi, functionName: 'ethReserve' }),
          publicClient.readContract({ address: pair, abi: pairAbi, functionName: 'tokenReserve' }),
        ]);
        const eth = Number(er as bigint), tok = Number(tr as bigint);
        if (eth > 0 && tok > 0) {
          const ethUsd = Number(ep as bigint) / 1e6;
          const rootPerEth = tok / eth;
          setRootMarketUsd(ethUsd / rootPerEth);
        }
      } catch { /* pool read optional */ }
    } catch { /* keep fallbacks */ }
  }, [publicClient, land, pair]);

  useEffect(() => { refresh(); const t = setInterval(refresh, 30000); return () => clearInterval(t); }, [refresh]);

  return {
    rootPriceE6, ethPriceE6,
    rootPriceUsd: Number(rootPriceE6) / 1e6,
    ethPriceUsd: Number(ethPriceE6) / 1e6,
    rootMarketUsd,
  };
}
