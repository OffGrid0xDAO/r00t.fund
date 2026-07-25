/**
 * useCCAAuctions — reads every parcel raise from the RegenLaunchpad (our uniform-price Continuous
 * Clearing Auction) so the frontend can show LIVE ongoing raises + launched markets. Auctions are
 * discovered from AuctionStarted events (the mapping isn't enumerable), then each parcel's live state
 * (phase, raised, cleared price, your bid) is read on-chain. On clear the launchpad seeds a REAL
 * Uniswap v4 pool at the cleared price — so a raise becomes a live v4 market.
 */
import { useCallback, useEffect, useState } from 'react';
import { createPublicClient, http, parseAbiItem } from 'viem';
import { HACKATHON } from '../config';

const logsClient = createPublicClient({ transport: http(HACKATHON.logsRpc) }); // wide-range getLogs (free-tier Alchemy caps to 10 blocks)
const client = createPublicClient({ transport: http(HACKATHON.rpcUrl) });
const auctionStarted = parseAbiItem('event AuctionStarted(bytes32 indexed parcelId, uint64 end, uint256 reservePriceR00T)');
const parcelCreated = parseAbiItem('event ParcelCreated(bytes32 indexed parcelId, address indexed steward, address token, uint256 saleTokens, uint256 poolTokens)');
const FROM_BLOCK = 11343000n;

const lpAbi = [
  { type: 'function', name: 'phaseOf', stateMutability: 'view', inputs: [{ type: 'bytes32' }], outputs: [{ type: 'uint8' }] },
  { type: 'function', name: 'raisedOf', stateMutability: 'view', inputs: [{ type: 'bytes32' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'clearedPriceOf', stateMutability: 'view', inputs: [{ type: 'bytes32' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'parcelTokenOf', stateMutability: 'view', inputs: [{ type: 'bytes32' }], outputs: [{ type: 'address' }] },
  { type: 'function', name: 'bidsR00T', stateMutability: 'view', inputs: [{ type: 'bytes32' }, { type: 'address' }], outputs: [{ type: 'uint256' }] },
] as const;
const symbolAbi = [{ type: 'function', name: 'symbol', stateMutability: 'view', inputs: [], outputs: [{ type: 'string' }] }] as const;

export interface Auction {
  parcelId: string; token: string; ticker: string;
  saleTokens: number; poolTokens: number;
  reservePrice: number;   // R00T per token floor
  auctionEnd: number;     // unix seconds
  phase: number;          // 0 None, 1 Auction, 2 Live
  raised: number;         // R00T
  clearedPrice: number;   // R00T per token (0 until launched)
  impliedPrice: number;   // raised/saleTokens (>= reserve)
  myBid: number;          // your escrowed R00T
}

export function useCCAAuctions(me?: string): { auctions: Auction[]; loading: boolean; refetch: () => void } {
  const [auctions, setAuctions] = useState<Auction[]>([]);
  const [loading, setLoading] = useState(true);
  const [nonce, setNonce] = useState(0);
  const refetch = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [starts, created] = await Promise.all([
          logsClient.getLogs({ address: HACKATHON.launchpad as `0x${string}`, event: auctionStarted, fromBlock: FROM_BLOCK, toBlock: 'latest' }),
          logsClient.getLogs({ address: HACKATHON.launchpad as `0x${string}`, event: parcelCreated, fromBlock: FROM_BLOCK, toBlock: 'latest' }),
        ]);
        const createdBy: Record<string, any> = {};
        for (const c of created as any[]) createdBy[String(c.args.parcelId).toLowerCase()] = c.args;

        const out = await Promise.all((starts as any[]).map(async (s) => {
          const pid = String(s.args.parcelId);
          const cr = createdBy[pid.toLowerCase()] || {};
          const [phase, raised, cleared, token] = await Promise.all([
            client.readContract({ address: HACKATHON.launchpad as `0x${string}`, abi: lpAbi, functionName: 'phaseOf', args: [pid as `0x${string}`] }),
            client.readContract({ address: HACKATHON.launchpad as `0x${string}`, abi: lpAbi, functionName: 'raisedOf', args: [pid as `0x${string}`] }),
            client.readContract({ address: HACKATHON.launchpad as `0x${string}`, abi: lpAbi, functionName: 'clearedPriceOf', args: [pid as `0x${string}`] }),
            client.readContract({ address: HACKATHON.launchpad as `0x${string}`, abi: lpAbi, functionName: 'parcelTokenOf', args: [pid as `0x${string}`] }),
          ]);
          let ticker = 'TKN';
          try { ticker = (await client.readContract({ address: token as `0x${string}`, abi: symbolAbi, functionName: 'symbol' })) as string; } catch { /* default */ }
          let myBid = 0;
          if (me) { try { myBid = Number(await client.readContract({ address: HACKATHON.launchpad as `0x${string}`, abi: lpAbi, functionName: 'bidsR00T', args: [pid as `0x${string}`, me as `0x${string}`] })) / 1e18; } catch { /* 0 */ } }
          const saleTokens = Number(cr.saleTokens ?? 0n) / 1e18;
          const raisedN = Number(raised) / 1e18;
          return {
            parcelId: pid, token: String(token), ticker,
            saleTokens, poolTokens: Number(cr.poolTokens ?? 0n) / 1e18,
            reservePrice: Number(s.args.reservePriceR00T) / 1e18,
            auctionEnd: Number(s.args.end), phase: Number(phase), raised: raisedN,
            clearedPrice: Number(cleared) / 1e18,
            impliedPrice: saleTokens > 0 ? raisedN / saleTokens : 0,
            myBid,
          } as Auction;
        }));
        if (alive) { setAuctions(out); setLoading(false); }
      } catch { if (alive) setLoading(false); }
    })();
    return () => { alive = false; };
  }, [me, nonce]);

  return { auctions, loading, refetch };
}
