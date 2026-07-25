/**
 * myLand — the connected steward's OWN land terrain, saved when they create a land via the wizard.
 * Makes the pilot experience identical to any anon steward: the map renders whatever land YOU set up
 * (your uploaded boundary/contours/river), not a hardcoded pilot. Persisted in localStorage keyed by
 * wallet so it survives reloads. (Production: this moves to Land.cid on IPFS + the indexer.)
 */
export interface MyLand {
  name: string;
  region?: string;
  boundary: number[][];                 // normalized [0,1] ring (from the wizard's parseBoundary)
  contours?: { l: string; p: number[][] }[];
  river?: number[][];
  createdAt: number;
}

const KEY = (addr?: string) => `r00t.myland.${(addr || 'anon').toLowerCase()}`;

export function saveMyLand(addr: string | undefined, land: MyLand) {
  try { localStorage.setItem(KEY(addr), JSON.stringify(land)); } catch { /* ignore */ }
}

export function loadMyLand(addr?: string): MyLand | null {
  try {
    const raw = localStorage.getItem(KEY(addr)) || localStorage.getItem(KEY(undefined));
    return raw ? (JSON.parse(raw) as MyLand) : null;
  } catch { return null; }
}

export function clearMyLand(addr?: string) {
  try { localStorage.removeItem(KEY(addr)); } catch { /* ignore */ }
}
