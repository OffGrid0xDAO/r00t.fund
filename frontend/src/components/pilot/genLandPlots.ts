/**
 * genLandPlots — turn a steward's saved land boundary + their launched parcels into map Plots, so the
 * map renders THEIR land (pilot == any anon steward). Subdivides the boundary's bounding box into a
 * grid, keeps cells whose centre is inside the boundary, and assigns each to a launched parcel
 * (auto-discovered auctions). Demo-grade auto-parceling; the server pipeline (gen-zones) refines it.
 */
import type { Plot, PlotStatus } from './types';

const EMOJI: Record<string, string> = { OAK: '🌳', NUT: '🌰', CARROT: '🥕', CACTUS: '🌵', BERRY: '🫐', HERB: '🌿', FIG: '🫒', SPUD: '🥔', TURNIP: '🥬' };

function pointInPoly(x: number, y: number, poly: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if (((yi > y) !== (yj > y)) && (x < ((xj - xi) * (y - yi)) / (yj - yi) + xi)) inside = !inside;
  }
  return inside;
}

export interface LandParcel { ticker: string; name?: string; phase: number; raised: number; clearedPrice: number; areaHa?: number }

export function genLandPlots(boundary: number[][], parcels: LandParcel[]): Plot[] {
  if (!boundary || boundary.length < 3) return [];
  const xs = boundary.map((p) => p[0]), ys = boundary.map((p) => p[1]);
  const xmin = Math.min(...xs), xmax = Math.max(...xs), ymin = Math.min(...ys), ymax = Math.max(...ys);
  const w = xmax - xmin || 1, h = ymax - ymin || 1;

  // grid sized to fit at least the parcel count (min 3x3 so the land reads as parceled)
  const n = Math.max(9, parcels.length);
  const cols = Math.ceil(Math.sqrt(n));
  const rows = Math.ceil(n / cols);
  const cw = w / cols, ch = h / rows;

  const cells: number[][][] = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const x0 = xmin + c * cw, y0 = ymin + r * ch;
    const cx = x0 + cw / 2, cy = y0 + ch / 2;
    if (!pointInPoly(cx, cy, boundary)) continue; // clip to the land shape
    // inset the cell slightly so parcels read as separate fields
    const pad = 0.12;
    cells.push([[x0 + cw * pad, y0 + ch * pad], [x0 + cw * (1 - pad), y0 + ch * pad], [x0 + cw * (1 - pad), y0 + ch * (1 - pad)], [x0 + cw * pad, y0 + ch * (1 - pad)]]);
  }

  return cells.map((poly, i): Plot => {
    const p = parcels[i]; // may be undefined for empty cells
    const [cx, cy] = [poly.reduce((s, q) => s + q[0], 0) / 4, poly.reduce((s, q) => s + q[1], 0) / 4];
    const live = p?.phase === 2;
    const status: PlotStatus = p ? (live ? 'planted' : 'greening') : 'seeking';
    const targetEur = p ? Math.max(2000, Math.round(p.raised)) : 2000;
    return {
      id: p ? `parcel-${p.ticker}` : `open-${i}`,
      name: p?.name || (p ? `$${p.ticker}` : 'Open parcel'),
      type: 'syntropic',
      x: cx, y: cy, r: 0.03,
      poly,
      ticker: p?.ticker,
      named: !!p,
      emoji: p ? (EMOJI[p.ticker] || '🌱') : '➕',
      areaHa: p?.areaHa,
      targetEur,
      fundedEur: p ? Math.round(p.raised) : 0,
      status,
      contributions: [],
      rewards: [],
      blurb: p ? (live ? `$${p.ticker} — live, trading against $R00T` : `$${p.ticker} — raising via CCA`) : 'Unclaimed — launch a parcel here from the Steward Console.',
    };
  });
}
