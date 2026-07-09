/**
 * Seed data for the Project 001 pilot map.
 *
 * Plot x/y/r are SCREEN-RELATIVE (stage fractions in [0,1]) and deliberately
 * hand-placed — they are indicative zones, not a survey. No real geometry here.
 */
import type { Crop, Plot, Machine } from './types';

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
    x: 0.30, y: 0.34, r: 0.075, targetEur: 4200, fundedEur: 3990, status: 'greening',
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
    x: 0.50, y: 0.52, r: 0.07, targetEur: 2600, fundedEur: 2600, status: 'funded',
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
    x: 0.66, y: 0.36, r: 0.08, targetEur: 5200, fundedEur: 1850, status: 'seeking',
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
    x: 0.40, y: 0.66, r: 0.06, targetEur: 1800, fundedEur: 640, status: 'seeking',
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
    x: 0.24, y: 0.56, r: 0.055, targetEur: 3400, fundedEur: 3400, status: 'planted',
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
    x: 0.74, y: 0.60, r: 0.065, targetEur: 6800, fundedEur: 2400, status: 'seeking',
    rewards: ['naming', 'stay', 'certificate'],
    blurb: 'Repair the fire-road switchback and a tool barn so every other plot can be worked and watered.',
    contributions: [
      { id: 'c11', backer: 'anon·0dd', amountEur: 1400, at: Date.now() - 2.9e7 },
      { id: 'c12', backer: 'terra', amountEur: 1000, at: Date.now() - 9e6 },
    ],
    verified: { attested: false, source: 'CCIP attestation (mock)' },
  },
];

// Communal capex — funded together, separate from the plant-a-plot flow.
export const SEED_MACHINES: Machine[] = [
  { id: 'm1', name: 'Tractor', emoji: '🚜', kind: 'machine', targetEur: 9500, fundedEur: 6100, blurb: 'Shared compact tractor — swale digging, mulch hauling, no diesel middlemen.' },
  { id: 'm2', name: 'Wood chipper', emoji: '🪵', kind: 'machine', targetEur: 3200, fundedEur: 2950, blurb: 'Turns salvaged burned trunks into biomass mulch for soil fertility.' },
  { id: 'm3', name: 'Water pump', emoji: '💧', kind: 'machine', targetEur: 1400, fundedEur: 900, blurb: 'Solar pump lifts catchment water to the upper terraces.' },
  { id: 'm4', name: 'Communal kitchen', emoji: '🍲', kind: 'infrastructure', targetEur: 5400, fundedEur: 1200, blurb: 'Where the crews and backers-in-residence cook and gather.' },
];
