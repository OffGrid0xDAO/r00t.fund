/**
 * useRegenLive — live reads of the Regenerative Liquidity double pool on Ethereum Sepolia.
 *
 * Polls, straight from the deployed hackathon stack (see config.HACKATHON):
 *   - the PRIVATE pool price (RegenPrivatePool.getReserves)
 *   - the PUBLIC Uniswap v4 pool price (StateView.getSlot0 → sqrtPriceX96)
 *   - the CCA cleared price + phase + raise (RegenLaunchpad views)
 *   - the parcel regen treasury balance (R00T)
 *
 * All prices normalized to R00T per parcel token so the two pools + the cleared price line up.
 * Uses its own viem public client (Sepolia) so it works regardless of the wallet's current chain.
 */
import { useCallback, useEffect, useState } from 'react';
import { createPublicClient, http, keccak256, encodeAbiParameters } from 'viem';
import { HACKATHON } from '../config';

const client = createPublicClient({ transport: http(HACKATHON.rpcUrl) });

const Q96 = 2n ** 96n;
const WAD = 10n ** 18n;

const launchpadAbi = [
  { type: 'function', name: 'clearedPriceOf', stateMutability: 'view', inputs: [{ type: 'bytes32' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'phaseOf', stateMutability: 'view', inputs: [{ type: 'bytes32' }], outputs: [{ type: 'uint8' }] },
  { type: 'function', name: 'raisedOf', stateMutability: 'view', inputs: [{ type: 'bytes32' }], outputs: [{ type: 'uint256' }] },
] as const;
const privateAbi = [
  { type: 'function', name: 'getReserves', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }, { type: 'uint256' }] },
] as const;
const stateViewAbi = [
  { type: 'function', name: 'getSlot0', stateMutability: 'view', inputs: [{ type: 'bytes32' }],
    outputs: [{ type: 'uint160', name: 'sqrtPriceX96' }, { type: 'int24' }, { type: 'uint24' }, { type: 'uint24' }] },
] as const;
const erc20Abi = [
  { type: 'function', name: 'balanceOf', stateMutability: 'view', inputs: [{ type: 'address' }], outputs: [{ type: 'uint256' }] },
] as const;

export interface RegenLive {
  privatePrice: number | null;   // R00T per parcel token, private pool
  publicPrice: number | null;    // R00T per parcel token, public v4 pool
  clearedPrice: number | null;   // R00T per parcel token, CCA clear
  phase: number | null;          // 0 None · 1 Auction · 2 Live
  raised: number | null;         // R00T raised in the CCA
  treasuryRoot: number | null;   // R00T sitting in the parcel regen treasury
  divergenceBps: number | null;  // |pub-priv| / max * 10000
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

function toNum(x: bigint, dp = 6): number {
  return Number((x * BigInt(10 ** dp)) / WAD) / 10 ** dp;
}

export function useRegenLive(pollMs = 8000): RegenLive {
  const p = HACKATHON.parcel;
  const [s, setS] = useState<RegenLive>({
    privatePrice: null, publicPrice: null, clearedPrice: null, phase: null, raised: null,
    treasuryRoot: null, divergenceBps: null, loading: true, error: null, refetch: () => {},
  });

  const load = useCallback(async () => {
    try {
      const [reserves, slot0, cleared, phase, raised, treasury] = await Promise.all([
        client.readContract({ address: p.privatePool as `0x${string}`, abi: privateAbi, functionName: 'getReserves' }),
        client.readContract({ address: HACKATHON.stateView as `0x${string}`, abi: stateViewAbi, functionName: 'getSlot0', args: [p.poolId as `0x${string}`] }),
        client.readContract({ address: HACKATHON.launchpad as `0x${string}`, abi: launchpadAbi, functionName: 'clearedPriceOf', args: [p.id as `0x${string}`] }),
        client.readContract({ address: HACKATHON.launchpad as `0x${string}`, abi: launchpadAbi, functionName: 'phaseOf', args: [p.id as `0x${string}`] }),
        client.readContract({ address: HACKATHON.launchpad as `0x${string}`, abi: launchpadAbi, functionName: 'raisedOf', args: [p.id as `0x${string}`] }),
        client.readContract({ address: HACKATHON.root as `0x${string}`, abi: erc20Abi, functionName: 'balanceOf', args: [p.treasury as `0x${string}`] }),
      ]);

      // private: reserves are (currency0, currency1). currency0 = R00T → R00T per parcel = r0/r1.
      const [r0, r1] = reserves as [bigint, bigint];
      const privatePrice = r1 > 0n ? toNum((r0 * WAD) / r1) : null;

      // public: price1/0 = (sqrtP/2^96)^2 = parcel per R00T (c1/c0). R00T per parcel = inverse.
      const sqrtP = (slot0 as unknown as [bigint])[0];
      const price1_0_e18 = (sqrtP * sqrtP * WAD) / (Q96 * Q96); // parcel per R00T, WAD
      const publicPrice = price1_0_e18 > 0n ? toNum((WAD * WAD) / price1_0_e18) : null;

      const clearedPrice = toNum(cleared as bigint);
      const div = privatePrice && publicPrice
        ? Math.round((Math.abs(publicPrice - privatePrice) / Math.max(publicPrice, privatePrice)) * 10000)
        : null;

      setS((prev) => ({
        ...prev,
        privatePrice, publicPrice, clearedPrice,
        phase: Number(phase as number),
        raised: toNum(raised as bigint, 2),
        treasuryRoot: toNum(treasury as bigint, 4),
        divergenceBps: div,
        loading: false, error: null,
      }));
    } catch (e: any) {
      setS((prev) => ({ ...prev, loading: false, error: e?.shortMessage || e?.message || 'read failed' }));
    }
  }, [p.privatePool, p.poolId, p.id, p.treasury]);

  useEffect(() => {
    let alive = true;
    const tick = () => { if (alive) load(); };
    tick();
    const iv = setInterval(tick, pollMs);
    return () => { alive = false; clearInterval(iv); };
  }, [load, pollMs]);

  return { ...s, refetch: load };
}

/** Recompute a v4 poolId from a PoolKey (handy if we launch more parcels from the UI). */
export function computePoolId(c0: string, c1: string, fee: number, tickSpacing: number, hooks: string): `0x${string}` {
  return keccak256(encodeAbiParameters(
    [{ type: 'address' }, { type: 'address' }, { type: 'uint24' }, { type: 'int24' }, { type: 'address' }],
    [c0 as `0x${string}`, c1 as `0x${string}`, fee, tickSpacing, hooks as `0x${string}`],
  ));
}
