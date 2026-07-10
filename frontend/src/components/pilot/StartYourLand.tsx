/**
 * StartYourLand — onboarding flow for other land stewards. They submit their
 * topography + boundary; the pipeline (fuzz-terrain.mjs + gen-zones.mjs, run
 * server-side on ingest) de-georeferences it and auto-divides it into parcels.
 * Their parcels' tokens pair with $R00T. Real geodata never leaves their private
 * store — only fuzzed terrain is published (same firewall as Pilot Project).
 */
import { useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { BASE_TOKEN } from './lands';
import { useLandFactory } from '../../hooks/useLandFactory';

type Step = 0 | 1 | 2 | 3;

interface Files { heightmap?: string; boundary?: string; river?: string }

// parse a GeoJSON polygon ring → normalized [0,1] preview coords (firewall: we
// only keep the SHAPE, normalized; the real lng/lat are dropped on the client).
function parseBoundary(text: string): [number, number][] | null {
  try {
    const g = JSON.parse(text);
    const ring: number[][] | undefined =
      g?.geometry?.coordinates?.[0] ?? g?.coordinates?.[0] ??
      g?.features?.[0]?.geometry?.coordinates?.[0];
    if (!ring || ring.length < 3) return null;
    const xs = ring.map((p) => p[0]), ys = ring.map((p) => p[1]);
    const xmin = Math.min(...xs), xmax = Math.max(...xs), ymin = Math.min(...ys), ymax = Math.max(...ys);
    const w = xmax - xmin || 1, h = ymax - ymin || 1;
    // normalize + flip y (geo north-up → svg y-down)
    return ring.map((p) => [(p[0] - xmin) / w, 1 - (p[1] - ymin) / h]);
  } catch { return null; }
}

export function StartYourLand({ onClose }: { onClose: () => void }) {
  const [step, setStep] = useState<Step>(0);
  const [name, setName] = useState('');
  const [steward, setSteward] = useState('');
  const [region, setRegion] = useState('');
  const [files, setFiles] = useState<Files>({});
  const [supply, setSupply] = useState(1_000_000);
  const [treasury, setTreasury] = useState('');
  const [rootPledge, setRootPledge] = useState(1000);
  const [submitted, setSubmitted] = useState(false);

  const { createLand, status, error, configured, toPledge } = useLandFactory();
  const submitting = status === 'approving' || status === 'creating';

  const handleSubmit = async () => {
    // On-chain path when the factory is deployed + a treasury address is given.
    if (configured && treasury.trim().startsWith('0x')) {
      const res = await createLand({
        name, region,
        boundaryText: files.boundary, topoText: files.heightmap,
        treasury: treasury.trim() as `0x${string}`,
        r00tPledge: toPledge(rootPledge),
      });
      if (res) setSubmitted(true);
      return;
    }
    // Not configured yet → queue locally (demo/onboarding).
    setSubmitted(true);
  };

  const boundary = useMemo(() => (files.boundary ? parseBoundary(files.boundary) : null), [files.boundary]);
  const boundaryPath = useMemo(() => {
    if (!boundary) return '';
    return boundary.map((p, i) => `${i === 0 ? 'M' : 'L'}${(p[0] * 300).toFixed(1)} ${(p[1] * 200).toFixed(1)}`).join(' ') + ' Z';
  }, [boundary]);

  const readFile = (key: keyof Files) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    const r = new FileReader();
    r.onload = () => setFiles((f) => ({ ...f, [key]: String(r.result) }));
    r.readAsText(file);
  };

  const canNext = step === 0 ? name.trim() && region.trim() : step === 1 ? !!files.boundary : true;

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-[120] grid place-items-center p-4 md:p-8"
      style={{ background: 'color-mix(in srgb, var(--bg-primary) 72%, transparent)', backdropFilter: 'blur(6px)' }}
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.96, y: 16 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.96, y: 16 }}
        transition={{ type: 'spring', stiffness: 280, damping: 30 }}
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-2xl rounded-2xl border border-[var(--border)] overflow-hidden"
        style={{ background: 'var(--bg-elevated)', boxShadow: 'var(--shadow-lg)' }}
      >
        {/* header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border)]">
          <div>
            <span className="text-xs tracking-[0.2em] text-[var(--accent-on-bg)] uppercase font-mono">Start your land</span>
            <p className="text-[11px] font-mono text-[var(--text-muted)] mt-0.5">bring your terrain · get it parceled · pair with ${BASE_TOKEN}</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-md text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-secondary)]" aria-label="Close">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>

        {/* stepper */}
        {!submitted && (
          <div className="flex gap-1.5 px-6 pt-4">
            {['Land', 'Topography', 'Token', 'Review'].map((s, i) => (
              <div key={s} className="flex-1">
                <div className="h-1 rounded-full transition-colors" style={{ background: i <= step ? 'var(--accent)' : 'var(--border)' }} />
                <span className={`mt-1 block text-[9px] font-mono uppercase tracking-wide ${i === step ? 'text-[var(--text-primary)]' : 'text-[var(--text-muted)]'}`}>{s}</span>
              </div>
            ))}
          </div>
        )}

        <div className="p-6 max-h-[64vh] overflow-y-auto">
          <AnimatePresence mode="wait">
            {submitted ? (
              <motion.div key="done" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="text-center py-8">
                <div className="text-4xl mb-3">🌱</div>
                <h3 className="font-display text-2xl text-[var(--text-primary)] mb-2">{name || 'Your land'} is queued</h3>
                <p className="text-sm text-[var(--text-secondary)] max-w-sm mx-auto leading-relaxed">
                  Your terrain will be de-georeferenced (fuzzed) and auto-divided into organic parcels.
                  Real coordinates stay in your private store — only fuzzed geometry is published. You'll get
                  naming rights on the first parcels, and every parcel token pairs with ${BASE_TOKEN}.
                </p>
                <button onClick={onClose} className="mt-6 px-6 py-2.5 rounded-xl text-[var(--accent-ink)] font-medium text-sm" style={{ background: 'var(--accent)' }}>Done</button>
              </motion.div>
            ) : step === 0 ? (
              <motion.div key="s0" initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -12 }} className="space-y-4">
                <Field label="Land name">
                  <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Emberfell Commons" className={inputCls} />
                </Field>
                <Field label="Steward (handle / ENS)">
                  <input value={steward} onChange={(e) => setSteward(e.target.value)} placeholder="e.g. emberfell.eth" className={inputCls} />
                </Field>
                <Field label="Region (fuzzy — no exact coordinates)">
                  <input value={region} onChange={(e) => setRegion(e.target.value)} placeholder="e.g. Atlantic coast · burned pine" className={inputCls} />
                  <p className="mt-1 text-[10px] font-mono text-[var(--text-muted)]">🔒 Firewall: exact location is never published. Keep it general.</p>
                </Field>
              </motion.div>
            ) : step === 1 ? (
              <motion.div key="s1" initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -12 }} className="space-y-4">
                <div className="grid sm:grid-cols-2 gap-4">
                  <div className="space-y-4">
                    <Drop label="Boundary (GeoJSON / KML)" hint="polygon of the land edge" done={!!files.boundary} accept=".json,.geojson,.kml" onChange={readFile('boundary')} />
                    <Drop label="Topography (DEM / heightmap)" hint="GeoTIFF or elevation grid" done={!!files.heightmap} accept=".tif,.tiff,.json,.asc" onChange={readFile('heightmap')} />
                    <Drop label="Watercourse (optional)" hint="river / stream line" done={!!files.river} accept=".json,.geojson,.kml" onChange={readFile('river')} />
                  </div>
                  {/* live boundary preview */}
                  <div className="rounded-xl border border-[var(--border)] p-3 grid place-items-center" style={{ background: 'var(--bg-secondary)' }}>
                    {boundaryPath ? (
                      <svg viewBox="0 0 300 200" width="100%">
                        <path d={boundaryPath} fill="var(--accent-on-bg)" fillOpacity={0.1} stroke="var(--accent-on-bg)" strokeWidth={2} strokeLinejoin="round" />
                      </svg>
                    ) : (
                      <p className="text-[11px] font-mono text-[var(--text-muted)] text-center px-4">drop a boundary file to preview the land shape</p>
                    )}
                  </div>
                </div>
                <p className="text-[10px] font-mono text-[var(--text-muted)]">🔒 Files are fuzzed on ingest — the preview only keeps the normalized shape, not coordinates.</p>
              </motion.div>
            ) : step === 2 ? (
              <motion.div key="s2" initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -12 }} className="space-y-4">
                <div className="rounded-xl border border-[var(--border)] p-4" style={{ background: `color-mix(in srgb, var(--accent) 6%, var(--bg-secondary))` }}>
                  <p className="text-sm text-[var(--text-primary)] font-medium mb-1">Parcel tokens pair with ${BASE_TOKEN}</p>
                  <p className="text-xs text-[var(--text-secondary)] leading-relaxed">Every parcel on your land launches its own token, paired against ${BASE_TOKEN} — the universal base currency across all r00t lands. Backers are airdropped parcel tokens on an early-bird curve; pledged value funds your land, never LP.</p>
                </div>
                <Field label="Token supply per parcel">
                  <input type="number" value={supply} onChange={(e) => setSupply(Math.max(1000, Number(e.target.value) || 0))} className={inputCls} />
                </Field>
                <Field label="Land treasury address (receives pledges)">
                  <input value={treasury} onChange={(e) => setTreasury(e.target.value)} placeholder="0x…" className={`${inputCls} font-mono`} />
                </Field>
                <Field label={`$${BASE_TOKEN} pledge (seeds your parcels' liquidity)`}>
                  <input type="number" min={0} value={rootPledge} onChange={(e) => setRootPledge(Math.max(0, Number(e.target.value) || 0))} className={inputCls} />
                  <p className="mt-1 text-[10px] font-mono text-[var(--text-muted)]">Locked at creation as the seed liquidity for your parcel/${BASE_TOKEN} pools — this is the OTC ${BASE_TOKEN} you sell to backers.</p>
                </Field>
              </motion.div>
            ) : (
              <motion.div key="s3" initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -12 }} className="space-y-3">
                {[
                  ['Land', name || '—'], ['Steward', steward || '—'], ['Region', region || '—'],
                  ['Boundary', files.boundary ? '✓ uploaded' : '—'], ['Topography', files.heightmap ? '✓ uploaded' : '— (auto-flat)'],
                  ['Watercourse', files.river ? '✓ uploaded' : '— (none)'],
                  ['Token base', `$${BASE_TOKEN}`], ['Supply / parcel', supply.toLocaleString()], ['Treasury', treasury || '—'],
                  [`$${BASE_TOKEN} pledge`, rootPledge.toLocaleString()],
                ].map(([k, v]) => (
                  <div key={k} className="flex items-center justify-between text-sm border-b border-[var(--border)]/60 pb-2">
                    <span className="text-[var(--text-muted)] font-mono text-xs">{k}</span>
                    <span className="text-[var(--text-primary)]">{v}</span>
                  </div>
                ))}
                <p className="text-[11px] font-mono text-[var(--text-muted)] pt-1">
                  {configured
                    ? `On submit: approve your $${BASE_TOKEN} pledge → createLand on-chain → terrain fuzzed & auto-parceled.`
                    : 'On submit: terrain is fuzzed → auto-parceled → your land goes live for pledges.'}
                </p>
                {status === 'error' && error && (
                  <p className="text-[11px] font-mono text-[var(--error,#e5484d)] pt-1">⚠ {error}</p>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* footer nav */}
        {!submitted && (
          <div className="flex items-center justify-between px-6 py-4 border-t border-[var(--border)]">
            <button onClick={() => (step === 0 ? onClose() : setStep((s) => (s - 1) as Step))} className="px-4 py-2 text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors">
              {step === 0 ? 'Cancel' : 'Back'}
            </button>
            {step < 3 ? (
              <button onClick={() => canNext && setStep((s) => (s + 1) as Step)} disabled={!canNext}
                className="px-6 py-2.5 rounded-xl text-[var(--accent-ink)] font-medium text-sm disabled:opacity-40" style={{ background: 'var(--accent)' }}>
                Continue
              </button>
            ) : (
              <button onClick={handleSubmit} disabled={submitting} className="px-6 py-2.5 rounded-xl text-[var(--accent-ink)] font-medium text-sm disabled:opacity-50" style={{ background: 'var(--accent)' }}>
                {status === 'approving' ? `Approving $${BASE_TOKEN}…` : status === 'creating' ? 'Creating land…' : 'Submit land'}
              </button>
            )}
          </div>
        )}
      </motion.div>
    </motion.div>
  );
}

const inputCls = "w-full px-3 py-2.5 rounded-lg border border-[var(--border)] bg-[var(--bg-secondary)] text-sm text-[var(--text-primary)]";
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-[11px] font-mono uppercase tracking-[0.12em] text-[var(--text-muted)] mb-1.5 block">{label}</span>
      {children}
    </label>
  );
}
function Drop({ label, hint, done, accept, onChange }: { label: string; hint: string; done: boolean; accept: string; onChange: (e: React.ChangeEvent<HTMLInputElement>) => void }) {
  return (
    <label className={`block rounded-xl border border-dashed p-3 cursor-pointer transition-colors ${done ? 'border-[var(--accent)]' : 'border-[var(--border)] hover:border-[var(--text-muted)]'}`}
      style={{ background: done ? 'color-mix(in srgb, var(--accent) 8%, transparent)' : 'transparent' }}>
      <div className="flex items-center justify-between">
        <span className="text-sm text-[var(--text-primary)]">{done ? '✓ ' : '⬆ '}{label}</span>
      </div>
      <span className="text-[10px] font-mono text-[var(--text-muted)]">{hint}</span>
      <input type="file" accept={accept} onChange={onChange} className="hidden" />
    </label>
  );
}

export default StartYourLand;
