/**
 * ParcelSwapPanel — clean private parcel↔R00T trading UI (NO Railgun).
 *
 * Shows the live ZkParcelPool reserves + your shielded notes, and lets you:
 *   1. Shield R00T (real R00T → private R00T note)
 *   2. Buy $OAK  (R00T note → private parcel note)
 *   3. Sell $OAK (parcel note → private R00T note)
 * All shielded via the deployed swap/deposit verifiers.
 */
import { useEffect, useState } from 'react';
import { parseEther, formatEther } from 'viem';
import { useZkParcelSwap } from '../hooks/useZkParcelSwap';
import { getExplorerTxUrl } from '../config';

const fmt = (v: bigint) => Number(formatEther(v)).toLocaleString('en-US', { maximumFractionDigits: 2 });

export function ParcelSwapPanel() {
  const p = useZkParcelSwap();
  const [reserves, setReserves] = useState<{ r00tReserve: bigint; parcelReserve: bigint } | null>(null);
  const [shieldAmt, setShieldAmt] = useState('');
  const [tx, setTx] = useState<string | null>(null);

  const refresh = () => { p.getReserves().then(setReserves).catch(() => {}); };
  useEffect(() => { refresh(); const t = setInterval(refresh, 15000); return () => clearInterval(t); /* eslint-disable-next-line */ }, []);

  const doShield = async () => {
    try { const h = await p.shieldR00T(parseEther(shieldAmt || '0')); setTx(h); setShieldAmt(''); refresh(); } catch { /* error shown via hook */ }
  };
  const doBuy = async (id: string) => {
    const note = p.r00tNotes.find((n) => n.id === id); if (!note) return;
    try { const r = await p.buyParcel(note); setTx(r.hash); refresh(); } catch { /* */ }
  };
  const doSell = async (id: string) => {
    const note = p.parcelNotes.find((n) => n.id === id); if (!note) return;
    try { const r = await p.sellParcel(note); setTx(r.hash); refresh(); } catch { /* */ }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-baseline justify-between">
        <h3 className="text-sm font-semibold text-[var(--text-primary)]">
          <span className="text-[var(--accent)] opacity-60">// </span>private parcel swap · $OAK
        </h3>
        <span className="text-[10px] font-mono text-[var(--text-muted)]">shielded, no Railgun</span>
      </div>

      {/* Pool reserves */}
      <div className="rounded-lg border border-[var(--border)] p-4 bg-[var(--bg-secondary)] grid grid-cols-2 gap-3">
        <div>
          <p className="text-[11px] font-mono text-[var(--text-muted)]">R00T reserve</p>
          <p className="font-mono text-sm text-[var(--text-primary)]">{reserves ? fmt(reserves.r00tReserve) : '…'}</p>
        </div>
        <div>
          <p className="text-[11px] font-mono text-[var(--text-muted)]">$OAK reserve</p>
          <p className="font-mono text-sm text-[var(--text-primary)]">{reserves ? fmt(reserves.parcelReserve) : '…'}</p>
        </div>
      </div>

      {/* 1. Shield */}
      <div className="rounded-lg border border-[var(--border)] p-4">
        <p className="text-[11px] font-mono text-[var(--text-muted)] mb-2">1 · shield R00T → private R00T note</p>
        <div className="flex gap-2">
          <input value={shieldAmt} onChange={(e) => setShieldAmt(e.target.value)} placeholder="R00T amount"
            className="flex-1 min-w-0 px-2.5 py-2 rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] text-sm text-[var(--text-primary)] font-mono" />
          <button onClick={doShield} disabled={p.busy}
            className="shrink-0 px-3 py-2 rounded-lg text-[var(--accent-ink)] bg-[var(--accent)] font-medium text-sm disabled:opacity-60">Shield</button>
        </div>
      </div>

      {/* 2. R00T notes → buy $OAK */}
      <div className="rounded-lg border border-[var(--border)] p-4">
        <p className="text-[11px] font-mono text-[var(--text-muted)] mb-2">2 · buy $OAK (spend a R00T note)</p>
        {p.r00tNotes.length === 0 && <p className="text-xs text-[var(--text-muted)]">No R00T notes — shield first.</p>}
        {p.r00tNotes.map((n) => (
          <div key={n.id} className="flex items-center justify-between py-1.5">
            <span className="font-mono text-xs text-[var(--text-secondary)]">{fmt(BigInt(n.amount))} R00T</span>
            <button onClick={() => doBuy(n.id)} disabled={p.busy}
              className="px-2.5 py-1 rounded-md text-[var(--accent-ink)] bg-[var(--accent)] text-xs font-medium disabled:opacity-60">Buy $OAK</button>
          </div>
        ))}
      </div>

      {/* 3. Parcel notes → sell */}
      <div className="rounded-lg border border-[var(--border)] p-4">
        <p className="text-[11px] font-mono text-[var(--text-muted)] mb-2">3 · sell $OAK (spend a parcel note)</p>
        {p.parcelNotes.length === 0 && <p className="text-xs text-[var(--text-muted)]">No $OAK notes yet.</p>}
        {p.parcelNotes.map((n) => (
          <div key={n.id} className="flex items-center justify-between py-1.5">
            <span className="font-mono text-xs text-[var(--text-secondary)]">{fmt(BigInt(n.amount))} $OAK</span>
            <button onClick={() => doSell(n.id)} disabled={p.busy}
              className="px-2.5 py-1 rounded-md border border-[var(--border)] text-[var(--text-secondary)] text-xs font-medium disabled:opacity-60">Sell → R00T</button>
          </div>
        ))}
      </div>

      {p.busy && <p className="text-xs text-[var(--accent)] font-mono animate-pulse">🔒 {p.progress || 'working…'}</p>}
      {p.error && <p className="text-xs text-[var(--error,#e05555)] break-words">{p.error}</p>}
      {tx && <p className="text-xs text-[var(--text-muted)]">last tx · <a href={getExplorerTxUrl(tx)} target="_blank" rel="noreferrer" className="underline">view ↗</a></p>}
    </div>
  );
}

export default ParcelSwapPanel;
