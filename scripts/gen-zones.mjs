#!/usr/bin/env node
/**
 * gen-zones.mjs — derive investment polygons ("polígonos de investimento") from
 * the fuzzed terrain, so parcels follow the actual land (elevation terraces +
 * water corridor) instead of arbitrary cuts.
 *
 * Reads frontend/public/terrain/{heightmap,river}.json and writes
 * frontend/public/terrain/zones.json:
 *   [{ id, name, type, elev:[lo,hi], poly:[[nx,ny],...] }]
 *
 * Method:
 *   - sample elevation over the boundary bbox (bilinear from the heightmap)
 *   - mask = inside the property boundary
 *   - water corridor = cells within a buffer of the river centreline
 *   - remaining land split into K elevation terraces by quantile thresholds
 *   - highest terrace flagged 'structure' (steep, erosion barriers/access),
 *     the rest 'syntropic'; the corridor is 'water'
 *   - each label's connected regions polygonised by cell-edge tracing (adjacent
 *     parcels share exact edges ⇒ perfect tiling), then simplified (Douglas–Peucker)
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
    const px = ax + t * dx, py = ay + t * dy;
    best = Math.min(best, Math.hypot(nx - px, ny - py));
  }
  return best;
};

// ── boundary bbox + sampling grid ──
const xs = boundary.map(p => p[0]), ys = boundary.map(p => p[1]);
const xmin = Math.min(...xs), xmax = Math.max(...xs), ymin = Math.min(...ys), ymax = Math.max(...ys);
const pad = 0.02;
const bx0 = xmin - pad, by0 = ymin - pad, bw = (xmax - xmin) + 2 * pad, bh = (ymax - ymin) + 2 * pad;
const RES = 200;
const gx = (i) => bx0 + (i / (RES - 1)) * bw;
const gy = (j) => by0 + (j / (RES - 1)) * bh;

const RIVER_BUFFER = 0.010;   // ~ corridor half-width in normalized units
const K_TERRACES = 10;         // elevation bands on the dry land
const CN = RES;               // cell-grid resolution (cells, not grid points)

// gather masked elevations to pick quantile thresholds (dry land only)
const cx = (i) => bx0 + ((i + 0.5) / CN) * bw;   // cell CENTRE
const cy = (j) => by0 + ((j + 0.5) / CN) * bh;
void gx; void gy;
const dryElevs = [];
for (let j = 0; j < CN; j++) for (let i = 0; i < CN; i++) {
  const nx = cx(i), ny = cy(j);
  if (!inPoly(nx, ny, boundary)) continue;
  if (distToRiver(nx, ny) < RIVER_BUFFER) continue;
  dryElevs.push(elevAt(nx, ny));
}
dryElevs.sort((a, b) => a - b);
const q = (t) => dryElevs[Math.max(0, Math.min(dryElevs.length - 1, Math.round(t * (dryElevs.length - 1))))];
const thresholds = Array.from({ length: K_TERRACES + 1 }, (_, k) => q(k / K_TERRACES));

// label each CELL: -1 outside, 0 = water corridor, 1..K = terrace (low→high)
function labelAt(nx, ny) {
  if (!inPoly(nx, ny, boundary)) return -1;
  if (distToRiver(nx, ny) < RIVER_BUFFER) return 0;
  const e = elevAt(nx, ny);
  for (let k = 0; k < K_TERRACES; k++) if (e < thresholds[k + 1] || k === K_TERRACES - 1) return k + 1;
  return K_TERRACES;
}
const label = new Int8Array(CN * CN);
for (let j = 0; j < CN; j++) for (let i = 0; i < CN; i++) label[j * CN + i] = labelAt(cx(i), cy(j));

// corner (integer i,j) of the CELL grid → normalized coords
const toNorm = (p) => [bx0 + (p[0] / CN) * bw, by0 + (p[1] / CN) * bh];

// ── cell-edge region tracing: outline the union of cells with a given label.
// Adjacent labels share exact edges ⇒ the parcels tile with no gaps. ──
function labelLoops(lb) {
  const at = (i, j) => (i >= 0 && i < CN && j >= 0 && j < CN && label[j * CN + i] === lb) ? 1 : 0;
  // directed boundary edges, interior kept on a consistent side
  const edges = new Map(); // key(start) -> end  (start->end)
  const addEdge = (a, b) => { edges.set(a[0] + ',' + a[1], b); };
  for (let j = 0; j < CN; j++) for (let i = 0; i < CN; i++) {
    if (!at(i, j)) continue;
    if (!at(i, j - 1)) addEdge([i + 1, j], [i, j]);         // top    → left
    if (!at(i - 1, j)) addEdge([i, j], [i, j + 1]);         // left   → down
    if (!at(i, j + 1)) addEdge([i, j + 1], [i + 1, j + 1]); // bottom → right
    if (!at(i + 1, j)) addEdge([i + 1, j + 1], [i + 1, j]); // right  → up
  }
  const loops = [];
  const seen = new Set();
  for (const startKey of edges.keys()) {
    if (seen.has(startKey)) continue;
    const loop = [];
    let key = startKey;
    for (let guard = 0; guard < edges.size + 4; guard++) {
      if (seen.has(key)) break;
      seen.add(key);
      const [sx, sy] = key.split(',').map(Number);
      loop.push([sx, sy]);
      const nxt = edges.get(key);
      if (!nxt) break;
      key = nxt[0] + ',' + nxt[1];
      if (key === startKey) break;
    }
    if (loop.length >= 4) loops.push(loop);
  }
  return loops;
}
const areaOf = (poly) => { let a = 0; for (let i = 0, n = poly.length; i < n; i++) { const [x0, y0] = poly[i], [x1, y1] = poly[(i + 1) % n]; a += x0 * y1 - x1 * y0; } return Math.abs(a) / 2; };
function simplify(poly, eps) {
  if (poly.length < 4) return poly;
  const dp = (pts) => {
    let dmax = 0, idx = 0;
    const [ax, ay] = pts[0], [bx, by] = pts[pts.length - 1];
    for (let i = 1; i < pts.length - 1; i++) {
      const [x, y] = pts[i];
      const num = Math.abs((by - ay) * x - (bx - ax) * y + bx * ay - by * ax);
      const den = Math.hypot(bx - ax, by - ay) || 1e-9;
      const d = num / den;
      if (d > dmax) { dmax = d; idx = i; }
    }
    if (dmax > eps) return [...dp(pts.slice(0, idx + 1)).slice(0, -1), ...dp(pts.slice(idx))];
    return [pts[0], pts[pts.length - 1]];
  };
  return dp(poly);
}

const signedArea = (poly) => { let a = 0; for (let i = 0, n = poly.length; i < n; i++) { const [x0, y0] = poly[i], [x1, y1] = poly[(i + 1) % n]; a += x0 * y1 - x1 * y0; } return a / 2; };

// ── build zones per label ──
const zones = [];
const labelsPresent = [...new Set([...label].filter(v => v >= 0))].sort((a, b) => a - b);
for (const lb of labelsPresent) {
  const loops = labelLoops(lb);
  // outer loops share one winding sign; holes the other — keep the dominant sign
  const withArea = loops.map(l => ({ l, s: signedArea(l.map(toNorm)) })).filter(o => Math.abs(o.s) > 1e-6);
  const outerSign = Math.sign(withArea.reduce((m, o) => Math.abs(o.s) > Math.abs(m.s) ? o : m, withArea[0] || { s: 0 }).s || 1);
  for (const { l, s } of withArea) {
    if (Math.sign(s) !== outerSign) continue; // drop holes
    let poly = simplify(l.map(toNorm), 0.0022);
    if (poly.length < 4) continue;
    const a = areaOf(poly);
    if (a < 0.00010) continue; // drop slivers
    zones.push({ label: lb, poly, area: a });
  }
}

// assign type + name; terraces low→high elevation
zones.sort((z1, z2) => z1.label - z2.label);
const maxTerrace = K_TERRACES;
let waterN = 0, terraceN = 0, structN = 0;
const out = zones.map((z, i) => {
  let type, name;
  if (z.label === 0) { type = 'water'; name = `Water corridor ${++waterN}`; }
  else if (z.label === maxTerrace) { type = 'structure'; name = `Upper terrace & access ${++structN}`; }
  else { type = 'syntropic'; name = `Terrace ${++terraceN}`; }
  const lo = z.label >= 1 ? thresholds[z.label - 1] : 0;
  const hi = z.label >= 1 ? thresholds[z.label] : 0;
  return { id: `z${i + 1}`, name, type, elev: [Number(lo.toFixed(3)), Number(hi.toFixed(3))], poly: z.poly.map(p => [Number(p[0].toFixed(4)), Number(p[1].toFixed(4))]) };
});

writeFileSync(resolve(T, 'zones.json'), JSON.stringify(out));
const totalArea = zones.reduce((s, z) => s + z.area, 0);
console.log(`zones.json written: ${out.length} investment polygons`);
console.log(`  types: ${out.filter(z=>z.type==='syntropic').length} syntropic · ${out.filter(z=>z.type==='water').length} water · ${out.filter(z=>z.type==='structure').length} structure`);
console.log(`  covered area ${totalArea.toFixed(5)} vs boundary ${areaOf(boundary).toFixed(5)}`);
console.log(`  vertex counts: ${out.map(z=>z.poly.length).join(', ')}`);
