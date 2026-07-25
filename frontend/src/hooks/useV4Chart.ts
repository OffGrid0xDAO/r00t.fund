/**
 * useV4Chart — per-market price history for the ETHGlobal Sepolia stack, read straight on-chain
 * (no indexer needed): every RegenArbHook `SpreadCaptured` carries BOTH pool prices at a real
 * rebalance, so it doubles as a public+private time series. Plus a live tail (public v4 slot0 +
 * private pool reserves + treasury). Powers the pair-selectable "trades & rebalancing" chart.
 */
import { useEffect, useRef, useState } from 'react';
import { createPublicClient, http, parseAbiItem } from 'viem';
import { HACKATHON } from '../config';
import type { Market } from './useV4Markets';

const logsClient = createPublicClient({ transport: http(HACKATHON.logsRpc) }); // wide-range getLogs (free-tier Alchemy caps to 10 blocks)
const client = createPublicClient({ transport: http(HACKATHON.rpcUrl) });
const spreadEvent = parseAbiItem('event SpreadCaptured(bytes32 indexed marketId, uint256 profit, uint256 uniPriceE18, uint256 privPriceE18)');
const FROM_BLOCK = 11343000n;

const stateViewAbi = [{ type: 'function', name: 'getSlot0', stateMutability: 'view', inputs: [{ type: 'bytes32' }], outputs: [{ type: 'uint160' }, { type: 'int24' }, { type: 'uint24' }, { type: 'uint24' }] }] as const;
const reservesAbi = [{ type: 'function', name: 'getReserves', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }, { type: 'uint256' }] }] as const;

export interface V4Point { x: number; pub: number; priv: number; profit: number; tx: string; block: number }
export interface V4Chart {
  series: V4Point[];      // one point per real rebalance (SpreadCaptured), both prices
  livePub: number | null; // current public v4 price (oriented for display)
  livePriv: number | null;
  treasury: number | null;
  divergenceBps: number | null;
  loading: boolean;
}

// price1/0 (currency1 per currency0) → display price for this market
function orient(m: Market, price1_0: number): number {
  return m.currency0IsRoot ? (price1_0 === 0 ? 0 : 1 / price1_0) : price1_0;
}

export function useV4Chart(market: Market): V4Chart {
  const [s, setS] = useState<V4Chart>({ series: [], livePub: null, livePriv: null, treasury: null, divergenceBps: null, loading: true });
  const arbsRef = useRef<V4Point[]>([]);

  // historical rebalances (once per market switch)
  useEffect(() => {
    let alive = true;
    arbsRef.current = [];
    setS((p) => ({ ...p, series: [], loading: true }));
    (async () => {
      try {
        const logs = await logsClient.getLogs({ address: market.hook as `0x${string}`, event: spreadEvent, fromBlock: FROM_BLOCK, toBlock: 'latest' });
        const pts: V4Point[] = logs.map((l: any, i: number) => ({
          x: Number(l.blockNumber) + i * 1e-6,
          pub: orient(market, Number(l.args.uniPriceE18) / 1e18),
          priv: orient(market, Number(l.args.privPriceE18) / 1e18),
          profit: Number(l.args.profit) / 1e18,
          tx: l.transactionHash,
          block: Number(l.blockNumber),
        }));
        if (alive) { arbsRef.current = pts; setS((p) => ({ ...p, series: pts })); }
      } catch { /* RPC hiccup — live tail still renders */ }
    })();
    return () => { alive = false; };
  }, [market.key]);

  // live tail (public slot0 + private reserves + treasury), polled
  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const [slot0, reserves, treasuryBal] = await Promise.all([
          client.readContract({ address: HACKATHON.stateView as `0x${string}`, abi: stateViewAbi, functionName: 'getSlot0', args: [market.poolId as `0x${string}`] }),
          client.readContract({ address: market.privatePool as `0x${string}`, abi: reservesAbi, functionName: 'getReserves' }),
          market.treasuryIsEth
            ? client.getBalance({ address: market.treasury as `0x${string}` })
            : client.readContract({ address: HACKATHON.root as `0x${string}`, abi: [{ type: 'function', name: 'balanceOf', stateMutability: 'view', inputs: [{ type: 'address' }], outputs: [{ type: 'uint256' }] }] as const, functionName: 'balanceOf', args: [market.treasury as `0x${string}`] }),
        ]);
        const sqrtP = Number((slot0 as unknown as any[])[0]);
        const pub = orient(market, (sqrtP / 2 ** 96) ** 2);
        const [r0, r1] = reserves as [bigint, bigint];
        const priv = orient(market, r0 === 0n ? 0 : Number(r1) / Number(r0));
        const treasury = Number(treasuryBal) / 1e18;
        const divergenceBps = pub > 0 ? Math.round((Math.abs(pub - priv) / pub) * 10000) : null;
        if (!alive) return;
        setS((p) => ({ ...p, livePub: pub, livePriv: priv, treasury, divergenceBps, loading: false,
          series: [...arbsRef.current, { x: Date.now() * 1e-9, pub, priv, profit: 0, tx: '', block: 0 }] }));
      } catch { if (alive) setS((p) => ({ ...p, loading: false })); }
    };
    tick();
    const iv = setInterval(tick, 8000);
    return () => { alive = false; clearInterval(iv); };
  }, [market.key]);

  return s;
}
