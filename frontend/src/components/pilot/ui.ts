/** Shared presentational helpers for the pilot map (r00t tokens only). */
import type { InterventionType, PlotStatus, PatronageReward } from './types';

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
