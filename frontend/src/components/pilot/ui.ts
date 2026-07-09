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

export const eur = (n: number) => '€' + Math.round(n).toLocaleString('en-GB');

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
