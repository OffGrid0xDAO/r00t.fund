#!/usr/bin/env node
/**
 * fuzz-terrain.mjs — de-georeference the pilot terrain for the client bundle.
 *
 * Reads the REAL terrain from the .gitignore'd secret/ store and emits a
 * de-georeferenced, high-fidelity copy into frontend/public/terrain/ so the
 * landing intro renders EXACTLY like the source animation.
 *
 * Firewall protection kept (owner-directed high fidelity, 2026-07):
 *   - georeferencing removed → the `coordinates` / `crs` block is stripped, so the
 *     relief cannot be placed on a real map or tied to a registry parcel.
 *   - heightmap downsampled 512² → 256² and rounded (mild generalization).
 *   - the property boundary is kept smooth (real shape, no coordinates); a tiny
 *     jitter breaks exact vertex correspondence with the survey.
 *   - contours / river are transported at full fidelity (they carry no coords).
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

// deterministic PRNG (mulberry32) so re-runs are stable
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
const gauss = (sigma) => Math.sqrt(-2 * Math.log(1 - rand())) * Math.cos(2 * Math.PI * rand()) * sigma;

const TARGET_RES = 256;    // downsample target from 512 (keeps relief crisp)
const JITTER = 0.0015;     // sub-visual boundary jitter (breaks survey-exact vertices)

// ── heightmap: downsample + strip georef ──
const hm = JSON.parse(readFileSync(resolve(SRC, 'heightmap.json'), 'utf8'));
const srcRes = hm.resolution;
const R = Math.min(TARGET_RES, srcRes);
const block = srcRes / R;
const data = new Array(R * R);
for (let y = 0; y < R; y++) {
  for (let x = 0; x < R; x++) {
    let sum = 0, cnt = 0;
    const sy0 = Math.floor(y * block), sy1 = Math.floor((y + 1) * block);
    const sx0 = Math.floor(x * block), sx1 = Math.floor((x + 1) * block);
    for (let sy = sy0; sy < sy1; sy++) for (let sx = sx0; sx < sx1; sx++) { sum += hm.data[sy * srcRes + sx]; cnt++; }
    data[y * R + x] = Math.round((sum / cnt) * 1000) / 1000;
  }
}

// boundary: keep the real (smooth) shape, add sub-visual jitter, no coords involved
const clamp = (v) => Math.min(0.999, Math.max(0.001, v));
const propertyBoundary = (hm.propertyBoundary || []).map(([px, py]) => [
  clamp(px + gauss(JITTER)), clamp(py + gauss(JITTER)),
]);

// recompute property mask at the output resolution
function inPoly(nx, ny, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if (((yi > ny) !== (yj > ny)) && (nx < ((xj - xi) * (ny - yi)) / (yj - yi) + xi)) inside = !inside;
  }
  return inside;
}
const propertyMask = new Array(R * R);
for (let y = 0; y < R; y++) for (let x = 0; x < R; x++) {
  propertyMask[y * R + x] = inPoly(x / (R - 1), y / (R - 1), propertyBoundary) ? 1 : 0;
}

const round50 = (n) => Math.round(n / 50) * 50;
const heightmapOut = {
  resolution: R,
  minElevation: Math.round(hm.minElevation),
  maxElevation: Math.round(hm.maxElevation),
  extentMeters: { width: round50(hm.extentMeters.width), height: round50(hm.extentMeters.height) },
  // `coordinates` / `crs` intentionally omitted — georeferencing stripped.
  propertyBoundary,
  propertyMask,
  data,
};

// ── contours: transport at full fidelity (no coordinates present) ──
const contoursOut = JSON.parse(readFileSync(resolve(SRC, 'contours.json'), 'utf8'));

// ── river: transport with tiny jitter ──
let riverOut = null;
try {
  const rv = JSON.parse(readFileSync(resolve(SRC, 'river.json'), 'utf8'));
  const centerline = rv.centerline.map(([px, py]) => [clamp(px + gauss(JITTER * 0.5)), clamp(py + gauss(JITTER * 0.5))]);
  riverOut = { type: 'LineString', points: centerline, centerline };
} catch { /* river optional */ }

mkdirSync(OUT, { recursive: true });
writeFileSync(resolve(OUT, 'heightmap.json'), JSON.stringify(heightmapOut));
writeFileSync(resolve(OUT, 'contours.json'), JSON.stringify(contoursOut));
if (riverOut) writeFileSync(resolve(OUT, 'river.json'), JSON.stringify(riverOut));

console.log('de-georeferenced terrain written to frontend/public/terrain/');
console.log(`  heightmap: ${R}x${R} (from ${srcRes}), georef stripped`);
console.log(`  boundary : ${propertyBoundary.length} verts (real shape, sub-visual jitter)`);
console.log(`  contours : ${contoursOut.contours.length} polylines (transported)`);
console.log(`  river    : ${riverOut ? riverOut.centerline.length + ' verts' : 'none'}`);
