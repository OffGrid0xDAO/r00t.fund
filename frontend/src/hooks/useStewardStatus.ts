/**
 * useStewardStatus — decides whether the connected wallet is a set-up land steward.
 *
 * A wallet is steward-eligible (and only then does the Steward Console appear) when it:
 *   1. is connected,
 *   2. OWNS a Land (is the `steward` of a Land deployed by the LandFactory, or the pilot Land), and
 *   3. is a verified steward — StewardGatekeeper.isEligibleSteward (World PoH + Selfie/Identity).
 *      Until a gatekeeper address is configured, owning a Land is treated as set-up (World gate = #33).
 *
 * This is what ties Steward ↔ Land together: the console is an extension of the land you steward.
 */
import { useEffect, useState } from 'react';
import { useAccount, usePublicClient } from 'wagmi';
import { CONTRACTS, HACKATHON, isContractDeployed } from '../config';

const factoryAbi = [
  { type: 'function', name: 'landCount', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'lands', stateMutability: 'view', inputs: [{ type: 'uint256' }], outputs: [{ type: 'address' }] },
] as const;
const landAbi = [
  { type: 'function', name: 'steward', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { type: 'function', name: 'name', stateMutability: 'view', inputs: [], outputs: [{ type: 'string' }] },
] as const;
const gateAbi = [
  { type: 'function', name: 'isEligibleSteward', stateMutability: 'view', inputs: [{ type: 'address' }], outputs: [{ type: 'bool' }] },
] as const;

export interface StewardStatus {
  isConnected: boolean;
  ownsLand: boolean;
  isVerifiedSteward: boolean;
  eligible: boolean;        // connected && ownsLand && isVerifiedSteward — gates the console
  landAddress: string | null;
  landName: string | null;
  loading: boolean;
}

const EMPTY: StewardStatus = {
  isConnected: false, ownsLand: false, isVerifiedSteward: false, eligible: false,
  landAddress: null, landName: null, loading: false,
};

// optional gatekeeper address (set once StewardGatekeeper is deployed for the demo)
const GATEKEEPER = (HACKATHON as any).stewardGatekeeper as string | undefined;

export function useStewardStatus(): StewardStatus {
  const { address, isConnected } = useAccount();
  const publicClient = usePublicClient();
  const [s, setS] = useState<StewardStatus>(EMPTY);

  useEffect(() => {
    let alive = true;
    if (!isConnected || !address || !publicClient) { setS({ ...EMPTY, isConnected: !!isConnected }); return; }
    setS((p) => ({ ...p, isConnected: true, loading: true }));

    (async () => {
      const me = address.toLowerCase();
      let landAddress: string | null = null;
      let landName: string | null = null;

      // 1) does the wallet steward a Land? check the pilot Land first, then scan the factory.
      const candidates: string[] = [];
      if (isContractDeployed(CONTRACTS.pilotLand)) candidates.push(CONTRACTS.pilotLand);
      try {
        if (isContractDeployed(CONTRACTS.landFactory)) {
          const n = (await publicClient.readContract({ address: CONTRACTS.landFactory as `0x${string}`, abi: factoryAbi, functionName: 'landCount' })) as bigint;
          const cap = Number(n > 50n ? 50n : n);
          const idxs = await Promise.all(Array.from({ length: cap }, (_, i) =>
            publicClient.readContract({ address: CONTRACTS.landFactory as `0x${string}`, abi: factoryAbi, functionName: 'lands', args: [BigInt(i)] }).catch(() => null)));
          for (const a of idxs) if (a) candidates.push(a as string);
        }
      } catch { /* factory not reachable — pilot check still applies */ }

      for (const land of Array.from(new Set(candidates))) {
        try {
          const st = (await publicClient.readContract({ address: land as `0x${string}`, abi: landAbi, functionName: 'steward' })) as string;
          if (st.toLowerCase() === me) {
            landAddress = land;
            landName = await publicClient.readContract({ address: land as `0x${string}`, abi: landAbi, functionName: 'name' }).catch(() => null) as string | null;
            break;
          }
        } catch { /* not a Land / no steward view */ }
      }

      const ownsLand = !!landAddress;

      // 2) verified steward? use the gatekeeper if configured, else owning a Land counts as set-up.
      let isVerifiedSteward = ownsLand;
      if (GATEKEEPER && isContractDeployed(GATEKEEPER)) {
        try {
          isVerifiedSteward = (await publicClient.readContract({ address: GATEKEEPER as `0x${string}`, abi: gateAbi, functionName: 'isEligibleSteward', args: [address] })) as boolean;
        } catch { isVerifiedSteward = false; }
      }

      if (!alive) return;
      setS({
        isConnected: true, ownsLand, isVerifiedSteward,
        eligible: ownsLand && isVerifiedSteward,
        landAddress, landName, loading: false,
      });
    })();

    return () => { alive = false; };
  }, [address, isConnected, publicClient]);

  return s;
}
