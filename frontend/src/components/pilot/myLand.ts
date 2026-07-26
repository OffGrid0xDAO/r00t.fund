/**
 * myLand — the connected steward's OWN land terrain, saved when they create a land via the wizard.
 * Makes the pilot experience identical to any anon steward: the map renders whatever land YOU set up
 * (your uploaded boundary/contours/river), not a hardcoded pilot. Persisted in localStorage keyed by
 * wallet so it survives reloads. (Production: this moves to Land.cid on IPFS + the indexer.)
 */
import type { Zone } from './data';
import { HACKATHON } from '../../config';

export interface MyLand {
  name: string;
  region?: string;
  // ALL geometry below shares ONE coordinate space. When `zones` is present the whole bundle is in the
  // RAW terrain space (heightmap.propertyBoundary space) so it renders IDENTICALLY to the pilot demo.
  // With no zones, `boundary` is the wizard's normalized [0,1] ring and parcels are auto-gridded.
  boundary: number[][];
  contours?: { l: string; p: number[][] }[];
  river?: number[][];
  zones?: Zone[];                       // precomputed terrain parcels → zonesToPlots (exact demo picture)
  aspect?: number;                      // real extent width/height (heightmap.extentMeters) — un-squeezes the plan
  launched?: boolean;                   // true once the land + its parcels actually launched (guards ghost-saves)
  createdAt: number;
}

const KEY = (addr?: string) => `r00t.myland.${(addr || 'anon').toLowerCase()}`;
export const MYLAND_EVENT = 'r00t:myland'; // fired whenever the steward's saved land changes → live map refresh

function announce() { try { window.dispatchEvent(new Event(MYLAND_EVENT)); } catch { /* ssr */ } }

export function saveMyLand(addr: string | undefined, land: MyLand) {
  try { localStorage.setItem(KEY(addr), JSON.stringify(land)); announce(); } catch { /* ignore */ }
}

export function loadMyLand(addr?: string): MyLand | null {
  try {
    const raw = localStorage.getItem(KEY(addr)) || localStorage.getItem(KEY(undefined));
    return raw ? (JSON.parse(raw) as MyLand) : null;
  } catch { return null; }
}

export function clearMyLand(addr?: string) {
  try { localStorage.removeItem(KEY(addr)); announce(); } catch { /* ignore */ }
}

// ── shared (cross-device) store: persist the land geometry on the Railway indexer so ANY device can
// render a steward's land map. Ponder only indexes on-chain data; the terrain drawing lives here. ──
const INDEXER_BASE = () => ((HACKATHON.indexerUrl || (import.meta.env.VITE_INDEXER_URL as string) || '').replace(/\/$/, ''));

/** Push the land geometry to the shared store, keyed by steward wallet (+ on-chain land address). */
export async function pushLandGeometry(land: MyLand, opts: { steward?: string; landAddress?: string } = {}): Promise<boolean> {
  const base = INDEXER_BASE();
  if (!base) return false;
  try {
    const r = await fetch(`${base}/land-geometry`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ steward: opts.steward, landAddress: opts.landAddress, land }),
    });
    return r.ok;
  } catch { return false; }
}

/** Fetch a land's geometry from the shared store by key (steward wallet or on-chain land address). */
export async function fetchLandGeometry(key?: string): Promise<MyLand | null> {
  const base = INDEXER_BASE();
  if (!base || !key) return null;
  try {
    const r = await fetch(`${base}/land-geometry/${key.toLowerCase()}`);
    if (!r.ok) return null;
    const j = await r.json();
    return (j?.land as MyLand) ?? null;
  } catch { return null; }
}
