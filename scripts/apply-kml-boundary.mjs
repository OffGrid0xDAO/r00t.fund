#!/usr/bin/env node
/**
 * apply-kml-boundary.mjs — swap the pilot land's border for the real parcel shape,
 * de-georeferenced.
 *
 * Reads the real KML from the .gitignore'd secret/kml/parcel.kml, converts lng/lat
 * to local metres, normalizes to [0,1] PRESERVING ASPECT (so the shape is true),
 * strips all coordinates, lightly simplifies + jitters, and writes the result as
 * `propertyBoundary` into frontend/public/terrain/heightmap.json (recomputing the
 * property mask). Then re-run gen-zones.mjs to re-parcel the new shape.
 *
 * Firewall: the raw KML never leaves secret/. Only the normalized (coordinate-free)
 * boundary is committed — no lat/lng, no cadastral identifier.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const KML = resolve(ROOT, 'secret/kml/parcel.kml');
const HEIGHTMAP = resolve(ROOT, 'frontend/public/terrain/heightmap.json');
const RIVER = resolve(ROOT, 'frontend/public/terrain/river.json');

// ── parse the KML coordinate ring ──
const kml = readFileSync(KML, 'utf8');
const block = kml.match(/<coordinates>([\s\S]*?)<\/coordinates>/i);
if (!block) { console.error('no <coordinates> in KML'); process.exit(1); }
let ring = block[1].trim().split(/\s+/).map(s => {
  const [lng, lat] = s.split(',').map(Number);
  return [lng, lat];
}).filter(p => Number.isFinite(p[0]) && Number.isFinite(p[1]));
if (ring.length >= 2 && ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1]) ring.pop();

// ── lng/lat → local metres ──
const latMean = ring.reduce((s, p) => s + p[1], 0) / ring.length;
const mPerLat = 110540, mPerLng = 111320 * Math.cos(latMean * Math.PI / 180);
const metric = ring.map(([lng, lat]) => [lng * mPerLng, lat * mPerLat]);

// area (hectares) for reference — a measurement, not a coordinate
const areaM2 = Math.abs(metric.reduce((a, _, i) => {
  const [x0, y0] = metric[i], [x1, y1] = metric[(i + 1) % metric.length];
  return a + (x0 * y1 - x1 * y0);
}, 0)) / 2;

// ── normalize to [0,1], preserve aspect, centre, flip Y (north up) ──
const xs = metric.map(p => p[0]), ys = metric.map(p => p[1]);
const mx0 = Math.min(...xs), mx1 = Math.max(...xs), my0 = Math.min(...ys), my1 = Math.max(...ys);
const w = mx1 - mx0, h = my1 - my0;
const scale = 0.9 / Math.max(w, h);
const offX = 0.5 - (w * scale) / 2, offY = 0.5 - (h * scale) / 2;

// deterministic tiny jitter (mulberry32) — breaks vertex-exact match to the survey
function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const rand = rng(0x1660);
const jit = () => (rand() - 0.5) * 0.003;

let boundary = metric.map(([mx, my]) => [
  Math.min(0.99, Math.max(0.01, offX + (mx - mx0) * scale + jit())),
  Math.min(0.99, Math.max(0.01, 1 - (offY + (my - my0) * scale) + jit())),
]);

// light Douglas–Peucker to drop redundant vertices
function simplify(poly, eps) {
  if (poly.length < 5) return poly;
  const dp = (pts) => {
    let dmax = 0, idx = 0; const [ax, ay] = pts[0], [bx, by] = pts[pts.length - 1];
    for (let i = 1; i < pts.length - 1; i++) { const [x, y] = pts[i]; const d = Math.abs((by - ay) * x - (bx - ax) * y + bx * ay - by * ax) / (Math.hypot(bx - ax, by - ay) || 1e-9); if (d > dmax) { dmax = d; idx = i; } }
    if (dmax > eps) return [...dp(pts.slice(0, idx + 1)).slice(0, -1), ...dp(pts.slice(idx))];
    return [pts[0], pts[pts.length - 1]];
  };
  // DP on the open chain (the polygon re-closes at render time via 'Z')
  return dp(poly);
}
boundary = simplify(boundary, 0.0015).map(p => [Math.round(p[0] * 1e4) / 1e4, Math.round(p[1] * 1e4) / 1e4]);

// ── write into the (fuzzed) heightmap: replace boundary + recompute mask ──
const hm = JSON.parse(readFileSync(HEIGHTMAP, 'utf8'));
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
writeFileSync(HEIGHTMAP, JSON.stringify(hm));

// ── river: trace the LEFT (west) silhouette of the parcel so it hugs that edge ──
function leftRiver(poly) {
  const yv = poly.map(p => p[1]); const ymin = Math.min(...yv), ymax = Math.max(...yv);
  const N = 60, pts = [];
  for (let k = 0; k <= N; k++) {
    const y = ymin + (k / N) * (ymax - ymin);
    let minx = Infinity;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, yi] = poly[i], [xj, yj] = poly[j];
      if ((yi > y) !== (yj > y)) { const x = ((xj - xi) * (y - yi)) / (yj - yi) + xi; if (x < minx) minx = x; }
    }
    if (minx !== Infinity) pts.push([Math.max(0.004, minx - 0.006), Math.round(y * 1e4) / 1e4]);
  }
  // Chaikin smooth (open chain)
  let p = pts;
  for (let it = 0; it < 2; it++) {
    const q = [p[0]];
    for (let i = 0; i < p.length - 1; i++) { const a = p[i], b = p[i + 1]; q.push([0.75 * a[0] + 0.25 * b[0], 0.75 * a[1] + 0.25 * b[1]], [0.25 * a[0] + 0.75 * b[0], 0.25 * a[1] + 0.75 * b[1]]); }
    q.push(p[p.length - 1]); p = q;
  }
  return p.map(([x, y]) => [Math.round(x * 1e4) / 1e4, Math.round(y * 1e4) / 1e4]);
}
const centerline = leftRiver(boundary);
writeFileSync(RIVER, JSON.stringify({ type: 'LineString', points: centerline, centerline }));

console.log('applied real parcel boundary (de-georeferenced) to frontend/public/terrain/heightmap.json');
console.log(`  vertices: ${boundary.length}  ·  parcel area ~${(areaM2 / 10000).toFixed(2)} ha`);
console.log(`  river: ${centerline.length}-pt left-edge watercourse`);
console.log('  next: node scripts/gen-zones.mjs   (re-parcel the new shape)');
