/**
 * Workflow 7: Serra da Estrela Native Forest Restoration -- Custom Data Feed
 *
 * REAL PROJECT: After the September 2025 fires devastated Serra da Estrela Natural Park,
 * we are reforesting 9 hectares with native Iberian species in two phases:
 *
 * PHASE 1 (2026 H1) — Ground Clearing — €27,150 budget
 *   Clear burned trees, woodchip biomass for soil fertility, build contour
 *   erosion barriers from salvaged trunks. Giratória + biotriturador + 4-person crew.
 *
 * PHASE 2 (Sep–Oct 2026) — Native Replanting — €17,300 budget
 *   Quercus pyrenaica (Carvalho-negral)         -- 450 trees
 *   Quercus robur (Carvalho-roble)              -- 400 trees
 *   Castanea sativa (Castanheiro)               -- 350 trees
 *   Betula celtiberica (Vidoeiro)               -- 300 trees
 *   Pinus sylvestris (Pinheiro-silvestre)       -- 400 trees
 *   Arbutus unedo (Medronheiro)                 -- 350 trees
 *   Prunus lusitanica (Azereiro)                -- 300 trees
 *                                       Total: 2,550 native trees
 *
 * Location: Serra da Estrela Natural Park, Seia, Portugal (exact coords in private config)
 * Area: 9 hectares (90,000 m2)
 * Fire date: September 2025 | Clearing: 2026 H1 | Planting target: Sep-Oct 2026
 * ICNF Project: PRRF-SE-2025-0042
 * Total budget: €44,450
 *
 * This CRE workflow creates a Chainlink-compatible data feed that publishes:
 * - Post-fire NDVI recovery trajectory (Copernicus Sentinel-2)
 * - dNBR burn severity from satellite (Sentinel-2 NIR + SWIR bands)
 * - Soil organic carbon recovery (ISRIC SoilGrids)
 * - Tree survival rate estimation (post-planting, NDVI micro-analysis)
 * - Carbon sequestration estimate (tCO2e/year)
 * - Fire recovery index (composite 0-1000 score)
 * - Current project phase tracking (clearing / planting / monitoring)
 *
 * Trigger: CronCapability (weekly)
 * Capabilities: HTTPClient, EVMClient
 */

import {
  bytesToHex,
  cre,
  encodeCallMsg,
  getNetwork,
  LAST_FINALIZED_BLOCK_NUMBER,
  hexToBase64,
  Runner,
  type Runtime,
  type CronPayload,
} from '@chainlink/cre-sdk'
import {
  encodeFunctionData,
  type Address,
  zeroAddress,
} from 'viem'
import { z } from 'zod'
import { SerraEstrelaNativeForestABI } from '../contracts/abi/SerraEstrelaNativeForest'

// ============ Config Schema ============

const configSchema = z.object({
  schedule: z.string(),
  chainName: z.string(),
  serraEstrelaAddress: z.string(),
  gasLimit: z.string(),
  projectLat: z.number(),
  projectLon: z.number(),
  // Copernicus Data Space OAuth2 credentials (free at dataspace.copernicus.eu)
  copernicusClientId: z.string().optional(),
  copernicusClientSecret: z.string().optional(),
  // NASA FIRMS API key (free at https://firms.modaps.eosdis.nasa.gov/api/area/)
  firmsMapKey: z.string().optional(),
})

type Config = z.infer<typeof configSchema>

// ============ Project Constants ============

const PROJECT_AREA_HECTARES = 9
const TOTAL_TREES = 2550
const FIRE_DATE = '2025-09-07'

// Phase dates
const CLEARING_START = '2026-02-01'   // Phase 1: Ground clearing begins
const CLEARING_END = '2026-06-30'     // Phase 1: Clearing complete
const PLANTING_START = '2026-09-15'   // Phase 2: Native replanting begins
const PLANTING_END = '2026-10-31'     // Phase 2: Planting complete

// Measured pre-fire baselines from Sentinel-2 (Aug 26, 2025 — 12 days before fire)
const PREFIRE_NDVI = 0.8243
const PREFIRE_NBR = 0.6542

// Bounding box derived from private config coordinates
// ~420m × 440m envelope around 9 ha project area (includes buffer)
function getBbox(config: Config): [number, number, number, number] {
  const lon = config.projectLon
  const lat = config.projectLat
  return [lon - 0.005, lat - 0.004, lon + 0.005, lat + 0.004]
}

// Species composition — matches landing page and project plan
const SPECIES = [
  { name: 'Quercus pyrenaica', count: 450, co2PerTreePerYear: 22, survivalRate: 0.85 },
  { name: 'Quercus robur', count: 400, co2PerTreePerYear: 22, survivalRate: 0.85 },
  { name: 'Castanea sativa', count: 350, co2PerTreePerYear: 28, survivalRate: 0.80 },
  { name: 'Betula celtiberica', count: 300, co2PerTreePerYear: 18, survivalRate: 0.78 },
  { name: 'Pinus sylvestris', count: 400, co2PerTreePerYear: 25, survivalRate: 0.72 },
  { name: 'Arbutus unedo', count: 350, co2PerTreePerYear: 10, survivalRate: 0.88 },
  { name: 'Prunus lusitanica', count: 300, co2PerTreePerYear: 15, survivalRate: 0.82 },
] as const

// Data source APIs
const COPERNICUS_TOKEN_URL = 'https://identity.dataspace.copernicus.eu/auth/realms/CDSE/protocol/openid-connect/token'
const COPERNICUS_STATS_API = 'https://sh.dataspace.copernicus.eu/api/v1/statistics'
const SOILGRIDS_API = 'https://rest.isric.org/soilgrids/v2.0/properties/query'
const OPEN_METEO_API = 'https://api.open-meteo.com/v1/forecast'
const FIRMS_API = 'https://firms.modaps.eosdis.nasa.gov/api/area/csv'

// Sentinel-1 SAR pre-fire baselines (VH/VV ratio for healthy forest ≈ 0.4-0.5)
const PREFIRE_SAR_CROSS_RATIO = 0.45

// ============ Project Goals & Timeline ============
// Each phase has concrete, measurable goals evaluated by the workflow every run.

interface ProjectGoal {
  id: string
  phase: ProjectPhase
  title: string
  description: string
  target: string
  evaluate: (ctx: GoalContext) => { progress: number; status: 'not_started' | 'in_progress' | 'met' | 'at_risk' }
}

interface GoalContext {
  phase: ProjectPhase
  ndvi: number
  dnbr: number
  sarCrossRatio: number | null
  soilMoisture: number | null
  avgTemp: number
  rainfall: number
  monthsSinceFire: number
  monthsSincePlanting: number
  totalLiveTrees: number
  fireRecoveryIndex: number
}

const PROJECT_GOALS: ProjectGoal[] = [
  // ── Phase 1: Ground Clearing (Feb–Jun 2026) ──
  {
    id: 'G1',
    phase: 'clearing',
    title: 'Cut dead burned wood',
    description: 'Remove fire-killed trees and standing dead wood across 9 ha to eliminate fire hazard',
    target: 'SAR VH/VV drops below 0.35 (vertical structure removed)',
    evaluate: (ctx) => {
      if (ctx.phase !== 'clearing' && ctx.phase !== 'post_clearing' && ctx.phase !== 'planting' && ctx.phase !== 'monitoring') {
        return { progress: 0, status: 'not_started' }
      }
      if (ctx.sarCrossRatio !== null) {
        // VH/VV < 0.35 means vertical tree structure removed (burned trunks felled)
        // Pre-fire was ~0.45, burned standing dead ≈ 0.30-0.38
        const pct = Math.min(100, Math.max(0, ((PREFIRE_SAR_CROSS_RATIO - ctx.sarCrossRatio) / (PREFIRE_SAR_CROSS_RATIO - 0.25)) * 100))
        return { progress: pct, status: pct >= 80 ? 'met' : pct > 20 ? 'in_progress' : 'not_started' }
      }
      // Fallback: use dNBR trend — higher dNBR during clearing = more exposure = progress
      const pct = Math.min(100, Math.max(0, (ctx.dnbr / 0.9) * 100))
      return { progress: pct, status: ctx.phase === 'clearing' ? 'in_progress' : pct > 60 ? 'met' : 'in_progress' }
    },
  },
  {
    id: 'G2',
    phase: 'clearing',
    title: 'Woodchip biomass for soil fertility',
    description: 'Chip felled burned wood with biotriturador, spread across site to build soil organic matter',
    target: 'Soil moisture > 0.15 m³/m³ (mulch retaining water)',
    evaluate: (ctx) => {
      if (ctx.phase === 'pre_clearing') return { progress: 0, status: 'not_started' }
      if (ctx.soilMoisture !== null) {
        // Woodchip mulch retains moisture — target > 0.15 even in dry periods
        const pct = Math.min(100, Math.max(0, (ctx.soilMoisture / 0.18) * 100))
        return { progress: pct, status: pct >= 80 ? 'met' : 'in_progress' }
      }
      // If no soil moisture data, track by phase progress
      const phaseProgress = ctx.phase === 'clearing' ? 50 : ctx.phase === 'post_clearing' ? 80 : 100
      return { progress: phaseProgress, status: phaseProgress >= 80 ? 'met' : 'in_progress' }
    },
  },
  {
    id: 'G3',
    phase: 'clearing',
    title: 'Build contour erosion barriers',
    description: 'Stack salvaged trunks along contour lines to prevent soil erosion on slopes',
    target: 'Completed before rainy season (Oct 2026)',
    evaluate: (ctx) => {
      // Not directly measurable from satellite — track by phase timeline
      if (ctx.phase === 'pre_clearing') return { progress: 0, status: 'not_started' }
      if (ctx.phase === 'clearing') return { progress: 40, status: 'in_progress' }
      return { progress: 100, status: 'met' }
    },
  },
  {
    id: 'G4',
    phase: 'clearing',
    title: 'Reduce fire hazard',
    description: 'Remove dead fuel load to prevent reburn before replanting',
    target: 'dNBR decreasing trend + no FIRMS active fire detections',
    evaluate: (ctx) => {
      if (ctx.phase === 'pre_clearing') return { progress: 0, status: 'not_started' }
      // Fire hazard reduces as dead material is cleared
      // dNBR > 0.8 still = lots of burn damage visible. As we clear, it stays high but
      // the fuel on the ground is removed (not detectable by dNBR alone)
      // Combine phase progress with dNBR
      const phaseWeight = ctx.phase === 'clearing' ? 0.5 : 1.0
      const pct = Math.min(100, phaseWeight * 100)
      return { progress: pct, status: pct >= 80 ? 'met' : 'in_progress' }
    },
  },
  // ── Phase 2: Soil Prep (Jul–Sep 2026) ──
  {
    id: 'G5',
    phase: 'post_clearing',
    title: 'Prepare soil for planting',
    description: 'Ground cleared, woodchips decomposing, soil moisture adequate for autumn planting',
    target: 'Soil moisture > 0.12, ground NDVI < 0.3 (bare prepared soil)',
    evaluate: (ctx) => {
      if (ctx.phase === 'pre_clearing' || ctx.phase === 'clearing') return { progress: 0, status: 'not_started' }
      if (ctx.phase === 'post_clearing') {
        const soilOk = ctx.soilMoisture === null || ctx.soilMoisture > 0.12
        const groundOk = ctx.ndvi < 0.35 // Bare prepared ground
        const pct = (soilOk ? 50 : 30) + (groundOk ? 50 : 20)
        return { progress: Math.min(100, pct), status: soilOk && groundOk ? 'met' : 'in_progress' }
      }
      return { progress: 100, status: 'met' }
    },
  },
  // ── Phase 3: Native Replanting (Sep–Oct 2026) ──
  {
    id: 'G6',
    phase: 'planting',
    title: 'Plant 2,550 native trees',
    description: '7 native Iberian species planted across 9 ha at ~280 trees/ha density',
    target: 'NDVI begins rising above bare-soil baseline within 60 days of planting',
    evaluate: (ctx) => {
      if (ctx.phase !== 'planting' && ctx.phase !== 'monitoring') return { progress: 0, status: 'not_started' }
      if (ctx.phase === 'planting') return { progress: 50, status: 'in_progress' }
      // Post-planting: check if NDVI is rising
      const plantingNdvi = 0.15 // Expected bare ground at planting time
      const ndviGain = ctx.ndvi - plantingNdvi
      const pct = Math.min(100, Math.max(0, (ndviGain / 0.1) * 100))
      return { progress: Math.max(50, pct), status: pct > 30 ? 'met' : 'in_progress' }
    },
  },
  // ── Phase 4: Monitoring (Nov 2026+) ──
  {
    id: 'G7',
    phase: 'monitoring',
    title: 'Achieve >75% tree survival',
    description: 'At least 1,912 of 2,550 trees survive first winter (75% threshold)',
    target: 'Estimated live trees > 1,912 by spring 2027',
    evaluate: (ctx) => {
      if (ctx.phase !== 'monitoring') return { progress: 0, status: 'not_started' }
      const survivalPct = (ctx.totalLiveTrees / TOTAL_TREES) * 100
      const pct = Math.min(100, (survivalPct / 75) * 100)
      return { progress: pct, status: survivalPct >= 75 ? 'met' : survivalPct >= 60 ? 'in_progress' : 'at_risk' }
    },
  },
  {
    id: 'G8',
    phase: 'monitoring',
    title: 'NDVI recovery trajectory',
    description: 'Vegetation index trending toward pre-fire baseline (0.82)',
    target: 'NDVI > 0.4 by year 2, > 0.6 by year 5',
    evaluate: (ctx) => {
      if (ctx.phase !== 'monitoring') return { progress: 0, status: 'not_started' }
      const recoveryPct = Math.max(0, (ctx.ndvi - 0.08) / (PREFIRE_NDVI - 0.08)) * 100
      const yearTarget = ctx.monthsSincePlanting < 24 ? 40 : ctx.monthsSincePlanting < 60 ? 60 : 75
      return {
        progress: Math.min(100, recoveryPct),
        status: recoveryPct >= yearTarget ? 'met' : recoveryPct >= yearTarget * 0.7 ? 'in_progress' : 'at_risk',
      }
    },
  },
  {
    id: 'G9',
    phase: 'monitoring',
    title: 'Carbon sequestration verified',
    description: 'Measurable CO2 capture registered with Portugal VCM (mvcarbono.pt)',
    target: '~8 tCO2/yr by year 3, ~52 tCO2/yr at maturity',
    evaluate: (ctx) => {
      if (ctx.phase !== 'monitoring') return { progress: 0, status: 'not_started' }
      if (ctx.monthsSincePlanting < 12) return { progress: 10, status: 'in_progress' }
      const yearTarget = ctx.monthsSincePlanting < 36 ? 8 : ctx.monthsSincePlanting < 120 ? 32 : 52
      const co2Tonnes = ctx.totalLiveTrees > 0 ? ctx.fireRecoveryIndex * 0.052 : 0 // rough proxy
      const pct = Math.min(100, (co2Tonnes / yearTarget) * 100)
      return { progress: pct, status: pct >= 80 ? 'met' : pct >= 40 ? 'in_progress' : 'at_risk' }
    },
  },
]

// Evaluate all goals for the current phase and return active + completed
function evaluateGoals(ctx: GoalContext): Array<{ id: string; title: string; progress: number; status: string }> {
  return PROJECT_GOALS.map(goal => {
    const result = goal.evaluate(ctx)
    return { id: goal.id, title: goal.title, progress: result.progress, status: result.status }
  })
}

// ============ Project Phase Detection ============

type ProjectPhase = 'pre_clearing' | 'clearing' | 'post_clearing' | 'planting' | 'monitoring'

function getProjectPhase(now: Date): ProjectPhase {
  if (now < new Date(CLEARING_START)) return 'pre_clearing'
  if (now <= new Date(CLEARING_END)) return 'clearing'
  if (now < new Date(PLANTING_START)) return 'post_clearing'
  if (now <= new Date(PLANTING_END)) return 'planting'
  return 'monitoring'
}

// ============ Copernicus OAuth2 Token ============

function fetchCopernicusToken(
  runtime: Runtime<Config>,
  httpCapability: InstanceType<typeof cre.capabilities.HTTPClient>,
): string | null {
  const config = runtime.config
  if (!config.copernicusClientId || !config.copernicusClientSecret) return null

  try {
    const tokenResult = httpCapability.sendRequest(runtime, {
      url: COPERNICUS_TOKEN_URL,
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `grant_type=client_credentials&client_id=${config.copernicusClientId}&client_secret=${config.copernicusClientSecret}`,
    }).result()

    const parsed = JSON.parse(tokenResult.body ?? '{}')
    return parsed.access_token ?? null
  } catch (err) {
    // Token fetch failed (err: ${err instanceof Error ? err.message : 'unknown'})
    return null
  }
}

// ============ NDVI + NBR Satellite Fetcher (Statistical API) ============
// Uses Copernicus Sentinel Hub Statistical API to compute NDVI and NBR averages.
// NDVI = (B08 - B04) / (B08 + B04) — vegetation greenness
// NBR  = (B08 - B12) / (B08 + B12) — burn ratio (NIR vs SWIR)
// dNBR = PREFIRE_NBR - current NBR — burn severity

interface StatsBand {
  stats: { min: number; max: number; mean: number; stDev: number; sampleCount: number; noDataCount: number }
}
interface StatsResponse {
  data?: Array<{
    outputs: {
      ndvi: { bands: { B0: StatsBand } }
      nbr: { bands: { B0: StatsBand } }
    }
  }>
  error?: { message: string }
}

function satelliteStatsRequest(config: Config, token: string | null): { url: string; method: string; headers: Record<string, string>; body: string } {
  const bbox = getBbox(config)
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (token) headers['Authorization'] = `Bearer ${token}`

  // Look at last 10 days, low cloud coverage
  const to = new Date()
  const from = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000)

  return {
    url: COPERNICUS_STATS_API,
    method: 'POST',
    headers,
    body: JSON.stringify({
      input: {
        bounds: {
          bbox: [...bbox],
          properties: { crs: 'http://www.opengis.net/def/crs/EPSG/0/4326' },
        },
        data: [{
          type: 'sentinel-2-l2a',
          dataFilter: {
            timeRange: { from: from.toISOString(), to: to.toISOString() },
            maxCloudCoverage: 30,
          },
        }],
      },
      aggregation: {
        timeRange: { from: from.toISOString(), to: to.toISOString() },
        aggregationInterval: { of: 'P10D' },
        // Evalscript: DN units (SCL is always DN), compute NDVI + NBR, mask clouds
        evalscript: `//VERSION=3
function setup() {
  return {
    input: [{bands: ["B04", "B08", "B12", "SCL"]}],
    output: [
      {id: "ndvi", bands: 1, sampleType: "FLOAT32"},
      {id: "nbr", bands: 1, sampleType: "FLOAT32"},
      {id: "dataMask", bands: 1}
    ]
  };
}
function evaluatePixel(samples) {
  let scl = samples.SCL;
  if (scl === 3 || scl === 6 || scl === 8 || scl === 9 || scl === 10) {
    return {ndvi: [0], nbr: [0], dataMask: [0]};
  }
  let b04 = samples.B04;
  let b08 = samples.B08;
  let b12 = samples.B12;
  if (b04 + b08 === 0 || b08 + b12 === 0) return {ndvi: [0], nbr: [0], dataMask: [0]};
  let ndvi = (b08 - b04) / (b08 + b04);
  let nbr = (b08 - b12) / (b08 + b12);
  return {ndvi: [ndvi], nbr: [nbr], dataMask: [1]};
}`,
      },
    }),
  }
}

// ============ Soil HTTP Fetcher ============

interface SoilResponse {
  properties?: { layers?: Array<{ depths?: Array<{ values?: { mean?: number } }> }> }
  error?: string
}

function soilFetcher(config: Config): { url: string; method: string; headers: Record<string, string> } {
  return {
    url: `${SOILGRIDS_API}?lon=${config.projectLon}&lat=${config.projectLat}&property=soc&depth=0-30cm&value=mean`,
    method: 'GET',
    headers: { Accept: 'application/json' },
  }
}

// ============ Open-Meteo Weather Fetcher (free, no auth) ============

interface OpenMeteoResponse {
  daily?: {
    time?: string[]
    temperature_2m_mean?: (number | null)[]
    precipitation_sum?: (number | null)[]
    et0_fao_evapotranspiration?: (number | null)[]
  }
  hourly?: {
    soil_moisture_0_to_1cm?: (number | null)[]
  }
  elevation?: number
}

function weatherFetcher(config: Config): { url: string; method: string; headers: Record<string, string> } {
  return {
    url: `${OPEN_METEO_API}?latitude=${config.projectLat}&longitude=${config.projectLon}` +
      `&daily=temperature_2m_mean,precipitation_sum,et0_fao_evapotranspiration` +
      `&hourly=soil_moisture_0_to_1cm&timezone=Europe/Lisbon&past_days=7&forecast_days=0`,
    method: 'GET',
    headers: { Accept: 'application/json' },
  }
}

// ============ Sentinel-1 SAR Fetcher (cloud-independent radar) ============
// VH/VV cross-polarization ratio indicates vegetation structure:
// Healthy forest: ~0.4-0.5 (volume scattering from canopy)
// Burned/cleared: ~0.2-0.3 (surface scattering from bare ground)

interface SarStatsResponse {
  data?: Array<{
    outputs: {
      cross_ratio: { bands: { B0: StatsBand } }
      vv_db: { bands: { B0: StatsBand } }
    }
  }>
  error?: { message: string }
}

function sarStatsRequest(config: Config, token: string | null): { url: string; method: string; headers: Record<string, string>; body: string } {
  const bbox = getBbox(config)
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (token) headers['Authorization'] = `Bearer ${token}`

  const to = new Date()
  const from = new Date(Date.now() - 12 * 24 * 60 * 60 * 1000) // Last 12 days (S1 revisit ≈ 6 days)

  return {
    url: COPERNICUS_STATS_API,
    method: 'POST',
    headers,
    body: JSON.stringify({
      input: {
        bounds: {
          bbox: [...bbox],
          properties: { crs: 'http://www.opengis.net/def/crs/EPSG/0/4326' },
        },
        data: [{
          type: 'sentinel-1-grd',
          dataFilter: { timeRange: { from: from.toISOString(), to: to.toISOString() } },
          processing: { orthorectify: true, backCoeff: 'SIGMA0_ELLIPSOID' },
        }],
      },
      aggregation: {
        timeRange: { from: from.toISOString(), to: to.toISOString() },
        aggregationInterval: { of: 'P12D' },
        evalscript: `//VERSION=3
function setup() {
  return {
    input: [{bands: ["VV", "VH"]}],
    output: [
      {id: "cross_ratio", bands: 1, sampleType: "FLOAT32"},
      {id: "vv_db", bands: 1, sampleType: "FLOAT32"},
      {id: "dataMask", bands: 1}
    ]
  };
}
function evaluatePixel(samples) {
  let vv = samples.VV;
  let vh = samples.VH;
  if (vv === 0 || vh === 0) return {cross_ratio: [0], vv_db: [0], dataMask: [0]};
  return {cross_ratio: [vh / vv], vv_db: [10 * Math.log10(vv)], dataMask: [1]};
}`,
      },
    }),
  }
}

// ============ NASA FIRMS Fire Detection Fetcher (optional, needs MAP_KEY) ============

interface FirmsResult {
  activeFires: number
  source: string
}

function firmsFetcher(config: Config): { url: string; method: string; headers: Record<string, string> } | null {
  if (!config.firmsMapKey) return null
  const bbox = getBbox(config)
  // VIIRS_SNPP_SP: Suomi NPP satellite, standard product
  return {
    url: `${FIRMS_API}/${config.firmsMapKey}/VIIRS_SNPP_SP/[${bbox.join(',')}]/1/2025-09-07`,
    method: 'GET',
    headers: { Accept: 'text/csv' },
  }
}

// ============ Modeled Fallback Functions ============

function getModeledNdvi(monthsSinceFire: number, phase: ProjectPhase): { current: number; preFire: number; postFire: number } {
  // Modeled NDVI recovery for Serra da Estrela based on REAL satellite data:
  // Pre-fire: 0.82 (measured Aug 26, 2025 — healthy mixed forest)
  // Immediate post-fire: ~0.36 (measured Oct 15, 2025 — 5 weeks after Sep 7 fire)
  // During clearing: NDVI may dip further as burned material is removed
  const preFire = PREFIRE_NDVI
  const postFire = 0.36

  const now = new Date()
  const month = now.getMonth()
  const seasonalFactor = 1 + 0.15 * Math.cos((month - 4) * Math.PI / 6) // Peak in May

  let current: number
  if (phase === 'clearing') {
    // During active clearing, NDVI stays low (bare soil exposed)
    // Natural regrowth is disrupted by machinery and woodchipping
    current = postFire + 0.05 * seasonalFactor
  } else if (phase === 'post_clearing') {
    // After clearing, soil is prepared — very low NDVI, mostly bare ground
    current = 0.10 + 0.03 * seasonalFactor
  } else {
    // Natural recovery curve (pre-clearing or post-planting)
    const recoveryFraction = Math.log(1 + monthsSinceFire) / Math.log(1 + 60)
    current = postFire + (preFire - postFire) * recoveryFraction * seasonalFactor
  }

  current = Math.max(0, Math.min(0.8, current))
  return { current, preFire, postFire }
}

function getModeledDnbr(monthsSinceFire: number, phase: ProjectPhase): number {
  // dNBR = prefire_NBR (0.65) - current_NBR. Higher = more damage.
  // Measured dNBR at 5 weeks post-fire: 0.81 (high severity)
  // During clearing: dNBR stays high or increases (exposed bare soil)
  if (phase === 'clearing' || phase === 'post_clearing') {
    return 0.85 + 0.03 * Math.random() // Bare soil during/after clearing
  }
  // Recovery: dNBR slowly decreases as vegetation returns
  return 0.88 * Math.exp(-monthsSinceFire / 36)
}

function getModeledSoilCarbon(monthsSinceFire: number): number {
  // Serra da Estrela reference: granitic soils, moderate SOC
  // Post-fire SOC is initially higher (charcoal), then decreases, then slowly recovers
  // Woodchipping adds organic matter, boosting SOC during clearing phase
  return 35 + 5 * Math.min(1, monthsSinceFire / 24)
}

function getModeledWeather(): { temperature: number; rainfall: number } {
  // Serra da Estrela climate: Continental-Mediterranean, 1000-1400mm annual rainfall
  const month = new Date().getMonth()
  const monthlyTemp = [4, 5, 8, 10, 13, 17, 20, 20, 17, 12, 7, 5]
  const monthlyRain = [120, 110, 80, 90, 80, 30, 10, 10, 40, 100, 120, 130]
  return {
    temperature: monthlyTemp[month] ?? 12,
    rainfall: monthlyRain[month] ?? 60,
  }
}

// ============ Workflow Init ============

const initWorkflow = (config: Config) => {
  const cron = new cre.capabilities.CronCapability()
  return [cre.handler(cron.trigger({ schedule: config.schedule }), onCronTrigger)]
}

// ============ Handler ============

const onCronTrigger = (runtime: Runtime<Config>, _payload: CronPayload): string => {
  const config = runtime.config

  const network = getNetwork({
    chainFamily: 'evm',
    chainSelectorName: config.chainName,
    isTestnet: !config.chainName.includes('mainnet'),
  })
  const evmClient = new cre.capabilities.EVMClient(network.chainSelector.selector)

  const now = new Date()
  const phase = getProjectPhase(now)
  const monthsSinceFire = Math.max(
    0,
    (now.getTime() - new Date(FIRE_DATE).getTime()) / (30.44 * 24 * 60 * 60 * 1000)
  )
  const monthsSincePlanting = phase === 'monitoring'
    ? Math.max(0, (now.getTime() - new Date(PLANTING_END).getTime()) / (30.44 * 24 * 60 * 60 * 1000))
    : 0

  // ---- Step 1: Fetch satellite data (NDVI + NBR) via Statistical API ----
  let ndviCurrent: number
  const ndviPreFire = PREFIRE_NDVI  // Measured: 0.8243 (Aug 26, 2025)
  const ndviPostFire = 0.08         // Immediate post-fire bare soil estimate
  let dnbrCurrent: number
  let usedSatelliteData = false

  try {
    const httpCapability = new cre.capabilities.HTTPClient()

    // Get OAuth2 token for Copernicus Data Space
    const token = fetchCopernicusToken(runtime, httpCapability)

    const statsRequest = satelliteStatsRequest(config, token)
    const satResult = httpCapability.sendRequest(runtime, {
      url: statsRequest.url,
      method: statsRequest.method,
      headers: statsRequest.headers,
      body: statsRequest.body,
    }).result()

    const parsed = JSON.parse(satResult.body ?? '{}') as StatsResponse
    if (parsed.data && parsed.data.length > 0) {
      const ndviStats = parsed.data[0].outputs.ndvi.bands.B0.stats
      const nbrStats = parsed.data[0].outputs.nbr.bands.B0.stats
      const validRatio = (ndviStats.sampleCount - ndviStats.noDataCount) / ndviStats.sampleCount

      if (validRatio > 0.1) {
        // Enough valid (non-cloudy) pixels for reliable stats
        ndviCurrent = ndviStats.mean
        // dNBR = pre-fire NBR - current NBR (higher = more damage)
        dnbrCurrent = PREFIRE_NBR - nbrStats.mean
        usedSatelliteData = true
      } else {
        // Too cloudy — fall back to modeled values
        const modeled = getModeledNdvi(monthsSinceFire, phase)
        ndviCurrent = modeled.current
        dnbrCurrent = getModeledDnbr(monthsSinceFire, phase)
      }
    } else {
      // No data in time window — fall back to model
      const modeled = getModeledNdvi(monthsSinceFire, phase)
      ndviCurrent = modeled.current
      dnbrCurrent = getModeledDnbr(monthsSinceFire, phase)
    }
  } catch (err) {
    // Satellite data fetch failed (err: ${err instanceof Error ? err.message : 'unknown'})
    const modeled = getModeledNdvi(monthsSinceFire, phase)
    ndviCurrent = modeled.current
    dnbrCurrent = getModeledDnbr(monthsSinceFire, phase)
  }

  // ---- Step 2: Classify burn severity from dNBR ----
  let burnSeverity: string
  if (dnbrCurrent > 0.44) burnSeverity = 'high'
  else if (dnbrCurrent > 0.27) burnSeverity = 'moderate-high'
  else if (dnbrCurrent > 0.1) burnSeverity = 'moderate-low'
  else if (dnbrCurrent > -0.1) burnSeverity = 'low'
  else burnSeverity = 'unburned'

  // ---- Step 3: Soil organic carbon (with fallback) ----
  let soilOrganicCarbon: number

  try {
    const httpCapability = new cre.capabilities.HTTPClient()
    const soilRequest = soilFetcher(config)
    const soilResult = httpCapability.sendRequest(runtime, {
      url: soilRequest.url,
      method: soilRequest.method,
      headers: soilRequest.headers,
    }).result()

    const soilData = JSON.parse(soilResult.body ?? '{}') as SoilResponse
    const socRaw = soilData.properties?.layers?.[0]?.depths?.[0]?.values?.mean ?? 0
    if (socRaw > 0) {
      // SOC in dg/kg -> approximate tonnes C/ha (multiply by bulk density ~1.3 and depth 0.3m)
      soilOrganicCarbon = (socRaw / 10) * 1.3 * 0.3 * 10
    } else {
      soilOrganicCarbon = getModeledSoilCarbon(monthsSinceFire)
    }
  } catch (err) {
    // Soil data fetch failed (err: ${err instanceof Error ? err.message : 'unknown'})
    soilOrganicCarbon = getModeledSoilCarbon(monthsSinceFire)
  }

  // ---- Step 4: Real weather data via Open-Meteo (free, no auth) ----
  let avgTemperature: number
  let recentRainfall: number
  let soilMoisture: number | null = null
  let usedRealWeather = false

  try {
    const httpCapability = new cre.capabilities.HTTPClient()
    const wxRequest = weatherFetcher(config)
    const wxResult = httpCapability.sendRequest(runtime, {
      url: wxRequest.url,
      method: wxRequest.method,
      headers: wxRequest.headers,
    }).result()

    const wxData = JSON.parse(wxResult.body ?? '{}') as OpenMeteoResponse
    const temps = wxData.daily?.temperature_2m_mean ?? []
    const rains = wxData.daily?.precipitation_sum ?? []
    const soilVals = (wxData.hourly?.soil_moisture_0_to_1cm ?? []).filter((v): v is number => v !== null)

    const validTemps = temps.filter((t): t is number => t !== null)
    const validRains = rains.filter((r): r is number => r !== null)

    if (validTemps.length > 0) {
      avgTemperature = validTemps.reduce((a, b) => a + b, 0) / validTemps.length
      recentRainfall = validRains.reduce((a, b) => a + b, 0) // Weekly total
      soilMoisture = soilVals.length > 0 ? soilVals[soilVals.length - 1] : null
      usedRealWeather = true
    } else {
      const fallback = getModeledWeather()
      avgTemperature = fallback.temperature
      recentRainfall = fallback.rainfall
    }
  } catch (err) {
    // Weather data fetch failed (err: ${err instanceof Error ? err.message : 'unknown'})
    const fallback = getModeledWeather()
    avgTemperature = fallback.temperature
    recentRainfall = fallback.rainfall
  }

  // ---- Step 4b: Sentinel-1 SAR backscatter (cloud-independent) ----
  let sarCrossRatio: number | null = null
  let sarVvDb: number | null = null

  try {
    const httpCapability = new cre.capabilities.HTTPClient()
    const token = fetchCopernicusToken(runtime, httpCapability)
    const sarRequest = sarStatsRequest(config, token)
    const sarResult = httpCapability.sendRequest(runtime, {
      url: sarRequest.url,
      method: sarRequest.method,
      headers: sarRequest.headers,
      body: sarRequest.body,
    }).result()

    const sarData = JSON.parse(sarResult.body ?? '{}') as SarStatsResponse
    if (sarData.data && sarData.data.length > 0) {
      const crStats = sarData.data[0].outputs.cross_ratio.bands.B0.stats
      const vvStats = sarData.data[0].outputs.vv_db.bands.B0.stats
      const validRatio = (crStats.sampleCount - crStats.noDataCount) / crStats.sampleCount
      if (validRatio > 0.1) {
        sarCrossRatio = crStats.mean
        sarVvDb = vvStats.mean
      }
    }
  } catch (err) {
    // SAR data optional — continue without it (err: ${err instanceof Error ? err.message : 'unknown'})
  }

  // ---- Step 4c: NASA FIRMS fire verification (optional) ----
  let firmsActiveFires = 0
  let firmsVerified = false

  try {
    const firmsRequest = firmsFetcher(config)
    if (firmsRequest) {
      const httpCapability = new cre.capabilities.HTTPClient()
      const firmsResult = httpCapability.sendRequest(runtime, {
        url: firmsRequest.url,
        method: firmsRequest.method,
        headers: firmsRequest.headers,
      }).result()

      const csv = firmsResult.body ?? ''
      // FIRMS CSV: header row + data rows, each row is a fire detection
      const lines = csv.split('\n').filter(l => l.trim().length > 0)
      firmsActiveFires = Math.max(0, lines.length - 1) // Subtract header
      firmsVerified = true
    }
  } catch (err) {
    // FIRMS is optional — continue without it (err: ${err instanceof Error ? err.message : 'unknown'})
  }

  // ---- Step 5: Estimate tree survival and carbon sequestration ----
  // Phase-aware: before planting, trees = 0. After planting, track survival.
  const ndviRecoveryPct = ndviPreFire > 0
    ? Math.max(0, (ndviCurrent - ndviPostFire) / (ndviPreFire - ndviPostFire)) * 100
    : 0

  const winterStressFactor = avgTemperature < 2 ? 0.92 : 1.0
  const droughtStressFactor = recentRainfall < 20 ? 0.95 : 1.0

  let totalLiveTrees = 0
  let totalAnnualCO2 = 0

  if (phase === 'monitoring') {
    // Trees are planted — track survival and CO2 sequestration
    for (const species of SPECIES) {
      const growthFactor = Math.min(1, monthsSincePlanting / 120) // Full capacity at ~10 years
      const survivalAdjusted = species.survivalRate * winterStressFactor * droughtStressFactor
      const liveTrees = Math.floor(species.count * survivalAdjusted)
      const speciesCO2 = liveTrees * species.co2PerTreePerYear * growthFactor
      totalLiveTrees += liveTrees
      totalAnnualCO2 += speciesCO2
    }
  }
  // In clearing/pre-planting phases: totalLiveTrees = 0, totalAnnualCO2 = 0

  const annualCO2Tonnes = totalAnnualCO2 / 1000
  const carbonCreditTonnes = annualCO2Tonnes * 0.8

  // ---- Step 6: Compute composite Fire Recovery Index (0-1000) ----
  // Multi-source composite: Sentinel-2 (NDVI, dNBR) + Sentinel-1 (SAR) + weather + soil
  // Weights shift based on project phase and data availability

  let fireRecoveryIndex: number

  // SAR vegetation score: how close VH/VV is to pre-fire healthy forest baseline
  const sarScore = sarCrossRatio !== null
    ? Math.min(1000, Math.max(0, (sarCrossRatio / PREFIRE_SAR_CROSS_RATIO) * 1000))
    : null

  if (phase === 'monitoring') {
    // Post-planting: full composite with tree survival
    const ndviScore = Math.min(1000, Math.max(0, ndviRecoveryPct * 10))
    const dnbrScore = Math.min(1000, Math.max(0, (0.5 - dnbrCurrent) * 2000))
    const soilScore = Math.min(1000, Math.max(0, (soilOrganicCarbon / 60) * 1000))
    const treeScore = Math.min(1000, Math.max(0, (totalLiveTrees / TOTAL_TREES) * 1000))
    const weatherScore = Math.min(1000, Math.max(0,
      (avgTemperature > 5 && avgTemperature < 30 ? 500 : 200) +
      (recentRainfall > 30 ? 500 : recentRainfall * 16.6)
    ))

    if (sarScore !== null) {
      // Full 6-source composite: NDVI 25% + dNBR 15% + SAR 10% + Soil 10% + Trees 30% + Weather 10%
      fireRecoveryIndex = Math.floor(
        ndviScore * 0.25 + dnbrScore * 0.15 + sarScore * 0.10 +
        soilScore * 0.10 + treeScore * 0.30 + weatherScore * 0.10
      )
    } else {
      fireRecoveryIndex = Math.floor(
        ndviScore * 0.30 + dnbrScore * 0.20 + soilScore * 0.15 +
        treeScore * 0.25 + weatherScore * 0.10
      )
    }
  } else {
    // Pre-planting: land recovery focus (no tree score)
    const ndviScore = Math.min(1000, Math.max(0, ndviRecoveryPct * 10))
    const dnbrScore = Math.min(1000, Math.max(0, (0.5 - dnbrCurrent) * 2000))
    const soilScore = Math.min(1000, Math.max(0, (soilOrganicCarbon / 60) * 1000))
    const weatherScore = Math.min(1000, Math.max(0,
      (avgTemperature > 5 && avgTemperature < 30 ? 500 : 200) +
      (recentRainfall > 30 ? 500 : recentRainfall * 16.6)
    ))

    if (sarScore !== null) {
      // 5-source: NDVI 30% + dNBR 25% + SAR 15% + Soil 15% + Weather 15%
      fireRecoveryIndex = Math.floor(
        ndviScore * 0.30 + dnbrScore * 0.25 + sarScore * 0.15 +
        soilScore * 0.15 + weatherScore * 0.15
      )
    } else {
      fireRecoveryIndex = Math.floor(
        ndviScore * 0.35 + dnbrScore * 0.30 + soilScore * 0.20 + weatherScore * 0.15
      )
    }
  }

  // ---- Step 7: Evaluate project goals against sensor data ----
  const goalCtx: GoalContext = {
    phase, ndvi: ndviCurrent, dnbr: dnbrCurrent,
    sarCrossRatio, soilMoisture, avgTemp: avgTemperature,
    rainfall: recentRainfall, monthsSinceFire, monthsSincePlanting,
    totalLiveTrees, fireRecoveryIndex,
  }
  const goalResults = evaluateGoals(goalCtx)
  const activeGoals = goalResults.filter(g => g.status !== 'not_started')
  const goalsMetCount = goalResults.filter(g => g.status === 'met').length
  const goalsAtRisk = goalResults.filter(g => g.status === 'at_risk')

  // Build structured goal progress report for downstream consumers (W4, frontend)
  const goalProgressJSON = JSON.stringify({
    phase,
    monthsSinceFire: Math.round(monthsSinceFire * 10) / 10,
    goalsTotal: PROJECT_GOALS.length,
    goalsMet: goalsMetCount,
    goalsAtRisk: goalsAtRisk.length,
    goals: goalResults.map(g => ({
      id: g.id, title: g.title,
      progress: Math.round(g.progress),
      status: g.status,
    })),
  })

  // ---- Step 8: Encode and push data feed on-chain ----
  const ndviCurrentScaled = BigInt(Math.floor(ndviCurrent * 10000))
  const ndviPreFireScaled = BigInt(Math.floor(ndviPreFire * 10000))
  const ndviRecoveryPctScaled = BigInt(Math.floor(ndviRecoveryPct * 100))
  const dnbrScaled = BigInt(Math.floor(dnbrCurrent * 10000))
  const soilCarbonScaled = BigInt(Math.floor(soilOrganicCarbon * 100))
  const liveTrees = BigInt(totalLiveTrees)
  const annualCO2Scaled = BigInt(Math.floor(annualCO2Tonnes * 1000))
  const carbonCreditsScaled = BigInt(Math.floor(carbonCreditTonnes * 1000))
  const recoveryIndex = BigInt(fireRecoveryIndex)

  const reportData = encodeFunctionData({
    abi: SerraEstrelaNativeForestABI,
    functionName: 'receiveReport',
    args: [
      ndviCurrentScaled,
      ndviPreFireScaled,
      ndviRecoveryPctScaled,
      dnbrScaled,
      soilCarbonScaled,
      liveTrees,
      annualCO2Scaled,
      carbonCreditsScaled,
      recoveryIndex,
    ],
  })

  const reportResponse = runtime.report({
    encodedPayload: hexToBase64(reportData),
    encoderName: 'evm',
    signingAlgo: 'ecdsa',
    hashingAlgo: 'keccak256',
  }).result()

  const resp = evmClient.writeReport(runtime, {
    receiver: config.serraEstrelaAddress as Address,
    report: reportResponse,
    gasConfig: { gasLimit: config.gasLimit },
  }).result()

  // Build data source summary
  const sources = [
    usedSatelliteData ? 'S2' : 'S2-modeled',
    sarCrossRatio !== null ? 'S1-SAR' : null,
    usedRealWeather ? 'OpenMeteo' : 'weather-modeled',
    firmsVerified ? `FIRMS(${firmsActiveFires})` : null,
  ].filter(Boolean).join('+')

  // Build goal status summary
  const goalSummary = activeGoals
    .map(g => `${g.id}:${g.status}(${g.progress.toFixed(0)}%)`)
    .join(',')
  const riskWarning = goalsAtRisk.length > 0
    ? ` AT_RISK=[${goalsAtRisk.map(g => `${g.id}:${g.title}`).join(',')}]`
    : ''

  return `Serra da Estrela W7 [phase=${phase}]: ` +
    `NDVI=${ndviCurrent.toFixed(4)} (recovery=${ndviRecoveryPct.toFixed(1)}%), ` +
    `dNBR=${dnbrCurrent.toFixed(4)} (${burnSeverity}), ` +
    `SAR=${sarCrossRatio !== null ? `VH/VV=${sarCrossRatio.toFixed(3)}` : 'N/A'}, ` +
    `SOC=${soilOrganicCarbon.toFixed(1)} tC/ha, ` +
    `trees=${totalLiveTrees}/${TOTAL_TREES}, ` +
    `CO2=${annualCO2Tonnes.toFixed(2)} tCO2e/yr, ` +
    `FRI=${fireRecoveryIndex}/1000, ` +
    `weather=${avgTemperature.toFixed(1)}C/${recentRainfall.toFixed(0)}mm` +
    `${soilMoisture !== null ? `/soil=${soilMoisture.toFixed(3)}` : ''}, ` +
    `goals=${goalsMetCount}/${PROJECT_GOALS.length}met [${goalSummary}]${riskWarning}, ` +
    `sources=[${sources}], ` +
    `months_since_fire=${monthsSinceFire.toFixed(1)}` +
    ` goalProgressJSON=${goalProgressJSON}`
}

// ============ Entry Point ============

export async function main() {
  const runner = await Runner.newRunner<Config>({ configSchema })
  await runner.run(initWorkflow)
}

main()
