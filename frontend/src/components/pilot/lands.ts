/**
 * Land registry — r00t is multi-tenant: Project 001 is the template, other land
 * stewards onboard their own land the same way (submit topography + boundary,
 * the pipeline fuzzes + auto-parcels it). Every land's parcel tokens pair with
 * $R00T as the universal base currency, so each new land compounds $R00T demand.
 */
export type LandStatus = 'live' | 'processing' | 'queued';

export interface Land {
  id: string;
  name: string;
  steward: string;
  region: string;          // fuzzy region only — never exact coordinates (firewall)
  status: LandStatus;
  hectares: number;
  parcels: number;
  raisedR00T: number;
  // terrain asset base path (fuzzed, de-georeferenced); Project 001 = /terrain
  terrainPath: string;
}

// $R00T is the base pair for EVERY land's parcel tokens.
export const BASE_TOKEN = 'R00T';

export const LANDS: Land[] = [
  {
    id: 'project-001',
    name: 'Project 001 — the pilot site',
    steward: 'r00t core',
    region: 'Southern Europe · uplands',
    status: 'live',
    hectares: 9,
    parcels: 13,
    raisedR00T: 41400,
    terrainPath: '/terrain',
  },
  // Example onboarding pipeline entries (stewards' real geodata stays private;
  // only fuzzed terrain is ever published):
  {
    id: 'emberfell',
    name: 'Emberfell Commons',
    steward: 'emberfell.eth',
    region: 'Atlantic coast · burned pine',
    status: 'processing',
    hectares: 22,
    parcels: 0,
    raisedR00T: 0,
    terrainPath: '',
  },
  {
    id: 'highvalley',
    name: 'High Valley Regen',
    steward: 'anon·hv',
    region: 'Continental · terraced slope',
    status: 'queued',
    hectares: 14,
    parcels: 0,
    raisedR00T: 0,
    terrainPath: '',
  },
];
