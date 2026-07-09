#!/usr/bin/env node
/**
 * fuzz-terrain.mjs — Firewall geometry generalizer.
 *
 * Reads the REAL, georeferenced terrain from the .gitignore'd secret/ store and
 * emits a FUZZED, non-cadastral version into frontend/public/terrain/ for the
 * client bundle.
 *
 * What "fuzzed" means here (see MIGRATION_NOTES / ARCHITECTURE firewall notes):
 *   - georeferencing removed  → the `coordinates` / `crs` block is stripped, so
 *     the relief can no longer be placed on a real map or tied to a registry parcel.
 *   - precision destroyed      → the 512² heightmap is block-averaged down to 128².
 *   - vertices decoupled       → the property boundary and river centreline are
 *     decimated and jittered, so they no longer match the legal subdivision.
 *   - contours regenerated      → drawn from the fuzzed relief (marching squares),
 *     never transported from the real contour file.
 *
 * The real geodata NEVER leaves secret/. Only the output of this script is committed.
 *
 * Usage:  node scripts/fuzz-terrain.mjs
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const SRC = resolve(ROOT, 'secret/terrain');
const OUT = resolve(ROOT, 'frontend/public/terrain');

// ── deterministic PRNG so re-runs are stable (mulberry32) ──
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = rng(0x1701);
const gauss = (sigma) => {
  // Box–Muller
  const u = 1 - rand(), v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v) * sigma;
};

const TARGET_RES = 128;   // downsample target (from 512)
const JITTER = 0.006;     // boundary/river vertex jitter (normalized units)
const BOUNDARY_KEEP = 2;  // keep every Nth boundary vertex (decimation)

// ── load real heightmap ──
const hm = JSON.parse(readFileSync(resolve(SRC, 'heightmap.json'), 'utf8'));
const srcRes = hm.resolution;
const R = TARGET_RES;

// block-average downsample 512 → 128
const data = new Array(R * R);
const block = srcRes / R;
for (let y = 0; y < R; y++) {
  for (let x = 0; x < R; x++) {
    let sum = 0, cnt = 0;
    const sy0 = Math.floor(y * block), sy1 = Math.floor((y + 1) * block);
    const sx0 = Math.floor(x * block), sx1 = Math.floor((x + 1) * block);
    for (let sy = sy0; sy < sy1; sy++) {
      for (let sx = sx0; sx < sx1; sx++) {
        sum += hm.data[sy * srcRes + sx];
        cnt++;
      }
    }
    // round to 1 decimal — further strips precision
    data[y * R + x] = Math.round((sum / cnt) * 10) / 10;
  }
}

// ── fuzz the property boundary: decimate + jitter, keep closed ──
function fuzzPolyline(pts, keep, sigma) {
  const out = [];
  for (let i = 0; i < pts.length; i += keep) {
    const [px, py] = pts[i];
    out.push([
      Math.min(0.999, Math.max(0.001, px + gauss(sigma))),
      Math.min(0.999, Math.max(0.001, py + gauss(sigma))),
    ]);
  }
  return out;
}
const propertyBoundary = fuzzPolyline(hm.propertyBoundary, BOUNDARY_KEEP, JITTER);

// point-in-polygon (ray cast)
function inPoly(nx, ny, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if (((yi > ny) !== (yj > ny)) && (nx < ((xj - xi) * (ny - yi)) / (yj - yi) + xi)) inside = !inside;
  }
  return inside;
}
// recompute property mask at the fuzzed resolution against the fuzzed boundary
const propertyMask = new Array(R * R);
for (let y = 0; y < R; y++) {
  for (let x = 0; x < R; x++) {
    const nx = x / (R - 1), ny = y / (R - 1);
    propertyMask[y * R + x] = inPoly(nx, ny, propertyBoundary) ? 1 : 0;
  }
}

// generalize extent to the nearest 50 m so it reads as approximate, not surveyed
const round50 = (n) => Math.round(n / 50) * 50;
const heightmapOut = {
  resolution: R,
  minElevation: Math.round(hm.minElevation),
  maxElevation: Math.round(hm.maxElevation),
  extentMeters: { width: round50(hm.extentMeters.width), height: round50(hm.extentMeters.height) },
  // NOTE: `coordinates` and `crs` intentionally omitted — georeferencing stripped.
  propertyBoundary,
  propertyMask,
  data,
};

// ── regenerate contours from the fuzzed relief via marching squares ──
const sample = (x, y) => data[y * R + x];
function levelClass(idx, minorEvery, mediumEvery, majorEvery) {
  if (idx % majorEvery === 0) return 'major';
  if (idx % mediumEvery === 0) return 'medium';
  return 'minor';
}
const minEl = heightmapOut.minElevation, maxEl = heightmapOut.maxElevation;
// `data` is normalized [0,1]; contour levels are generated in that space.
// The `e` label is mapped back to metres for reference only.
const N_LEVELS = 26;       // contour bands across the normalized range
const mediumEvery = 3, majorEvery = 6;
const toMetres = (t) => Math.round(minEl + t * (maxEl - minEl));
const contours = [];
let levelIdx = 0;
for (let li = 1; li < N_LEVELS; li++, levelIdx++) {
  const level = li / N_LEVELS;                 // in [0,1]
  const l = levelClass(levelIdx, 1, mediumEvery, majorEvery);
  for (let y = 0; y < R - 1; y++) {
    for (let x = 0; x < R - 1; x++) {
      const tl = sample(x, y), tr = sample(x + 1, y), br = sample(x + 1, y + 1), bl = sample(x, y + 1);
      const n = [tl, tr, br, bl];
      let cell = 0;
      if (tl > level) cell |= 8;
      if (tr > level) cell |= 4;
      if (br > level) cell |= 2;
      if (bl > level) cell |= 1;
      if (cell === 0 || cell === 15) continue;
      // interpolated crossings on the 4 edges, in normalized coords
      const nx = x / (R - 1), ny = y / (R - 1), d = 1 / (R - 1);
      const lerp = (a, b) => (level - a) / (b - a || 1e-6);
      const top = [nx + d * lerp(tl, tr), ny];
      const right = [nx + d, ny + d * lerp(tr, br)];
      const bottom = [nx + d * lerp(bl, br), ny + d];
      const left = [nx, ny + d * lerp(tl, bl)];
      const edges = { top, right, bottom, left };
      const segs = {
        1: ['left', 'bottom'], 2: ['bottom', 'right'], 3: ['left', 'right'],
        4: ['top', 'right'], 5: ['top', 'left'], /* 5 & 10 saddles: split */ 6: ['top', 'bottom'],
        7: ['top', 'left'], 8: ['top', 'left'], 9: ['top', 'bottom'], 10: ['top', 'right'],
        11: ['top', 'right'], 12: ['left', 'right'], 13: ['bottom', 'right'], 14: ['left', 'bottom'],
      }[cell];
      if (!segs) continue;
      contours.push({ e: toMetres(level), l, p: [edges[segs[0]], edges[segs[1]]] });
    }
  }
}
const contoursOut = { contours, elevRange: [minEl, maxEl] };

// ── fuzz the river centreline ──
let riverOut = null;
try {
  const rv = JSON.parse(readFileSync(resolve(SRC, 'river.json'), 'utf8'));
  const centerline = fuzzPolyline(rv.centerline, 1, JITTER * 0.6);
  riverOut = { type: 'LineString', points: centerline, centerline };
} catch { /* river optional */ }

// ── write outputs ──
mkdirSync(OUT, { recursive: true });
writeFileSync(resolve(OUT, 'heightmap.json'), JSON.stringify(heightmapOut));
writeFileSync(resolve(OUT, 'contours.json'), JSON.stringify(contoursOut));
if (riverOut) writeFileSync(resolve(OUT, 'river.json'), JSON.stringify(riverOut));

console.log(`fuzzed terrain written to frontend/public/terrain/`);
console.log(`  heightmap: ${R}×${R} (from ${srcRes}²), georef stripped`);
console.log(`  boundary : ${propertyBoundary.length} verts (decimated + jittered)`);
console.log(`  contours : ${contours.length} segments across ${N_LEVELS} levels`);
console.log(`  river    : ${riverOut ? riverOut.centerline.length + ' verts' : 'none'}`);
