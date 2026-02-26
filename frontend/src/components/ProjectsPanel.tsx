import { useState, useMemo, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAccount } from 'wagmi';
import { ProjectDetailModal } from './ProjectDetailModal';
import { AnimatedTabs } from './ui/AnimatedTabs';
import { useProposals } from './projects/hooks/useProposals';
import { useWorldIdVerification } from './projects/hooks/useWorldIdVerification';
import { useCreDataFeeds } from './projects/hooks/useCreDataFeeds';
import { useProofOfReserve } from './projects/hooks/useProofOfReserve';
import { useAIOrchestrator } from './projects/hooks/useAIOrchestrator';
import { useProtocolHealth } from './projects/hooks/useProtocolHealth';
import { usePolicyEngine } from './projects/hooks/usePolicyEngine';
import { useCompliantVault } from './projects/hooks/useCompliantVault';
import { useConfidentialFunding } from './projects/hooks/useConfidentialFunding';
import { ProposalList } from './projects/proposals/ProposalList';
import { VoteModal } from './projects/proposals/VoteModal';
import { LiveProjectList } from './projects/live/LiveProjectList';
import { CreateProposalWizard } from './projects/wizard/CreateProposalWizard';
import { CONTRACTS, getExplorerTxUrl, NETWORK } from '../config';
import type { CommitmentsResult, TabType, CreWorkflowStatus } from './projects/types';

interface ProjectsPanelProps {
  launchpadAddress: string;
  hiddenPoolAddress: string;
  viewingKey: string | null;
  hiddenBalance: bigint;
  onTradeProject?: (ammAddress: string, name: string, symbol: string) => void;
  onLiveTokensDiscovered?: (tokens: { address: string; name: string; symbol: string }[]) => void;
  commitments?: Array<{
    commitment: string;
    amount: string;
    leafIndex: number;
    spent: boolean;
    nullifier?: string;
    secret?: string;
  }>;
  fetchAllOnChainCommitments?: () => Promise<CommitmentsResult>;
  worldIdGatekeeperAddress?: string;
}

export function ProjectsPanel({
  launchpadAddress,
  hiddenPoolAddress: _hiddenPoolAddress,
  viewingKey,
  hiddenBalance,
  onTradeProject,
  onLiveTokensDiscovered,
  commitments = [],
  fetchAllOnChainCommitments,
  worldIdGatekeeperAddress,
}: ProjectsPanelProps) {
  void _hiddenPoolAddress;
  const { isConnected, address } = useAccount();

  const [activeTab, setActiveTab] = useState<TabType>('proposals');
  const [voteModal, setVoteModal] = useState<{ proposalId: number; support: boolean } | null>(null);
  const [selectedProject, setSelectedProject] = useState<{
    name: string;
    symbol: string;
    ammAddress: string;
    totalSupply?: bigint;
    feeBps?: number;
    metadataHash?: string;
  } | null>(null);

  const {
    proposals,
    liveProjects,
    isLoading,
    error,
    txHash,
    setTxHash,
    setIsLoading,
    setError,
    handleVote,
    handleExecute,
    handleCancel,
  } = useProposals({ launchpadAddress, commitments, fetchAllOnChainCommitments });

  const worldId = useWorldIdVerification({ worldIdGatekeeperAddress });

  // Auto-switch to live tab when live projects are discovered
  useEffect(() => {
    if (liveProjects.length > 0 && activeTab === 'proposals') {
      setActiveTab('live');
    }
  }, [liveProjects.length]);

  // CRE Workflow hooks — data feeds + protocol monitoring
  const { report, summary } = useCreDataFeeds({
    contractAddress: CONTRACTS.serraEstrela,
    enabled: liveProjects.length > 0,
  });
  const proofOfReserve = useProofOfReserve();
  const aiOrchestrator = useAIOrchestrator();
  const protocolHealth = useProtocolHealth();
  const policyEngine = usePolicyEngine();
  const compliantVault = useCompliantVault();
  const confidentialFunding = useConfidentialFunding();

  // Aggregate CRE workflow status for UI display
  const creWorkflowStatus = useMemo<CreWorkflowStatus>(() => ({
    serraEstrela: { active: !!report, lastUpdate: report?.timestamp ?? 0 },
    proofOfReserve: {
      active: !!proofOfReserve.data,
      backingRatio: proofOfReserve.data?.backingRatio ?? 0,
      tvl: proofOfReserve.data?.totalTVL ?? 0n,
    },
    aiOrchestrator: {
      active: !!aiOrchestrator.analysis,
      riskLevel: aiOrchestrator.analysis?.riskLevel ?? 0,
      safeToTrade: aiOrchestrator.safeToTrade ?? true,
    },
    predictionMarket: { active: true, openMarkets: 0 },
    protocolHealth: {
      active: !!protocolHealth.report,
      riskLevel: protocolHealth.report?.overallRiskLevel ?? 0,
    },
    policyEngine: {
      active: !!policyEngine.stats,
      totalAttestations: policyEngine.stats?.totalAttestations ?? 0,
    },
    compliantVault: {
      active: !!compliantVault.stats,
      totalRequests: compliantVault.stats?.totalRequests ?? 0,
    },
    confidentialFunding: {
      active: confidentialFunding.verifiedCount > 0,
      verifiedProposals: confidentialFunding.verifiedCount,
    },
  }), [report, proofOfReserve.data, aiOrchestrator.analysis, aiOrchestrator.safeToTrade, protocolHealth.report, policyEngine.stats, compliantVault.stats, confidentialFunding.verifiedCount]);

  // Notify parent of live project tokens so they appear in the swap token selector
  useEffect(() => {
    if (!onLiveTokensDiscovered || proposals.length === 0) return;
    const liveTokens = proposals
      .filter(p => p.ammAddress && p.ammAddress !== '0x0000000000000000000000000000000000000000')
      .map(p => ({ address: p.ammAddress, name: p.name, symbol: p.symbol }));
    if (liveTokens.length > 0) onLiveTokensDiscovered(liveTokens);
  }, [proposals, onLiveTokensDiscovered]);

  const tabs = [
    { id: 'live' as const, label: '_live' },
    { id: 'proposals' as const, label: '_proposals' },
    { id: 'create' as const, label: '_create' },
  ];

  return (
    <div className="space-y-6">
      {/* Tabs */}
      <AnimatedTabs
        tabs={tabs}
        activeTab={activeTab}
        onTabChange={(tab) => setActiveTab(tab as TabType)}
      />

      {/* Error */}
      <AnimatePresence>
        {error && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="p-3 rounded-xl text-sm"
            style={{
              background: 'color-mix(in srgb, var(--error) 10%, transparent)',
              border: '1px solid color-mix(in srgb, var(--error) 25%, transparent)',
              color: 'var(--error)',
            }}
          >
            {error}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Success */}
      <AnimatePresence>
        {txHash && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="p-3 rounded-xl text-sm"
            style={{
              background: 'color-mix(in srgb, var(--success) 10%, transparent)',
              border: '1px solid color-mix(in srgb, var(--success) 25%, transparent)',
              color: 'var(--success)',
            }}
          >
            Transaction submitted!{' '}
            {getExplorerTxUrl(txHash) ? (
              <a
                href={getExplorerTxUrl(txHash)}
                target="_blank"
                rel="noopener noreferrer"
                className="underline"
              >
                View on {NETWORK.explorerName}
              </a>
            ) : (
              <span className="font-mono text-xs opacity-70">{txHash.slice(0, 10)}...{txHash.slice(-8)}</span>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Tab Content */}
      <AnimatePresence mode="wait">
        {activeTab === 'proposals' && (
          <motion.div
            key="proposals"
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 20 }}
            transition={{ duration: 0.3 }}
          >
            <ProposalList
              proposals={proposals}
              onVote={(id, support) => setVoteModal({ proposalId: id, support })}
              onExecute={handleExecute}
              onCancel={handleCancel}
              viewingKey={viewingKey}
              address={address}
              isLoading={isLoading}
              onTabChange={setActiveTab}
            />
          </motion.div>
        )}

        {activeTab === 'live' && (
          <motion.div
            key="live"
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 20 }}
            transition={{ duration: 0.3 }}
          >
            <LiveProjectList
              liveProjects={liveProjects}
              proposals={proposals}
              report={report}
              summary={summary}
              creWorkflowStatus={creWorkflowStatus}
              onSelectProject={setSelectedProject}
              onTradeProject={onTradeProject}
            />
          </motion.div>
        )}

        {activeTab === 'create' && (
          <motion.div
            key="create"
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 20 }}
            transition={{ duration: 0.3 }}
          >
            {!isConnected ? (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="text-center py-12 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border)]"
              >
                <p className="text-xs font-mono text-[var(--text-muted)] mb-4">
                  <span className="text-[var(--accent)] opacity-60">// </span>
                  wallet_required
                </p>
                <p className="text-[var(--text-secondary)]">Connect wallet to create a proposal</p>
              </motion.div>
            ) : (
              <CreateProposalWizard
                launchpadAddress={launchpadAddress}
                viewingKey={viewingKey}
                hiddenBalance={hiddenBalance}
                commitments={commitments}
                fetchAllOnChainCommitments={fetchAllOnChainCommitments}
                worldIdEnabled={worldId.worldIdEnabled}
                worldIdVerified={worldId.worldIdVerified}
                worldIdPending={worldId.worldIdPending}
                worldIdError={worldId.worldIdError}
                onWorldIdSuccess={worldId.handleWorldIdSuccess}
                onSuccess={(hash) => setTxHash(hash)}
                onTabChange={setActiveTab}
                setIsLoading={setIsLoading}
                setError={setError}
                isLoading={isLoading}
              />
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Vote Modal */}
      {voteModal && (
        <VoteModal
          proposalId={voteModal.proposalId}
          support={voteModal.support}
          isLoading={isLoading}
          onVote={(proposalId, support, amount) => {
            handleVote(proposalId, support, amount);
            setVoteModal(null);
          }}
          onClose={() => setVoteModal(null)}
        />
      )}

      {/* Project Detail Modal */}
      {selectedProject && (
        <ProjectDetailModal
          project={selectedProject}
          onClose={() => setSelectedProject(null)}
          onTrade={(ammAddress) => {
            setSelectedProject(null);
            onTradeProject?.(ammAddress, selectedProject.name, selectedProject.symbol);
          }}
          creReport={report}
          creSummary={summary}
          creWorkflowStatus={creWorkflowStatus}
        />
      )}
    </div>
  );
}
