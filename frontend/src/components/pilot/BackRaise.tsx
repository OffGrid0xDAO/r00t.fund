/**
 * BackRaise — inline "back this raise" bid, right on a parcel card. Bid $R00T into the CCA (approve →
 * bid), auto-topping-up test R00T if the wallet is short so backing is effectively one click. Optional
 * "pay with ETH" buys R00T on the base R00T/ETH pool first (via the external swap) then bids.
 */
import { useState } from 'react';
import { useAccount, useWalletClient, usePublicClient, useSwitchChain, useChainId } from 'wagmi';
import { parseEther } from 'viem';
import { HACKATHON } from '../../config';
import { TEST_TOKEN_ABI } from '../../lib/testToken';

const lpBidAbi = [
  { type: 'function', name: 'bid', stateMutability: 'nonpayable', inputs: [{ type: 'bytes32' }, { type: 'uint256' }], outputs: [] },
] as const;
const MAX = 2n ** 255n;
const ROOT_ETH_BUY = (root: string) => `https://app.uniswap.org/swap?outputCurrency=${root}`;

export function BackRaise({ parcelId, ticker, color, auctionEnd, onDone }: {
  parcelId: string; ticker: string; color: string; auctionEnd?: number; onDone?: () => void;
}) {
  const { address } = useAccount();
  const { data: walletClient } = useWalletClient();
  const publicClient = usePublicClient();
  const { switchChainAsync } = useSwitchChain();
  const chainId = useChainId();

  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState(1000);
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState<string>('');

  const root = HACKATHON.root as `0x${string}`;
  const launchpad = HACKATHON.launchpad as `0x${string}`;

  const ended = auctionEnd != null && Math.floor(Date.now() / 1000) >= auctionEnd;

  const back = async () => {
    if (!walletClient || !address || !publicClient || busy) return;
    if (ended) { setStep('✗ window ended — clearAndLaunch it instead'); return; }
    setBusy(true);
    // wait AND check status — a reverted tx still returns a receipt, so we must fail loudly on 'reverted'.
    const tx = async (h: `0x${string}`, label: string) => {
      const r = await publicClient.waitForTransactionReceipt({ hash: h });
      if (r.status !== 'success') throw new Error(`${label} reverted`);
    };
    try {
      if (chainId !== HACKATHON.chainId) await switchChainAsync({ chainId: HACKATHON.chainId });
      const want = parseEther(String(amount));
      const bal = await publicClient.readContract({ address: root, abi: TEST_TOKEN_ABI as any, functionName: 'balanceOf', args: [address] }) as bigint;
      if (bal < want) { setStep('minting test R00T…'); await tx(await walletClient.writeContract({ address: root, abi: TEST_TOKEN_ABI as any, functionName: 'mint', args: [address, want - bal] }), 'mint'); }
      setStep('approving R00T…');
      await tx(await walletClient.writeContract({ address: root, abi: TEST_TOKEN_ABI as any, functionName: 'approve', args: [launchpad, MAX] }), 'approve');
      // simulate first → surfaces the REAL revert reason (e.g. AuctionNotEnded / NotAuction) before spending gas
      setStep('bidding…');
      await publicClient.simulateContract({ account: address, address: launchpad, abi: lpBidAbi, functionName: 'bid', args: [parcelId as `0x${string}`, want] });
      await tx(await walletClient.writeContract({ address: launchpad, abi: lpBidAbi, functionName: 'bid', args: [parcelId as `0x${string}`, want] }), 'bid');
      setStep('✓ backed');
      onDone?.();
      setTimeout(() => { setOpen(false); setStep(''); }, 1500);
    } catch (e: any) {
      setStep('✗ ' + (e?.shortMessage || e?.details || e?.message || 'failed').slice(0, 70));
    } finally { setBusy(false); }
  };

  if (ended) {
    return (
      <div className="w-full py-2 rounded-lg border border-[var(--border)] text-center text-[11px] font-mono text-[var(--text-muted)]" style={{ background: 'var(--bg-secondary)' }}>
        Bidding closed — <span style={{ color }}>clearAndLaunch</span> it from the map to seed the pools.
      </div>
    );
  }
  if (!open) {
    return (
      <button onClick={() => setOpen(true)}
        className="w-full py-2 rounded-lg text-[var(--accent-ink)] font-medium text-sm cursor-pointer transition-transform duration-200 hover:-translate-y-0.5"
        style={{ background: color }}>
        Back ${ticker} with R00T
      </button>
    );
  }

  return (
    <div className="rounded-lg border p-2.5" style={{ borderColor: `${color}55`, background: `color-mix(in srgb, ${color} 6%, transparent)` }}>
      <div className="flex items-center gap-2">
        <input type="number" min={1} value={amount} onChange={(e) => setAmount(Math.max(1, Number(e.target.value) || 0))}
          className="w-full min-w-0 px-2 py-1.5 rounded-md border border-[var(--border)] bg-[var(--bg-elevated)] text-sm font-mono text-[var(--text-primary)] outline-none focus:border-[var(--accent)]" />
        <span className="text-[11px] font-mono text-[var(--text-muted)] shrink-0">R00T</span>
        <button onClick={back} disabled={busy}
          className="shrink-0 px-3 py-1.5 rounded-md text-[var(--accent-ink)] font-semibold text-sm disabled:opacity-60 cursor-pointer" style={{ background: color }}>
          {busy ? '…' : 'Back'}
        </button>
      </div>
      <div className="flex items-center justify-between mt-1.5">
        <a href={ROOT_ETH_BUY(root)} target="_blank" rel="noopener noreferrer" className="text-[10px] font-mono text-[var(--text-muted)] hover:text-[var(--accent-on-bg)]">or buy R00T with ETH ↗</a>
        <span className="text-[10px] font-mono" style={{ color: step.startsWith('✗') ? '#e05555' : 'var(--text-muted)' }}>{step || 'tops up test R00T if short'}</span>
      </div>
    </div>
  );
}

export default BackRaise;
