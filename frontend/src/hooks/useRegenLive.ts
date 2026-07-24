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
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPublicClient, http, keccak256, encodeAbiParameters, parseAbiItem } from 'viem';
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

export interface SeriesPoint { t: number; priv: number; pub: number; treasury: number; }
export interface ArbEvent { block: number; profit: number; uni: number; priv: number; } // prices R00T/parcel

export interface RegenLive {
  privatePrice: number | null;   // R00T per parcel token, private pool
  publicPrice: number | null;    // R00T per parcel token, public v4 pool
  clearedPrice: number | null;   // R00T per parcel token, CCA clear
  phase: number | null;          // 0 None · 1 Auction · 2 Live
  raised: number | null;         // R00T raised in the CCA
  treasuryRoot: number | null;   // R00T sitting in the parcel regen treasury
  divergenceBps: number | null;  // |pub-priv| / max * 10000
  series: SeriesPoint[];         // rolling live poll of both pool prices + treasury
  arbs: ArbEvent[];              // on-chain SpreadCaptured events (each = a real rebalance)
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

const spreadEvent = parseAbiItem('event SpreadCaptured(bytes32 indexed marketId, uint256 profit, uint256 uniPriceE18, uint256 privPriceE18)');
const ARB_FROM_BLOCK = 11343000n; // just before the live launch — bounds the getLogs range
const inv = (e18: bigint) => (e18 > 0n ? Number((10n ** 36n * 1_000_000n / e18)) / 1e6 : 0); // OAK/ROOT → R00T/OAK

function toNum(x: bigint, dp = 6): number {
  return Number((x * BigInt(10 ** dp)) / WAD) / 10 ** dp;
}

export function useRegenLive(pollMs = 8000): RegenLive {
  const p = HACKATHON.parcel;
  const seriesRef = useRef<SeriesPoint[]>([]);
  const [s, setS] = useState<RegenLive>({
    privatePrice: null, publicPrice: null, clearedPrice: null, phase: null, raised: null,
    treasuryRoot: null, divergenceBps: null, series: [], arbs: [], loading: true, error: null, refetch: () => {},
  });

  // read the on-chain arb history once (each SpreadCaptured = one real rebalance).
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const logs = await client.getLogs({
          address: HACKATHON.hook as `0x${string}`, event: spreadEvent,
          args: { marketId: p.id as `0x${string}` }, fromBlock: ARB_FROM_BLOCK, toBlock: 'latest',
        });
        const arbs: ArbEvent[] = logs.map((l: any) => ({
          block: Number(l.blockNumber),
          profit: toNum(l.args.profit as bigint, 4),
          uni: inv(l.args.uniPriceE18 as bigint),
          priv: inv(l.args.privPriceE18 as bigint),
        }));
        if (alive) setS((prev) => ({ ...prev, arbs }));
      } catch { /* getLogs range/RPC hiccup — chart still works off the live series */ }
    })();
    return () => { alive = false; };
  }, [p.id]);

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
      const treasuryRoot = toNum(treasury as bigint, 4);
      const div = privatePrice && publicPrice
        ? Math.round((Math.abs(publicPrice - privatePrice) / Math.max(publicPrice, privatePrice)) * 10000)
        : null;

      // append to the rolling live series (cap 60 points ≈ 8 min at 8s)
      if (privatePrice != null && publicPrice != null) {
        const next = [...seriesRef.current, { t: Date.now(), priv: privatePrice, pub: publicPrice, treasury: treasuryRoot }];
        seriesRef.current = next.slice(-60);
      }

      setS((prev) => ({
        ...prev,
        privatePrice, publicPrice, clearedPrice,
        phase: Number(phase as number),
        raised: toNum(raised as bigint, 2),
        treasuryRoot,
        divergenceBps: div,
        series: seriesRef.current,
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
