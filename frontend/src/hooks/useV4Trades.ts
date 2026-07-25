/**
 * useV4Trades — reads a Sepolia v4 market's PUBLIC swaps (PoolManager `Swap` events for the pool's
 * poolId) and returns them as OHLCVChart `Trade[]` (timestamp ms, price, amount, side). This lets the
 * SAME beautiful candlestick chart render real Sepolia trades per pair — no Ponder required (on-chain
 * getLogs); the indexer is a drop-in speedup later.
 */
import { useEffect, useRef, useState } from 'react';
import { createPublicClient, http, parseAbiItem } from 'viem';
import { HACKATHON } from '../config';
import type { Market } from './useV4Markets';
import type { Trade } from '../components/OHLCVChart/types';

// wide-range logs RPC (Alchemy free tier caps eth_getLogs to 10 blocks); Alchemy for block reads
const logsClient = createPublicClient({ transport: http(HACKATHON.logsRpc) });
const client = createPublicClient({ transport: http(HACKATHON.rpcUrl) });
// v4 PoolManager Swap: id (poolId) is indexed, so we filter to just this market's pool
const swapEvent = parseAbiItem('event Swap(bytes32 indexed id, address indexed sender, int128 amount0, int128 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick, uint24 fee)');
const FROM_BLOCK = 11343000n;

// display price for a market from sqrtPriceX96 (price1/0 = currency1 per currency0)
function priceFor(market: Market, sqrtP: bigint): number {
  const p1_0 = (Number(sqrtP) / 2 ** 96) ** 2;
  return market.currency0IsRoot ? (p1_0 === 0 ? 0 : 1 / p1_0) : p1_0; // orient to the market's priceLabel
}

export function useV4Trades(market: Market | undefined): { trades: Trade[]; loading: boolean } {
  const [trades, setTrades] = useState<Trade[]>([]);
  const [loading, setLoading] = useState(true);
  const blockTsCache = useRef<Map<number, number>>(new Map());

  useEffect(() => {
    if (!market) return;
    let alive = true;
    setLoading(true); setTrades([]);
    (async () => {
      try {
        const logs = await logsClient.getLogs({ address: HACKATHON.poolManager as `0x${string}`, event: swapEvent, args: { id: market.poolId as `0x${string}` }, fromBlock: FROM_BLOCK, toBlock: 'latest' });
        // resolve timestamps per unique block (batched)
        const blocks = [...new Set(logs.map((l: any) => Number(l.blockNumber)))].filter((b) => !blockTsCache.current.has(b));
        await Promise.all(blocks.map(async (bn) => {
          try { const blk = await client.getBlock({ blockNumber: BigInt(bn) }); blockTsCache.current.set(bn, Number(blk.timestamp) * 1000); } catch { blockTsCache.current.set(bn, Date.now()); }
        }));
        const out: Trade[] = logs.map((l: any): any => {
          const a0 = l.args.amount0 as bigint; // signed (pool's perspective)
          const a1 = l.args.amount1 as bigint;
          const price = priceFor(market, l.args.sqrtPriceX96 as bigint);
          const zeroForOne = a0 > 0n; // currency0 into the pool
          // quote = R00T/ETH side, base = the parcel/R00T token side, per this market's ordering
          const quoteAmt = Math.abs(Number(market.currency0IsRoot ? a0 : a1)) / 1e18;
          const baseAmt = Math.abs(Number(market.currency0IsRoot ? a1 : a0)) / 1e18;
          return {
            timestamp: blockTsCache.current.get(Number(l.blockNumber)) || Date.now(),
            price, amount: baseAmt,
            // ethAmount/tokenAmount consumed by the recent-trades TradeRow (quote/base sides)
            ethAmount: quoteAmt, tokenAmount: baseAmt,
            side: (zeroForOne === market.currency0IsRoot ? 'sell' : 'buy') as 'buy' | 'sell',
            txHash: l.transactionHash, blockNumber: Number(l.blockNumber),
          };
        }).filter((t: Trade) => t.price > 0 && isFinite(t.price));
        if (alive) { setTrades(out); setLoading(false); }
      } catch { if (alive) setLoading(false); }
    })();
    return () => { alive = false; };
  }, [market?.key]);

  return { trades, loading };
}
