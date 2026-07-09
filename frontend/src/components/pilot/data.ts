/**
 * Seed data for the Project 001 pilot map.
 *
 * Plot x/y are TERRAIN-NORMALIZED coordinates ([0,1] over the fuzzed heightmap)
 * placed inside the de-georeferenced land border; r is a normalized radius.
 * These are indicative zones, not a survey — no real geometry.
 */
import type { Crop, Plot, Machine, InterventionType, PatronageReward, PlotStatus } from './types';
import { centroid, type Pt } from './voronoi';

export const CROPS: Crop[] = [
  { id: 'oak', label: 'Native oak', emoji: '🌳', note: 'Cork & holm oak — the canopy layer, deep roots for burned slopes' },
  { id: 'chestnut', label: 'Sweet chestnut', emoji: '🌰', note: 'Food + timber, thrives on granitic soils' },
  { id: 'fig', label: 'Fig & almond', emoji: '🫒', note: 'Fast pioneer fruit, early yield while the canopy grows' },
  { id: 'vine', label: 'Vine & berry', emoji: '🍇', note: 'Ground & climbing layer, holds moisture' },
  { id: 'herb', label: 'Aromatic herbs', emoji: '🌿', note: 'Rosemary, thyme, lavender — pollinators + fire-wise cover' },
];

// seeking → greening → funded → planted → verified
export const SEED_PLOTS: Plot[] = [
  {
    id: 'p1', name: 'Upper Oak Terrace', type: 'syntropic',
    x: 0.302, y: 0.574, r: 0.017, targetEur: 4200, fundedEur: 3990, status: 'greening',
    rewards: ['produce', 'choose-crop', 'naming', 'certificate'],
    cropOptions: ['oak', 'chestnut', 'fig'], chosenCropId: 'oak',
    blurb: 'Contour rows of native oak on the upper burned terrace — the anchor canopy for the whole slope.',
    contributions: [
      { id: 'c1', backer: 'lural.eth', amountEur: 1500, at: Date.now() - 8.6e7 },
      { id: 'c2', backer: 'anon·7f3', amountEur: 900, at: Date.now() - 5.2e7 },
      { id: 'c3', backer: 'meadow', amountEur: 1590, at: Date.now() - 2.1e7 },
    ],
    verified: { attested: false, ndvi: 0.31, source: 'CCIP attestation (mock)' },
  },
  {
    id: 'p2', name: 'Spring Swale', type: 'water',
    x: 0.352, y: 0.596, r: 0.015, targetEur: 2600, fundedEur: 2600, status: 'funded',
    rewards: ['naming', 'certificate'],
    blurb: 'Keyline swale that slows and sinks winter rain across the mid-slope, rehydrating the whole hillside.',
    contributions: [
      { id: 'c4', backer: 'hydro.dao', amountEur: 1600, at: Date.now() - 9.1e7 },
      { id: 'c5', backer: 'anon·b12', amountEur: 1000, at: Date.now() - 3.3e7 },
    ],
    verified: { attested: false, ndvi: 0.28, source: 'CCIP attestation (mock)' },
  },
  {
    id: 'p3', name: 'Chestnut Grove', type: 'syntropic',
    x: 0.402, y: 0.579, r: 0.018, targetEur: 5200, fundedEur: 1850, status: 'seeking',
    rewards: ['produce', 'choose-crop', 'stay', 'certificate'],
    cropOptions: ['chestnut', 'oak', 'vine'],
    blurb: 'A food forest of sweet chestnut and understory fruit — first harvest reward for backers within 3 seasons.',
    contributions: [
      { id: 'c6', backer: 'anon·9aa', amountEur: 850, at: Date.now() - 4.4e7 },
      { id: 'c7', backer: 'silva', amountEur: 1000, at: Date.now() - 1.2e7 },
    ],
    verified: { attested: false, ndvi: 0.19, source: 'CCIP attestation (mock)' },
  },
  {
    id: 'p4', name: 'Lower Herb Bank', type: 'syntropic',
    x: 0.334, y: 0.617, r: 0.013, targetEur: 1800, fundedEur: 640, status: 'seeking',
    rewards: ['produce', 'choose-crop', 'certificate'],
    cropOptions: ['herb', 'vine', 'fig'],
    blurb: 'Aromatic, fire-wise ground cover along the lower path — pollinators and quick green.',
    contributions: [
      { id: 'c8', backer: 'anon·1c4', amountEur: 640, at: Date.now() - 6.0e6 },
    ],
    verified: { attested: false, ndvi: 0.22, source: 'CCIP attestation (mock)' },
  },
  {
    id: 'p5', name: 'Catchment Pond', type: 'water',
    x: 0.286, y: 0.606, r: 0.012, targetEur: 3400, fundedEur: 3400, status: 'planted',
    rewards: ['naming', 'stay', 'certificate'],
    blurb: 'Lined catchment at the base of the swale line — stores gravity-fed irrigation through the dry summer.',
    contributions: [
      { id: 'c9', backer: 'wellspring', amountEur: 2000, at: Date.now() - 1.1e8 },
      { id: 'c10', backer: 'anon·e55', amountEur: 1400, at: Date.now() - 7.7e7 },
    ],
    verified: { attested: true, ndvi: 0.41, source: 'CCIP attestation (mock)', at: Date.now() - 3e6 },
  },
  {
    id: 'p6', name: 'Access Track & Barn', type: 'structure',
    x: 0.424, y: 0.611, r: 0.014, targetEur: 6800, fundedEur: 2400, status: 'seeking',
    rewards: ['naming', 'stay', 'certificate'],
    blurb: 'Repair the fire-road switchback and a tool barn so every other plot can be worked and watered.',
    contributions: [
      { id: 'c11', backer: 'anon·0dd', amountEur: 1400, at: Date.now() - 2.9e7 },
      { id: 'c12', backer: 'terra', amountEur: 1000, at: Date.now() - 9e6 },
    ],
    verified: { attested: false, source: 'CCIP attestation (mock)' },
  },
];

// ── Terrain-derived investment parcels ──────────────────────────────────────
// zones.json is produced by scripts/gen-zones.mjs from the fuzzed terrain
// (elevation terraces + water corridor). Each zone becomes an investable Plot
// with deterministic, seeded funding so the map is stable across reloads.

export interface Zone {
  id: string;
  name: string;
  type: InterventionType;
  elev: [number, number];
  poly: number[][];
}

function seedRng(str: string) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
  return () => {
    h += 0x6D2B79F5; let t = h;
    t = Math.imul(t ^ (t >>> 15), 1 | t);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function polyArea(poly: number[][]): number {
  let a = 0;
  for (let i = 0, n = poly.length; i < n; i++) { const [x0, y0] = poly[i], [x1, y1] = poly[(i + 1) % n]; a += x0 * y1 - x1 * y0; }
  return Math.abs(a) / 2;
}

const BACKERS = ['lural.eth', 'anon·7f3', 'meadow', 'hydro.dao', 'silva', 'terra', 'wellspring', 'anon·b12', 'anon·9aa', 'anon·e55', 'anon·0dd', 'grove', 'anon·1c4', 'seedbank'];
const REWARDS_BY_TYPE: Record<InterventionType, PatronageReward[]> = {
  syntropic: ['produce', 'choose-crop', 'naming', 'certificate'],
  water: ['naming', 'stay', 'certificate'],
  structure: ['naming', 'stay', 'certificate'],
};
const BLURB_BY_TYPE: Record<InterventionType, string> = {
  syntropic: 'Contour rows of food forest on this terrace — trees on the level so water soaks in, not runs off.',
  water: 'The watercourse corridor — swales and catchment that slow and sink winter rain across the slope.',
  structure: 'The steep upper band — erosion barriers from salvaged trunks, plus the access track that serves every terrace below.',
};

// pool of evocative names early namers might pick (their choice → the token name)
const NAMED_POOL = ['Dragon Oak', 'Emberhill', 'Mistvale', 'Thornwood', 'Greenmarch', 'Ashridge', 'Wolfspring', 'Fernhollow', 'Sunterrace', 'Rootdeep', 'Wildeacre', 'Stonebrook'];

export function zonesToPlots(zones: Zone[]): Plot[] {
  return zones.map((z, idx) => {
    const rng = seedRng(z.id);
    const [cx, cy] = centroid(z.poly as Pt[]);
    const target = Math.max(1200, Math.round((1200 + polyArea(z.poly) * 3.6e6) / 100) * 100);
    const f = rng();                       // funded fraction
    const fundedEur = Math.round((target * f) / 100) * 100;
    let status: PlotStatus = f < 0.12 ? 'seeking' : f < 0.85 ? 'greening' : 'funded';
    const r2 = rng();
    if (status === 'funded') { if (r2 < 0.45) status = 'planted'; if (r2 < 0.18) status = 'verified'; }
    // established parcels have been named by an early backer; the rest are open
    const named = f > 0.4;
    const displayName = named ? NAMED_POOL[idx % NAMED_POOL.length] : `Parcel ${String(idx + 1).padStart(2, '0')}`;

    const n = 1 + Math.floor(rng() * 4);
    const contributions = fundedEur <= 0 ? [] : Array.from({ length: n }, (_, i) => ({
      id: `${z.id}-c${i}`,
      backer: BACKERS[Math.floor(rng() * BACKERS.length)],
      amountEur: Math.max(100, Math.round((fundedEur / n) / 50) * 50),
      at: Date.now() - Math.floor(rng() * 1.1e8),
    }));

    const isSyn = z.type === 'syntropic';
    const cropIds = CROPS.map(c => c.id);
    const cropOptions = isSyn ? [cropIds[Math.floor(rng() * cropIds.length)], cropIds[Math.floor(rng() * cropIds.length)], cropIds[Math.floor(rng() * cropIds.length)]].filter((v, i, a) => a.indexOf(v) === i) : undefined;

    return {
      id: z.id,
      name: displayName,
      type: z.type,
      x: cx, y: cy, r: 0.02,
      poly: z.poly,
      elev: z.elev,
      named,
      tokenSupply: 1_000_000,
      targetEur: target,
      fundedEur,
      status,
      rewards: REWARDS_BY_TYPE[z.type],
      cropOptions,
      chosenCropId: isSyn && status !== 'seeking' ? cropOptions?.[0] : undefined,
      blurb: BLURB_BY_TYPE[z.type],
      contributions,
      verified: { attested: status === 'verified', ndvi: 0.18 + f * 0.3, source: 'CCIP attestation (mock)', at: status === 'verified' ? Date.now() - 3e6 : undefined },
    } as Plot;
  });
}

// Communal capex — funded together, separate from the plant-a-plot flow.
// Those with x/y (terrain-normalized) also appear as pins on the plan map.
export const SEED_MACHINES: Machine[] = [
  { id: 'm1', name: 'Tractor', emoji: '🚜', kind: 'machine', targetEur: 9500, fundedEur: 6100, blurb: 'Shared compact tractor — swale digging, mulch hauling, no diesel middlemen.', x: 0.44, y: 0.588 },
  { id: 'm2', name: 'Wood chipper', emoji: '🪵', kind: 'machine', targetEur: 3200, fundedEur: 2950, blurb: 'Turns salvaged burned trunks into biomass mulch for soil fertility.', x: 0.432, y: 0.596 },
  { id: 'm3', name: 'Water pump', emoji: '💧', kind: 'machine', targetEur: 1400, fundedEur: 900, blurb: 'Solar pump lifts catchment water to the upper terraces.', x: 0.30, y: 0.6 },
  { id: 'm4', name: 'Communal kitchen', emoji: '🍲', kind: 'infrastructure', targetEur: 5400, fundedEur: 1200, blurb: 'Where the crews and backers-in-residence cook and gather.', x: 0.415, y: 0.601 },
];
