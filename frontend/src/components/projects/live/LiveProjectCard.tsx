import { useMemo } from 'react';
import { motion } from 'framer-motion';
import { GlowButton } from '../../ui/GlowButton';
import { StatusBadge } from '../proposals/StatusBadge';
import { DataFeedGauge } from './DataFeedGauge';
import { NdviMiniChart } from './NdviMiniChart';
import { SpeciesBreakdown } from './SpeciesBreakdown';
import type { Proposal, ProposalMetadata, CreDataFeedReport, ProjectSummary, CreWorkflowStatus } from '../types';
import { ProposalStatus } from '../constants';

const RISK_LABELS = ['NONE', 'LOW', 'MED', 'HIGH', 'CRIT'] as const;
const RISK_COLORS = ['var(--text-muted)', 'var(--success)', 'var(--warning)', 'var(--error)', 'var(--error)'] as const;

interface LiveProjectCardProps {
  ammAddress: string;
  proposal?: Proposal;
  report?: CreDataFeedReport | null;
  summary?: ProjectSummary | null;
  creWorkflowStatus?: CreWorkflowStatus;
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
  creWorkflowStatus,
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

      {/* Hero Image + Gauges Row */}
      {(report || summary || metadata?.coverImageUrl) && (
        <div className="flex gap-3 mb-4">
          {/* Hero Image (left) */}
          {metadata?.coverImageUrl ? (
            <div className="w-40 h-24 flex-shrink-0 rounded-md overflow-hidden border border-[var(--border)]">
              <img
                src={metadata.coverImageUrl}
                alt={proposal?.name || 'Project'}
                className="w-full h-full object-cover"
              />
            </div>
          ) : (
            <div className="w-40 h-24 flex-shrink-0 rounded-md border border-[var(--border)] bg-[var(--bg-primary)] flex items-center justify-center">
              <span className="text-2xl opacity-30">🌱</span>
            </div>
          )}
          {/* Gauges (right, grouped tight) */}
          {(report || summary) && (
            <div className="flex gap-3 items-center ml-auto">
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
          <span>survival: {(summary.survivalRatePct / 100).toFixed(1)}%</span>
          <span>reports: {summary.totalReports}</span>
        </div>
      )}

      {/* CRE Workflow Status Bar */}
      {creWorkflowStatus && (
        <div className="mt-3 pt-3 border-t border-[var(--border)]">
          <p className="text-[9px] font-mono text-[var(--text-muted)] mb-2 uppercase">cre workflow status</p>
          <div className="flex flex-wrap gap-1.5">
            {/* W7: Pilot Site Data Feed */}
            <span
              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-mono"
              style={{
                background: creWorkflowStatus.pilotSite.active
                  ? 'color-mix(in srgb, var(--success) 15%, transparent)'
                  : 'color-mix(in srgb, var(--text-muted) 10%, transparent)',
                color: creWorkflowStatus.pilotSite.active ? 'var(--success)' : 'var(--text-muted)',
              }}
            >
              <span className="w-1 h-1 rounded-full" style={{ background: 'currentColor' }} />
              W7:NDVI
            </span>

            {/* W2: Proof of Reserve */}
            <span
              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-mono"
              style={{
                background: creWorkflowStatus.proofOfReserve.active
                  ? 'color-mix(in srgb, var(--success) 15%, transparent)'
                  : 'color-mix(in srgb, var(--text-muted) 10%, transparent)',
                color: creWorkflowStatus.proofOfReserve.active ? 'var(--success)' : 'var(--text-muted)',
              }}
            >
              <span className="w-1 h-1 rounded-full" style={{ background: 'currentColor' }} />
              W2:PoR
              {creWorkflowStatus.proofOfReserve.active && (
                <span className="opacity-70">{(creWorkflowStatus.proofOfReserve.backingRatio / 100).toFixed(0)}%</span>
              )}
            </span>

            {/* W3: AI Orchestrator */}
            <span
              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-mono"
              style={{
                background: creWorkflowStatus.aiOrchestrator.active
                  ? `color-mix(in srgb, ${RISK_COLORS[creWorkflowStatus.aiOrchestrator.riskLevel] || 'var(--success)'} 15%, transparent)`
                  : 'color-mix(in srgb, var(--text-muted) 10%, transparent)',
                color: creWorkflowStatus.aiOrchestrator.active
                  ? RISK_COLORS[creWorkflowStatus.aiOrchestrator.riskLevel] || 'var(--success)'
                  : 'var(--text-muted)',
              }}
            >
              <span className="w-1 h-1 rounded-full" style={{ background: 'currentColor' }} />
              W3:AI
              {creWorkflowStatus.aiOrchestrator.active && (
                <span className="opacity-70">{RISK_LABELS[creWorkflowStatus.aiOrchestrator.riskLevel] || '?'}</span>
              )}
            </span>

            {/* W5: Protocol Health */}
            <span
              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-mono"
              style={{
                background: creWorkflowStatus.protocolHealth.active
                  ? `color-mix(in srgb, ${RISK_COLORS[creWorkflowStatus.protocolHealth.riskLevel] || 'var(--success)'} 15%, transparent)`
                  : 'color-mix(in srgb, var(--text-muted) 10%, transparent)',
                color: creWorkflowStatus.protocolHealth.active
                  ? RISK_COLORS[creWorkflowStatus.protocolHealth.riskLevel] || 'var(--success)'
                  : 'var(--text-muted)',
              }}
            >
              <span className="w-1 h-1 rounded-full" style={{ background: 'currentColor' }} />
              W5:HEALTH
              {creWorkflowStatus.protocolHealth.active && (
                <span className="opacity-70">{RISK_LABELS[creWorkflowStatus.protocolHealth.riskLevel] || '?'}</span>
              )}
            </span>

            {/* W6: Compliance */}
            <span
              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-mono"
              style={{
                background: creWorkflowStatus.policyEngine.active
                  ? 'color-mix(in srgb, var(--accent) 15%, transparent)'
                  : 'color-mix(in srgb, var(--text-muted) 10%, transparent)',
                color: creWorkflowStatus.policyEngine.active ? 'var(--accent)' : 'var(--text-muted)',
              }}
            >
              <span className="w-1 h-1 rounded-full" style={{ background: 'currentColor' }} />
              W6:KYC
              {creWorkflowStatus.policyEngine.active && (
                <span className="opacity-70">{creWorkflowStatus.policyEngine.totalAttestations}</span>
              )}
            </span>

            {/* W1: Confidential Funding */}
            <span
              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-mono"
              style={{
                background: creWorkflowStatus.confidentialFunding.active
                  ? 'color-mix(in srgb, var(--accent) 15%, transparent)'
                  : 'color-mix(in srgb, var(--text-muted) 10%, transparent)',
                color: creWorkflowStatus.confidentialFunding.active ? 'var(--accent)' : 'var(--text-muted)',
              }}
            >
              <span className="w-1 h-1 rounded-full" style={{ background: 'currentColor' }} />
              W1:VAULT
              {creWorkflowStatus.compliantVault.active && (
                <span className="opacity-70">{creWorkflowStatus.compliantVault.totalRequests}</span>
              )}
            </span>
          </div>
        </div>
      )}

      {/* Fallback for projects without CRE data */}
      {!report && !summary && !metadata && !creWorkflowStatus && (
        <div className="text-center py-3">
          <p className="text-xs font-mono text-[var(--text-muted)]">
            // awaiting first CRE data feed report
          </p>
        </div>
      )}
    </motion.div>
  );
}
