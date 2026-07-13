/**
 * ParcelFundPanel — patron a real parcel of land, anonymously.
 *
 * The point (what we incentivize): pay with ETH or USDC — 100% funds the ground — and
 * receive a PRIVATE note. Later you claim it to ANY wallet, unlinked from the wallet that
 * paid, for full anonymity: either $R00T (the OTC floor, once the parcel is fully funded)
 * or the parcel token (the upside). One irreversible choice per note (shared nullifier).
 */
import { useMemo, useState } from 'react';
import { useAccount } from 'wagmi';
import { formatEther, isAddress } from 'viem';
import { useLandVault, type LandNote } from '../hooks/useLandVault';
import { useLandPricing } from '../hooks/useLandPricing';
import { CONTRACTS, getExplorerTxUrl } from '../config';

// USD → R00T-equiv (18dp) at the LIVE OTC price.
function usdToRootOut(usd: number, rootPriceE6: bigint): bigint {
  if (!usd || usd <= 0) return 0n;
  const usdE6 = BigInt(Math.floor(usd * 1e6));
  return (usdE6 * 10n ** 18n) / rootPriceE6;
}
function rootOutToEth(rootOut: bigint, rootPriceE6: bigint, ethPriceE6: bigint): bigint {
  const num = rootOut * rootPriceE6;
  return (num + ethPriceE6 - 1n) / ethPriceE6;
}
function rootOutToUsdc(rootOut: bigint, rootPriceE6: bigint): bigint {
  const num = rootOut * rootPriceE6;
  return (num + 10n ** 18n - 1n) / 10n ** 18n;
}

export function ParcelFundPanel() {
  const { address } = useAccount();
  const vault = useLandVault(null);
  const pricing = useLandPricing();
  const [usd, setUsd] = useState('5');
  const [payWith, setPayWith] = useState<'eth' | 'usdc'>('eth');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [tx, setTx] = useState<string | null>(null);

  // claim UI state
  const [recipients, setRecipients] = useState<Record<string, string>>({});
  const [kinds, setKinds] = useState<Record<string, 'root' | 'parcel'>>({});
  const [claimingId, setClaimingId] = useState<string | null>(null);
  const [claimErr, setClaimErr] = useState<Record<string, string>>({});

  const parcelId = CONTRACTS.pilotParcelId;
  const rootOut = useMemo(() => usdToRootOut(parseFloat(usd || '0'), pricing.rootPriceE6), [usd, pricing.rootPriceE6]);
  const ethCost = useMemo(() => rootOutToEth(rootOut, pricing.rootPriceE6, pricing.ethPriceE6), [rootOut, pricing.rootPriceE6, pricing.ethPriceE6]);
  const usdcCost = useMemo(() => rootOutToUsdc(rootOut, pricing.rootPriceE6), [rootOut, pricing.rootPriceE6]);

  const claimable = vault.notes.filter((n) => !n.claimed);
  const claimed = vault.notes.filter((n) => n.claimed);

  const doFund = async () => {
    setErr(null); setTx(null);
    if (rootOut === 0n) { setErr('Enter an amount.'); return; }
    if (!vault.isReady) { setErr('Land vault not configured.'); return; }
    try {
      setBusy(true);
      const res = payWith === 'eth'
        ? await vault.fundETH(parcelId, rootOut, ethCost)
        : await vault.fundUSDC(parcelId, rootOut, usdcCost, CONTRACTS.usdc);
      setTx(res.hash);
    } catch (e) {
      setErr((e as Error).message?.slice(0, 160) || 'Funding failed.');
    } finally { setBusy(false); }
  };

  const doClaim = async (note: LandNote) => {
    setClaimErr((s) => ({ ...s, [note.id]: '' }));
    const recipient = (recipients[note.id] || address || '').trim();
    const kind = kinds[note.id] || 'parcel';
    if (!isAddress(recipient)) { setClaimErr((s) => ({ ...s, [note.id]: 'Enter a valid wallet address.' })); return; }
    try {
      setClaimingId(note.id);
      await vault.claim(note, recipient, kind);
    } catch (e) {
      setClaimErr((s) => ({ ...s, [note.id]: (e as Error).message?.slice(0, 140) || 'Claim failed.' }));
    } finally { setClaimingId(null); }
  };

  if (!vault.isReady) {
    return <div className="rounded-lg border border-dashed border-[var(--border)] p-6 text-center text-sm text-[var(--text-secondary)]">Private funding isn't configured yet.</div>;
  }

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-sm font-semibold text-[var(--text-primary)]">
          <span className="text-[var(--accent)] opacity-60">// </span>patron this parcel · anonymously
        </h3>
        <p className="text-[11px] text-[var(--text-muted)] mt-1 leading-relaxed">
          Pay with <span className="text-[var(--text-secondary)]">ETH or USDC</span> — 100% funds the ground. You get a
          private note you can claim to <span className="text-[var(--accent)]">any wallet</span>, unlinked from the one that paid.
        </p>
      </div>

      {/* Amount + pay-with */}
      <div className="rounded-lg border border-[var(--border)] p-4 bg-[var(--bg-secondary)] space-y-3">
        <div className="flex items-center gap-2">
          <div className="flex-1">
            <label className="text-[10px] font-mono text-[var(--text-muted)]">amount (USD)</label>
            <div className="flex items-center gap-1 mt-1">
              <span className="text-[var(--text-muted)] font-mono text-sm">$</span>
              <input value={usd} onChange={(e) => setUsd(e.target.value)} inputMode="decimal"
                className="flex-1 min-w-0 px-2 py-2 rounded-md border border-[var(--border)] bg-[var(--bg-elevated)] text-sm text-[var(--text-primary)] font-mono" />
            </div>
          </div>
          <div className="pt-4">
            <div className="inline-flex gap-1 p-1 rounded-lg border border-[var(--border)]" style={{ background: 'var(--bg-elevated)' }}>
              {(['eth', 'usdc'] as const).map((p) => (
                <button key={p} onClick={() => setPayWith(p)}
                  className={`px-3 py-1.5 rounded-md text-xs font-medium ${payWith === p ? 'text-[var(--accent-ink)] bg-[var(--accent)]' : 'text-[var(--text-muted)]'}`}>
                  {p.toUpperCase()}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="flex justify-between text-[11px] font-mono text-[var(--text-muted)]">
          <span>you pay ≈ <span className="text-[var(--text-secondary)]">{payWith === 'eth' ? `${Number(formatEther(ethCost)).toFixed(5)} ETH` : `${(Number(usdcCost) / 1e6).toFixed(2)} USDC`}</span></span>
          <span>note value: <span className="text-[var(--accent)]">{Number(formatEther(rootOut)).toLocaleString()} R00T-eq</span></span>
        </div>
        <button onClick={doFund} disabled={busy}
          className="w-full py-2.5 rounded-lg text-[var(--accent-ink)] bg-[var(--accent)] font-medium text-sm disabled:opacity-60 hover:opacity-90">
          {busy ? 'Funding privately…' : `Patron with ${payWith.toUpperCase()}`}
        </button>
        {err && <p className="text-[11px] text-[var(--error,#e05555)] break-words">{err}</p>}
        {tx && <p className="text-[11px] text-[var(--text-muted)]">funded · <a href={getExplorerTxUrl(tx)} target="_blank" rel="noreferrer" className="underline">tx ↗</a> — your private note is below.</p>}
      </div>

      {/* Your private notes → claim to any wallet */}
      {claimable.length > 0 && (
        <div className="space-y-3">
          <p className="text-[11px] font-mono text-[var(--text-muted)]">// your private notes · claim to any wallet</p>
          {claimable.map((n) => {
            const kind = kinds[n.id] || 'parcel';
            return (
              <div key={n.id} className="rounded-lg border border-[var(--border)] p-3 bg-[var(--bg-secondary)]">
                <div className="flex items-baseline justify-between mb-2">
                  <span className="text-xs text-[var(--text-primary)] font-medium">{Number(formatEther(BigInt(n.rootOut))).toLocaleString()} R00T-eq</span>
                  <span className="text-[10px] font-mono text-[var(--text-muted)]">one irreversible choice</span>
                </div>
                <div className="flex gap-2 mb-2">
                  {(['root', 'parcel'] as const).map((k) => (
                    <button key={k} onClick={() => setKinds((s) => ({ ...s, [n.id]: k }))}
                      className={`flex-1 py-1.5 rounded-md border text-[11px] font-medium ${kind === k ? 'text-[var(--accent-ink)] bg-[var(--accent)] border-transparent' : 'text-[var(--text-secondary)] border-[var(--border)]'}`}>
                      {k === 'root' ? 'Claim $R00T (floor)' : 'Claim parcel token'}
                    </button>
                  ))}
                </div>
                <div className="flex gap-2">
                  <input value={recipients[n.id] || ''} onChange={(e) => setRecipients((r) => ({ ...r, [n.id]: e.target.value }))}
                    placeholder={`Claim to wallet… (default: ${(address || '0x…').slice(0, 8)}…)`}
                    className="flex-1 min-w-0 px-2 py-1.5 rounded-md border border-[var(--border)] bg-[var(--bg-elevated)] text-xs text-[var(--text-primary)] font-mono" />
                  <button onClick={() => doClaim(n)} disabled={claimingId === n.id}
                    className="shrink-0 px-3 py-1.5 rounded-md text-[var(--accent-ink)] bg-[var(--accent)] font-medium text-xs disabled:opacity-60">
                    {claimingId === n.id ? 'Claiming…' : 'Claim'}
                  </button>
                </div>
                {claimErr[n.id] && <p className="mt-1 text-[10px] text-[var(--error,#e05555)] break-words">{claimErr[n.id]}</p>}
              </div>
            );
          })}
        </div>
      )}

      {claimed.length > 0 && (
        <p className="text-[10px] font-mono text-[var(--text-muted)]">✓ {claimed.length} note(s) already claimed</p>
      )}
    </div>
  );
}

export default ParcelFundPanel;
