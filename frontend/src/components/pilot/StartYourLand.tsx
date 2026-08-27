/**
 * StartYourLand — onboarding flow for other land stewards. They submit their
 * topography + boundary; the pipeline (fuzz-terrain.mjs + gen-zones.mjs, run
 * server-side on ingest) de-georeferences it and auto-divides it into parcels.
 * Their parcels' tokens pair with $R00T. Real geodata never leaves their private
 * store — only fuzzed terrain is published (same firewall as Pilot Project).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useAccount, useConnect } from 'wagmi';
import { BASE_TOKEN } from './lands';
import { useLandFactory } from '../../hooks/useLandFactory';
import { useLaunchParcel } from '../../hooks/useLaunchParcel';
import { saveMyLand, pushLandGeometry, type MyLand } from './myLand';
import { StewardIdentity, useStewardEns } from '../StewardIdentity';
import { WorldIdGate } from './WorldIdGate';
import type { Zone } from './data';

type Step = 0 | 1 | 2 | 3 | 4;
interface ParcelDraft { ticker: string; name: string; emoji: string; sale: number; pool: number; floor: number; ha: number; fromMap?: boolean }
const MIN_HA = 0.5; // smallest parcel
// draft autosave — keep what the steward typed (name/region/parcels/…) across close+reopen (files excluded: too big)
const DRAFT_KEY = (addr?: string) => `r00t.landdraft.${(addr || 'anon').toLowerCase()}`;

// distinct ticker from a zone name: initials of long words, keep short tokens (A, B, 2) → UFA, WC, MTA2…
function tickerFromZone(name: string): string {
  const words = name.replace(/[^a-zA-Z0-9\s]/g, ' ').trim().split(/\s+/).filter(Boolean);
  const t = words.map((w) => (w.length <= 2 ? w : w[0])).join('').toUpperCase().slice(0, 6);
  return t || 'PARCEL';
}
// |signed polygon area| in normalized units
function polyAreaAbs(poly: number[][]): number {
  let a = 0;
  for (let i = 0, n = poly.length; i < n; i++) { const [x0, y0] = poly[i], [x1, y1] = poly[(i + 1) % n]; a += x0 * y1 - x1 * y0; }
  return Math.abs(a) / 2;
}
// REAL land area (hectares) from the boundary polygon × the heightmap's extentMeters — no guessing.
function boundaryHa(heightmapText: string): number | null {
  try {
    const g = JSON.parse(heightmapText);
    const b = Array.isArray(g?.propertyBoundary) ? g.propertyBoundary : null;
    const e = g?.extentMeters;
    if (!b || b.length < 3 || !e?.width || !e?.height) return null;
    return polyAreaAbs(b) * e.width * e.height / 1e4; // m² → ha
  } catch { return null; }
}

interface Files { heightmap?: string; boundary?: string; river?: string; zones?: string; contours?: string }

// ── raw terrain-bundle parsers ──────────────────────────────────────────────
// A precomputed bundle (heightmap.propertyBoundary + zones + contours + river) is ALL in one raw
// [0,1] terrain space, so we keep it verbatim → the map renders IDENTICALLY to the pilot demo.
function parseHeightmapBoundary(text: string): number[][] | null {
  try { const g = JSON.parse(text); return Array.isArray(g?.propertyBoundary) && g.propertyBoundary.length >= 3 ? g.propertyBoundary : null; } catch { return null; }
}
function parseZones(text: string): Zone[] | null {
  try { const z = JSON.parse(text); const arr = Array.isArray(z) ? z : Array.isArray(z?.zones) ? z.zones : null; return arr && arr.length ? arr : null; } catch { return null; }
}
function parseContours(text: string): { l: string; p: number[][] }[] | null {
  try { const c = JSON.parse(text); const arr = Array.isArray(c?.contours) ? c.contours : Array.isArray(c) ? c : null; return arr && arr.length ? arr : null; } catch { return null; }
}
function parseRiverPoints(text: string): number[][] | null {
  try { const r = JSON.parse(text); return r?.centerline ?? r?.points ?? r?.geometry?.coordinates ?? null; } catch { return null; }
}
function parseExtentAspect(text: string): number | undefined {
  try { const g = JSON.parse(text); const e = g?.extentMeters; return e?.width && e?.height ? e.width / e.height : undefined; } catch { return undefined; }
}

// Build the renderable land geometry from the uploaded files. When a precomputed terrain bundle
// (heightmap.propertyBoundary + zones) is present we keep the RAW terrain space verbatim so the map
// renders IDENTICALLY to the pilot demo; otherwise we fall back to the normalized boundary + client
// auto-parceling. Shared by BOTH the launch path and render-on-upload so they build identical geometry.
function buildLandObj(files: Files, name: string, region: string, boundary: number[][] | null, launched: boolean): MyLand | null {
  const zones = files.zones ? parseZones(files.zones) : null;
  const rawBoundary = zones ? (files.heightmap ? parseHeightmapBoundary(files.heightmap) : null) : null;
  if (zones && rawBoundary) {
    return {
      name, region,
      boundary: rawBoundary,
      zones,
      contours: (files.contours ? parseContours(files.contours) : null) ?? undefined,
      river: (files.river ? parseRiverPoints(files.river) : null) ?? undefined,
      aspect: files.heightmap ? parseExtentAspect(files.heightmap) : undefined,
      launched, createdAt: Date.now(),
    };
  }
  if (boundary) {
    return {
      name, region,
      boundary,
      river: (files.river ? parseRiverPoints(files.river) : null) ?? undefined,
      launched, createdAt: Date.now(),
    };
  }
  return null;
}

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
  const [hectares, setHectares] = useState(9); // total land size; parcels drawn from this budget
  const [parcels, setParcels] = useState<ParcelDraft[]>([
    { ticker: 'CACTUS', name: 'Cactus Line', emoji: '🌵', sale: 100000, pool: 100000, floor: 0.01, ha: 0.5 },
  ]);
  const [launchLog, setLaunchLog] = useState<string[]>([]);
  const usedHa = parcels.reduce((s, p) => s + (p.ha || 0), 0);
  const remainingHa = Math.max(0, hectares - usedHa);

  const { address } = useAccount();
  const { connect, connectors } = useConnect();
  const { createLand, status, error, configured, toPledge } = useLandFactory();
  const { launch } = useLaunchParcel();
  const { ensName } = useStewardEns();
  // World ID proof-of-humanity (verified in the Launch step) — real humans steward real land.
  const [worldVerified, setWorldVerified] = useState(false);

  // auto-fill the treasury with the connected wallet (the steward receives their own pledges by
  // default). Only prefills while the field is empty, so a manually-entered address is never clobbered.
  useEffect(() => { if (address && !treasury) setTreasury(address); }, [address]); // eslint-disable-line react-hooks/exhaustive-deps
  // auto-fill the steward handle with the wallet's ENS name once resolved (only while empty).
  useEffect(() => { if (ensName && !steward) setSteward(ensName); }, [ensName]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── draft autosave: restore what the steward already filled in (name/region/parcels/…) ──
  const draftLoaded = useRef(false);
  useEffect(() => {
    if (draftLoaded.current) return;
    draftLoaded.current = true;
    try {
      const raw = localStorage.getItem(DRAFT_KEY(address)) || localStorage.getItem(DRAFT_KEY(undefined));
      if (!raw) return;
      const d = JSON.parse(raw);
      if (d.name) setName(d.name);
      if (d.steward) setSteward(d.steward);
      if (d.region) setRegion(d.region);
      if (d.supply) setSupply(d.supply);
      if (d.treasury) setTreasury(d.treasury);
      if (d.rootPledge != null) setRootPledge(d.rootPledge);
      if (d.hectares) setHectares(d.hectares);
      if (Array.isArray(d.parcels) && d.parcels.length) setParcels(d.parcels);
      if (typeof d.step === 'number') setStep(Math.min(d.step, 1) as Step); // re-drop files, so cap at the terrain step
    } catch { /* ignore */ }
  }, [address]);
  useEffect(() => {
    if (submitted) return;
    try { localStorage.setItem(DRAFT_KEY(address), JSON.stringify({ step, name, steward, region, supply, treasury, rootPledge, hectares, parcels })); } catch { /* ignore */ }
  }, [address, step, name, steward, region, supply, treasury, rootPledge, hectares, parcels, submitted]);

  // REAL land area read from the uploaded map (boundary polygon × heightmap extent) — not a guess.
  const landHa = useMemo(() => (files.heightmap ? boundaryHa(files.heightmap) : null), [files.heightmap]);
  // Parcels read straight from the map's zones: each carries its own area share; the steward only NAMES them.
  const mapParcels = useMemo<ParcelDraft[] | null>(() => {
    if (!files.zones || landHa == null) return null;
    const zones = parseZones(files.zones);
    if (!zones || !zones.length) return null;
    const areas = zones.map((z) => polyAreaAbs(z.poly));
    const sum = areas.reduce((a, b) => a + b, 0) || 1;
    return zones.map((z, i) => ({
      ticker: tickerFromZone(z.name || `Parcel ${i + 1}`), name: z.name || `Parcel ${i + 1}`,
      emoji: z.type === 'water' ? '💧' : z.type === 'structure' ? '🪨' : '🌱',
      sale: 100_000, pool: 100_000, floor: 0.01,
      ha: Math.round((areas[i] / sum) * landHa * 100) / 100,
      fromMap: true,
    }));
  }, [files.zones, landHa]);
  // total ha = the real land area when a map is uploaded
  useEffect(() => { if (landHa != null) setHectares(Math.round(landHa * 100) / 100); }, [landHa]);
  // A map ALREADY subdivides the land into parcels — the steward launches each token later from the
  // land map, one at a time (naming it then). So don't pre-name a form here, and don't auto-launch
  // anything on create: just clear the default draft parcel so creating the land only creates the land.
  useEffect(() => { if (mapParcels && mapParcels.length) setParcels([]); }, [mapParcels]);
  const connectWallet = () => {
    const named = connectors.filter((c) => c.name && c.name.toLowerCase() !== 'injected');
    const c = named[0] ?? connectors[0];
    if (c) connect({ connector: c });
  };
  const submitting = status === 'approving' || status === 'creating';

  // treasury for the parcels' regen funds: the land treasury address (or the steward wallet)
  const parcelTreasury = (treasury.trim().startsWith('0x') ? treasury.trim() : address || '') as string;

  function addParcel() { if (remainingHa < MIN_HA) return; setParcels((p) => [...p, { ticker: '', name: '', emoji: '🌱', sale: 100000, pool: 100000, floor: 0.01, ha: Math.min(0.5, remainingHa) }]); }
  function setParcel(i: number, patch: Partial<ParcelDraft>) { setParcels((p) => p.map((x, j) => (j === i ? { ...x, ...patch } : x))); }
  function delParcel(i: number) { setParcels((p) => p.filter((_, j) => j !== i)); }

  const handleSubmit = async () => {
    setLaunchLog([]);
    const log = (s: string) => setLaunchLog((p) => [...p, s]);

    // 1) create the Land on-chain (records name/region/topography cid + commits R00T) when configured.
    //    Treasury defaults to the connected steward wallet if no explicit address was entered.
    let createdLand: string | undefined;
    if (configured && parcelTreasury.startsWith('0x')) {
      log('creating land on-chain…');
      const res = await createLand({
        name, region,
        boundaryText: files.boundary, topoText: files.heightmap,
        treasury: parcelTreasury as `0x${string}`,
        r00tPledge: toPledge(rootPledge),
      });
      if (!res) { log('✗ land creation failed'); return; }
      createdLand = res.land ?? undefined;
      log(`✓ land "${name}" created (${res.land ? `${res.land.slice(0, 8)}…` : 'on-chain'})`);
    } else {
      log('land queued (factory not configured) — launching parcels…');
    }

    // 2) launch each parcel as a CCA (deploy token → open auction → clears into both pools + hook).
    for (const p of parcels.filter((x) => x.ticker.trim())) {
      log(`— launching $${p.ticker} —`);
      const r = await launch({
        ticker: p.ticker.trim().toUpperCase(), name: p.name || `${p.ticker} Parcel`,
        sale: p.sale, pool: p.pool, floorR00T: p.floor, windowHours: 1, treasury: parcelTreasury,
      });
      if (r) log(`✓ $${p.ticker} raise LIVE (${r.token.slice(0, 8)}…)`);
      else log(`✗ $${p.ticker} failed`);
    }
    log('✓ all parcels launched — trading on zkAMM + Uniswap v4 with the arb hook');

    // Mark THIS steward's land as fully launched (parcels open on-chain). The terrain was already
    // persisted + shared the moment it was uploaded (see the render-on-upload effect) so the map shows
    // it without waiting for the launch; here we just upgrade it to `launched:true` + attach the
    // on-chain land address, and re-push so every device reflects the launched state.
    const landObj = buildLandObj(files, name, region, boundary, true);
    if (landObj) {
      saveMyLand(address, landObj);                                   // local (this device, instant)
      pushLandGeometry(landObj, { steward: address, landAddress: createdLand }); // shared store → every device
    }
    try { localStorage.removeItem(DRAFT_KEY(address)); } catch { /* ignore */ } // launched → drop the draft
    setSubmitted(true);
  };

  const boundary = useMemo(() => (files.boundary ? parseBoundary(files.boundary) : null), [files.boundary]);

  // ── render-on-upload: the moment valid terrain is uploaded, persist + share the land geometry so the
  // map renders it IMMEDIATELY — no on-chain launch required. Saved as `launched:false` (preview: parcels
  // open on-chain later); the launch step upgrades it to `launched:true`. A geometry signature guards
  // against re-saving on every keystroke/render (which would loop the MYLAND_EVENT map refresh). ──
  const uploadedSig = useRef('');
  useEffect(() => {
    const landObj = buildLandObj(files, name, region, boundary, false);
    if (!landObj) return;
    const sig = JSON.stringify([landObj.boundary, landObj.zones ?? null, landObj.river ?? null, landObj.contours ?? null]);
    if (sig === uploadedSig.current) return;
    uploadedSig.current = sig;
    saveMyLand(address, landObj);                       // local (this device, instant → map refreshes)
    pushLandGeometry(landObj, { steward: address });    // shared store → every device
  }, [files, boundary, name, region, address]);

  // Rich preview: when the terrain bundle (heightmap + zones/contours) is uploaded, draw the REAL plan
  // (boundary + parcels + contours) at TRUE proportions — the same coordinate space + aspect the map
  // uses. Falls back to a plain, undistorted boundary outline when only a boundary file is present.
  const preview = useMemo(() => {
    const rawB = files.heightmap ? parseHeightmapBoundary(files.heightmap) : null;
    const zones = files.zones ? parseZones(files.zones) : null;
    const contours = files.contours ? parseContours(files.contours) : null;
    const bundle = !!(rawB && (zones || contours));
    const ring = (bundle ? rawB : boundary) as number[][] | null;
    if (!ring || ring.length < 3) return null;
    const A = bundle ? (parseExtentAspect(files.heightmap!) || 1) : 1;

    // normalized bbox (pre-aspect) to clip contours to the property
    const nxs = ring.map((p) => p[0]), nys = ring.map((p) => p[1]);
    const nxmin = Math.min(...nxs), nxmax = Math.max(...nxs), nymin = Math.min(...nys), nymax = Math.max(...nys);
    // aspect-corrected view bbox
    const xs = ring.map((p) => p[0] * A);
    const xmin = Math.min(...xs), xmax = Math.max(...xs), ymin = nymin, ymax = nymax;
    const pad = 0.06 * Math.max(xmax - xmin, ymax - ymin);
    const vx0 = xmin - pad, vy0 = ymin - pad, vw = (xmax - xmin) + 2 * pad, vh = (ymax - ymin) + 2 * pad;
    const W = 300, S = W / vw, H = vh * S;
    const proj = (nx: number, ny: number) => `${((nx * A - vx0) * S).toFixed(1)} ${((ny - vy0) * S).toFixed(1)}`;
    const toPath = (poly: number[][], close: boolean) => poly.map((p, i) => `${i === 0 ? 'M' : 'L'}${proj(p[0], p[1])}`).join(' ') + (close ? ' Z' : '');
    const inBox = (p: number[]) => p[0] >= nxmin && p[0] <= nxmax && p[1] >= nymin && p[1] <= nymax;

    return {
      viewBox: `0 0 ${W} ${H.toFixed(1)}`,
      boundaryD: toPath(ring, true),
      zonePolys: bundle && zones ? zones.map((z) => toPath(z.poly, true)) : [],
      // clip to the property + skip the densest 'minor' lines so the preview stays light
      contourPaths: bundle && contours ? contours.filter((c) => c.l !== 'minor' && c.p.some(inBox)).map((c) => toPath(c.p, false)) : [],
    };
  }, [files.heightmap, files.zones, files.contours, files.boundary, boundary]);

  const readFile = (key: keyof Files) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    const r = new FileReader();
    r.onload = () => setFiles((f) => ({ ...f, [key]: String(r.result) }));
    r.readAsText(file);
  };

  // parcels are OPTIONAL — a steward can create the land now and add parcels later (incrementally,
  // min 0.5 ha each, until the land is fully parceled) from the Steward Console.
  const canNext = step === 0 ? !!(name.trim() && region.trim()) : step === 1 ? !!files.boundary : true;

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
          <div className="flex items-center gap-3">
            {/* steward ENS identity (resolved from L1) — who's creating this land */}
            <StewardIdentity compact />
            <button onClick={onClose} className="p-1.5 rounded-md text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-secondary)]" aria-label="Close">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
          </div>
        </div>

        {/* stepper */}
        {!submitted && address && (
          <div className="flex gap-1.5 px-6 pt-4">
            {['Land', 'Topography', 'Token', 'Parcels', 'Launch'].map((s, i) => (
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
            ) : !address ? (
              <motion.div key="connect" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="text-center py-10">
                <div className="text-4xl mb-3">🔌</div>
                <h3 className="font-display text-2xl text-[var(--text-primary)] mb-2">Connect your wallet</h3>
                <p className="text-sm text-[var(--text-secondary)] max-w-sm mx-auto leading-relaxed">
                  Creating a land commits ${BASE_TOKEN} on-chain and sets your wallet as the land treasury that
                  receives pledges. Connect a wallet to begin.
                </p>
                <button onClick={connectWallet} className="mt-6 px-6 py-2.5 rounded-xl text-[var(--accent-ink)] font-medium text-sm" style={{ background: 'var(--accent)' }}>
                  🔌 Connect wallet
                </button>
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
                    <Drop label="Parcels (zones.json — optional)" hint="precomputed terrain parcels → exact plan" done={!!files.zones} accept=".json" onChange={readFile('zones')} />
                    <Drop label="Contours (optional)" hint="elevation contour lines" done={!!files.contours} accept=".json" onChange={readFile('contours')} />
                  </div>
                  {/* live plan preview — boundary + parcels + contours at true proportions */}
                  <div className="rounded-xl border border-[var(--border)] p-3 grid place-items-center" style={{ background: 'var(--bg-secondary)' }}>
                    {preview ? (
                      <svg viewBox={preview.viewBox} width="100%" preserveAspectRatio="xMidYMid meet" style={{ display: 'block' }}>
                        {preview.contourPaths.map((d, i) => (
                          <path key={`c${i}`} d={d} fill="none" stroke="var(--accent-on-bg)" strokeOpacity={0.16} strokeWidth={0.5} strokeLinejoin="round" />
                        ))}
                        <path d={preview.boundaryD} fill="var(--accent-on-bg)" fillOpacity={0.05} stroke="none" />
                        {preview.zonePolys.map((d, i) => (
                          <path key={`z${i}`} d={d} fill="var(--accent-on-bg)" fillOpacity={0.14} stroke="var(--accent-on-bg)" strokeOpacity={0.5} strokeWidth={0.7} strokeLinejoin="round" />
                        ))}
                        <path d={preview.boundaryD} fill="none" stroke="var(--accent-on-bg)" strokeWidth={1.5} strokeLinejoin="round" />
                      </svg>
                    ) : (
                      <p className="text-[11px] font-mono text-[var(--text-muted)] text-center px-4">drop a boundary (or heightmap) file to preview the land</p>
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
                  <input value={treasury} onChange={(e) => setTreasury(e.target.value)} placeholder={address || '0x… (connect wallet)'} className={`${inputCls} font-mono`} />
                  <p className="mt-1 text-[10px] font-mono text-[var(--text-muted)]">
                    {address
                      ? '✓ Auto-filled from your connected wallet — edit to route pledges to a different treasury.'
                      : '🔌 Connect your wallet to auto-fill your address as the treasury.'}
                  </p>
                </Field>
                <Field label={`$${BASE_TOKEN} pledge (seeds your parcels' liquidity)`}>
                  <input type="number" min={0} value={rootPledge} onChange={(e) => setRootPledge(Math.max(0, Number(e.target.value) || 0))} className={inputCls} />
                  <p className="mt-1 text-[10px] font-mono text-[var(--text-muted)]">Locked at creation as the seed liquidity for your parcel/${BASE_TOKEN} pools — this is the OTC ${BASE_TOKEN} you sell to backers.</p>
                </Field>
              </motion.div>
            ) : step === 3 ? (
              <motion.div key="parcels" initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -12 }} className="space-y-3">
                {mapParcels ? (
                  // A map is uploaded → the land is ALREADY subdivided. No naming here; the steward
                  // launches each token later from the land map, one at a time.
                  <>
                    <div className="rounded-xl border border-[var(--border)] p-4" style={{ background: `color-mix(in srgb, var(--accent) 6%, var(--bg-secondary))` }}>
                      <p className="text-sm text-[var(--text-primary)] font-medium">🗺️ Your land is subdivided into <span className="text-[var(--accent-on-bg)]">{mapParcels.length} parcels</span></p>
                      <p className="text-xs text-[var(--text-secondary)] leading-relaxed mt-1">
                        {landHa != null && <><span className="text-[var(--accent-on-bg)]">{landHa.toFixed(2)} ha</span> total, read from your terrain. </>}
                        You'll <span className="text-[var(--accent-on-bg)]">name &amp; launch</span> each token later from the land map — one at a time, up to {mapParcels.length}. Creating the land now just registers it on-chain; no tokens are launched yet.
                      </p>
                    </div>
                    <div className="grid grid-cols-2 gap-1.5">
                      {mapParcels.map((p, i) => (
                        <div key={i} className="flex items-center gap-2 rounded-lg border border-[var(--border)] px-2.5 py-1.5" style={{ background: 'var(--bg-secondary)' }}>
                          <span className="text-base leading-none">{p.emoji}</span>
                          <span className="text-xs text-[var(--text-primary)] truncate flex-1 min-w-0">{p.name}</span>
                          <span className="text-[10px] font-mono text-[var(--text-muted)] shrink-0">{p.ha.toFixed(2)} ha</span>
                        </div>
                      ))}
                    </div>
                    <p className="text-[10px] font-mono text-[var(--text-muted)]">Parcels are named when you launch them, on the map — not here.</p>
                  </>
                ) : (
                  // No map → let the steward hand-define parcels (fallback for manual/no-terrain flows).
                  <>
                    <div className="rounded-xl border border-[var(--border)] p-3" style={{ background: `color-mix(in srgb, var(--accent) 6%, var(--bg-secondary))` }}>
                      <p className="text-sm text-[var(--text-primary)] font-medium">Define your parcels — like a memecoin launchpad</p>
                      <p className="text-xs text-[var(--text-secondary)] leading-relaxed mt-0.5">Name each one yourself. Each becomes a token opened via a CCA → private zkAMM + public Uniswap v4 pool + regen hook. <span className="text-[var(--accent-on-bg)]">Optional now</span> — you can add more parcels anytime from the Steward Console.</p>
                    </div>
                    <div className="flex items-center gap-3">
                      <label className="text-[10px] font-mono text-[var(--text-muted)]">total ha
                        <input type="number" min={MIN_HA} step={0.5} value={hectares} onChange={(e) => setHectares(Math.max(MIN_HA, Number(e.target.value) || 0))} className={`${inputCls} w-20`} /></label>
                      <div className="flex-1">
                        <div className="h-2 rounded-full bg-[var(--bg-secondary)] overflow-hidden">
                          <div className="h-full" style={{ width: `${Math.min(100, (usedHa / hectares) * 100)}%`, background: 'var(--accent)' }} />
                        </div>
                        <span className="text-[10px] font-mono text-[var(--text-muted)]">{usedHa.toFixed(1)} / {hectares} ha used · {remainingHa.toFixed(1)} ha left</span>
                      </div>
                    </div>
                    {parcels.map((p, i) => (
                      <div key={i} className="rounded-lg border border-[var(--border)] p-3 grid grid-cols-12 gap-2 items-end">
                        <label className="col-span-2 text-[9px] font-mono text-[var(--text-muted)]">emoji
                          <input value={p.emoji} onChange={(e) => setParcel(i, { emoji: e.target.value })} className={`${inputCls} text-center`} maxLength={2} /></label>
                        <label className="col-span-3 text-[9px] font-mono text-[var(--text-muted)]">ticker
                          <input value={p.ticker} onChange={(e) => setParcel(i, { ticker: e.target.value.toUpperCase() })} placeholder="OAK" className={`${inputCls} font-mono`} /></label>
                        <label className="col-span-4 text-[9px] font-mono text-[var(--text-muted)]">name
                          <input value={p.name} onChange={(e) => setParcel(i, { name: e.target.value })} placeholder="Native oak" className={inputCls} /></label>
                        <label className="col-span-2 text-[9px] font-mono text-[var(--text-muted)]">ha
                          <input type="number" min={MIN_HA} step={0.5} value={p.ha} onChange={(e) => setParcel(i, { ha: Math.max(MIN_HA, Number(e.target.value) || 0) })} className={inputCls} /></label>
                        <button onClick={() => delParcel(i)} className="col-span-1 text-[var(--text-muted)] hover:text-[var(--error,#e5484d)] pb-2" aria-label="remove">✕</button>
                      </div>
                    ))}
                    <button onClick={addParcel} disabled={remainingHa < MIN_HA}
                      className="w-full py-2 rounded-lg border border-dashed border-[var(--border)] text-xs text-[var(--text-muted)] hover:border-[var(--accent)] disabled:opacity-40">
                      {remainingHa < MIN_HA ? 'land fully parceled' : '+ add parcel'}
                    </button>
                  </>
                )}
              </motion.div>
            ) : (
              <motion.div key="s4" initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -12 }} className="space-y-3">
                {[
                  ['Land', name || '—'], ['Steward', steward || '—'], ['Region', region || '—'],
                  ['Boundary', files.boundary ? '✓ uploaded' : '—'], ['Topography', files.heightmap ? '✓ uploaded' : '— (auto-flat)'],
                  ['Watercourse', files.river ? '✓ uploaded' : '— (none)'],
                  ['Parcels (zones)', files.zones ? '✓ exact plan' : '— (auto-grid)'], ['Contours', files.contours ? '✓ uploaded' : '— (none)'],
                  ['Token base', `$${BASE_TOKEN}`], ['Treasury', treasury || '—'],
                  [`$${BASE_TOKEN} pledge`, rootPledge.toLocaleString()],
                  ['Parcels', mapParcels ? `${mapParcels.length} · name & launch from the map` : (parcels.filter((p) => p.ticker.trim()).map((p) => `${p.emoji}$${p.ticker}`).join('  ') || '—')],
                ].map(([k, v]) => (
                  <div key={k} className="flex items-center justify-between text-sm border-b border-[var(--border)]/60 pb-2">
                    <span className="text-[var(--text-muted)] font-mono text-xs">{k}</span>
                    <span className="text-[var(--text-primary)]">{v}</span>
                  </div>
                ))}
                {/* proof-of-humanity — real people steward real land (World ID) */}
                <div className="pt-1">
                  <WorldIdGate verified={worldVerified} signal={address} onVerified={() => setWorldVerified(true)} />
                </div>
                <p className="text-[11px] font-mono text-[var(--text-muted)] pt-1">
                  {mapParcels
                    ? <>On submit: createLand on-chain (name/region/topography + commit ${BASE_TOKEN}). Your {mapParcels.length} parcels appear on the map — you launch each token (CCA → zkAMM + Uniswap v4 pool + hook) from there, one at a time.</>
                    : <>On submit: createLand on-chain (name/region/topography + commit ${BASE_TOKEN}) → each parcel you defined opens a CCA that seeds a private zkAMM + public Uniswap v4 pool + wires the arb hook.</>}
                </p>
                {status === 'error' && error && (
                  <p className="text-[11px] font-mono text-[var(--error,#e5484d)] pt-1">⚠ {error}</p>
                )}
                {launchLog.length > 0 && (
                  <div className="mt-2 flex flex-col gap-0.5 rounded-lg border border-[var(--border)] p-2 max-h-40 overflow-y-auto" style={{ background: 'var(--bg-secondary)' }}>
                    {launchLog.map((s, i) => <div key={i} className="text-[10px] font-mono" style={{ color: s.startsWith('✓') ? '#7CFFB2' : s.startsWith('✗') ? '#e05555' : 'var(--text-muted)' }}>{s}</div>)}
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* footer nav */}
        {!submitted && address && (
          <div className="flex items-center justify-between px-6 py-4 border-t border-[var(--border)]">
            <button onClick={() => (step === 0 ? onClose() : setStep((s) => (s - 1) as Step))} className="px-4 py-2 text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors">
              {step === 0 ? 'Cancel' : 'Back'}
            </button>
            {step < 4 ? (
              <button onClick={() => canNext && setStep((s) => (s + 1) as Step)} disabled={!canNext}
                className="px-6 py-2.5 rounded-xl text-[var(--accent-ink)] font-medium text-sm disabled:opacity-40" style={{ background: 'var(--accent)' }}>
                Continue
              </button>
            ) : !address ? (
              <button onClick={connectWallet} className="px-6 py-2.5 rounded-xl text-[var(--accent-ink)] font-medium text-sm" style={{ background: 'var(--accent)' }}>
                🔌 Connect wallet to launch
              </button>
            ) : (
              <button onClick={handleSubmit} disabled={submitting || !worldVerified} title={!worldVerified ? 'Verify with World ID first' : undefined} className="px-6 py-2.5 rounded-xl text-[var(--accent-ink)] font-medium text-sm disabled:opacity-50" style={{ background: 'var(--accent)' }}>
                {!worldVerified ? 'Verify humanity to launch' : status === 'approving' ? `Approving $${BASE_TOKEN}…` : status === 'creating' ? 'Creating land…' : launchLog.length > 0 ? 'Launching…' : mapParcels ? 'Create land' : 'Create land + launch parcels'}
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
