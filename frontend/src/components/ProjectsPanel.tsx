import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAccount, usePublicClient, useWalletClient } from 'wagmi';
import { parseEther, formatUnits, keccak256, toBytes } from 'viem';
import { IDKitWidget, VerificationLevel, type ISuccessResult } from '@worldcoin/idkit';
import { ProjectDetailModal } from './ProjectDetailModal';
import { GlowButton } from './ui/GlowButton';
import { AnimatedTabs } from './ui/AnimatedTabs';
import { usePageVisibility } from '../hooks/usePageVisibility';
import { useZkProver } from '../hooks/useZkProver';

// Types
interface Proposal {
  id: number;
  creator: string;
  pledgedR00t: bigint;
  name: string;
  symbol: string;
  metadataHash: string;
  totalSupply: bigint;
  feeBps: number;
  deployerBps: number;
  votesFor: bigint;
  votesAgainst: bigint;
  votingEnds: bigint;
  status: number;
  ammAddress: string;
  tokenAddress: string;
  createdAt: bigint;
}

// Type for fetching all on-chain commitments (for merkle tree building)
interface CommitmentsResult {
  commitments: { commitment: bigint; leafIndex: number }[];
  treeState?: {
    filledSubtrees: bigint[];
    root: bigint;
  };
}

interface ProjectsPanelProps {
  launchpadAddress: string;
  hiddenPoolAddress: string;
  viewingKey: string | null;
  hiddenBalance: bigint;
  onTradeProject?: (ammAddress: string, name: string, symbol: string) => void;
  // Commitments from usePrivateWallet (with secrets for proof generation)
  commitments?: Array<{
    commitment: string;
    amount: string;
    leafIndex: number;
    spent: boolean;
    nullifier?: string;
    secret?: string;
  }>;
  // Function to fetch all on-chain commitments for merkle tree
  fetchAllOnChainCommitments?: () => Promise<CommitmentsResult>;
  // World ID Gatekeeper address (optional — if not set, World ID gate is disabled)
  worldIdGatekeeperAddress?: string;
}

// Status enum matching contract
const ProposalStatus = {
  Active: 0,
  Approved: 1,
  Rejected: 2,
  Cancelled: 3,
  Executed: 4,
};

const LAUNCHPAD_ABI = [
  {
    name: 'createProposal',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      {
        name: 'params',
        type: 'tuple',
        components: [
          { name: 'name', type: 'string' },
          { name: 'symbol', type: 'string' },
          { name: 'metadataHash', type: 'bytes32' },
          { name: 'totalSupply', type: 'uint256' },
          { name: 'feeBps', type: 'uint256' },
          { name: 'deployerBps', type: 'uint256' },
        ],
      },
      { name: 'proof', type: 'uint256[8]' },
      { name: 'merkleRoot', type: 'uint256' },
      { name: 'nullifierHash', type: 'uint256' },
      { name: 'pledgeAmount', type: 'uint256' },
      { name: 'publicInputsBinding', type: 'uint256' },
    ],
    outputs: [{ type: 'uint256' }],
  },
  {
    name: 'votePrivate',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'proposalId', type: 'uint256' },
      { name: 'proof', type: 'uint256[8]' },
      { name: 'merkleRoot', type: 'uint256' },
      { name: 'nullifierHash', type: 'uint256' },
      { name: 'voteWeight', type: 'uint256' },
      { name: 'support', type: 'bool' },
    ],
    outputs: [],
  },
  {
    name: 'executeProposal',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'proposalId', type: 'uint256' }],
    outputs: [],
  },
  {
    name: 'cancelProposal',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'proposalId', type: 'uint256' }],
    outputs: [],
  },
  {
    name: 'finalizeRejected',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'proposalId', type: 'uint256' }],
    outputs: [],
  },
  {
    name: 'withdrawRejected',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'proposalId', type: 'uint256' }],
    outputs: [],
  },
  {
    name: 'getProposal',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'proposalId', type: 'uint256' }],
    outputs: [
      {
        type: 'tuple',
        components: [
          { name: 'creator', type: 'address' },
          { name: 'pledgedR00t', type: 'uint256' },
          { name: 'name', type: 'string' },
          { name: 'symbol', type: 'string' },
          { name: 'metadataHash', type: 'bytes32' },
          { name: 'totalSupply', type: 'uint256' },
          { name: 'feeBps', type: 'uint256' },
          { name: 'deployerBps', type: 'uint256' },
          { name: 'votesFor', type: 'uint256' },
          { name: 'votesAgainst', type: 'uint256' },
          { name: 'votingEnds', type: 'uint256' },
          { name: 'status', type: 'uint8' },
          { name: 'ammAddress', type: 'address' },
          { name: 'tokenAddress', type: 'address' },
          { name: 'createdAt', type: 'uint256' },
        ],
      },
    ],
  },
  {
    name: 'proposalCount',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint256' }],
  },
  {
    name: 'getActiveProposals',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint256[]' }],
  },
  {
    name: 'getLiveProjects',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'address[]' }],
  },
  {
    name: 'MIN_VOTES_FOR_QUORUM',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint256' }],
  },
] as const;

// World ID Gatekeeper ABI (minimal — only functions we call from frontend)
const WORLD_ID_GATEKEEPER_ABI = [
  {
    name: 'isVerified',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'user', type: 'address' }],
    outputs: [{ type: 'bool' }],
  },
  {
    name: 'requestVerification',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'nullifierHash', type: 'bytes32' },
      { name: 'merkleRoot', type: 'bytes32' },
      { name: 'proof', type: 'uint256[8]' },
      { name: 'verificationLevel', type: 'string' },
    ],
    outputs: [{ name: 'requestId', type: 'uint256' }],
  },
  {
    name: 'appId',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'string' }],
  },
] as const;

// World ID configuration — update with real Worldcoin app credentials
const WORLD_ID_APP_ID = import.meta.env.VITE_WORLD_ID_APP_ID || 'app_staging_r00t_fund';
const WORLD_ID_ACTION = import.meta.env.VITE_WORLD_ID_ACTION || 'create-proposal';

type TabType = 'proposals' | 'live' | 'create';

// Status badge component
function StatusBadge({ status }: { status: number }) {
  const getStatusConfig = () => {
    switch (status) {
      case ProposalStatus.Active:
        return { label: 'active', color: 'var(--glow-secondary)', bg: 'var(--glow-secondary)' };
      case ProposalStatus.Approved:
        return { label: 'approved', color: 'var(--success)', bg: 'var(--success)' };
      case ProposalStatus.Rejected:
        return { label: 'rejected', color: 'var(--error)', bg: 'var(--error)' };
      case ProposalStatus.Cancelled:
        return { label: 'cancelled', color: 'var(--text-muted)', bg: 'var(--text-muted)' };
      case ProposalStatus.Executed:
        return { label: 'live', color: 'var(--success)', bg: 'var(--success)' };
      default:
        return { label: 'unknown', color: 'var(--text-muted)', bg: 'var(--text-muted)' };
    }
  };

  const config = getStatusConfig();

  return (
    <motion.span
      initial={{ opacity: 0, scale: 0.8 }}
      animate={{ opacity: 1, scale: 1 }}
      className="px-2 py-0.5 rounded-full text-[10px] font-mono uppercase tracking-wider"
      style={{
        color: config.color,
        background: `${config.bg}20`,
        border: `1px solid ${config.bg}40`,
      }}
    >
      {config.label}
    </motion.span>
  );
}

// Proposal card component
function ProposalCard({
  proposal,
  onVote,
  onExecute,
  onCancel,
  viewingKey,
  address,
  isLoading,
  index,
}: {
  proposal: Proposal;
  onVote: (proposalId: number, support: boolean) => void;
  onExecute: (proposalId: number) => void;
  onCancel: (proposalId: number) => void;
  viewingKey: string | null;
  address: string | undefined;
  isLoading: boolean;
  index: number;
}) {
  const isActive = proposal.status === ProposalStatus.Active;
  const isCreator = address?.toLowerCase() === proposal.creator.toLowerCase();
  const votingEnded = BigInt(Math.floor(Date.now() / 1000)) >= proposal.votingEnds;
  const canExecute =
    votingEnded &&
    proposal.status === ProposalStatus.Active &&
    proposal.votesFor > proposal.votesAgainst &&
    proposal.votesFor + proposal.votesAgainst >= parseEther('1000000');

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
      <div className="flex justify-between items-start mb-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <h3 className="font-semibold text-lg text-[var(--text-primary)]">{proposal.name}</h3>
            <span className="text-[var(--text-muted)] font-mono text-sm">${proposal.symbol}</span>
            <StatusBadge status={proposal.status} />
          </div>
          <p className="text-xs text-[var(--text-muted)] font-mono">
            by {proposal.creator.slice(0, 6)}...{proposal.creator.slice(-4)}
          </p>
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

      {/* Vote Progress */}
      <div className="mb-4">
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
      <div className="flex justify-between text-xs text-[var(--text-muted)] mb-4 font-mono">
        <span>supply: {Number(formatUnits(proposal.totalSupply, 18)).toLocaleString()}</span>
        <span>fee: {proposal.feeBps / 100}%</span>
        <span>{isActive ? formatTimeRemaining() : ''}</span>
      </div>

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

export function ProjectsPanel({
  launchpadAddress,
  hiddenPoolAddress: _hiddenPoolAddress,
  viewingKey,
  hiddenBalance,
  onTradeProject,
  commitments = [],
  fetchAllOnChainCommitments,
  worldIdGatekeeperAddress,
}: ProjectsPanelProps) {
  void _hiddenPoolAddress; // Using CONTRACTS.zkAMMPair instead
  const { isConnected, address } = useAccount();
  const publicClient = usePublicClient();
  const { data: walletClient } = useWalletClient();
  const isPageVisible = usePageVisibility();

  // Initialize ZK prover for generating real proofs
  const zkProver = useZkProver();

  const [activeTab, setActiveTab] = useState<TabType>('proposals');

  // World ID verification state
  const [worldIdVerified, setWorldIdVerified] = useState(false);
  const [worldIdPending, setWorldIdPending] = useState(false);
  const [worldIdError, setWorldIdError] = useState<string | null>(null);
  const worldIdEnabled = !!worldIdGatekeeperAddress && worldIdGatekeeperAddress !== '0x0000000000000000000000000000000000000000';
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [liveProjects, setLiveProjects] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [selectedProject, setSelectedProject] = useState<{
    name: string;
    symbol: string;
    ammAddress: string;
    totalSupply?: bigint;
    feeBps?: number;
  } | null>(null);

  // Create proposal form state
  const [formData, setFormData] = useState({
    name: '',
    symbol: '',
    description: '',
    docsUrl: '',
    twitterUrl: '',
    totalSupply: '10000000',
    feeBps: '50',
    deployerBps: '0',
    pledgeAmount: '100000',
  });

  // Vote modal state
  const [voteModal, setVoteModal] = useState<{ proposalId: number; support: boolean } | null>(null);
  const [voteAmount, setVoteAmount] = useState('');

  // Tab configuration
  const tabs = [
    { id: 'proposals' as const, label: '_proposals' },
    { id: 'live' as const, label: '_live' },
    { id: 'create' as const, label: '_create' },
  ];

  // Fetch proposals and live projects
  useEffect(() => {
    if (!publicClient || !launchpadAddress || launchpadAddress === '0x...') return;

    const fetchData = async () => {
      try {
        const [count, _activeIds, liveAddrs] = await Promise.all([
          publicClient.readContract({
            address: launchpadAddress as `0x${string}`,
            abi: LAUNCHPAD_ABI,
            functionName: 'proposalCount',
          }),
          publicClient.readContract({
            address: launchpadAddress as `0x${string}`,
            abi: LAUNCHPAD_ABI,
            functionName: 'getActiveProposals',
          }),
          publicClient.readContract({
            address: launchpadAddress as `0x${string}`,
            abi: LAUNCHPAD_ABI,
            functionName: 'getLiveProjects',
          }),
        ]);

        const proposalPromises = [];
        for (let i = 0; i < Number(count); i++) {
          proposalPromises.push(
            publicClient.readContract({
              address: launchpadAddress as `0x${string}`,
              abi: LAUNCHPAD_ABI,
              functionName: 'getProposal',
              args: [BigInt(i)],
            })
          );
        }

        const proposalResults = await Promise.all(proposalPromises);
        const formattedProposals: Proposal[] = proposalResults.map((p, idx) => ({
          id: idx,
          creator: p.creator,
          pledgedR00t: p.pledgedR00t,
          name: p.name,
          symbol: p.symbol,
          metadataHash: p.metadataHash,
          totalSupply: p.totalSupply,
          feeBps: Number(p.feeBps),
          deployerBps: Number(p.deployerBps),
          votesFor: p.votesFor,
          votesAgainst: p.votesAgainst,
          votingEnds: p.votingEnds,
          status: p.status,
          ammAddress: p.ammAddress,
          tokenAddress: p.tokenAddress,
          createdAt: p.createdAt,
        }));

        setProposals(formattedProposals);
        setLiveProjects([...liveAddrs]);
      } catch (err) {
        console.error('Failed to fetch launchpad data:', err);
      }
    };

    fetchData();

    // Only poll when page is visible, and use longer interval to reduce RPC calls
    if (!isPageVisible) return;

    const interval = window.setInterval(fetchData, 60000); // Reduced from 15s to 60s
    return () => window.clearInterval(interval);
  }, [publicClient, launchpadAddress, isPageVisible]);

  // Check World ID verification status
  useEffect(() => {
    if (!publicClient || !address || !worldIdEnabled) return;

    const checkVerification = async () => {
      try {
        const verified = await publicClient.readContract({
          address: worldIdGatekeeperAddress as `0x${string}`,
          abi: WORLD_ID_GATEKEEPER_ABI,
          functionName: 'isVerified',
          args: [address],
        });
        setWorldIdVerified(verified as boolean);
      } catch (err) {
        console.error('Failed to check World ID status:', err);
      }
    };

    checkVerification();

    // Poll while pending
    if (worldIdPending) {
      const interval = window.setInterval(checkVerification, 5000);
      return () => window.clearInterval(interval);
    }
  }, [publicClient, address, worldIdGatekeeperAddress, worldIdEnabled, worldIdPending]);

  // Handle successful World ID verification from IDKit
  const handleWorldIdSuccess = useCallback(async (result: ISuccessResult) => {
    if (!walletClient || !publicClient || !address || !worldIdEnabled) return;

    setWorldIdPending(true);
    setWorldIdError(null);

    try {
      // IDKit returns: merkle_root, nullifier_hash, proof, verification_level
      const nullifierHash = result.nullifier_hash as `0x${string}`;
      const merkleRoot = result.merkle_root as `0x${string}`;

      // Parse the proof string into 8 uint256 values
      // IDKit returns proof as a hex-encoded ABI-packed string
      const proofStr = result.proof;
      const proofBigInts: bigint[] = [];
      // The proof is ABI-encoded as uint256[8]
      const cleanProof = proofStr.startsWith('0x') ? proofStr.slice(2) : proofStr;
      for (let i = 0; i < 8; i++) {
        const chunk = cleanProof.slice(i * 64, (i + 1) * 64);
        proofBigInts.push(chunk ? BigInt('0x' + chunk) : 0n);
      }
      while (proofBigInts.length < 8) proofBigInts.push(0n);

      const proof = proofBigInts.slice(0, 8) as [bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint];

      const verificationLevel = result.verification_level === 'orb' ? 'orb' : 'device';

      // Submit proof on-chain to WorldIDGatekeeper
      const hash = await walletClient.writeContract({
        address: worldIdGatekeeperAddress as `0x${string}`,
        abi: WORLD_ID_GATEKEEPER_ABI,
        functionName: 'requestVerification',
        args: [nullifierHash, merkleRoot, proof, verificationLevel],
      });

      await publicClient.waitForTransactionReceipt({ hash });

      // Poll for CRE to process the verification
      // The useEffect above will pick up the polling
    } catch (err: unknown) {
      const error = err as Error;
      console.error('World ID submission failed:', error);
      setWorldIdError(error.message || 'Failed to submit World ID proof');
      setWorldIdPending(false);
    }
  }, [walletClient, publicClient, address, worldIdGatekeeperAddress, worldIdEnabled]);

  const handleCreateProposal = async () => {
    if (!walletClient || !publicClient || !address) return;

    setIsLoading(true);
    setError(null);
    setTxHash(null);

    try {
      // Check if ZK prover is ready
      if (!zkProver.isReady) {
        throw new Error('ZK prover is loading. Please wait...');
      }

      const metadata = JSON.stringify({
        description: formData.description,
        docsUrl: formData.docsUrl,
        twitterUrl: formData.twitterUrl,
      });
      const metadataHash = keccak256(toBytes(metadata));

      const params = {
        name: formData.name,
        symbol: formData.symbol.toUpperCase(),
        metadataHash: metadataHash as `0x${string}`,
        totalSupply: parseEther(formData.totalSupply),
        feeBps: BigInt(formData.feeBps),
        deployerBps: BigInt(formData.deployerBps),
      };

      const pledgeAmount = parseEther(formData.pledgeAmount);

      // Find a commitment with secrets that has enough balance for the pledge
      const commitmentsWithSecrets = commitments.filter(
        c => !c.spent && c.nullifier && c.secret && BigInt(c.amount) >= pledgeAmount
      );

      if (commitmentsWithSecrets.length === 0) {
        // Check total balance for better error message
        const totalBalance = commitments
          .filter(c => !c.spent)
          .reduce((sum, c) => sum + BigInt(c.amount), 0n);

        if (totalBalance < pledgeAmount) {
          throw new Error(`Insufficient balance. You need at least ${formData.pledgeAmount} $ROOT to create a proposal.`);
        } else {
          throw new Error('No single commitment has enough balance. Please consolidate your balance first.');
        }
      }

      // Use the first suitable commitment
      const selectedCommitment = commitmentsWithSecrets[0];
      console.log('[ProjectsPanel] Using commitment at leafIndex', selectedCommitment.leafIndex);

      // Fetch all on-chain commitments for merkle tree
      if (!fetchAllOnChainCommitments) {
        throw new Error('fetchAllOnChainCommitments not available');
      }

      console.log('[ProjectsPanel] Fetching all on-chain commitments for merkle tree...');
      const { commitments: allCommitments, treeState } = await fetchAllOnChainCommitments();
      console.log(`[ProjectsPanel] Got ${allCommitments.length} commitments for merkle tree`);

      // Generate real ZK pledge proof
      console.log('[ProjectsPanel] Generating real ZK pledge proof...');
      const proofResult = await zkProver.generatePledgeProof({
        commitment: {
          nullifier: BigInt(selectedCommitment.nullifier!),
          secret: BigInt(selectedCommitment.secret!),
          amount: BigInt(selectedCommitment.amount),
          leafIndex: selectedCommitment.leafIndex,
        },
        pledgeAmount,
        creator: address,
        allCommitments,
        treeState,
      });

      console.log('[ProjectsPanel] Proof generated successfully');
      console.log('[ProjectsPanel] Merkle root:', proofResult.merkleRoot.toString().slice(0, 20) + '...');
      console.log('[ProjectsPanel] Nullifier hash:', proofResult.nullifierHash.toString().slice(0, 20) + '...');
      console.log('[ProjectsPanel] Public inputs binding:', proofResult.publicInputsBinding.toString().slice(0, 20) + '...');

      // Format proof for contract (8 bigints)
      const proof = proofResult.proof as [bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint];

      const hash = await walletClient.writeContract({
        address: launchpadAddress as `0x${string}`,
        abi: LAUNCHPAD_ABI,
        functionName: 'createProposal',
        args: [params, proof, proofResult.merkleRoot, proofResult.nullifierHash, pledgeAmount, proofResult.publicInputsBinding],
      });

      setTxHash(hash);
      await publicClient.waitForTransactionReceipt({ hash });

      setFormData({
        name: '',
        symbol: '',
        description: '',
        docsUrl: '',
        twitterUrl: '',
        totalSupply: '10000000',
        feeBps: '50',
        deployerBps: '0',
        pledgeAmount: '100000',
      });
      setActiveTab('proposals');
    } catch (err: unknown) {
      const error = err as Error;
      console.error('Create proposal failed:', error);
      setError(error.message || 'Failed to create proposal');
    } finally {
      setIsLoading(false);
    }
  };

  const handleVote = async (support: boolean) => {
    if (!walletClient || !publicClient || !voteModal || !voteAmount) return;

    setIsLoading(true);
    setError(null);

    try {
      // Check if ZK prover is ready
      if (!zkProver.isReady) {
        throw new Error('ZK prover is loading. Please wait...');
      }

      const weight = parseEther(voteAmount);

      // Find a commitment with secrets that has enough balance for the vote
      const commitmentsWithSecrets = commitments.filter(
        c => !c.spent && c.nullifier && c.secret && BigInt(c.amount) >= weight
      );

      if (commitmentsWithSecrets.length === 0) {
        // Check total balance for better error message
        const totalBalance = commitments
          .filter(c => !c.spent)
          .reduce((sum, c) => sum + BigInt(c.amount), 0n);

        if (totalBalance < weight) {
          throw new Error(`Insufficient balance. You need at least ${voteAmount} $ROOT to vote.`);
        } else {
          throw new Error('No single commitment has enough balance. Please consolidate your balance first.');
        }
      }

      // Use the first suitable commitment
      const selectedCommitment = commitmentsWithSecrets[0];
      console.log('[ProjectsPanel] Using commitment at leafIndex', selectedCommitment.leafIndex, 'for vote');

      // Fetch all on-chain commitments for merkle tree
      if (!fetchAllOnChainCommitments) {
        throw new Error('fetchAllOnChainCommitments not available');
      }

      console.log('[ProjectsPanel] Fetching all on-chain commitments for vote merkle tree...');
      const { commitments: allCommitments, treeState } = await fetchAllOnChainCommitments();
      console.log(`[ProjectsPanel] Got ${allCommitments.length} commitments for vote merkle tree`);

      // Generate real ZK vote proof
      console.log('[ProjectsPanel] Generating real ZK vote proof...');
      const proofResult = await zkProver.generateVoteProof({
        commitment: {
          nullifier: BigInt(selectedCommitment.nullifier!),
          secret: BigInt(selectedCommitment.secret!),
          amount: BigInt(selectedCommitment.amount),
          leafIndex: selectedCommitment.leafIndex,
        },
        proposalId: BigInt(voteModal.proposalId),
        voteWeight: weight,
        support,
        allCommitments,
        treeState,
      });

      console.log('[ProjectsPanel] Vote proof generated successfully');
      console.log('[ProjectsPanel] Merkle root:', proofResult.merkleRoot.toString().slice(0, 20) + '...');
      console.log('[ProjectsPanel] Nullifier hash:', proofResult.nullifierHash.toString().slice(0, 20) + '...');

      // Format proof for contract (8 bigints)
      const proof = proofResult.proof as [bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint];

      const hash = await walletClient.writeContract({
        address: launchpadAddress as `0x${string}`,
        abi: LAUNCHPAD_ABI,
        functionName: 'votePrivate',
        args: [BigInt(voteModal.proposalId), proof, proofResult.merkleRoot, proofResult.nullifierHash, weight, support],
      });

      await publicClient.waitForTransactionReceipt({ hash });
      setVoteModal(null);
      setVoteAmount('');
    } catch (err: unknown) {
      const error = err as Error;
      console.error('Vote failed:', error);
      setError(error.message || 'Failed to vote');
    } finally {
      setIsLoading(false);
    }
  };

  const handleExecute = async (proposalId: number) => {
    if (!walletClient || !publicClient) return;

    setIsLoading(true);
    setError(null);

    try {
      const hash = await walletClient.writeContract({
        address: launchpadAddress as `0x${string}`,
        abi: LAUNCHPAD_ABI,
        functionName: 'executeProposal',
        args: [BigInt(proposalId)],
      });

      await publicClient.waitForTransactionReceipt({ hash });
    } catch (err: unknown) {
      const error = err as Error;
      console.error('Execute failed:', error);
      setError(error.message || 'Failed to execute proposal');
    } finally {
      setIsLoading(false);
    }
  };

  const handleCancel = async (proposalId: number) => {
    if (!walletClient || !publicClient) return;

    setIsLoading(true);
    setError(null);

    try {
      const hash = await walletClient.writeContract({
        address: launchpadAddress as `0x${string}`,
        abi: LAUNCHPAD_ABI,
        functionName: 'cancelProposal',
        args: [BigInt(proposalId)],
      });

      await publicClient.waitForTransactionReceipt({ hash });
    } catch (err: unknown) {
      const error = err as Error;
      console.error('Cancel failed:', error);
      setError(error.message || 'Failed to cancel proposal');
    } finally {
      setIsLoading(false);
    }
  };

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
            className="p-3 rounded-xl text-sm bg-[var(--error)]20 border border-[var(--error)]40 text-[var(--error)]"
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
            className="p-3 rounded-xl text-sm bg-[var(--success)]20 border border-[var(--success)]40 text-[var(--success)]"
          >
            Transaction submitted!{' '}
            <a
              href={`https://basescan.org/tx/${txHash}`}
              target="_blank"
              rel="noopener noreferrer"
              className="underline"
            >
              View on BaseScan
            </a>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Active Proposals Tab */}
      <AnimatePresence mode="wait">
        {activeTab === 'proposals' && (
          <motion.div
            key="proposals"
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 20 }}
            transition={{ duration: 0.3 }}
            className="space-y-4"
          >
            {proposals.length === 0 ? (
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
                <GlowButton onClick={() => setActiveTab('create')} variant="primary" size="sm">
                  create_first()
                </GlowButton>
              </motion.div>
            ) : (
              proposals.map((proposal, index) => (
                <ProposalCard
                  key={proposal.id}
                  proposal={proposal}
                  onVote={(id, support) => setVoteModal({ proposalId: id, support })}
                  onExecute={handleExecute}
                  onCancel={handleCancel}
                  viewingKey={viewingKey}
                  address={address}
                  isLoading={isLoading}
                  index={index}
                />
              ))
            )}
          </motion.div>
        )}

        {/* Live Projects Tab */}
        {activeTab === 'live' && (
          <motion.div
            key="live"
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 20 }}
            transition={{ duration: 0.3 }}
            className="space-y-4"
          >
            {liveProjects.length === 0 ? (
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
            ) : (
              liveProjects.map((ammAddress, idx) => {
                const proposal = proposals.find((p) => p.ammAddress === ammAddress);
                return (
                  <motion.button
                    key={ammAddress}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.4, delay: idx * 0.1 }}
                    whileHover={{ y: -4, scale: 1.01 }}
                    onClick={() =>
                      setSelectedProject({
                        name: proposal?.name || `Project ${idx + 1}`,
                        symbol: proposal?.symbol || 'TOKEN',
                        ammAddress,
                        totalSupply: proposal?.totalSupply,
                        feeBps: proposal?.feeBps,
                      })
                    }
                    className="w-full rounded-lg p-5 bg-[var(--bg-secondary)] border border-[var(--border)] hover:border-[var(--border-focus)] transition-all duration-300 text-left"
                  >
                    <div className="flex justify-between items-center">
                      <div>
                        <h3 className="font-semibold text-[var(--text-primary)]">
                          {proposal?.name || `Project ${idx + 1}`}
                        </h3>
                        <p className="text-sm text-[var(--text-muted)] font-mono">
                          ${proposal?.symbol || 'TOKEN'}
                        </p>
                      </div>
                      <div className="flex items-center gap-3">
                        <StatusBadge status={ProposalStatus.Executed} />
                        <motion.svg
                          whileHover={{ x: 3 }}
                          className="w-5 h-5 text-[var(--text-muted)]"
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                        </motion.svg>
                      </div>
                    </div>
                  </motion.button>
                );
              })
            )}
          </motion.div>
        )}

        {/* Create Proposal Tab */}
        {activeTab === 'create' && (
          <motion.div
            key="create"
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 20 }}
            transition={{ duration: 0.3 }}
            className="space-y-4"
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
              <>
                {/* World ID Verification Gate */}
                {worldIdEnabled && !worldIdVerified && (
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="p-5 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border)]"
                  >
                    <div className="flex items-center gap-3 mb-3">
                      <div className="w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold"
                        style={{ background: 'var(--glow-secondary)', color: 'var(--bg-primary)' }}>
                        ID
                      </div>
                      <div>
                        <h3 className="font-semibold text-[var(--text-primary)]">Verify Your Humanity</h3>
                        <p className="text-xs text-[var(--text-muted)] font-mono">
                          // world_id_required
                        </p>
                      </div>
                    </div>

                    <p className="text-sm text-[var(--text-secondary)] mb-4">
                      To create a regeneration proposal, verify you are a unique human via World ID.
                      This prevents sybil attacks while preserving your privacy.
                    </p>

                    {worldIdError && (
                      <div className="p-2 rounded-lg text-xs mb-3"
                        style={{ background: 'var(--error)', opacity: 0.2, color: 'var(--error)' }}>
                        {worldIdError}
                      </div>
                    )}

                    {worldIdPending ? (
                      <div className="flex items-center gap-2 text-sm text-[var(--text-muted)] font-mono">
                        <motion.div
                          animate={{ rotate: 360 }}
                          transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
                          className="w-4 h-4 border-2 border-current border-t-transparent rounded-full"
                        />
                        // awaiting_cre_verification...
                      </div>
                    ) : (
                      <IDKitWidget
                        app_id={WORLD_ID_APP_ID as `app_${string}`}
                        action={WORLD_ID_ACTION}
                        verification_level={VerificationLevel.Orb}
                        onSuccess={handleWorldIdSuccess}
                      >
                        {({ open }: { open: () => void }) => (
                          <GlowButton onClick={open} variant="primary" size="sm" className="w-full">
                            verify_with_world_id()
                          </GlowButton>
                        )}
                      </IDKitWidget>
                    )}
                  </motion.div>
                )}

                {/* World ID Verified Badge */}
                {worldIdEnabled && worldIdVerified && (
                  <motion.div
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="p-3 rounded-lg flex items-center gap-2"
                    style={{
                      background: 'var(--success)',
                      opacity: 0.15,
                      border: '1px solid var(--success)',
                    }}
                  >
                    <span className="text-sm font-mono" style={{ color: 'var(--success)' }}>
                      // verified_human
                    </span>
                  </motion.div>
                )}

                {/* Project Name */}
                <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0 }}>
                  <p className="text-xs font-mono text-[var(--text-muted)] mb-1.5">
                    <span className="text-[var(--accent)] opacity-60">// </span>
                    project_name
                  </p>
                  <input
                    type="text"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    placeholder="e.g., Cactus"
                    className="w-full px-4 py-3 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--border-focus)] focus:outline-none transition-colors"
                  />
                </motion.div>

                {/* Symbol */}
                <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}>
                  <p className="text-xs font-mono text-[var(--text-muted)] mb-1.5">
                    <span className="text-[var(--accent)] opacity-60">// </span>
                    symbol
                  </p>
                  <input
                    type="text"
                    value={formData.symbol}
                    onChange={(e) => setFormData({ ...formData, symbol: e.target.value.toUpperCase() })}
                    placeholder="e.g., CACTUS"
                    maxLength={10}
                    className="w-full px-4 py-3 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--border-focus)] focus:outline-none transition-colors font-mono"
                  />
                </motion.div>

                {/* Description */}
                <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
                  <p className="text-xs font-mono text-[var(--text-muted)] mb-1.5">
                    <span className="text-[var(--accent)] opacity-60">// </span>
                    description
                  </p>
                  <textarea
                    value={formData.description}
                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                    placeholder="Describe your ReFi/RWA project..."
                    rows={3}
                    className="w-full px-4 py-3 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--border-focus)] focus:outline-none transition-colors resize-none"
                  />
                </motion.div>

                {/* URLs */}
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.15 }}
                  className="grid grid-cols-2 gap-4"
                >
                  <div>
                    <p className="text-xs font-mono text-[var(--text-muted)] mb-1.5">
                      <span className="text-[var(--accent)] opacity-60">// </span>
                      docs_url
                    </p>
                    <input
                      type="url"
                      value={formData.docsUrl}
                      onChange={(e) => setFormData({ ...formData, docsUrl: e.target.value })}
                      placeholder="https://docs.example.com"
                      className="w-full px-4 py-3 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--border-focus)] focus:outline-none transition-colors text-sm"
                    />
                  </div>
                  <div>
                    <p className="text-xs font-mono text-[var(--text-muted)] mb-1.5">
                      <span className="text-[var(--accent)] opacity-60">// </span>
                      twitter_url
                    </p>
                    <input
                      type="url"
                      value={formData.twitterUrl}
                      onChange={(e) => setFormData({ ...formData, twitterUrl: e.target.value })}
                      placeholder="https://x.com/project"
                      className="w-full px-4 py-3 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--border-focus)] focus:outline-none transition-colors text-sm"
                    />
                  </div>
                </motion.div>

                {/* Tokenomics */}
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.2 }}
                  className="grid grid-cols-2 gap-4"
                >
                  <div>
                    <p className="text-xs font-mono text-[var(--text-muted)] mb-1.5">
                      <span className="text-[var(--accent)] opacity-60">// </span>
                      total_supply
                    </p>
                    <input
                      type="number"
                      value={formData.totalSupply}
                      onChange={(e) => setFormData({ ...formData, totalSupply: e.target.value })}
                      className="w-full px-4 py-3 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border)] text-[var(--text-primary)] focus:border-[var(--border-focus)] focus:outline-none transition-colors"
                    />
                  </div>
                  <div>
                    <p className="text-xs font-mono text-[var(--text-muted)] mb-1.5">
                      <span className="text-[var(--accent)] opacity-60">// </span>
                      fee_bps
                    </p>
                    <input
                      type="number"
                      value={formData.feeBps}
                      onChange={(e) => setFormData({ ...formData, feeBps: e.target.value })}
                      max={1000}
                      className="w-full px-4 py-3 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border)] text-[var(--text-primary)] focus:border-[var(--border-focus)] focus:outline-none transition-colors"
                    />
                    <p className="text-xs text-[var(--text-muted)] mt-1 font-mono">
                      // {Number(formData.feeBps) / 100}% fee per swap
                    </p>
                  </div>
                </motion.div>

                {/* Deployer Allocation */}
                <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.22 }}>
                  <p className="text-xs font-mono text-[var(--text-muted)] mb-1.5">
                    <span className="text-[var(--accent)] opacity-60">// </span>
                    deployer_bps (optional)
                  </p>
                  <input
                    type="number"
                    value={formData.deployerBps}
                    onChange={(e) => setFormData({ ...formData, deployerBps: e.target.value })}
                    max={500}
                    placeholder="0"
                    className="w-full px-4 py-3 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--border-focus)] focus:outline-none transition-colors"
                  />
                  <p className="text-xs text-[var(--text-muted)] mt-1 font-mono">
                    // {Number(formData.deployerBps) / 100}% to deployer (max 5%)
                  </p>
                </motion.div>

                {/* Pledge Amount */}
                <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25 }}>
                  <p className="text-xs font-mono text-[var(--text-muted)] mb-1.5">
                    <span className="text-[var(--accent)] opacity-60">// </span>
                    pledge_amount
                  </p>
                  <input
                    type="number"
                    value={formData.pledgeAmount}
                    onChange={(e) => setFormData({ ...formData, pledgeAmount: e.target.value })}
                    className="w-full px-4 py-3 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border)] text-[var(--text-primary)] focus:border-[var(--border-focus)] focus:outline-none transition-colors"
                  />
                  <p className="text-xs text-[var(--text-muted)] mt-1 font-mono">
                    // locked as initial LP — returned minus 0.03% if rejected
                  </p>
                </motion.div>

                {/* Current Balance */}
                {viewingKey && (
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.3 }}
                    className="p-4 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border)]"
                  >
                    <p className="text-xs font-mono text-[var(--text-muted)] mb-1">
                      <span className="text-[var(--accent)] opacity-60">// </span>
                      your_balance
                    </p>
                    <div className="font-medium text-[var(--text-primary)]">
                      {Number(formatUnits(hiddenBalance, 18)).toLocaleString()} $ROOT
                    </div>
                  </motion.div>
                )}

                {/* Submit */}
                <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.35 }}>
                  <GlowButton
                    onClick={handleCreateProposal}
                    disabled={isLoading || !formData.name || !formData.symbol || !formData.pledgeAmount || (worldIdEnabled && !worldIdVerified)}
                    variant="primary"
                    size="lg"
                    loading={isLoading}
                    className="w-full"
                  >
                    {worldIdEnabled && !worldIdVerified ? 'world_id_required()' : 'create_proposal()'}
                  </GlowButton>
                </motion.div>

                <motion.p
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.4 }}
                  className="text-xs text-[var(--text-muted)] text-center font-mono"
                >
                  // 7-day voting period • 1M $ROOT quorum • private votes
                </motion.p>
              </>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Vote Modal */}
      <AnimatePresence>
        {voteModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50"
            onClick={() => setVoteModal(null)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              transition={{ type: 'spring', damping: 20 }}
              onClick={(e) => e.stopPropagation()}
              className="max-w-md w-full mx-4 rounded-lg p-6 bg-[var(--bg-elevated)] border border-[var(--border-default)]"
            >
              <p className="text-xs font-mono text-[var(--text-muted)] mb-2">
                <span className="text-[var(--accent)] opacity-60">// </span>
                vote
              </p>
              <h3 className="text-xl font-semibold mb-4 text-[var(--text-primary)]">
                {voteModal.support ? 'vote_for()' : 'vote_against()'}
              </h3>

              <div className="mb-4">
                <p className="text-xs font-mono text-[var(--text-muted)] mb-1.5">
                  <span className="text-[var(--accent)] opacity-60">// </span>
                  weight
                </p>
                <input
                  type="number"
                  value={voteAmount}
                  onChange={(e) => setVoteAmount(e.target.value)}
                  placeholder="Amount of $ROOT to vote with"
                  className="w-full px-4 py-3 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--border-focus)] focus:outline-none transition-colors"
                />
                <p className="text-xs text-[var(--text-muted)] mt-2 font-mono">
                  // your vote is private — nobody can see who voted or how much
                </p>
              </div>

              <div className="flex gap-3">
                <GlowButton onClick={() => setVoteModal(null)} variant="ghost" className="flex-1">
                  cancel()
                </GlowButton>
                <GlowButton
                  onClick={() => handleVote(voteModal.support)}
                  disabled={isLoading || !voteAmount}
                  loading={isLoading}
                  variant={voteModal.support ? 'primary' : 'danger'}
                  className="flex-1"
                >
                  confirm()
                </GlowButton>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Project Detail Modal */}
      {selectedProject && (
        <ProjectDetailModal
          project={selectedProject}
          onClose={() => setSelectedProject(null)}
          onTrade={(ammAddress) => {
            setSelectedProject(null);
            onTradeProject?.(ammAddress, selectedProject.name, selectedProject.symbol);
          }}
        />
      )}
    </div>
  );
}
