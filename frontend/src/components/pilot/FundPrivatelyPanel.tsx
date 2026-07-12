/**
 * FundPrivatelyPanel — private plot funding against the deployed LandVault.
 *
 * Pay ETH → 100% to the land treasury → a shielded commitment bound to this parcel.
 * The deposit wallet is never linked to the later claim, which can go to ANY wallet
 * (R00T floor OR the parcel token — one irreversible choice) from Portfolio.
 * Proof-gen is the on-chain-validated path in useLandVault.
 */
import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { useAccount, usePublicClient } from 'wagmi';
import { formatEther } from 'viem';
import type { Plot } from './types';
import { parcelIdOf } from './landBackend';
import { TYPE_COLOR, fmtCompact } from './ui';
import { useWalletSession } from '../../hooks/useWalletSession';
import { useLandVault } from '../../hooks/useLandVault';
import { CONTRACTS, getExplorerTxUrl } from '../../config';

const R00T_PRESETS = [100, 1_000, 10_000]; // R00T-equivalent you'll be able to claim

type Phase = 'idle' | 'proving' | 'submitting' | 'done';

const LAND_ABI = [
  { type: 'function', name: 'rootPriceE6', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'ethPriceE6', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
] as const;

export function FundPrivatelyPanel({ plot, onClose }: { plot: Plot; onClose: () => void }) {
  const color = TYPE_COLOR[plot.type];
  const parcelId = parcelIdOf(plot.id);

  const { isConnected } = useAccount();
  const publicClient = usePublicClient();
  const session = useWalletSession();
  const vault = useLandVault(session.viewingKey);

  const [rootOutStr, setRootOutStr] = useState('1000');
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [prices, setPrices] = useState<{ root: bigint; eth: bigint } | null>(null);

  // read the OTC prices from the Land so ethNeeded matches the contract exactly
  useEffect(() => {
    (async () => {
      if (!publicClient || CONTRACTS.pilotLand === '0x...') return;
      try {
        const [root, eth] = await Promise.all([
          publicClient.readContract({ address: CONTRACTS.pilotLand as `0x${string}`, abi: LAND_ABI, functionName: 'rootPriceE6' }),
          publicClient.readContract({ address: CONTRACTS.pilotLand as `0x${string}`, abi: LAND_ABI, functionName: 'ethPriceE6' }),
        ]);
        setPrices({ root: root as bigint, eth: eth as bigint });
      } catch { /* fall back to known deploy prices */ setPrices({ root: 100000n, eth: 3000000000n }); }
    })();
  }, [publicClient]);

  const rootOut = (() => { try { return BigInt(Math.floor(Number(rootOutStr || '0'))) * 10n ** 18n; } catch { return 0n; } })();
  const ethNeeded = prices && rootOut > 0n ? (rootOut * prices.root + prices.eth - 1n) / prices.eth : 0n;
  const busy = phase === 'proving' || phase === 'submitting';

  const submit = async () => {
    setError(null);
    if (!isConnected) { setError('Connect a wallet first.'); return; }
    if (!vault.isReady) { setError('LandVault not configured.'); return; }
    if (rootOut <= 0n || ethNeeded <= 0n) { setError('Enter an amount.'); return; }
    try {
      setPhase('proving');
      const { hash } = await vault.fundETH(parcelId, rootOut, ethNeeded);
      setPhase('submitting');
      if (publicClient) await publicClient.waitForTransactionReceipt({ hash });
      setTxHash(hash);
      setPhase('done');
    } catch (err) {
      console.error('[FundPrivately] failed', err);
      setError((err as Error).message || 'Private funding failed.');
      setPhase('idle');
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="absolute inset-0 z-40 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.96, y: 12 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.96, y: 12 }}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-2xl border border-[var(--border)] p-5 md:p-6"
        style={{ background: 'var(--bg-elevated)' }}
      >
        <div className="flex items-start justify-between gap-3 mb-4">
          <div>
            <span className="inline-flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-[0.15em]" style={{ color }}>
              <span className="w-2 h-2 rounded-full" style={{ background: color }} /> Fund privately
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
            <p className="text-[var(--text-primary)] font-medium mb-1">Funded privately</p>
            <p className="text-sm text-[var(--text-secondary)] mb-3">
              100% went to the land. This wallet is <span className="text-[var(--text-primary)] font-medium">not linked</span> to
              your claim — claim to any wallet from Portfolio → Private funds (R00T <em>or</em> the parcel token, one choice).
            </p>
            {txHash && <a href={getExplorerTxUrl(txHash)} target="_blank" rel="noreferrer" className="text-xs font-mono underline" style={{ color }}>view tx ↗</a>}
            <button onClick={onClose} className="mt-4 w-full py-2.5 rounded-lg text-[var(--accent-ink)] font-medium text-sm" style={{ background: color }}>Done</button>
          </div>
        ) : (
          <>
            <p className="text-sm text-[var(--text-secondary)] leading-relaxed mb-4">
              Pay ETH to fund this plot. 100% goes to the ground. You get a private claim — redeemable later to
              any wallet as $R00T (the OTC floor, once fully funded) or the parcel token.
            </p>

            <div className="flex items-center justify-between mb-2">
              <p className="text-[10px] font-mono uppercase tracking-[0.15em] text-[var(--text-muted)]">Claimable $R00T</p>
              <span className="text-[11px] font-mono text-[var(--text-muted)]">
                ≈ {ethNeeded > 0n ? formatEther(ethNeeded) : '—'} ETH
              </span>
            </div>
            <div className="flex gap-2 mb-3">
              {R00T_PRESETS.map((v) => (
                <button key={v} onClick={() => setRootOutStr(String(v))}
                  className={`flex-1 py-2 rounded-lg border text-sm font-medium transition-colors ${rootOutStr === String(v) ? 'text-[var(--accent-ink)] border-transparent' : 'text-[var(--text-secondary)] border-[var(--border)] hover:border-[var(--accent)]'}`}
                  style={rootOutStr === String(v) ? { background: color } : { background: 'var(--bg-secondary)' }}>
                  {fmtCompact(v)}
                </button>
              ))}
              <input type="number" min={0} value={rootOutStr} onChange={(e) => setRootOutStr(e.target.value)}
                className="w-24 px-2 py-2 rounded-lg border border-[var(--border)] bg-[var(--bg-secondary)] text-sm text-[var(--text-primary)] text-center font-mono" />
            </div>

            {error && <p className="text-[11px] text-[var(--error,#e05555)] mb-2 break-words">{error}</p>}

            <button onClick={submit} disabled={busy || !vault.isReady}
              className="w-full py-3 rounded-lg text-[var(--accent-ink)] font-medium text-sm transition-opacity disabled:opacity-60 hover:opacity-90"
              style={{ background: color }}>
              {phase === 'proving' ? 'Generating proof…' : phase === 'submitting' ? 'Funding…' : `Fund privately (${ethNeeded > 0n ? Number(formatEther(ethNeeded)).toFixed(4) : '…'} ETH)`}
            </button>
            <p className="mt-2 text-[10px] font-mono text-[var(--text-muted)] text-center">zk-shielded · unlinkable claim to any wallet</p>
          </>
        )}
      </motion.div>
    </motion.div>
  );
}

export default FundPrivatelyPanel;
