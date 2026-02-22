import { useMemo, useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { formatUnits, formatEther, parseEther } from 'viem';
import { usePredictionMarket } from '../hooks/usePredictionMarket';
import { useConfidentialFunding } from '../hooks/useConfidentialFunding';
import { useAIOrchestrator } from '../hooks/useAIOrchestrator';
import type { PredictionMarket, ProjectAttestation, GovernanceAdvisory } from '../types';
import { GlowButton } from '../../ui/GlowButton';
import { StatusBadge } from './StatusBadge';
import { MilestoneTimeline } from './MilestoneTimeline';
import { DataFeedPreview } from './DataFeedPreview';
import type { Proposal, ProposalMetadata, MilestoneNode } from '../types';
import { ProposalStatus, CRE_MILESTONES } from '../constants';

interface ProposalCardProps {
  proposal: Proposal;
  onVote: (proposalId: number, support: boolean) => void;
  onExecute: (proposalId: number) => void;
  onCancel: (proposalId: number) => void;
  viewingKey: string | null;
  address: string | undefined;
  isLoading: boolean;
  index: number;
}

function getStoredMetadata(metadataHash: string): ProposalMetadata | null {
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

export function ProposalCard({
  proposal,
  onVote,
  onExecute,
  onCancel,
  viewingKey,
  address,
  isLoading,
  index,
}: ProposalCardProps) {
  const isActive = proposal.status === ProposalStatus.Active;
  const isCreator = address?.toLowerCase() === proposal.creator.toLowerCase();
  const votingEnded = BigInt(Math.floor(Date.now() / 1000)) >= proposal.votingEnds;
  const canExecute =
    votingEnded &&
    proposal.status === ProposalStatus.Active &&
    proposal.votesFor > proposal.votesAgainst &&
    proposal.votesFor + proposal.votesAgainst >= parseEther('1000000');

  const metadata = useMemo(() => getStoredMetadata(proposal.metadataHash), [proposal.metadataHash]);

  const milestones: MilestoneNode[] = useMemo(() => {
    return CRE_MILESTONES.map(m => ({
      ...m,
      status: proposal.status === ProposalStatus.Executed ? 'active' : 'pending',
    }));
  }, [proposal.status]);

  // CRE Workflow hooks (W1, W3, W4)
  const { getMarket } = usePredictionMarket();
  const { getProjectAttestation } = useConfidentialFunding();
  const { getGovernanceAdvisory } = useAIOrchestrator();

  const [market, setMarket] = useState<PredictionMarket | null>(null);
  const [attestation, setAttestation] = useState<ProjectAttestation | null>(null);
  const [advisory, setAdvisory] = useState<GovernanceAdvisory | null>(null);

  useEffect(() => {
    Promise.all([
      getMarket(proposal.id),
      getProjectAttestation(proposal.id),
      getGovernanceAdvisory(proposal.id),
    ]).then(([m, a, adv]) => {
      if (m) setMarket(m);
      if (a) setAttestation(a);
      if (adv) setAdvisory(adv);
    });
  }, [proposal.id]);

  const getVotePercentage = () => {
    const total = proposal.votesFor + proposal.votesAgainst;
    if (total === 0n) return { for: 50, against: 50 };
    return {
      for: Number((proposal.votesFor * 100n) / total),
      against: Number((proposal.votesAgainst * 100n) / total),
    };
  };

  const formatTimeRemaining = () => {
    const now = BigInt(Math.floor(Date.now() / 1000));
    if (proposal.votingEnds <= now) return 'Ended';
    const remaining = Number(proposal.votingEnds - now);
    const days = Math.floor(remaining / 86400);
    const hours = Math.floor((remaining % 86400) / 3600);
    if (days > 0) return `${days}d ${hours}h left`;
    return `${hours}h left`;
  };

  const votePercent = getVotePercentage();

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: index * 0.1 }}
      whileHover={{ y: -4 }}
      className="rounded-lg p-5 bg-[var(--bg-secondary)] border border-[var(--border)] hover:border-[var(--border-focus)] transition-all duration-300"
    >
      {/* Header */}
      <div className="flex justify-between items-start mb-3">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <h3 className="font-semibold text-lg text-[var(--text-primary)]">{proposal.name}</h3>
            <span className="text-[var(--text-muted)] font-mono text-sm">${proposal.symbol}</span>
            <StatusBadge status={proposal.status} />
          </div>
          <div className="flex items-center gap-2">
            <p className="text-xs text-[var(--text-muted)] font-mono">
              by {proposal.creator.slice(0, 6)}...{proposal.creator.slice(-4)}
            </p>
            {metadata && (
              <span className="text-[9px] font-mono px-1.5 py-0.5 rounded"
                style={{ color: 'var(--success)', background: 'color-mix(in srgb, var(--success) 10%, transparent)' }}>
                v2
              </span>
            )}
          </div>
        </div>
        <div className="text-right">
          <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider font-mono mb-1">
            // pledged_lp
          </p>
          <div className="font-medium text-[var(--text-primary)]">
            {Number(formatUnits(proposal.pledgedR00t, 18)).toLocaleString()} $ROOT
          </div>
        </div>
      </div>

      {/* Description from metadata */}
      {metadata?.description && (
        <p className="text-xs text-[var(--text-secondary)] mb-3 line-clamp-2">{metadata.description}</p>
      )}

      {/* Data Feed Preview (if metadata has environmental data) */}
      {metadata?.environmental && (
        <div className="mb-3">
          <DataFeedPreview
            ndvi={parseFloat(metadata.environmental.targetNdvi) || undefined}
            carbonScore={metadata.environmental.species.reduce((s, sp) => s + sp.count * sp.co2RateKgYear, 0) / 1000 || undefined}
            fri={undefined}
          />
        </div>
      )}

      {/* Vote Progress */}
      <div className="mb-3">
        <div className="flex justify-between text-xs mb-2 font-mono">
          <span style={{ color: 'var(--success)' }}>
            for: {Number(formatUnits(proposal.votesFor, 18)).toLocaleString()}
          </span>
          <span style={{ color: 'var(--error)' }}>
            against: {Number(formatUnits(proposal.votesAgainst, 18)).toLocaleString()}
          </span>
        </div>
        <div className="h-2 rounded-full overflow-hidden flex bg-[var(--bg-secondary)]">
          <motion.div
            initial={{ width: 0 }}
            animate={{ width: `${votePercent.for}%` }}
            transition={{ duration: 0.8, ease: 'easeOut' }}
            style={{ background: 'var(--success)' }}
            className="h-full"
          />
          <motion.div
            initial={{ width: 0 }}
            animate={{ width: `${votePercent.against}%` }}
            transition={{ duration: 0.8, ease: 'easeOut', delay: 0.1 }}
            style={{ background: 'var(--error)' }}
            className="h-full"
          />
        </div>
      </div>

      {/* Info Row */}
      <div className="flex justify-between text-xs text-[var(--text-muted)] mb-3 font-mono">
        <span>supply: {Number(formatUnits(proposal.totalSupply, 18)).toLocaleString()}</span>
        <span>fee: {proposal.feeBps / 100}%</span>
        <span>{isActive ? formatTimeRemaining() : ''}</span>
      </div>

      {/* Milestone Timeline (compact) */}
      <div className="mb-3">
        <MilestoneTimeline milestones={milestones} compact />
      </div>

      {/* CRE Workflow Status (W1/W3/W4) */}
      {(attestation || advisory || market) && (
        <div className="mb-3 p-2.5 rounded-lg space-y-1.5" style={{ background: 'var(--bg-primary)' }}>
          {attestation && (
            <div className="flex items-center justify-between text-[10px] font-mono">
              <span>
                <span style={{ color: 'var(--accent)' }}>W1</span>
                <span className="text-[var(--text-muted)]"> funding_vault</span>
              </span>
              <span className="flex items-center gap-1.5">
                <span style={{ color: attestation.verified ? 'var(--success)' : 'var(--warning)' }}>
                  {attestation.verified ? 'verified' : 'pending'}
                </span>
                <span className="text-[var(--text-muted)]">impact: {attestation.impactScore}</span>
              </span>
            </div>
          )}
          {advisory && (
            <div className="flex items-center justify-between text-[10px] font-mono">
              <span>
                <span style={{ color: 'var(--accent)' }}>W3</span>
                <span className="text-[var(--text-muted)]"> ai_advisory</span>
              </span>
              <span className="flex items-center gap-1.5">
                <span style={{ color: advisory.recommendation === 1 ? 'var(--success)' : advisory.recommendation === 2 ? 'var(--error)' : 'var(--text-muted)' }}>
                  {advisory.recommendation === 1 ? 'FOR' : advisory.recommendation === 2 ? 'AGAINST' : 'ABSTAIN'}
                </span>
                <span className="text-[var(--text-muted)]">{advisory.confidence}%</span>
              </span>
            </div>
          )}
          {market && (
            <div className="flex items-center justify-between text-[10px] font-mono">
              <span>
                <span style={{ color: 'var(--accent)' }}>W4</span>
                <span className="text-[var(--text-muted)]"> prediction</span>
              </span>
              <span className="flex items-center gap-1.5">
                <span style={{ color: market.status === 0 ? 'var(--accent)' : market.status === 1 ? 'var(--success)' : market.status === 2 ? 'var(--error)' : 'var(--text-muted)' }}>
                  {['OPEN', 'YES', 'NO', 'CANCELLED'][market.status] ?? 'UNKNOWN'}
                </span>
                <span className="text-[var(--text-muted)]">{formatEther(market.totalPool)} ETH</span>
              </span>
            </div>
          )}
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-2">
        {isActive && !votingEnded && viewingKey && (
          <>
            <GlowButton onClick={() => onVote(proposal.id, true)} variant="primary" size="sm" className="flex-1">
              vote_for()
            </GlowButton>
            <GlowButton onClick={() => onVote(proposal.id, false)} variant="danger" size="sm" className="flex-1">
              vote_against()
            </GlowButton>
          </>
        )}

        {isActive && !votingEnded && !viewingKey && (
          <div className="flex-1 py-2 rounded-xl text-sm text-center text-[var(--text-muted)] bg-[var(--bg-secondary)] font-mono">
            // unlock wallet to vote
          </div>
        )}

        {canExecute && (
          <GlowButton onClick={() => onExecute(proposal.id)} disabled={isLoading} variant="primary" className="flex-1">
            execute()
          </GlowButton>
        )}

        {isCreator && isActive && BigInt(Math.floor(Date.now() / 1000)) < proposal.createdAt + 86400n && (
          <GlowButton onClick={() => onCancel(proposal.id)} disabled={isLoading} variant="ghost">
            cancel()
          </GlowButton>
        )}

        {proposal.status === ProposalStatus.Executed && (
          <a
            href={`https://basescan.org/address/${proposal.ammAddress}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex-1"
          >
            <GlowButton variant="secondary" className="w-full">
              view_pool()
            </GlowButton>
          </a>
        )}
      </div>
    </motion.div>
  );
}
