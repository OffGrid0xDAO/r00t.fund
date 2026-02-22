import { motion } from 'framer-motion';
import { GlowButton } from '../../ui/GlowButton';
import { ProposalCard } from './ProposalCard';
import type { Proposal, TabType } from '../types';

interface ProposalListProps {
  proposals: Proposal[];
  onVote: (proposalId: number, support: boolean) => void;
  onExecute: (proposalId: number) => void;
  onCancel: (proposalId: number) => void;
  viewingKey: string | null;
  address: string | undefined;
  isLoading: boolean;
  onTabChange: (tab: TabType) => void;
}

export function ProposalList({
  proposals,
  onVote,
  onExecute,
  onCancel,
  viewingKey,
  address,
  isLoading,
  onTabChange,
}: ProposalListProps) {
  if (proposals.length === 0) {
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="text-center py-12 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border)]"
      >
        <p className="text-xs font-mono text-[var(--text-muted)] mb-4">
          <span className="text-[var(--accent)] opacity-60">// </span>
          no_proposals
        </p>
        <p className="text-[var(--text-secondary)] mb-4">No proposals yet</p>
        <GlowButton onClick={() => onTabChange('create')} variant="primary" size="sm">
          create_first()
        </GlowButton>
      </motion.div>
    );
  }

  return (
    <div className="space-y-4">
      {proposals.map((proposal, index) => (
        <ProposalCard
          key={proposal.id}
          proposal={proposal}
          onVote={onVote}
          onExecute={onExecute}
          onCancel={onCancel}
          viewingKey={viewingKey}
          address={address}
          isLoading={isLoading}
          index={index}
        />
      ))}
    </div>
  );
}
