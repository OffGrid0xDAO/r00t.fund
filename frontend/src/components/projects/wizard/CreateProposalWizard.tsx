import { useState, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAccount, usePublicClient, useWalletClient } from 'wagmi';
import { parseEther, keccak256, toBytes } from 'viem';
import { GlowButton } from '../../ui/GlowButton';
import { WizardStepper } from './WizardStepper';
import { StepWorldId } from './StepWorldId';
import { StepProjectDetails } from './StepProjectDetails';
import { StepEnvironmentalData } from './StepEnvironmentalData';
import { StepTokenomics } from './StepTokenomics';
import { StepReview } from './StepReview';
import { useWizardState, validateStep } from './useWizardState';
import type { WalletCommitment, CommitmentsResult, ProposalMetadata, TabType } from '../types';
import { LAUNCHPAD_ABI } from '../constants';
import type { ISuccessResult } from '@worldcoin/idkit';
import { useZkProver } from '../../../hooks/useZkProver';

interface CreateProposalWizardProps {
  launchpadAddress: string;
  viewingKey: string | null;
  hiddenBalance: bigint;
  commitments: WalletCommitment[];
  fetchAllOnChainCommitments?: () => Promise<CommitmentsResult>;
  worldIdEnabled: boolean;
  worldIdVerified: boolean;
  worldIdPending: boolean;
  worldIdError: string | null;
  onWorldIdSuccess: (result: ISuccessResult) => void;
  onSuccess: (txHash: string) => void;
  onTabChange: (tab: TabType) => void;
  setIsLoading: (v: boolean) => void;
  setError: (v: string | null) => void;
  isLoading: boolean;
}

export function CreateProposalWizard({
  launchpadAddress,
  viewingKey,
  hiddenBalance,
  commitments,
  fetchAllOnChainCommitments,
  worldIdEnabled,
  worldIdVerified,
  worldIdPending,
  worldIdError,
  onWorldIdSuccess,
  onSuccess,
  onTabChange,
  setIsLoading,
  setError,
  isLoading,
}: CreateProposalWizardProps) {
  const { address } = useAccount();
  const publicClient = usePublicClient();
  const { data: walletClient } = useWalletClient();
  const zkProver = useZkProver();

  const wizard = useWizardState();
  const [direction, setDirection] = useState(0); // -1 = back, 1 = forward

  const completedSteps = useMemo(() => {
    const set = new Set<number>();
    // Step 0 is complete if World ID is verified or not enabled
    if (!worldIdEnabled || worldIdVerified) set.add(0);
    // Mark steps < current as completed if they were visited
    for (let i = 0; i < wizard.currentStep; i++) {
      const errors = validateStep(i as 0|1|2|3|4, wizard.formData, worldIdVerified, worldIdEnabled);
      if (errors.length === 0) set.add(i);
    }
    return set;
  }, [wizard.currentStep, wizard.formData, worldIdVerified, worldIdEnabled]);

  const handleNext = useCallback(() => {
    const errors = validateStep(wizard.currentStep, wizard.formData, worldIdVerified, worldIdEnabled);
    if (errors.length > 0) {
      wizard.setErrors(wizard.currentStep, errors);
      return;
    }
    wizard.setErrors(wizard.currentStep, []);
    setDirection(1);
    wizard.nextStep();
  }, [wizard, worldIdVerified, worldIdEnabled]);

  const handlePrev = useCallback(() => {
    setDirection(-1);
    wizard.prevStep();
  }, [wizard]);

  const handleSubmit = useCallback(async () => {
    if (!walletClient || !publicClient || !address) return;

    setIsLoading(true);
    setError(null);

    try {
      if (!zkProver.isReady) {
        throw new Error('ZK prover is loading. Please wait...');
      }

      // Build v2 metadata with environmental data
      const metadata: ProposalMetadata = {
        version: 2,
        description: wizard.formData.description,
        docsUrl: wizard.formData.docsUrl,
        twitterUrl: wizard.formData.twitterUrl,
        coverImageUrl: wizard.formData.coverImageUrl,
        environmental: wizard.formData.environmental,
        createdAt: Date.now(),
      };

      const metadataJson = JSON.stringify(metadata);
      const metadataHash = keccak256(toBytes(metadataJson));

      // Store metadata in localStorage keyed by hash
      try {
        localStorage.setItem(`r00t_metadata_${metadataHash}`, metadataJson);
      } catch {
        console.warn('Failed to store metadata in localStorage');
      }

      const params = {
        name: wizard.formData.name,
        symbol: wizard.formData.symbol.toUpperCase(),
        metadataHash: metadataHash as `0x${string}`,
        totalSupply: parseEther(wizard.formData.totalSupply),
        feeBps: BigInt(wizard.formData.feeBps),
        deployerBps: BigInt(wizard.formData.deployerBps),
      };

      const pledgeAmount = parseEther(wizard.formData.pledgeAmount);

      const commitmentsWithSecrets = commitments.filter(
        c => !c.spent && c.nullifier && c.secret && BigInt(c.amount) >= pledgeAmount
      );

      if (commitmentsWithSecrets.length === 0) {
        const totalBalance = commitments
          .filter(c => !c.spent)
          .reduce((sum, c) => sum + BigInt(c.amount), 0n);

        if (totalBalance < pledgeAmount) {
          throw new Error(`Insufficient balance. You need at least ${wizard.formData.pledgeAmount} $ROOT to create a proposal.`);
        } else {
          throw new Error('No single commitment has enough balance. Please consolidate your balance first.');
        }
      }

      const selectedCommitment = commitmentsWithSecrets[0];

      if (!fetchAllOnChainCommitments) {
        throw new Error('fetchAllOnChainCommitments not available');
      }

      const { commitments: allCommitments, treeState } = await fetchAllOnChainCommitments();

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

      const proof = proofResult.proof as [bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint];

      const hash = await walletClient.writeContract({
        address: launchpadAddress as `0x${string}`,
        abi: LAUNCHPAD_ABI,
        functionName: 'createProposal',
        args: [params, proof, proofResult.merkleRoot, proofResult.nullifierHash, pledgeAmount, proofResult.publicInputsBinding],
      });

      await publicClient.waitForTransactionReceipt({ hash });

      onSuccess(hash);
      wizard.reset();
      onTabChange('proposals');
    } catch (err: unknown) {
      const error = err as Error;
      console.error('Create proposal failed:', error);
      setError(error.message || 'Failed to create proposal');
    } finally {
      setIsLoading(false);
    }
  }, [walletClient, publicClient, address, zkProver, wizard, commitments, fetchAllOnChainCommitments, launchpadAddress, onSuccess, onTabChange, setIsLoading, setError]);

  const variants = {
    enter: (d: number) => ({ x: d > 0 ? 40 : -40, opacity: 0 }),
    center: { x: 0, opacity: 1 },
    exit: (d: number) => ({ x: d > 0 ? -40 : 40, opacity: 0 }),
  };

  const currentErrors = wizard.stepErrors[wizard.currentStep] || [];

  return (
    <div className="space-y-4">
      <WizardStepper
        currentStep={wizard.currentStep}
        onStepClick={(step) => {
          setDirection(step > wizard.currentStep ? 1 : -1);
          wizard.goToStep(step);
        }}
        completedSteps={completedSteps}
      />

      <AnimatePresence mode="wait" custom={direction}>
        <motion.div
          key={wizard.currentStep}
          custom={direction}
          variants={variants}
          initial="enter"
          animate="center"
          exit="exit"
          transition={{ duration: 0.25, ease: 'easeInOut' }}
        >
          {wizard.currentStep === 0 && (
            <StepWorldId
              worldIdEnabled={worldIdEnabled}
              worldIdVerified={worldIdVerified}
              worldIdPending={worldIdPending}
              worldIdError={worldIdError}
              onWorldIdSuccess={onWorldIdSuccess}
              walletAddress={address}
            />
          )}
          {wizard.currentStep === 1 && (
            <StepProjectDetails
              formData={wizard.formData}
              onUpdateField={wizard.updateField}
              errors={currentErrors}
            />
          )}
          {wizard.currentStep === 2 && (
            <StepEnvironmentalData
              formData={wizard.formData}
              onUpdateEnvironmental={wizard.updateEnvironmental}
              onSetSpecies={wizard.setSpecies}
              onAddSpecies={wizard.addSpecies}
              onRemoveSpecies={wizard.removeSpecies}
              onUpdateSpecies={wizard.updateSpecies}
              errors={currentErrors}
            />
          )}
          {wizard.currentStep === 3 && (
            <StepTokenomics
              formData={wizard.formData}
              onUpdateField={wizard.updateField}
              errors={currentErrors}
              viewingKey={viewingKey}
              hiddenBalance={hiddenBalance}
            />
          )}
          {wizard.currentStep === 4 && (
            <StepReview formData={wizard.formData} />
          )}
        </motion.div>
      </AnimatePresence>

      {/* Navigation buttons */}
      <div className="flex gap-3 pt-2">
        {wizard.currentStep > 0 && (
          <GlowButton onClick={handlePrev} variant="ghost" className="flex-1">
            ← prev
          </GlowButton>
        )}
        {wizard.currentStep < 4 ? (
          <GlowButton
            onClick={handleNext}
            variant="primary"
            className="flex-1"
            disabled={wizard.currentStep === 0 && worldIdEnabled && !worldIdVerified}
          >
            next →
          </GlowButton>
        ) : (
          <GlowButton
            onClick={handleSubmit}
            variant="primary"
            size="lg"
            loading={isLoading}
            disabled={isLoading || (worldIdEnabled && !worldIdVerified)}
            className="flex-1"
          >
            create_proposal()
          </GlowButton>
        )}
      </div>
    </div>
  );
}
