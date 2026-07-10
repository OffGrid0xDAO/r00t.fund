#!/usr/bin/env node
/**
 * apply-kml-boundary.mjs — place the real parcel border at its TRUE position on
 * the DEM so the contours/relief match, then de-georeference for the client.
 *
 * The KML (secret/kml/parcel.kml, WGS84) is projected to the DEM's CRS
 * (EPSG:3763 / Portugal TM06) and normalized against the DEM's real extent — so
 * the border lands exactly where it sits on the terrain (verified: it matches the
 * DEM's own property outline). Then coordinates are stripped and only the
 * normalized, coordinate-free boundary + mask are written to the public terrain.
 *
 * Firewall: raw KML + real extent live in secret/ ; nothing georeferenced is
 * committed. Run fuzz-terrain.mjs first (real contours/river), then this, then
 * gen-zones.mjs.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const KML = resolve(ROOT, 'secret/kml/parcel.kml');
const SECRET_HM = resolve(ROOT, 'secret/terrain/heightmap.json');   // has the real extent
const PUBLIC_HM = resolve(ROOT, 'frontend/public/terrain/heightmap.json');

// ── parse KML ring (WGS84 lng,lat) ──
const kml = readFileSync(KML, 'utf8');
const ring = kml.match(/<coordinates>([\s\S]*?)<\/coordinates>/i)[1].trim().split(/\s+/)
  .map(s => s.split(',').map(Number)).filter(p => Number.isFinite(p[0]) && Number.isFinite(p[1]));
if (ring.length >= 2 && ring[0][0] === ring.at(-1)[0] && ring[0][1] === ring.at(-1)[1]) ring.pop();

// ── WGS84 → EPSG:3763 (ETRS89 / PT-TM06), GRS80, Snyder TM forward ──
const a = 6378137, f = 1 / 298.257222101, e2 = f * (2 - f), ep2 = e2 / (1 - e2);
const lat0 = 39.66825833333333 * Math.PI / 180, lon0 = -8.133108333333333 * Math.PI / 180, k0 = 1;
const M = (phi) => a * ((1 - e2 / 4 - 3 * e2 * e2 / 64 - 5 * e2 ** 3 / 256) * phi
  - (3 * e2 / 8 + 3 * e2 * e2 / 32 + 45 * e2 ** 3 / 1024) * Math.sin(2 * phi)
  + (15 * e2 * e2 / 256 + 45 * e2 ** 3 / 1024) * Math.sin(4 * phi)
  - (35 * e2 ** 3 / 3072) * Math.sin(6 * phi));
function toTM(lng, lat) {
  const p = lat * Math.PI / 180, l = lng * Math.PI / 180;
  const N = a / Math.sqrt(1 - e2 * Math.sin(p) ** 2), T = Math.tan(p) ** 2, C = ep2 * Math.cos(p) ** 2, A = (l - lon0) * Math.cos(p);
  const E = k0 * N * (A + (1 - T + C) * A ** 3 / 6 + (5 - 18 * T + T * T + 72 * C - 58 * ep2) * A ** 5 / 120);
  const Nn = k0 * (M(p) - M(lat0) + N * Math.tan(p) * (A * A / 2 + (5 - T + 9 * C + 4 * C * C) * A ** 4 / 24 + (61 - 58 * T + T * T + 600 * C - 330 * ep2) * A ** 6 / 720));
  return [E, Nn];
}

// ── normalize against the DEM's real extent → boundary aligned to the relief ──
const coords = JSON.parse(readFileSync(SECRET_HM, 'utf8')).coordinates;
const { minX, maxX, minY, maxY } = coords;
const en = ring.map(([lng, lat]) => toTM(lng, lat));

// tiny deterministic jitter (sub-visual — keeps alignment, breaks survey-exact vertices)
function rng(seed) { let s = seed >>> 0; return () => { s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const rand = rng(0x1660); const jit = () => (rand() - 0.5) * 0.0016;

let boundary = en.map(([E, N]) => [
  Math.min(0.999, Math.max(0.001, (E - minX) / (maxX - minX) + jit())),
  Math.min(0.999, Math.max(0.001, (N - minY) / (maxY - minY) + jit())),  // no flip — matches DEM orientation
]);

// light Douglas–Peucker on the open chain (re-closes at render via 'Z')
function simplify(poly, eps) {
  if (poly.length < 5) return poly;
  const dp = (pts) => {
    let dmax = 0, idx = 0; const [ax, ay] = pts[0], [bx, by] = pts.at(-1);
    for (let i = 1; i < pts.length - 1; i++) { const [x, y] = pts[i]; const d = Math.abs((by - ay) * x - (bx - ax) * y + bx * ay - by * ax) / (Math.hypot(bx - ax, by - ay) || 1e-9); if (d > dmax) { dmax = d; idx = i; } }
    if (dmax > eps) return [...dp(pts.slice(0, idx + 1)).slice(0, -1), ...dp(pts.slice(idx))];
    return [pts[0], pts.at(-1)];
  };
  return dp(poly);
}
boundary = simplify(boundary, 0.0012).map(p => [Math.round(p[0] * 1e4) / 1e4, Math.round(p[1] * 1e4) / 1e4]);

// ── write into the fuzzed public heightmap: boundary + recomputed mask ──
const hm = JSON.parse(readFileSync(PUBLIC_HM, 'utf8'));
const R = hm.resolution;
function inPoly(nx, ny, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if (((yi > ny) !== (yj > ny)) && (nx < ((xj - xi) * (ny - yi)) / (yj - yi) + xi)) inside = !inside;
  }
  return inside;
}
const mask = new Array(R * R);
for (let j = 0; j < R; j++) for (let i = 0; i < R; i++) mask[j * R + i] = inPoly(i / (R - 1), j / (R - 1), boundary) ? 1 : 0;
hm.propertyBoundary = boundary;
hm.propertyMask = mask;
writeFileSync(PUBLIC_HM, JSON.stringify(hm));

const bx = boundary.map(p => p[0]), by = boundary.map(p => p[1]);
console.log('parcel border georeferenced onto the DEM, then de-georeferenced for the client.');
console.log(`  boundary bbox nx ${Math.min(...bx).toFixed(3)}–${Math.max(...bx).toFixed(3)} · ny ${Math.min(...by).toFixed(3)}–${Math.max(...by).toFixed(3)}  (${boundary.length} verts)`);
console.log('  → contours/river now align. next: node scripts/gen-zones.mjs');
