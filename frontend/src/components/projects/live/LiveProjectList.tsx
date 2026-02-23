import { motion } from 'framer-motion';
import { LiveProjectCard } from './LiveProjectCard';
import type { Proposal, CreDataFeedReport, ProjectSummary, CreWorkflowStatus } from '../types';

interface LiveProjectListProps {
  liveProjects: string[];
  proposals: Proposal[];
  report?: CreDataFeedReport | null;
  summary?: ProjectSummary | null;
  creWorkflowStatus?: CreWorkflowStatus;
  onSelectProject: (project: { name: string; symbol: string; ammAddress: string; totalSupply?: bigint; feeBps?: number; metadataHash?: string }) => void;
  onTradeProject?: (ammAddress: string, name: string, symbol: string) => void;
}

export function LiveProjectList({
  liveProjects,
  proposals,
  report,
  summary,
  creWorkflowStatus,
  onSelectProject,
  onTradeProject,
}: LiveProjectListProps) {
  if (liveProjects.length === 0) {
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="text-center py-12 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border)]"
      >
        <p className="text-xs font-mono text-[var(--text-muted)] mb-4">
          <span className="text-[var(--accent)] opacity-60">// </span>
          no_live_projects
        </p>
        <p className="text-[var(--text-secondary)]">No live projects yet</p>
        <p className="text-xs text-[var(--text-muted)] mt-2">
          Projects will appear here after proposals are approved and executed
        </p>
      </motion.div>
    );
  }

  return (
    <div className="space-y-4">
      {liveProjects.map((ammAddress, idx) => {
        const proposal = proposals.find((p) => p.ammAddress === ammAddress);
        return (
          <LiveProjectCard
            key={ammAddress}
            ammAddress={ammAddress}
            proposal={proposal}
            report={report}
            summary={summary}
            creWorkflowStatus={creWorkflowStatus}
            index={idx}
            onClick={() =>
              onSelectProject({
                name: proposal?.name || `Project ${idx + 1}`,
                symbol: proposal?.symbol || 'TOKEN',
                ammAddress,
                totalSupply: proposal?.totalSupply,
                feeBps: proposal?.feeBps,
                metadataHash: proposal?.metadataHash,
              })
            }
            onTrade={onTradeProject ? () => onTradeProject(ammAddress, proposal?.name || 'Token', proposal?.symbol || 'TOKEN') : undefined}
          />
        );
      })}
    </div>
  );
}
