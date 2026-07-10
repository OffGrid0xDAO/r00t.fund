/** Shared presentational helpers for the pilot map (r00t tokens only). */
import type { InterventionType, PlotStatus, PatronageReward, Plot } from './types';

// Intervention colour keys map onto existing r00t tokens / palette values.
export const TYPE_COLOR: Record<InterventionType, string> = {
  syntropic: 'var(--accent)',   // forest green
  water: '#5BA8B5',             // teal (matches terrain river)
  structure: '#D4A84B',         // gold-400
};

export const REWARD_LABEL: Record<PatronageReward, string> = {
  produce: 'A share of the produce',
  stay: 'Nights at the pilot site',
  naming: 'Name the plot',
  'choose-crop': 'Choose what grows',
  certificate: 'Certificate badge',
};

export const usd = (n: number) => '$' + Math.round(n).toLocaleString('en-US');

// UI-side ETH/USD used for progress accounting + previews. Mirrors the Land's
// default ethPriceE6 ($3,000); the contract is the source of truth on-chain.
export const ETH_USD = 3000;
export const fmtEth = (n: number) => `${n < 0.001 ? n.toFixed(5) : n.toFixed(n < 1 ? 3 : 2)} ETH`;

export const pct = (funded: number, target: number) =>
  Math.min(100, Math.round((funded / Math.max(1, target)) * 100));

// greenness a plot shows on the map: blends status + funding progress
export function greenLevel(status: PlotStatus, funded: number, target: number): number {
  const base: Record<PlotStatus, number> = {
    seeking: 0.15, greening: 0.4, funded: 0.6, planted: 0.8, verified: 1,
  };
  return Math.max(base[status], 0.15 + 0.7 * (funded / Math.max(1, target)));
}

// ── Momentum / heat ──────────────────────────────────────────────────────────
// Recency-weighted € pledged into a parcel within the rolling window. Drives the
// "this parcel is hot" FOMO signal (a momentum metric, not a price).
const HEAT_WINDOW_MS = 45_000;
export function parcelHeat(plot: Plot, now = Date.now(), windowMs = HEAT_WINDOW_MS): number {
  let s = 0;
  for (const c of plot.contributions) {
    const age = now - c.at;
    if (age >= 0 && age < windowMs) s += c.amountEur * (1 - age / windowMs);
  }
  return s;
}
// € pledged into a parcel within the last `windowMs` (for the "€X recently" chip)
export function recentEur(plot: Plot, now = Date.now(), windowMs = HEAT_WINDOW_MS): number {
  let s = 0;
  for (const c of plot.contributions) {
    const age = now - c.at;
    if (age >= 0 && age < windowMs) s += c.amountEur;
  }
  return s;
}
// A "Regen Index" — a non-price number-go-up score per parcel: backers + funding
// progress + momentum. Reads like a stat, confers nothing financial.
export function regenIndex(plot: Plot, now = Date.now()): number {
  const progress = Math.min(1, plot.fundedEur / Math.max(1, plot.targetEur));
  const backers = plot.contributions.length;
  const heat = parcelHeat(plot, now);
  return Math.round(progress * 600 + backers * 22 + Math.min(300, heat * 1.2));
}

// ── Parcel token ($PARCEL, paired with $R00T) ────────────────────────────────
// Each parcel has its own token; backers are airdropped it on an early-bird
// bonding curve (earlier = cheaper price in $R00T = more tokens). "Land value"
// is the token's market cap in $R00T, so a popular parcel visibly appreciates.
export const PARCEL_SUPPLY = 1_000_000;

export function tickerFromName(name: string): string {
  const words = name.replace(/[^a-zA-Z\s]/g, '').split(/\s+/).filter(Boolean);
  const salient = words.sort((a, b) => b.length - a.length)[0] || name;
  return salient.toUpperCase().slice(0, 6) || 'PARCEL';
}

// Price of one $PARCEL in $R00T — early-bird bonding curve on funding progress.
export function tokenPriceR00T(plot: Plot): number {
  const progress = plot.fundedEur / Math.max(1, plot.targetEur);
  return 0.0008 * (1 + 4 * Math.min(1.4, progress));   // 0% → 0.0008, 100% → 0.004
}
// "Land value" = market cap of the parcel token, in $R00T.
export function landValueR00T(plot: Plot): number {
  return tokenPriceR00T(plot) * (plot.tokenSupply ?? PARCEL_SUPPLY);
}
// $PARCEL you'd be airdropped for a given € pledge at the current price.
export function allocationFor(amountEur: number, plot: Plot): number {
  return amountEur / tokenPriceR00T(plot);   // 1 € ≈ 1 $R00T for display
}

export const fmtCompact = (n: number) =>
  n >= 1_000_000 ? (n / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M'
  : n >= 1_000 ? (n / 1_000).toFixed(1).replace(/\.0$/, '') + 'K'
  : String(Math.round(n));
export const fmtR00T = (n: number) => `${fmtCompact(n)} R00T`;
export const fmtPrice = (n: number) => `${n.toFixed(4)} R00T`;
