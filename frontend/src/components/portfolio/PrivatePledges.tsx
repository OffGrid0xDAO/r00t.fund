/**
 * PrivatePledges — Portfolio section listing the user's anonymous plot pledges
 * and letting them claim each to any wallet (Phase D).
 *
 * Claimable pledges are the encrypted notes stored client-side (usePledge) whose
 * commitment has been indexed (leafIndex resolved) and not yet claimed. "Claim to
 * wallet…" builds a fresh ZK proof over the pledge tree and calls
 * claim(proof, pubSignals, recipient) — paying out to a wallet unlinked from the
 * original deposit.
 */
import { useEffect, useMemo, useState } from 'react';
import { useAccount, usePublicClient, useWalletClient } from 'wagmi';
import { formatUnits, isAddress } from 'viem';
import type { WalletSession } from '../../hooks/useWalletSession';
import { usePledge, type PledgeNote } from '../../hooks/usePledge';
import { useZkProver } from '../../hooks/useZkProver';
import { PLEDGE_VAULT_ABI } from '../../abis/pledge';
import { CHAIN, getExplorerTxUrl } from '../../config';

const fmt = (wei: string) => Number(formatUnits(BigInt(wei), 18)).toLocaleString('en-US', { maximumFractionDigits: 2 });

export function PrivatePledges({ session }: { session: WalletSession }) {
  const { address } = useAccount();
  const publicClient = usePublicClient();
  const { data: walletClient } = useWalletClient();

  const pledge = usePledge(session.viewingKey);
  const zkProver = useZkProver();

  const [recipients, setRecipients] = useState<Record<string, string>>({});
  const [claimingId, setClaimingId] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (pledge.isReady) void pledge.refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pledge.isReady, pledge.notes.length]);

  const { claimable, pending, claimed } = useMemo(() => {
    const claimable: PledgeNote[] = [];
    const pending: PledgeNote[] = [];
    const claimed: PledgeNote[] = [];
    for (const n of pledge.notes) {
      if (n.claimed) claimed.push(n);
      else if (n.leafIndex != null) claimable.push(n);
      else pending.push(n);
    }
    return { claimable, pending, claimed };
  }, [pledge.notes]);

  const doClaim = async (note: PledgeNote) => {
    setErrors((e) => ({ ...e, [note.id]: '' }));
    const recipient = (recipients[note.id] || '').trim();
    if (!isAddress(recipient)) { setErrors((e) => ({ ...e, [note.id]: 'Enter a valid recipient address.' })); return; }
    if (!zkProver.isReady) { setErrors((e) => ({ ...e, [note.id]: 'Prover still loading.' })); return; }
    if (!walletClient || !publicClient || !address) { setErrors((e) => ({ ...e, [note.id]: 'Wallet not ready.' })); return; }
    if (note.leafIndex == null) { setErrors((e) => ({ ...e, [note.id]: 'Pledge not yet indexed.' })); return; }

    try {
      setClaimingId(note.id);
      const { commitments, treeState } = await pledge.fetchPledgeTree();

      const claim = await zkProver.generateClaimProof({
        commitment: {
          nullifier: BigInt(note.nullifier),
          secret: BigInt(note.secret),
          amount: BigInt(note.amount),
          leafIndex: note.leafIndex,
        },
        parcelId: note.parcelId,
        recipient,
        allCommitments: commitments,
        treeState,
      });

      const proof = claim.proof as unknown as readonly [bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint];
      const hash = await walletClient.writeContract({
        address: pledge.pledgeVault as `0x${string}`,
        abi: PLEDGE_VAULT_ABI,
        functionName: 'claim',
        args: [proof, claim.pubSignals, recipient as `0x${string}`],
        chain: CHAIN,
        account: address,
      });
      await publicClient.waitForTransactionReceipt({ hash });

      pledge.markClaimed(note.id, recipient, hash);
    } catch (err) {
      console.error('[PrivatePledges] claim failed', err);
      setErrors((e) => ({ ...e, [note.id]: (err as Error).message || 'Claim failed.' }));
    } finally {
      setClaimingId(null);
    }
  };

  if (!pledge.isReady) {
    return (
      <div className="rounded-lg border border-dashed border-[var(--border)] p-6 text-center">
        <p className="text-sm text-[var(--text-secondary)]">
          Private plot pledging goes live once the pledge vault deploys (Phase C).
        </p>
      </div>
    );
  }

  if (pledge.notes.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-[var(--border)] p-6 text-center">
        <p className="text-sm text-[var(--text-secondary)]">
          No private pledges yet. Fund a plot privately from the pilot map to see it here.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-[var(--text-primary)]">
          <span className="text-[var(--accent)] opacity-60">// </span>private pledges
        </h3>
        <button
          onClick={() => pledge.refresh()}
          disabled={pledge.isLoading}
          className="text-xs font-mono text-[var(--text-muted)] hover:text-[var(--text-primary)] disabled:opacity-50"
        >
          {pledge.isLoading ? 'syncing…' : '↻ refresh'}
        </button>
      </div>

      {claimable.map((n) => (
        <div key={n.id} className="rounded-lg border border-[var(--border)] p-4 bg-[var(--bg-secondary)]">
          <div className="flex items-baseline justify-between mb-2">
            <span className="text-[var(--text-primary)] font-medium">{n.parcelLabel || 'Plot pledge'}</span>
            <span className="font-mono text-sm text-[var(--text-primary)]">{fmt(n.amount)} R00T</span>
          </div>
          <p className="text-[11px] font-mono text-[var(--text-muted)] mb-3">
            claimable · leaf #{n.leafIndex} · parcel {n.parcelId.slice(0, 10)}…
          </p>
          <div className="flex gap-2">
            <input
              value={recipients[n.id] || ''}
              onChange={(e) => setRecipients((r) => ({ ...r, [n.id]: e.target.value }))}
              placeholder="Claim to wallet… (0x…)"
              className="flex-1 min-w-0 px-2.5 py-2 rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] text-sm text-[var(--text-primary)] font-mono"
            />
            <button
              onClick={() => doClaim(n)}
              disabled={claimingId === n.id}
              className="shrink-0 px-3 py-2 rounded-lg text-[var(--accent-ink)] bg-[var(--accent)] font-medium text-sm disabled:opacity-60 hover:opacity-90"
            >
              {claimingId === n.id ? 'Claiming…' : 'Claim'}
            </button>
          </div>
          {errors[n.id] && <p className="mt-1.5 text-[11px] text-[var(--error,#e05555)]">{errors[n.id]}</p>}
        </div>
      ))}

      {pending.map((n) => (
        <div key={n.id} className="rounded-lg border border-[var(--border)] p-4 opacity-70">
          <div className="flex items-baseline justify-between">
            <span className="text-[var(--text-primary)] font-medium">{n.parcelLabel || 'Plot pledge'}</span>
            <span className="font-mono text-sm text-[var(--text-primary)]">{fmt(n.amount)} R00T</span>
          </div>
          <p className="text-[11px] font-mono text-[var(--text-muted)] mt-1">
            pending · waiting for the indexer to confirm the commitment
          </p>
        </div>
      ))}

      {claimed.map((n) => (
        <div key={n.id} className="rounded-lg border border-[var(--border)] p-4 opacity-60">
          <div className="flex items-baseline justify-between">
            <span className="text-[var(--text-secondary)]">{n.parcelLabel || 'Plot pledge'}</span>
            <span className="font-mono text-sm text-[var(--text-secondary)]">{fmt(n.amount)} R00T</span>
          </div>
          <p className="text-[11px] font-mono text-[var(--text-muted)] mt-1">
            claimed{n.claimRecipient ? ` → ${n.claimRecipient.slice(0, 10)}…` : ''}
            {n.claimTxHash && (
              <> · <a href={getExplorerTxUrl(n.claimTxHash)} target="_blank" rel="noreferrer" className="underline">tx ↗</a></>
            )}
          </p>
        </div>
      ))}
    </div>
  );
}

export default PrivatePledges;
