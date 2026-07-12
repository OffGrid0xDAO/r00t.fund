/**
 * PrivatePledges — Portfolio section for the user's private plot funds (LandVault).
 *
 * Each note is a shielded commitment (stored client-side; recoverable from chain via
 * the SDK viewing key). Claim it to ANY wallet as R00T (OTC floor, once the parcel is
 * fully funded) OR the parcel token — ONE irreversible choice (the shared nullifier
 * makes double-claim impossible on-chain). The merkle proof is built from Ponder, and
 * falls back to reading on-chain Funded logs directly if the indexer is down.
 */
import { useState } from 'react';
import { useAccount, usePublicClient } from 'wagmi';
import { formatUnits, isAddress } from 'viem';
import type { WalletSession } from '../../hooks/useWalletSession';
import { useLandVault, type LandNote } from '../../hooks/useLandVault';
import { getExplorerTxUrl } from '../../config';

const fmt = (wei: string) => Number(formatUnits(BigInt(wei), 18)).toLocaleString('en-US', { maximumFractionDigits: 2 });

export function PrivatePledges({ session }: { session: WalletSession }) {
  const { address } = useAccount();
  const publicClient = usePublicClient();
  const vault = useLandVault(session.viewingKey);

  const [recipients, setRecipients] = useState<Record<string, string>>({});
  const [kinds, setKinds] = useState<Record<string, 'root' | 'parcel'>>({});
  const [claimingId, setClaimingId] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [txById, setTxById] = useState<Record<string, string>>({});

  const claimable = vault.notes.filter((n) => !n.claimed);
  const claimed = vault.notes.filter((n) => n.claimed);

  const doClaim = async (note: LandNote) => {
    setErrors((e) => ({ ...e, [note.id]: '' }));
    const recipient = (recipients[note.id] || address || '').trim();
    const kind = kinds[note.id] || 'parcel';
    if (!isAddress(recipient)) { setErrors((e) => ({ ...e, [note.id]: 'Enter a valid recipient address.' })); return; }
    if (!vault.isReady) { setErrors((e) => ({ ...e, [note.id]: 'LandVault not configured.' })); return; }
    try {
      setClaimingId(note.id);
      const hash = await vault.claim(note, recipient, kind);
      if (publicClient) await publicClient.waitForTransactionReceipt({ hash });
      setTxById((t) => ({ ...t, [note.id]: hash }));
    } catch (err) {
      console.error('[PrivatePledges] claim failed', err);
      setErrors((e) => ({ ...e, [note.id]: (err as Error).message || 'Claim failed.' }));
    } finally {
      setClaimingId(null);
    }
  };

  if (!vault.isReady) {
    return (
      <div className="rounded-lg border border-dashed border-[var(--border)] p-6 text-center">
        <p className="text-sm text-[var(--text-secondary)]">Private plot funding isn't configured yet.</p>
      </div>
    );
  }
  if (vault.notes.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-[var(--border)] p-6 text-center">
        <p className="text-sm text-[var(--text-secondary)]">No private funds yet. Fund a plot privately from the pilot map to see it here.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold text-[var(--text-primary)]">
        <span className="text-[var(--accent)] opacity-60">// </span>private funds
      </h3>

      {claimable.map((n) => {
        const kind = kinds[n.id] || 'parcel';
        return (
          <div key={n.id} className="rounded-lg border border-[var(--border)] p-4 bg-[var(--bg-secondary)]">
            <div className="flex items-baseline justify-between mb-2">
              <span className="text-[var(--text-primary)] font-medium">Plot fund</span>
              <span className="font-mono text-sm text-[var(--text-primary)]">{fmt(n.rootOut)} R00T-eq</span>
            </div>
            <p className="text-[11px] font-mono text-[var(--text-muted)] mb-3">claimable · parcel {n.parcelId.slice(0, 10)}… · one irreversible choice</p>

            {/* R00T vs parcel-token choice */}
            <div className="flex gap-2 mb-2">
              {(['root', 'parcel'] as const).map((k) => (
                <button key={k} onClick={() => setKinds((s) => ({ ...s, [n.id]: k }))}
                  className={`flex-1 py-1.5 rounded-lg border text-xs font-medium transition-colors ${kind === k ? 'text-[var(--accent-ink)] bg-[var(--accent)] border-transparent' : 'text-[var(--text-secondary)] border-[var(--border)]'}`}>
                  {k === 'root' ? 'Claim $R00T (floor)' : 'Claim parcel token'}
                </button>
              ))}
            </div>

            <div className="flex gap-2">
              <input value={recipients[n.id] || ''} onChange={(e) => setRecipients((r) => ({ ...r, [n.id]: e.target.value }))}
                placeholder={`Claim to wallet… (default: ${(address || '0x…').slice(0, 8)}…)`}
                className="flex-1 min-w-0 px-2.5 py-2 rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] text-sm text-[var(--text-primary)] font-mono" />
              <button onClick={() => doClaim(n)} disabled={claimingId === n.id}
                className="shrink-0 px-3 py-2 rounded-lg text-[var(--accent-ink)] bg-[var(--accent)] font-medium text-sm disabled:opacity-60 hover:opacity-90">
                {claimingId === n.id ? 'Claiming…' : 'Claim'}
              </button>
            </div>
            {errors[n.id] && <p className="mt-1.5 text-[11px] text-[var(--error,#e05555)] break-words">{errors[n.id]}</p>}
          </div>
        );
      })}

      {claimed.map((n) => (
        <div key={n.id} className="rounded-lg border border-[var(--border)] p-4 opacity-60">
          <div className="flex items-baseline justify-between">
            <span className="text-[var(--text-secondary)]">Plot fund</span>
            <span className="font-mono text-sm text-[var(--text-secondary)]">{fmt(n.rootOut)} R00T-eq</span>
          </div>
          <p className="text-[11px] font-mono text-[var(--text-muted)] mt-1">
            claimed as {n.claimKind === 'root' ? '$R00T' : 'parcel token'}{n.claimRecipient ? ` → ${n.claimRecipient.slice(0, 10)}…` : ''}
            {txById[n.id] && (<> · <a href={getExplorerTxUrl(txById[n.id])} target="_blank" rel="noreferrer" className="underline">tx ↗</a></>)}
          </p>
        </div>
      ))}
    </div>
  );
}

export default PrivatePledges;
