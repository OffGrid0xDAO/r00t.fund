/**
 * Project 001 pilot-map data model.
 *
 * IMPORTANT — legal shape: backer rewards here are PATRONAGE ONLY (produce,
 * stays, naming, choose-what-grows, a certificate NFT). Nothing in this model
 * wires revenue share, yield, profit, or resale value to a backer or a token.
 *
 * IMPORTANT — firewall: plot geometry is fuzzed and screen-relative. These are
 * indicative zones, NOT cadastral parcels, and carry no real coordinates.
 */

// The three intervention types seeded across the pilot site.
export type InterventionType = 'syntropic' | 'water' | 'structure';

// Per-plot lifecycle: seeking → greening → funded → planted → verified.
export type PlotStatus = 'seeking' | 'greening' | 'funded' | 'planted' | 'verified';

// What a backer may choose to grow on a syntropic plot (choose-what-grows reward).
export interface Crop {
  id: string;
  label: string;
  emoji: string;
  note: string;
}

// Patronage rewards a backer receives — never financial return.
export type PatronageReward =
  | 'produce'        // a share of what the plot yields, in kind
  | 'stay'           // nights at the pilot site
  | 'naming'         // name the plot / tree row
  | 'choose-crop'    // decide what grows (syntropic plots)
  | 'certificate';   // commemorative certificate NFT (non-transferable badge)

export interface Contribution {
  id: string;
  backer: string;    // display handle only (no identity linkage)
  amountEur: number;
  at: number;        // epoch ms
}

export interface Plot {
  id: string;
  name: string;
  type: InterventionType;
  // terrain-normalized placement ([0,1] over the fuzzed heightmap), inside the border
  x: number;
  y: number;
  r: number;         // indicative radius (terrain-normalized)
  // terrain-derived investment polygon (normalized coords); set for zone parcels
  poly?: number[][];
  elev?: [number, number];
  // per-parcel token (paired with $R00T): backers are airdropped this on a curve
  ticker?: string;
  tokenSupply?: number;
  named?: boolean;   // false → open for a pledger to name it (naming right → token name)
  targetEur: number;
  fundedEur: number;
  status: PlotStatus;
  contributions: Contribution[];
  rewards: PatronageReward[];
  chosenCropId?: string;      // set once a backer exercises choose-what-grows
  cropOptions?: string[];     // Crop ids available (syntropic only)
  blurb: string;
  // verification (Workstream G) — populated from the attestation adapter (mock now)
  verified?: {
    attested: boolean;
    ndvi?: number;            // greenness proxy from the pilot-site data feed
    source: string;           // e.g. "CCIP attestation (mock)"
    at?: number;
  };
}

// Shared communal capital equipment + infrastructure (Workstream E).
// Funded together, separate from the plant-a-plot flow.
export interface Machine {
  id: string;
  name: string;
  emoji: string;
  kind: 'machine' | 'infrastructure';
  targetEur: number;
  fundedEur: number;
  blurb: string;
  // optional terrain-normalized position — shows the item as a pin on the plan map
  x?: number;
  y?: number;
}

export const STATUS_ORDER: PlotStatus[] = ['seeking', 'greening', 'funded', 'planted', 'verified'];

export const STATUS_LABEL: Record<PlotStatus, string> = {
  seeking: 'Seeking backers',
  greening: 'Greening',
  funded: 'Funded',
  planted: 'Planted',
  verified: 'Verified',
};

export const TYPE_LABEL: Record<InterventionType, string> = {
  syntropic: 'Syntropic planting',
  water: 'Water & swales',
  structure: 'Structure & access',
};
