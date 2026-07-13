/**
 * PlotFundSection — REAL, per-plot anonymous patronage (no imagined data).
 *
 * Every map plot is a real on-chain parcel. This funds the right parcelId via the LandVault:
 * pay ETH or USDC → 100% to the land → you get a PRIVATE note → claim it to ANY wallet
 * (unlinked from the payer) as $R00T (floor) or the parcel token. Reads real raised/target.
 */
import { useCallback, useEffect, useState } from 'react';
import { useAccount, usePublicClient } from 'wagmi';
import { formatEther, isAddress, parseAbi } from 'viem';
import { useLandVault, type LandNote } from '../../hooks/useLandVault';
import { CONTRACTS, getExplorerTxUrl } from '../../config';

const ETH_PRESETS_USD = [10, 25, 100];
const vaultReadAbi = parseAbi([
  'function raisedR00TByParcel(bytes32) view returns (uint256)',
  'function parcelTargetR00T(bytes32) view returns (uint256)',
]);

const usd = (n: number) => `$${n.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
function pidHex(id: number): `0x${string}` { return ('0x' + id.toString(16).padStart(64, '0')) as `0x${string}`; }
// USD → R00T-equiv (18dp) at $0.10/R00T
function usdToRootOut(u: number): bigint { return u > 0 ? (BigInt(Math.floor(u * 1e6)) * 10n ** 18n) / CONTRACTS.rootPriceE6 : 0n; }
function rootOutToEth(r: bigint): bigint { const n = r * CONTRACTS.rootPriceE6; return (n + CONTRACTS.ethPriceE6 - 1n) / CONTRACTS.ethPriceE6; }
function rootOutToUsdc(r: bigint): bigint { const n = r * CONTRACTS.rootPriceE6; return (n + 10n ** 18n - 1n) / 10n ** 18n; }

export function PlotFundSection({ ticker, color }: { ticker: string; color: string }) {
  const { address } = useAccount();
  const publicClient = usePublicClient();
  const vault = useLandVault(null);

  const parcelId = CONTRACTS.parcelIdByTicker[ticker];
  const parcelIdHex = parcelId ? pidHex(parcelId) : null;

  const [usdAmt, setUsdAmt] = useState(10);
  const [pay, setPay] = useState<'eth' | 'usdc'>('eth');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [tx, setTx] = useState<string | null>(null);
  const [raised, setRaised] = useState<bigint | null>(null);
  const [target, setTarget] = useState<bigint | null>(null);

  const [recipients, setRecipients] = useState<Record<string, string>>({});
  const [kinds, setKinds] = useState<Record<string, 'root' | 'parcel'>>({});
  const [claimingId, setClaimingId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!publicClient || !parcelIdHex || !vault.isReady) return;
    try {
      const [r, t] = await Promise.all([
        publicClient.readContract({ address: vault.vault, abi: vaultReadAbi, functionName: 'raisedR00TByParcel', args: [parcelIdHex] }),
        publicClient.readContract({ address: vault.vault, abi: vaultReadAbi, functionName: 'parcelTargetR00T', args: [parcelIdHex] }),
      ]);
      setRaised(r as bigint); setTarget(t as bigint);
    } catch { /* ignore */ }
  }, [publicClient, parcelIdHex, vault.isReady, vault.vault]);
  useEffect(() => { refresh(); }, [refresh]);

  const rootOut = usdToRootOut(usdAmt);
  const ethCost = rootOutToEth(rootOut);
  const usdcCost = rootOutToUsdc(rootOut);
  // real $ progress (R00T × $0.10)
  const raisedUsd = raised != null ? Number(formatEther(raised)) * 0.1 : null;
  const targetUsd = target != null ? Number(formatEther(target)) * 0.1 : null;
  const progress = raisedUsd != null && targetUsd ? Math.min(100, (raisedUsd / targetUsd) * 100) : 0;

  const notes = vault.notes.filter((n) => parcelIdHex && n.parcelId.toLowerCase() === parcelIdHex.toLowerCase());
  const claimable = notes.filter((n) => !n.claimed);

  const doFund = async () => {
    setErr(null); setTx(null);
    if (!parcelIdHex) { setErr('This plot isn\'t on-chain yet.'); return; }
    if (rootOut === 0n) { setErr('Enter an amount.'); return; }
    if (!vault.isReady) { setErr('Land vault not configured.'); return; }
    try {
      setBusy(true);
      const res = pay === 'eth'
        ? await vault.fundETH(parcelIdHex, rootOut, ethCost)
        : await vault.fundUSDC(parcelIdHex, rootOut, usdcCost, CONTRACTS.usdc);
      setTx(res.hash);
      if (publicClient) await publicClient.waitForTransactionReceipt({ hash: res.hash });
      refresh();
    } catch (e) { setErr((e as Error).message?.slice(0, 150) || 'Funding failed.'); }
    finally { setBusy(false); }
  };

  const doClaim = async (note: LandNote) => {
    const recipient = (recipients[note.id] || address || '').trim();
    const kind = kinds[note.id] || 'parcel';
    if (!isAddress(recipient)) { setErr('Enter a valid wallet address.'); return; }
    try { setClaimingId(note.id); await vault.claim(note, recipient, kind); }
    catch (e) { setErr((e as Error).message?.slice(0, 150) || 'Claim failed.'); }
    finally { setClaimingId(null); }
  };

  if (!parcelIdHex) {
    return <p className="text-[11px] font-mono text-[var(--text-muted)] py-2">This plot isn't fundable yet.</p>;
  }

  return (
    <div className="space-y-3">
      {/* real progress */}
      <div className="rounded-xl border border-[var(--border)] p-4" style={{ background: 'var(--bg-secondary)' }}>
        <div className="flex items-baseline justify-between mb-2">
          <span className="font-display text-lg text-[var(--text-primary)]">{raisedUsd != null ? usd(raisedUsd) : '…'}</span>
          <span className="text-xs font-mono text-[var(--text-muted)]">of {targetUsd != null ? usd(targetUsd) : '…'}</span>
        </div>
        <div className="h-2 rounded-full overflow-hidden" style={{ background: 'var(--border)' }}>
          <div className="h-full rounded-full transition-all" style={{ background: color, width: `${progress}%` }} />
        </div>
        <p className="mt-2 text-[10px] font-mono text-[var(--text-muted)]">on-chain · 100% funds the land · patronage only</p>
      </div>

      {/* fund */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <p className="text-[10px] font-mono uppercase tracking-[0.15em] text-[var(--text-muted)]">Patron this plot · anonymously</p>
          <div className="inline-flex rounded-lg border border-[var(--border)] overflow-hidden text-[11px] font-mono">
            {(['eth', 'usdc'] as const).map((a) => (
              <button key={a} onClick={() => setPay(a)} className={`px-2.5 py-1 ${pay === a ? 'text-[var(--accent-ink)]' : 'text-[var(--text-muted)]'}`} style={pay === a ? { background: color } : undefined}>{a.toUpperCase()}</button>
            ))}
          </div>
        </div>
        <div className="flex gap-2 mb-2">
          {ETH_PRESETS_USD.map((v) => (
            <button key={v} onClick={() => setUsdAmt(v)} className={`flex-1 py-2 rounded-lg border text-sm font-medium ${usdAmt === v ? 'text-[var(--accent-ink)] border-transparent' : 'text-[var(--text-secondary)] border-[var(--border)]'}`} style={usdAmt === v ? { background: color } : { background: 'var(--bg-elevated)' }}>{usd(v)}</button>
          ))}
          <input type="number" min={1} value={usdAmt} onChange={(e) => setUsdAmt(Math.max(1, Number(e.target.value) || 0))}
            className="w-20 px-2 py-2 rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] text-sm text-[var(--text-primary)] text-center font-mono" />
        </div>
        <button onClick={doFund} disabled={busy} className="w-full py-3 rounded-lg text-[var(--accent-ink)] font-medium text-sm disabled:opacity-60 hover:opacity-90" style={{ background: color }}>
          {busy ? 'Funding privately…' : `Patron ${pay === 'eth' ? `${Number(formatEther(ethCost)).toFixed(4)} ETH` : `${(Number(usdcCost) / 1e6).toFixed(2)} USDC`} → private note`}
        </button>
        <p className="mt-1.5 text-[10px] font-mono text-[var(--text-muted)] text-center">
          you get a shielded note · claim it to <span style={{ color }}>any wallet</span> as $R00T or ${ticker}
        </p>
        {err && <p className="mt-1 text-[11px] text-[var(--error,#e05555)] break-words">{err}</p>}
        {tx && <p className="mt-1 text-[11px] text-[var(--text-muted)]">funded · <a href={getExplorerTxUrl(tx)} target="_blank" rel="noreferrer" className="underline">tx ↗</a></p>}
      </div>

      {/* your notes → claim to any wallet */}
      {claimable.length > 0 && (
        <div className="space-y-2 pt-1">
          <p className="text-[10px] font-mono uppercase tracking-[0.12em] text-[var(--text-muted)]">Your private notes · claim anywhere</p>
          {claimable.map((n) => {
            const kind = kinds[n.id] || 'parcel';
            return (
              <div key={n.id} className="rounded-lg border border-[var(--border)] p-2.5" style={{ background: 'var(--bg-secondary)' }}>
                <div className="flex gap-1.5 mb-2">
                  {(['root', 'parcel'] as const).map((k) => (
                    <button key={k} onClick={() => setKinds((s) => ({ ...s, [n.id]: k }))} className={`flex-1 py-1 rounded-md border text-[10px] font-medium ${kind === k ? 'text-[var(--accent-ink)] border-transparent' : 'text-[var(--text-secondary)] border-[var(--border)]'}`} style={kind === k ? { background: color } : undefined}>
                      {k === 'root' ? '$R00T (floor)' : `$${ticker}`}
                    </button>
                  ))}
                </div>
                <div className="flex gap-2">
                  <input value={recipients[n.id] || ''} onChange={(e) => setRecipients((r) => ({ ...r, [n.id]: e.target.value }))}
                    placeholder={`wallet… (default ${(address || '0x…').slice(0, 6)}…)`}
                    className="flex-1 min-w-0 px-2 py-1.5 rounded-md border border-[var(--border)] bg-[var(--bg-elevated)] text-[11px] text-[var(--text-primary)] font-mono" />
                  <button onClick={() => doClaim(n)} disabled={claimingId === n.id} className="shrink-0 px-2.5 py-1.5 rounded-md text-[var(--accent-ink)] text-[11px] font-medium disabled:opacity-60" style={{ background: color }}>
                    {claimingId === n.id ? '…' : 'Claim'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default PlotFundSection;
