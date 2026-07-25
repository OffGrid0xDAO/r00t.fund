/**
 * useV4Markets — AUTO-DISCOVERS every regen market from on-chain, so a new pair's chart appears the
 * instant its token launches. The RegenArbHook emits `MarketRegistered(poolId, marketId, privatePool,
 * treasury)` on every register() (i.e. every clearAndLaunch / base-market wiring). We read that event
 * from the known hook(s), merge with the curated list (rich labels/orientation), and derive any NEW
 * parcel market by reading its private pool's tokens. No hardcoding required as tokens get raised.
 *
 * Production note: with the ONE shared hook, a single MarketRegistered feed covers ALL markets — this
 * is exactly what the Ponder indexer keys on (v4_markets table) for the server-side version.
 */
import { useEffect, useState } from 'react';
import { createPublicClient, http, parseAbiItem } from 'viem';
import { HACKATHON } from '../config';

export type Market = {
  key: string; label: string; base: string; quote: string; priceLabel: string;
  poolId: string; hook: string; privatePool: string; treasury: string;
  treasuryIsEth: boolean; currency0IsRoot: boolean;
  currency0: string; currency1: string; fee: number; tickSpacing: number; // v4 PoolKey (for the Quoter)
};

const client = createPublicClient({ transport: http(HACKATHON.rpcUrl) });
const marketRegistered = parseAbiItem('event MarketRegistered(bytes32 indexed poolId, bytes32 indexed marketId, address privatePool, address treasury)');
const FROM_BLOCK = 11343000n;
const ROOT = HACKATHON.root.toLowerCase();

const tokensAbi = [
  { type: 'function', name: 'token0', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { type: 'function', name: 'token1', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { type: 'function', name: 'root', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { type: 'function', name: 'parcel', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
] as const;
const symbolAbi = [{ type: 'function', name: 'symbol', stateMutability: 'view', inputs: [], outputs: [{ type: 'string' }] }] as const;

async function poolTokens(priv: string): Promise<[string, string] | null> {
  try {
    const [t0, t1] = await Promise.all([
      client.readContract({ address: priv as `0x${string}`, abi: tokensAbi, functionName: 'token0' }),
      client.readContract({ address: priv as `0x${string}`, abi: tokensAbi, functionName: 'token1' }),
    ]);
    return [t0 as string, t1 as string];
  } catch {
    try {
      const [r, p] = await Promise.all([
        client.readContract({ address: priv as `0x${string}`, abi: tokensAbi, functionName: 'root' }),
        client.readContract({ address: priv as `0x${string}`, abi: tokensAbi, functionName: 'parcel' }),
      ]);
      return [r as string, p as string];
    } catch { return null; }
  }
}

export function useV4Markets(): { markets: Market[]; loading: boolean } {
  const [markets, setMarkets] = useState<Market[]>([...HACKATHON.markets]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      const byPool = new Map(HACKATHON.markets.map((m) => [m.poolId.toLowerCase(), m as Market]));
      const out: Market[] = [...HACKATHON.markets];
      const hooks = [...new Set(HACKATHON.markets.map((m) => m.hook.toLowerCase()))];
      try {
        for (const hook of hooks) {
          const logs = await client.getLogs({ address: hook as `0x${string}`, event: marketRegistered, fromBlock: FROM_BLOCK, toBlock: 'latest' });
          for (const l of logs as any[]) {
            const poolId = String(l.args.poolId).toLowerCase();
            if (byPool.has(poolId) || out.some((m) => m.poolId.toLowerCase() === poolId)) continue;
            const priv = String(l.args.privatePool);
            const toks = await poolTokens(priv);
            if (!toks) continue;
            const [t0, t1] = toks;
            const parcelTok = t0.toLowerCase() === ROOT ? t1 : t0;
            let sym = 'TKN';
            try { sym = (await client.readContract({ address: parcelTok as `0x${string}`, abi: symbolAbi, functionName: 'symbol' })) as string; } catch { /* keep default */ }
            out.push({
              key: poolId.slice(0, 10), label: `R00T / ${sym}`, base: sym, quote: 'R00T', priceLabel: `R00T/${sym}`,
              poolId, hook, privatePool: priv, treasury: String(l.args.treasury), treasuryIsEth: false,
              currency0IsRoot: t0.toLowerCase() === ROOT,
              currency0: t0, currency1: t1, fee: 3000, tickSpacing: 60, // parcel pools use 0.3% / 60
            });
          }
        }
      } catch { /* discovery best-effort — curated markets still render */ }
      if (alive) { setMarkets(out); setLoading(false); }
    })();
    return () => { alive = false; };
  }, []);

  return { markets, loading };
}
