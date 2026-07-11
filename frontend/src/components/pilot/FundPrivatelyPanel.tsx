/**
 * FundPrivatelyPanel — anonymous plot funding (Phase D).
 *
 * Shields R00T into a private note (reusing usePrivateWallet), then records a
 * pledge bound to this plot's parcelId via pledgePrivate. The pledge secrets are
 * stored client-side (usePledge) so the backer can later claim to ANY wallet — the
 * deposit address is never linked to the claim.
 *
 * Self-contained: the pilot map mounts <PlotMapTopo /> with no props, so this
 * panel manages its own wallet/session/prover state internally.
 */
import { useState } from 'react';
import { motion } from 'framer-motion';
import { useAccount, usePublicClient, useWalletClient } from 'wagmi';
import { parseEther, formatUnits } from 'viem';
import type { Plot } from './types';
import { parcelIdOf } from './landBackend';
import { TYPE_COLOR, fmtCompact } from './ui';
import { useWalletSession } from '../../hooks/useWalletSession';
import { usePrivateWallet } from '../../hooks/usePrivateWallet';
import { useZkProver } from '../../hooks/useZkProver';
import { usePledge } from '../../hooks/usePledge';
import { PLEDGE_VAULT_ABI } from '../../abis/pledge';
import { CONTRACTS, CHAIN, getExplorerTxUrl } from '../../config';

const R00T_PRESETS = [10_000, 50_000, 100_000];

type Phase = 'idle' | 'proving' | 'submitting' | 'done';

export function FundPrivatelyPanel({ plot, onClose }: { plot: Plot; onClose: () => void }) {
  const color = TYPE_COLOR[plot.type];
  const parcelId = parcelIdOf(plot.id);

  const { address, isConnected } = useAccount();
  const publicClient = usePublicClient();
  const { data: walletClient } = useWalletClient();
  const session = useWalletSession();

  const { commitments, spendCommitment, fetchAllOnChainCommitments } = usePrivateWallet(
    CONTRACTS.zkAMM,
    CONTRACTS.zkAMMPair,
    session.viewingKey,
  );
  const zkProver = useZkProver();
  const pledge = usePledge(session.viewingKey);

  const [amountStr, setAmountStr] = useState('50000');
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);

  const amount = (() => { try { return parseEther(amountStr || '0'); } catch { return 0n; } })();
  const shieldedBalance = commitments
    .filter((c) => !c.spent)
    .reduce((sum, c) => sum + BigInt(c.amount), 0n);
  const hasShielded = shieldedBalance >= amount && amount > 0n;
  const busy = phase === 'proving' || phase === 'submitting';

  const submit = async () => {
    setError(null);
    if (!isConnected || !address) { setError('Connect a wallet first.'); return; }
    if (!session.isUnlocked) { setError('Unlock your private balance first.'); return; }
    if (!pledge.isReady) { setError('Private pledging goes live after the pledge vault deploys (Phase C).'); return; }
    if (!zkProver.isReady) { setError('ZK prover still loading — try again in a moment.'); return; }
    if (!walletClient || !publicClient) { setError('Wallet not ready.'); return; }
    if (amount <= 0n) { setError('Enter an amount.'); return; }

    // Pick a shielded R00T note large enough to cover the pledge.
    const spendable = commitments.filter(
      (c) => !c.spent && c.nullifier && c.secret && BigInt(c.amount) >= amount,
    );
    if (spendable.length === 0) {
      setError(
        shieldedBalance >= amount
          ? 'No single shielded note covers this. Consolidate in Portfolio first.'
          : 'Shield R00T first (Portfolio → shield), then fund privately.',
      );
      return;
    }
    const note = spendable[0];

    try {
      setPhase('proving');
      const { commitments: allCommitments, treeState } = await fetchAllOnChainCommitments();

      // 1) Spend-proof over the shielded R00T note (reuses the pledge circuit).
      const spend = await zkProver.generatePledgeProof({
        commitment: {
          nullifier: BigInt(note.nullifier!),
          secret: BigInt(note.secret!),
          amount: BigInt(note.amount),
          leafIndex: note.leafIndex,
        },
        pledgeAmount: amount,
        creator: address,
        allCommitments,
        treeState,
      });

      // 2) Fresh pledge commitment bound to this parcel, encrypted to our viewing key.
      const built = await pledge.buildPledge(parcelId, amount, plot.name);

      setPhase('submitting');
      const proof = spend.proof as unknown as readonly [bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint];
      const hash = await walletClient.writeContract({
        address: pledge.pledgeVault as `0x${string}`,
        abi: PLEDGE_VAULT_ABI,
        functionName: 'pledgePrivate',
        args: [
          proof,
          spend.merkleRoot,
          spend.nullifierHash,
          amount,
          spend.publicInputsBinding,
          parcelId,
          built.commitment,
          built.encryptedNote as `0x${string}`,
        ],
        chain: CHAIN,
        account: address,
      });

      await publicClient.waitForTransactionReceipt({ hash });

      // Consume the shielded note; persist the pledge secrets for later claim.
      spendCommitment(note.commitment);
      pledge.storePledge({ ...built.note, pledgeTxHash: hash });

      setTxHash(hash);
      setPhase('done');
    } catch (err) {
      console.error('[FundPrivately] failed', err);
      setError((err as Error).message || 'Private pledge failed.');
      setPhase('idle');
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="absolute inset-0 z-40 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.96, y: 12 }}
        animate={{ scale: 1, y: 0 }}
        exit={{ scale: 0.96, y: 12 }}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-2xl border border-[var(--border)] p-5 md:p-6"
        style={{ background: 'var(--bg-elevated)' }}
      >
        <div className="flex items-start justify-between gap-3 mb-4">
          <div>
            <span className="inline-flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-[0.15em]" style={{ color }}>
              <span className="w-2 h-2 rounded-full" style={{ background: color }} />
              Fund privately
            </span>
            <h3 className="font-display text-xl text-[var(--text-primary)] mt-1 leading-tight">{plot.emoji} {plot.name}</h3>
          </div>
          <button onClick={onClose} className="shrink-0 p-1.5 rounded-md text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-secondary)] transition-colors" aria-label="Close">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>

        {phase === 'done' ? (
          <div className="text-center py-4">
            <div className="text-3xl mb-2">🕶️</div>
            <p className="text-[var(--text-primary)] font-medium mb-1">Private pledge recorded</p>
            <p className="text-sm text-[var(--text-secondary)] mb-3">
              This deposit wallet is <span className="text-[var(--text-primary)] font-medium">not linked</span> to your future claim.
              Claim it to any wallet from Portfolio → Private pledges.
            </p>
            {txHash && (
              <a href={getExplorerTxUrl(txHash)} target="_blank" rel="noreferrer" className="text-xs font-mono underline" style={{ color }}>
                view tx ↗
              </a>
            )}
            <button onClick={onClose} className="mt-4 w-full py-2.5 rounded-lg text-white font-medium text-sm" style={{ background: color }}>
              Done
            </button>
          </div>
        ) : (
          <>
            <p className="text-sm text-[var(--text-secondary)] leading-relaxed mb-4">
              Shield R00T into a private note, then pledge it to this plot. The pledge is bound to the
              parcel — not to you. Only the secret stored in this browser can claim it later.
            </p>

            <div className="flex items-center justify-between mb-2">
              <p className="text-[10px] font-mono uppercase tracking-[0.15em] text-[var(--text-muted)]">Amount (R00T)</p>
              <span className="text-[11px] font-mono text-[var(--text-muted)]">
                shielded: {fmtCompact(Number(formatUnits(shieldedBalance, 18)))}
              </span>
            </div>
            <div className="flex gap-2 mb-2">
              {R00T_PRESETS.map((v) => (
                <button
                  key={v}
                  onClick={() => setAmountStr(String(v))}
                  className={`flex-1 py-2 rounded-lg border text-sm font-medium transition-colors ${amountStr === String(v) ? 'text-[var(--accent-ink)] border-transparent' : 'text-[var(--text-secondary)] border-[var(--border)] hover:border-[var(--accent)]'}`}
                  style={amountStr === String(v) ? { background: color } : { background: 'var(--bg-secondary)' }}
                >
                  {fmtCompact(v)}
                </button>
              ))}
              <input
                type="number" min={0} value={amountStr}
                onChange={(e) => setAmountStr(e.target.value)}
                className="w-24 px-2 py-2 rounded-lg border border-[var(--border)] bg-[var(--bg-secondary)] text-sm text-[var(--text-primary)] text-center font-mono"
              />
            </div>

            {!hasShielded && amount > 0n && (
              <p className="text-[11px] text-[var(--warning,#e0a955)] mb-2">
                Not enough shielded R00T — shield in Portfolio first.
              </p>
            )}

            {error && <p className="text-[11px] text-[var(--error,#e05555)] mb-2">{error}</p>}

            <button
              onClick={submit}
              disabled={busy}
              className="w-full py-3 rounded-lg text-white font-medium text-sm transition-opacity disabled:opacity-60 hover:opacity-90"
              style={{ background: color }}
            >
              {phase === 'proving' ? 'Generating proof…' : phase === 'submitting' ? 'Pledging…' : 'Fund privately'}
            </button>
            <p className="mt-2 text-[10px] font-mono text-[var(--text-muted)] text-center">
              {pledge.isReady ? 'zk-shielded · unlinkable claim' : 'goes live after Phase C deploy'}
            </p>
          </>
        )}
      </motion.div>
    </motion.div>
  );
}

export default FundPrivatelyPanel;
