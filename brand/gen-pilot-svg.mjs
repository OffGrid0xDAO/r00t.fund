// Bakes the real Project 001 pilot terrain (boundary + contours + river + parcels)
// into a compact static SVG for the X/Twitter banner. Mirrors PlotMapTopo's
// projection + styling, tuned for the dark lime banner. Firewall-safe: consumes
// the already-fuzzed, de-georeferenced terrain JSON in frontend/public/terrain.
import fs from 'node:fs';

const PUB = new URL('../frontend/public/terrain/', import.meta.url);
const read = (f) => JSON.parse(fs.readFileSync(new URL(f, PUB)));

const boundary = read('heightmap.json').propertyBoundary;
const contours = read('contours.json').contours || [];
const river = read('river.json').centerline;
const zones = read('zones.json');

// ── projection (same math as PlotMapTopo) ───────────────────────────────
const xs = boundary.map((p) => p[0]), ys = boundary.map((p) => p[1]);
const xmin = Math.min(...xs), xmax = Math.max(...xs), ymin = Math.min(...ys), ymax = Math.max(...ys);
const pad = 0.12 * Math.max(xmax - xmin, ymax - ymin);
const vx0 = xmin - pad, vy0 = ymin - pad;
const vw = (xmax - xmin) + 2 * pad, vh = (ymax - ymin) + 2 * pad;
const S = 1000 / vw;
const H = +(vh * S).toFixed(1);
const px = (nx, ny) => [(nx - vx0) * S, (ny - vy0) * S];
const inPad = (nx, ny) => nx >= vx0 && nx <= vx0 + vw && ny >= vy0 && ny <= vy0 + vh;
const path = (poly, close) =>
  poly.map((p, i) => `${i ? 'L' : 'M'}${px(p[0], p[1]).map((n) => n.toFixed(1)).join(' ')}`).join('') + (close ? 'Z' : '');

const borderPath = path(boundary, true);
const riverPath = river ? path(river.filter(([x, y]) => inPad(x, y)), false) : '';

// keep only major/medium contours that fall in view — keeps the file small
const contourPaths = contours
  .filter((c) => (c.l === 'major' || c.l === 'medium') && c.p.some(([x, y]) => inPad(x, y)))
  .map((c) => ({ d: path(c.p, false), l: c.l }));

// ── parcel styling ──────────────────────────────────────────────────────
const LIME = '#D6FE51', TEAL = '#5BA8B5', GOLD = '#D4A84B';
const TYPE = { syntropic: LIME, water: TEAL, structure: GOLD };
const CULTURE = [
  { e: '🌳', t: 'OAK' }, { e: '🌰', t: 'NUT' }, { e: '🥕', t: 'CARROT' }, { e: '🥬', t: 'TURNIP' },
  { e: '🍇', t: 'VINE' }, { e: '🥔', t: 'SPUD' }, { e: '🫘', t: 'BEAN' }, { e: '🌿', t: 'HERB' },
  { e: '🎃', t: 'SQUASH' }, { e: '🪺', t: 'FIG' },
];
const WATER = { e: '💧', t: 'SWALE' };
const STRUCT = { e: '⛰️', t: 'STONE' };

// deterministic interior scatter so fields visibly fill
function mulberry(seed) {
  return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function pointInPoly(nx, ny, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > ny) !== (yj > ny) && nx < ((xj - xi) * (ny - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
function scatter(poly, max, seed) {
  const pxs = poly.map((p) => p[0]), pys = poly.map((p) => p[1]);
  const x0 = Math.min(...pxs), x1 = Math.max(...pxs), y0 = Math.min(...pys), y1 = Math.max(...pys);
  const rnd = mulberry(seed); const out = []; let tries = 0;
  while (out.length < max && tries < max * 60) { tries++; const nx = x0 + rnd() * (x1 - x0), ny = y0 + rnd() * (y1 - y0); if (pointInPoly(nx, ny, poly)) out.push([nx, ny]); }
  return out;
}

let syn = 0;
const parcels = zones.map((z, i) => {
  const color = TYPE[z.type] || LIME;
  const cx = z.poly.reduce((s, p) => s + p[0], 0) / z.poly.length;
  const cy = z.poly.reduce((s, p) => s + p[1], 0) / z.poly.length;
  const [scx, scy] = px(cx, cy);
  const cult = z.type === 'syntropic' ? CULTURE[syn++ % CULTURE.length] : z.type === 'water' ? WATER : STRUCT;
  const pts = scatter(z.poly, Math.min(10, Math.max(3, Math.round(z.poly.length / 2.4))), i * 97 + 13);
  const glyphs = pts.map(([x, y]) => { const [sx, sy] = px(x, y); return `<text x="${sx.toFixed(1)}" y="${sy.toFixed(1)}" font-size="13" text-anchor="middle" opacity="0.92">${cult.e}</text>`; }).join('');
  const filled = z.type !== 'structure'; // give most parcels the "backed" look
  return `
    <g>
      <path d="${path(z.poly, true)}" fill="${color}" fill-opacity="${filled ? 0.4 : 0.16}" stroke="${color}" stroke-width="${filled ? 1.6 : 1.1}" stroke-opacity="${filled ? 1 : 0.5}" ${filled ? '' : 'stroke-dasharray="5 4"'} stroke-linejoin="round" />
      ${glyphs}
      <rect x="${(scx - 30).toFixed(1)}" y="${(scy - 8).toFixed(1)}" width="60" height="16" rx="8" fill="#0B0D0A" opacity="0.72" />
      <text x="${scx.toFixed(1)}" y="${(scy + 3.5).toFixed(1)}" text-anchor="middle" font-family="'IBM Plex Mono',monospace" font-size="10" font-weight="700" fill="${color}">$${cult.t}</text>
    </g>`;
}).join('');

const svg = `<svg viewBox="0 0 1000 ${H}" width="100%" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Project 001 pilot land">
  <defs><clipPath id="land"><path d="${borderPath}" /></clipPath></defs>
  <g opacity="0.5" clip-path="url(#land)">
    ${contourPaths.map((c) => `<path d="${c.d}" fill="none" stroke="${LIME}" stroke-opacity="${c.l === 'major' ? 0.4 : 0.2}" stroke-width="${c.l === 'major' ? 1.1 : 0.7}" stroke-linejoin="round" />`).join('\n    ')}
  </g>
  <path d="${borderPath}" fill="${LIME}" fill-opacity="0.05" />
  ${parcels}
  <path d="${borderPath}" fill="none" stroke="${LIME}" stroke-width="2.6" stroke-opacity="0.9" stroke-linejoin="round" />
  ${riverPath ? `<path d="${riverPath}" fill="none" stroke="${TEAL}" stroke-width="3.2" stroke-opacity="0.65" stroke-linecap="round" stroke-linejoin="round" />` : ''}
</svg>`;

fs.writeFileSync(new URL('./pilot-land.svg', import.meta.url), svg);
console.log(`wrote pilot-land.svg — ${(svg.length / 1024).toFixed(1)} KB · viewBox 1000x${H} · ${zones.length} parcels · ${contourPaths.length} contours`);
