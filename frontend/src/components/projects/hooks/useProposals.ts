import { useState, useEffect, useCallback } from 'react';
import { usePublicClient, useWalletClient } from 'wagmi';
import { parseEther } from 'viem';
import { usePageVisibility } from '../../../hooks/usePageVisibility';
import { useZkProver } from '../../../hooks/useZkProver';
import type { Proposal, CommitmentsResult, WalletCommitment } from '../types';
import { LAUNCHPAD_ABI } from '../constants';

interface UseProposalsParams {
  launchpadAddress: string;
  commitments: WalletCommitment[];
  fetchAllOnChainCommitments?: () => Promise<CommitmentsResult>;
}

export function useProposals({ launchpadAddress, commitments, fetchAllOnChainCommitments }: UseProposalsParams) {
  const publicClient = usePublicClient();
  const { data: walletClient } = useWalletClient();
  const isPageVisible = usePageVisibility();
  const zkProver = useZkProver();

  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [liveProjects, setLiveProjects] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);

  // Fetch proposals and live projects
  useEffect(() => {
    console.log('[useProposals] Guard check:', { hasClient: !!publicClient, launchpadAddress });
    if (!publicClient || !launchpadAddress || launchpadAddress === '0x...') return;

    const fetchData = async () => {
      try {
        console.log('[useProposals] Fetching from launchpad:', launchpadAddress);
        const [count, liveCount] = await Promise.all([
          publicClient.readContract({
            address: launchpadAddress as `0x${string}`,
            abi: LAUNCHPAD_ABI,
            functionName: 'proposalCount',
          }),
          publicClient.readContract({
            address: launchpadAddress as `0x${string}`,
            abi: LAUNCHPAD_ABI,
            functionName: 'getLiveProjectCount',
          }),
        ]);

        console.log('[useProposals] proposalCount:', Number(count), 'liveProjectCount:', Number(liveCount));

        // Fetch each deployed AMM address by index
        const liveAddrs: string[] = [];
        const ammPromises = [];
        for (let i = 0; i < Number(liveCount); i++) {
          ammPromises.push(
            publicClient.readContract({
              address: launchpadAddress as `0x${string}`,
              abi: LAUNCHPAD_ABI,
              functionName: 'deployedAMMs',
              args: [BigInt(i)],
            })
          );
        }
        const ammResults = await Promise.all(ammPromises);
        for (const addr of ammResults) {
          liveAddrs.push(addr as string);
        }

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

        console.log('[useProposals] Success:', formattedProposals.length, 'proposals,', liveAddrs.length, 'live projects', liveAddrs);
        setProposals(formattedProposals);
        setLiveProjects(liveAddrs);
      } catch (err) {
        console.error('[useProposals] Failed to fetch launchpad data:', err);
      }
    };

    fetchData();

    if (!isPageVisible) return;

    const interval = window.setInterval(fetchData, 60000);
    return () => window.clearInterval(interval);
  }, [publicClient, launchpadAddress, isPageVisible]);

  const handleVote = useCallback(async (proposalId: number, support: boolean, voteAmount: string) => {
    if (!walletClient || !publicClient) return;

    setIsLoading(true);
    setError(null);

    try {
      if (!zkProver.isReady) {
        throw new Error('ZK prover is loading. Please wait...');
      }

      const weight = parseEther(voteAmount);

      const commitmentsWithSecrets = commitments.filter(
        c => !c.spent && c.nullifier && c.secret && BigInt(c.amount) >= weight
      );

      if (commitmentsWithSecrets.length === 0) {
        const totalBalance = commitments
          .filter(c => !c.spent)
          .reduce((sum, c) => sum + BigInt(c.amount), 0n);

        if (totalBalance < weight) {
          throw new Error(`Insufficient balance. You need at least ${voteAmount} $ROOT to vote.`);
        } else {
          throw new Error('No single commitment has enough balance. Please consolidate your balance first.');
        }
      }

      const selectedCommitment = commitmentsWithSecrets[0];

      if (!fetchAllOnChainCommitments) {
        throw new Error('fetchAllOnChainCommitments not available');
      }

      const { commitments: allCommitments, treeState } = await fetchAllOnChainCommitments();

      const proofResult = await zkProver.generateVoteProof({
        commitment: {
          nullifier: BigInt(selectedCommitment.nullifier!),
          secret: BigInt(selectedCommitment.secret!),
          amount: BigInt(selectedCommitment.amount),
          leafIndex: selectedCommitment.leafIndex,
        },
        proposalId: BigInt(proposalId),
        voteWeight: weight,
        support,
        allCommitments,
        treeState,
      });

      const proof = proofResult.proof as [bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint];

      const hash = await walletClient.writeContract({
        address: launchpadAddress as `0x${string}`,
        abi: LAUNCHPAD_ABI,
        functionName: 'votePrivate',
        args: [BigInt(proposalId), proof, proofResult.merkleRoot, proofResult.nullifierHash, weight, support],
      });

      await publicClient.waitForTransactionReceipt({ hash });
    } catch (err: unknown) {
      const error = err as Error;
      console.error('Vote failed:', error);
      setError(error.message || 'Failed to vote');
    } finally {
      setIsLoading(false);
    }
  }, [walletClient, publicClient, zkProver, commitments, fetchAllOnChainCommitments, launchpadAddress]);

  const handleExecute = useCallback(async (proposalId: number) => {
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
  }, [walletClient, publicClient, launchpadAddress]);

  const handleCancel = useCallback(async (proposalId: number) => {
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
  }, [walletClient, publicClient, launchpadAddress]);

  const clearError = useCallback(() => setError(null), []);
  const clearTxHash = useCallback(() => setTxHash(null), []);

  return {
    proposals,
    liveProjects,
    isLoading,
    error,
    txHash,
    setTxHash,
    setIsLoading,
    setError,
    zkProver,
    handleVote,
    handleExecute,
    handleCancel,
    clearError,
    clearTxHash,
  };
}
