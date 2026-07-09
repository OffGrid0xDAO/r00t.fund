#!/usr/bin/env node
/**
 * gen-zones.mjs — organic investment parcels ("polígonos de investimento") for
 * the Project 001 land map. Divides the land into HORIZONTAL bands of varied
 * height with wavy, terrain-nudged dividers, splits some bands left/right for
 * size variety, then Chaikin-smooths the outlines so parcels read as organic
 * fields — not a grid.
 *
 * Reads frontend/public/terrain/{heightmap,river}.json → writes zones.json:
 *   [{ id, name, type, elev:[lo,hi], poly:[[nx,ny],...] }]
 *
 * Tiling is preserved (cell-edge tracing: adjacent parcels share edges).
 * Firewall: input geometry is already fuzzed/de-georeferenced.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const T = resolve(ROOT, 'frontend/public/terrain');

const hm = JSON.parse(readFileSync(resolve(T, 'heightmap.json'), 'utf8'));
let river = null;
try { river = JSON.parse(readFileSync(resolve(T, 'river.json'), 'utf8')).centerline; } catch {}

const R0 = hm.resolution;
const boundary = hm.propertyBoundary;

function rng(seed) { let a = seed >>> 0; return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const rand = rng(0x5eed);

const elevAt = (nx, ny) => {
  const gx = Math.max(0, Math.min(R0 - 1.001, nx * (R0 - 1)));
  const gy = Math.max(0, Math.min(R0 - 1.001, ny * (R0 - 1)));
  const x0 = Math.floor(gx), y0 = Math.floor(gy), fx = gx - x0, fy = gy - y0;
  const h00 = hm.data[y0 * R0 + x0], h10 = hm.data[y0 * R0 + x0 + 1];
  const h01 = hm.data[(y0 + 1) * R0 + x0], h11 = hm.data[(y0 + 1) * R0 + x0 + 1];
  return h00 * (1 - fx) * (1 - fy) + h10 * fx * (1 - fy) + h01 * (1 - fx) * fy + h11 * fx * fy;
};
function inPoly(nx, ny, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if (((yi > ny) !== (yj > ny)) && (nx < ((xj - xi) * (ny - yi)) / (yj - yi) + xi)) inside = !inside;
  }
  return inside;
}
const distToRiver = (nx, ny) => {
  if (!river) return Infinity;
  let best = Infinity;
  for (let i = 0; i < river.length - 1; i++) {
    const [ax, ay] = river[i], [bx, by] = river[i + 1];
    const dx = bx - ax, dy = by - ay;
    const t = Math.max(0, Math.min(1, ((nx - ax) * dx + (ny - ay) * dy) / (dx * dx + dy * dy || 1e-9)));
    best = Math.min(best, Math.hypot(nx - (ax + t * dx), ny - (ay + t * dy)));
  }
  return best;
};

// boundary bbox
const xs = boundary.map(p => p[0]), ys = boundary.map(p => p[1]);
const xmin = Math.min(...xs), xmax = Math.max(...xs), ymin = Math.min(...ys), ymax = Math.max(...ys);
const pad = 0.02;
const bx0 = xmin - pad, by0 = ymin - pad, bw = (xmax - xmin) + 2 * pad, bh = (ymax - ymin) + 2 * pad;
const CN = 240;                       // cell grid
const cx = (i) => bx0 + ((i + 0.5) / CN) * bw;
const cy = (j) => by0 + ((j + 0.5) / CN) * bh;
const toNorm = (p) => [bx0 + (p[0] / CN) * bw, by0 + (p[1] / CN) * bh];

const RIVER_BUFFER = 0.009;
const yLo = ymin, yH = ymax - ymin;

// ── horizontal bands of VARIED height ──
const NB = 8;
const wts = Array.from({ length: NB }, () => 0.45 + rand() * 1.7);   // some big, some small
const tot = wts.reduce((a, b) => a + b, 0);
const yEdges = [0]; { let acc = 0; for (const w of wts) { acc += w / tot; yEdges.push(acc); } }
// wavy divider k as a function of nx (organic, 2 octaves), seeded per edge
const waves = yEdges.map((_, k) => ({ a1: 0.004 + rand() * 0.004, f1: 1.1 + rand() * 1.8, p1: rand() * 6.28, a2: 0.0015 + rand() * 0.002, f2: 2.5 + rand() * 2.0, p2: rand() * 6.28 }));
function edgeY(k, nx) {
  const u = (nx - xmin) / (xmax - xmin);
  const w = waves[k];
  return yLo + yEdges[k] * yH + w.a1 * Math.sin(u * 6.28 * w.f1 + w.p1) + w.a2 * Math.sin(u * 6.28 * w.f2 + w.p2);
}
// some bands split left/right with a wavy vertical divider (size variety)
const splitBands = new Set();
for (let k = 0; k < NB; k++) if (rand() < 0.45) splitBands.add(k);
const splitX = Array.from({ length: NB }, () => ({ x: xmin + (0.32 + rand() * 0.36) * (xmax - xmin), a: 0.006 + rand() * 0.01, f: 0.8 + rand() * 1.4, p: rand() * 6.28 }));
function xDivAt(k, ny) {
  const v = (ny - ymin) / (ymax - ymin);
  const s = splitX[k];
  return s.x + s.a * Math.sin(v * 6.28 * s.f + s.p);
}

// label each cell → region key
function bandOf(nx, ny) {
  let b = 0;
  for (let k = 1; k < NB; k++) if (ny > edgeY(k, nx)) b = k;
  return b;
}
function regionKey(nx, ny) {
  if (!inPoly(nx, ny, boundary)) return null;
  if (distToRiver(nx, ny) < RIVER_BUFFER) return 'W';
  const b = bandOf(nx, ny);
  if (splitBands.has(b)) return `b${b}${nx < xDivAt(b, ny) ? 'L' : 'R'}`;
  return `b${b}`;
}
const keys = new Array(CN * CN);
const keyIndex = new Map();
const keyList = [];
for (let j = 0; j < CN; j++) for (let i = 0; i < CN; i++) {
  const k = regionKey(cx(i), cy(j));
  keys[j * CN + i] = k;
  if (k && !keyIndex.has(k)) { keyIndex.set(k, keyList.length); keyList.push(k); }
}
const label = new Int16Array(CN * CN).fill(-1);
for (let n = 0; n < keys.length; n++) if (keys[n]) label[n] = keyIndex.get(keys[n]);

// ── cell-edge tracing (shared edges ⇒ tiling) ──
function labelLoops(lb) {
  const at = (i, j) => (i >= 0 && i < CN && j >= 0 && j < CN && label[j * CN + i] === lb) ? 1 : 0;
  const edges = new Map();
  const add = (a, b) => edges.set(a[0] + ',' + a[1], b);
  for (let j = 0; j < CN; j++) for (let i = 0; i < CN; i++) {
    if (!at(i, j)) continue;
    if (!at(i, j - 1)) add([i + 1, j], [i, j]);
    if (!at(i - 1, j)) add([i, j], [i, j + 1]);
    if (!at(i, j + 1)) add([i, j + 1], [i + 1, j + 1]);
    if (!at(i + 1, j)) add([i + 1, j + 1], [i + 1, j]);
  }
  const loops = [], seen = new Set();
  for (const start of edges.keys()) {
    if (seen.has(start)) continue;
    const loop = []; let key = start;
    for (let g = 0; g < edges.size + 4; g++) {
      if (seen.has(key)) break; seen.add(key);
      const [sx, sy] = key.split(',').map(Number); loop.push([sx, sy]);
      const nxt = edges.get(key); if (!nxt) break;
      key = nxt[0] + ',' + nxt[1]; if (key === start) break;
    }
    if (loop.length >= 4) loops.push(loop);
  }
  return loops;
}

// Chaikin corner-cutting → organic rounded edges (shared edges stay coincident)
function chaikin(poly, iters) {
  let p = poly;
  for (let it = 0; it < iters; it++) {
    const q = []; const n = p.length;
    for (let i = 0; i < n; i++) {
      const a = p[i], b = p[(i + 1) % n];
      q.push([0.75 * a[0] + 0.25 * b[0], 0.75 * a[1] + 0.25 * b[1]]);
      q.push([0.25 * a[0] + 0.75 * b[0], 0.25 * a[1] + 0.75 * b[1]]);
    }
    p = q;
  }
  return p;
}
function simplify(poly, eps) {
  if (poly.length < 5) return poly;
  const dp = (pts) => {
    let dmax = 0, idx = 0; const [ax, ay] = pts[0], [bx, by] = pts[pts.length - 1];
    for (let i = 1; i < pts.length - 1; i++) { const [x, y] = pts[i]; const d = Math.abs((by - ay) * x - (bx - ax) * y + bx * ay - by * ax) / (Math.hypot(bx - ax, by - ay) || 1e-9); if (d > dmax) { dmax = d; idx = i; } }
    if (dmax > eps) return [...dp(pts.slice(0, idx + 1)).slice(0, -1), ...dp(pts.slice(idx))];
    return [pts[0], pts[pts.length - 1]];
  };
  return dp(poly);
}
const signedArea = (poly) => { let a = 0; for (let i = 0, n = poly.length; i < n; i++) { const [x0, y0] = poly[i], [x1, y1] = poly[(i + 1) % n]; a += x0 * y1 - x1 * y0; } return a / 2; };
const areaOf = (poly) => Math.abs(signedArea(poly));

void chaikin;
// ── collect region loops as integer-node sequences (gapless staircase tiling) ──
const kept = []; // { lb, nodes: [[i,j],...] }
for (let lb = 0; lb < keyList.length; lb++) {
  const loops = labelLoops(lb);
  const withA = loops.map(l => ({ l, s: signedArea(l.map(toNorm)) })).filter(o => Math.abs(o.s) > 1e-6);
  if (!withA.length) continue;
  const outer = Math.sign(withA.reduce((m, o) => Math.abs(o.s) > Math.abs(m.s) ? o : m).s);
  for (const { l, s } of withA) {
    if (Math.sign(s) !== outer) continue;
    if (Math.abs(s) < 0.00013) continue;
    kept.push({ lb, nodes: l });
  }
}

// ── global Laplacian smoothing of the SHARED vertex graph ──
// Shared edges move identically for both parcels ⇒ no gaps. Land-border nodes
// are pinned so the outline stays crisp.
const nkey = (p) => p[0] + ',' + p[1];
const adj = new Map();
for (const { nodes } of kept) {
  for (let i = 0; i < nodes.length; i++) {
    const a = nkey(nodes[i]), b = nkey(nodes[(i + 1) % nodes.length]);
    if (!adj.has(a)) adj.set(a, new Set());
    if (!adj.has(b)) adj.set(b, new Set());
    adj.get(a).add(b); adj.get(b).add(a);
  }
}
const cellLabel = (i, j) => (i >= 0 && i < CN && j >= 0 && j < CN) ? label[j * CN + i] : -1;
const isOuter = (i, j) => [[i - 1, j - 1], [i, j - 1], [i - 1, j], [i, j]].some(([ci, cj]) => cellLabel(ci, cj) === -1);
const pos = new Map();
for (const k of adj.keys()) { const [i, j] = k.split(',').map(Number); pos.set(k, [i, j]); }
const pinned = new Set([...adj.keys()].filter(k => { const [i, j] = k.split(',').map(Number); return isOuter(i, j); }));
for (let it = 0; it < 7; it++) {
  const next = new Map();
  for (const [k, nbrs] of adj) {
    if (pinned.has(k)) { next.set(k, pos.get(k)); continue; }
    let sx = 0, sy = 0, c = 0;
    for (const nb of nbrs) { const p = pos.get(nb); sx += p[0]; sy += p[1]; c++; }
    const p0 = pos.get(k);
    next.set(k, [(sx / c) * 0.6 + p0[0] * 0.4, (sy / c) * 0.6 + p0[1] * 0.4]);
  }
  for (const [k, v] of next) pos.set(k, v);
}

// ── build parcels from smoothed shared nodes ──
const parcels = [];
for (const { lb, nodes } of kept) {
  let poly = nodes.map(n => toNorm(pos.get(nkey(n))));
  poly = simplify(poly, 0.0006);
  const a = areaOf(poly);
  if (a < 0.00012) continue;
  let es = 0, ec = 0;
  for (let j = 0; j < CN; j += 2) for (let i = 0; i < CN; i += 2) if (label[j * CN + i] === lb) { es += elevAt(cx(i), cy(j)); ec++; }
  parcels.push({ key: keyList[lb], poly, area: a, elev: ec ? es / ec : 0.5 });
}

// ── assign type + name ──
const elevs = parcels.filter(p => p.key !== 'W').map(p => p.elev).sort((a, b) => a - b);
const p80 = elevs[Math.floor(elevs.length * 0.88)] ?? 1;
// vertical position label from parcel centroid y
function bandName(p) {
  const c = p.poly.reduce((a, q) => [a[0] + q[0], a[1] + q[1]], [0, 0]).map(v => v / p.poly.length);
  const v = (c[1] - ymin) / (ymax - ymin);
  return v < 0.34 ? 'Upper' : v < 0.67 ? 'Mid' : 'Lower';
}
parcels.sort((a, b) => {
  const ca = a.poly.reduce((s, q) => s + q[1], 0) / a.poly.length;
  const cb = b.poly.reduce((s, q) => s + q[1], 0) / b.poly.length;
  return ca - cb;
});
let synN = 0, watN = 0, strN = 0;
const out = parcels.map((p, i) => {
  let type, name;
  const eMin = 0, eMax = 1;
  if (p.key === 'W') { type = 'water'; name = `Water corridor${++watN > 1 ? ' ' + watN : ''}`; }
  else if (p.elev >= p80) { type = 'structure'; name = `${bandName(p)} terrace & access${++strN > 1 ? ' ' + strN : ''}`; }
  else { type = 'syntropic'; name = `${bandName(p)} field ${String.fromCharCode(65 + (synN++ % 26))}`; }
  void eMin; void eMax;
  return { id: `z${i + 1}`, name, type, elev: [Number(p.elev.toFixed(3)), Number(p.elev.toFixed(3))], poly: p.poly.map(q => [Number(q[0].toFixed(4)), Number(q[1].toFixed(4))]) };
});

writeFileSync(resolve(T, 'zones.json'), JSON.stringify(out));
const totalArea = parcels.reduce((s, p) => s + p.area, 0);
console.log(`zones.json: ${out.length} organic parcels`);
console.log(`  ${out.filter(z=>z.type==='syntropic').length} syntropic · ${out.filter(z=>z.type==='water').length} water · ${out.filter(z=>z.type==='structure').length} structure`);
console.log(`  coverage ${totalArea.toFixed(5)} vs boundary ${areaOf(boundary).toFixed(5)}`);
console.log(`  vertex counts: ${out.map(z=>z.poly.length).join(', ')}`);
console.log(`  areas: ${parcels.map(p=>p.area.toFixed(4)).join(', ')}`);
