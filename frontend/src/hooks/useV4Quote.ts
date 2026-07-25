/**
 * useV4Quote — REAL swap quotes from the OFFICIAL Uniswap v4 Quoter (Sepolia
 * 0x61b3…9227), via eth_call. Given a market + input amount + direction, returns the exact output the
 * v4 pool would give (our afterSwap hook runs in the quote simulation but the state reverts, so the
 * quote is the honest user output). This is the Uniswap API/stack integration for the swap UI.
 */
import { useEffect, useState } from 'react';
import { createPublicClient, http, parseEther, formatEther } from 'viem';
import { HACKATHON } from '../config';
import type { Market } from './useV4Markets';

const client = createPublicClient({ transport: http(HACKATHON.rpcUrl) });

const quoterAbi = [
  {
    type: 'function', name: 'quoteExactInputSingle', stateMutability: 'nonpayable',
    inputs: [{
      type: 'tuple', name: 'params', components: [
        { type: 'tuple', name: 'poolKey', components: [
          { type: 'address', name: 'currency0' }, { type: 'address', name: 'currency1' },
          { type: 'uint24', name: 'fee' }, { type: 'int24', name: 'tickSpacing' }, { type: 'address', name: 'hooks' },
        ] },
        { type: 'bool', name: 'zeroForOne' }, { type: 'uint128', name: 'exactAmount' }, { type: 'bytes', name: 'hookData' },
      ],
    }],
    outputs: [{ type: 'uint256', name: 'amountOut' }, { type: 'uint256', name: 'gasEstimate' }],
  },
] as const;

export function useV4Quote(market: Market | undefined, amountIn: string, zeroForOne: boolean) {
  const [out, setOut] = useState<{ amountOut: number; gas: number } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!market || !market.currency0 || !amountIn || Number(amountIn) <= 0) { setOut(null); setError(null); return; }
    let alive = true;
    const t = setTimeout(async () => {
      setLoading(true); setError(null);
      try {
        const res = await client.simulateContract({
          address: HACKATHON.quoter as `0x${string}`, abi: quoterAbi, functionName: 'quoteExactInputSingle',
          args: [{
            poolKey: { currency0: market.currency0 as `0x${string}`, currency1: market.currency1 as `0x${string}`, fee: market.fee, tickSpacing: market.tickSpacing, hooks: market.hook as `0x${string}` },
            zeroForOne, exactAmount: parseEther(amountIn), hookData: '0x',
          }],
        });
        const [amountOut, gas] = res.result as unknown as [bigint, bigint];
        if (alive) setOut({ amountOut: Number(formatEther(amountOut)), gas: Number(gas) });
      } catch (e: any) {
        if (alive) { setOut(null); setError('no route / insufficient liquidity'); }
      } finally { if (alive) setLoading(false); }
    }, 350);
    return () => { alive = false; clearTimeout(t); };
  }, [market?.key, amountIn, zeroForOne]);

  return { ...out, loading, error, amountOut: out?.amountOut ?? null };
}
