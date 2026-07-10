/**
 * parcelTokens — derive the tradable-token view of the parcels for the dapp.
 *
 * Each parcel is a token ($TICKER) paired with $R00T. A token's launch status
 * gates tradability:
 *   pledging  → pre-TGE: NOT tradable, you fund the land to earn allocation
 *   launching → fully funded, TGE imminent: NOT tradable yet
 *   live      → trading on Uniswap (paired with $R00T)
 */
import type { Plot } from './types';
import { zonesToPlots, type Zone } from './data';
import { tokenPriceR00T, landValueR00T, pct } from './ui';

export type LaunchStatus = 'pledging' | 'launching' | 'live';

export interface ParcelToken {
  id: string;
  ticker: string;
  name: string;
  emoji: string;
  type: Plot['type'];
  fundedPct: number;
  fundedUsd: number;
  targetUsd: number;
  status: LaunchStatus;
  tradable: boolean;
  priceR00T: number;
  landValueR00T: number;
  areaHa?: number;
}

export function launchStatusOf(p: Plot): LaunchStatus {
  if (p.status === 'planted' || p.status === 'verified') return 'live';
  if (p.fundedEur >= p.targetEur) return 'launching';
  return 'pledging';
}

export function plotToToken(p: Plot): ParcelToken {
  const status = launchStatusOf(p);
  return {
    id: p.id,
    ticker: p.ticker ?? 'PARCEL',
    name: p.name,
    emoji: p.emoji ?? '🌱',
    type: p.type,
    fundedPct: pct(p.fundedEur, p.targetEur),
    fundedUsd: p.fundedEur,
    targetUsd: p.targetEur,
    status,
    tradable: status === 'live',
    priceR00T: tokenPriceR00T(p),
    landValueR00T: landValueR00T(p),
    areaHa: p.areaHa,
  };
}

export async function fetchParcelTokens(): Promise<ParcelToken[]> {
  const zones: Zone[] = await fetch('/terrain/zones.json').then(r => r.json());
  return zonesToPlots(zones).map(plotToToken);
}

export const STATUS_META: Record<LaunchStatus, { label: string; color: string }> = {
  pledging: { label: 'Pledging', color: 'var(--text-muted)' },
  launching: { label: 'TGE soon', color: '#D4A84B' },
  live: { label: 'Live', color: 'var(--success)' },
};
