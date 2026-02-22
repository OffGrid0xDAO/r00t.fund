import { useMemo } from 'react';
import { motion } from 'framer-motion';
import { GlowButton } from '../../ui/GlowButton';
import { StatusBadge } from '../proposals/StatusBadge';
import { DataFeedGauge } from './DataFeedGauge';
import { NdviMiniChart } from './NdviMiniChart';
import { SpeciesBreakdown } from './SpeciesBreakdown';
import type { Proposal, ProposalMetadata, CreDataFeedReport, ProjectSummary } from '../types';
import { ProposalStatus } from '../constants';

interface LiveProjectCardProps {
  ammAddress: string;
  proposal?: Proposal;
  report?: CreDataFeedReport | null;
  summary?: ProjectSummary | null;
  index: number;
  onClick: () => void;
  onTrade?: () => void;
}

function getStoredMetadata(metadataHash?: string): ProposalMetadata | null {
  if (!metadataHash) return null;
  try {
    const raw = localStorage.getItem(`r00t_metadata_${metadataHash}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed.version === 2) return parsed;
    return null;
  } catch {
    return null;
  }
}

export function LiveProjectCard({
  ammAddress,
  proposal,
  report,
  summary,
  index,
  onClick,
  onTrade,
}: LiveProjectCardProps) {
  void ammAddress; // Used by parent for keying
  const metadata = useMemo(
    () => getStoredMetadata(proposal?.metadataHash),
    [proposal?.metadataHash]
  );

  // Generate demo NDVI history from report if available
  const ndviHistory = useMemo(() => {
    if (!report) return [];
    const base = report.ndviPreFire > 0 ? report.ndviPreFire : 0.6;
    const current = report.ndviCurrent;
    const points: number[] = [];
    for (let i = 0; i < 12; i++) {
      const t = i / 11;
      // Simulate recovery curve
      const val = base * 0.3 + (current - base * 0.3) * Math.pow(t, 0.6) + (Math.random() - 0.5) * 0.02;
      points.push(Math.max(0, Math.min(1, val)));
    }
    return points;
  }, [report]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: index * 0.1 }}
      whileHover={{ y: -4, scale: 1.005 }}
      className="rounded-lg p-5 bg-[var(--bg-secondary)] border border-[var(--border)] hover:border-[var(--border-focus)] transition-all duration-300"
    >
      {/* Header */}
      <div className="flex justify-between items-start mb-4">
        <button onClick={onClick} className="text-left">
          <div className="flex items-center gap-2 mb-1">
            <h3 className="font-semibold text-[var(--text-primary)]">
              {proposal?.name || `Project ${index + 1}`}
            </h3>
            <span className="text-sm text-[var(--text-muted)] font-mono">
              ${proposal?.symbol || 'TOKEN'}
            </span>
            <StatusBadge status={ProposalStatus.Executed} />
          </div>
          {metadata?.description && (
            <p className="text-xs text-[var(--text-secondary)] line-clamp-1">{metadata.description}</p>
          )}
        </button>
        <div className="flex gap-2">
          {onTrade && (
            <GlowButton onClick={onTrade} variant="primary" size="sm">
              trade()
            </GlowButton>
          )}
          <GlowButton onClick={onClick} variant="secondary" size="sm">
            view
          </GlowButton>
        </div>
      </div>

      {/* Gauges Row */}
      {(report || summary) && (
        <div className="flex justify-around mb-4">
          <DataFeedGauge
            label="NDVI"
            value={report?.ndviCurrent ?? 0}
            max={1}
            unit=""
            color="var(--success)"
          />
          <DataFeedGauge
            label="CO₂/yr"
            value={summary?.annualCO2Kg ? summary.annualCO2Kg / 1000 : (report?.annualCO2 ?? 0) / 1000}
            max={100}
            unit="tCO₂"
            color="var(--accent)"
          />
          <DataFeedGauge
            label="FRI"
            value={report?.fireRecoveryIndex ?? (summary?.fireRecoveryIndex ?? 0)}
            max={100}
            unit="%"
          />
        </div>
      )}

      {/* NDVI Mini Chart */}
      {ndviHistory.length > 0 && (
        <div className="mb-3">
          <p className="text-[9px] font-mono text-[var(--text-muted)] mb-1 uppercase">ndvi recovery</p>
          <NdviMiniChart values={ndviHistory} width={280} height={36} />
        </div>
      )}

      {/* Species Breakdown */}
      {metadata?.environmental?.species && metadata.environmental.species.length > 0 && (
        <div className="mb-3">
          <p className="text-[9px] font-mono text-[var(--text-muted)] mb-1 uppercase">species composition</p>
          <SpeciesBreakdown species={metadata.environmental.species} />
        </div>
      )}

      {/* Summary stats */}
      {summary && (
        <div className="flex gap-4 text-[10px] font-mono text-[var(--text-muted)] pt-2 border-t border-[var(--border)]">
          <span>trees: {summary.estimatedLiveTrees.toLocaleString()}/{summary.totalTreesPlanted.toLocaleString()}</span>
          <span>survival: {summary.survivalRatePct}%</span>
          <span>reports: {summary.totalReports}</span>
        </div>
      )}

      {/* Fallback for projects without CRE data */}
      {!report && !summary && !metadata && (
        <div className="text-center py-3">
          <p className="text-xs font-mono text-[var(--text-muted)]">
            // awaiting first CRE data feed report
          </p>
        </div>
      )}
    </motion.div>
  );
}
