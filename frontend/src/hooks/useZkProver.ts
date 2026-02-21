import { useState, useCallback, useEffect, useRef } from 'react';
import {
  Prover,
  loadCircuitArtifactsFromUrls,
  hashCommitment,
  hashNullifier,
  hashClaimNullifier,
  MerkleTree,
  randomFieldElement,
} from '@r00t-fund/sdk';

// Circuit artifacts base URL (from public folder)
const CIRCUITS_BASE_URL = '/circuits';

interface ProverState {
  isLoading: boolean;
  isReady: boolean;
  error: string | null;
}

// Pre-computed tree state from Ponder indexer (avoids expensive hash recomputation)
interface TreeState {
  filledSubtrees: bigint[];
  root: bigint;
}

interface WithdrawProofParams {
  commitment: {
    nullifier: bigint;
    secret: bigint;
    amount: bigint;
    leafIndex: number;
  };
  recipient: string;
  allCommitments: { commitment: bigint; leafIndex: number }[];
  treeState?: TreeState;
}

interface SellProofParams {
  commitment: {
    nullifier: bigint;
    secret: bigint;
    amount: bigint;
    leafIndex: number;
  };
  tokenAmount: bigint;
  minEthOut: bigint;
  recipient: string;
  relayer: string;
  fee: bigint;
  allCommitments: { commitment: bigint; leafIndex: number }[];
  treeState?: TreeState;
}

interface AddLiquidityProofParams {
  commitment: {
    nullifier: bigint;
    secret: bigint;
    amount: bigint;
    leafIndex: number;
  };
  tokenAmount: bigint;
  lpShares: bigint;
  allCommitments: { commitment: bigint; leafIndex: number }[];
  treeState?: TreeState;
}

interface RemoveLiquidityProofParams {
  lpCommitment: {
    nullifier: bigint;
    secret: bigint;
    amount: bigint;
    leafIndex: number;
    commitment: bigint;
  };
  withdrawShares: bigint;
  minEthOut: bigint;
  recipient: string;
  tokensOut: bigint; // SECURITY FIX: Tokens to return (calculated from reserves)
  allLpCommitments: { commitment: bigint; leafIndex: number }[];
}

interface ClaimFeesProofParams {
  lpCommitment: {
    nullifier: bigint;
    secret: bigint;
    amount: bigint;
    leafIndex: number;
  };
  feeEpoch: bigint;
  recipient: string;
  allLpCommitments: { commitment: bigint; leafIndex: number }[];
}

interface SellProofResult {
  proof: bigint[];
  merkleRoot: bigint;
  nullifierHash: bigint;
  tokenAmount: bigint;
  minEthOut: bigint;
  recipient: string;
  relayer: string;
  fee: bigint;
  changeCommitment: bigint;
  changeNullifier: bigint;
  changeSecret: bigint;
  publicInputsBinding: bigint;
}

interface WithdrawProofResult {
  proof: bigint[];
  merkleRoot: bigint;
  nullifierHash: bigint;
  amount: bigint;
  recipient: string;
  recipientBinding: bigint;
}

interface TransferProofParams {
  commitment: {
    nullifier: bigint;
    secret: bigint;
    amount: bigint;
    leafIndex: number;
  };
  transferAmount: bigint;
  recipientNullifier: bigint;
  recipientSecret: bigint;
  allCommitments: { commitment: bigint; leafIndex: number }[];
  treeState?: TreeState;
}

interface TransferProofResult {
  proof: bigint[];
  merkleRoot: bigint;
  nullifierHash: bigint;
  recipientCommitment: bigint;
  changeCommitment: bigint;
  changeNullifier: bigint;
  changeSecret: bigint;
}

interface AddLiquidityProofResult {
  proof: bigint[];
  merkleRoot: bigint;
  nullifierHash: bigint;
  tokenAmount: bigint;
  lpCommitment: bigint;
  lpNullifier: bigint;
  lpSecret: bigint;
  changeCommitment: bigint;
  changeNullifier: bigint;
  changeSecret: bigint;
  publicInputsBinding: bigint;
}

interface RemoveLiquidityProofResult {
  proof: bigint[];
  merkleRoot: bigint;
  nullifierHash: bigint;
  commitment: bigint;
  withdrawShares: bigint;
  minEthOut: bigint;
  recipient: string;
  changeCommitment: bigint;
  changeNullifier: bigint;
  changeSecret: bigint;
  tokenCommitment: bigint;
  tokenNullifier: bigint;
  tokenSecret: bigint;
  tokensOut: bigint; // SECURITY FIX: Amount of tokens in the commitment
  publicInputsBinding: bigint;
}

interface ClaimFeesProofResult {
  proof: bigint[];
  lpMerkleRoot: bigint;
  claimNullifier: bigint;
  feeEpoch: bigint;
  lpShares: bigint;
  recipient: string;
  publicInputsBinding: bigint;
}

// Vote proof params for governance voting
interface VoteProofParams {
  commitment: {
    nullifier: bigint;
    secret: bigint;
    amount: bigint;
    leafIndex: number;
  };
  proposalId: bigint;
  voteWeight: bigint;
  support: boolean;
  allCommitments: { commitment: bigint; leafIndex: number }[];
  treeState?: TreeState;
}

interface VoteProofResult {
  proof: bigint[];
  merkleRoot: bigint;
  nullifierHash: bigint;
  voteWeight: bigint;
  support: boolean;
  voteBinding: bigint;
}

// Pledge proof params for proposal creation
interface PledgeProofParams {
  commitment: {
    nullifier: bigint;
    secret: bigint;
    amount: bigint;
    leafIndex: number;
  };
  pledgeAmount: bigint;
  creator: string; // msg.sender
  allCommitments: { commitment: bigint; leafIndex: number }[];
  treeState?: TreeState;
}

interface PledgeProofResult {
  proof: bigint[];
  merkleRoot: bigint;
  nullifierHash: bigint;
  pledgeAmount: bigint;
  creator: string;
  publicInputsBinding: bigint;
}

// Merge proof params for privacy-preserving commitment consolidation
interface MergeProofParams {
  commitment1: {
    nullifier: bigint;
    secret: bigint;
    amount: bigint;
    leafIndex: number;
  };
  commitment2: {
    nullifier: bigint;
    secret: bigint;
    amount: bigint;
    leafIndex: number;
  };
  allCommitments: { commitment: bigint; leafIndex: number }[];
  treeState?: TreeState;
}

interface MergeProofResult {
  proof: bigint[];
  merkleRoot: bigint;
  nullifierHash1: bigint;
  nullifierHash2: bigint;
  outputCommitment: bigint;
  outputNullifier: bigint;
  outputSecret: bigint;
  totalAmount: bigint;
  publicInputsBinding: bigint;
}

/**
 * Hook for generating ZK proofs in the browser
 */
export function useZkProver() {
  const [state, setState] = useState<ProverState>({
    isLoading: false,
    isReady: false,
    error: null,
  });

  const proverRef = useRef<Prover | null>(null);
  const loadingRef = useRef(false);

  // Load circuit artifacts on mount
  const loadProver = useCallback(async () => {
    if (proverRef.current || loadingRef.current) return;
    loadingRef.current = true;

    setState({ isLoading: true, isReady: false, error: null });

    try {
      console.log('[useZkProver] Loading circuit artifacts...');

      const artifacts = await loadCircuitArtifactsFromUrls(CIRCUITS_BASE_URL);

      proverRef.current = new Prover(artifacts);
      setState({ isLoading: false, isReady: true, error: null });

      console.log('[useZkProver] Prover ready');
    } catch (err) {
      console.error('[useZkProver] Failed to load prover:', err);
      setState({
        isLoading: false,
        isReady: false,
        error: (err as Error).message || 'Failed to load ZK prover',
      });
      loadingRef.current = false;
    }
  }, []);

  // Auto-load on mount
  useEffect(() => {
    loadProver();
  }, [loadProver]);

  /**
   * Generate withdraw proof
   */
  const generateWithdrawProof = useCallback(
    async (params: WithdrawProofParams): Promise<WithdrawProofResult> => {
      if (!proverRef.current) {
        throw new Error('Prover not ready');
      }

      const { commitment, recipient, allCommitments, treeState } = params;

      // Build merkle tree from all commitments
      const tree = new MerkleTree(24); // Must match contract's TREE_DEPTH

      if (treeState) {
        // FAST PATH: Use pre-computed tree state from Ponder indexer
        console.log(`[useZkProver] ⚡ FAST PATH (Withdraw): Using pre-built tree state`);
        const leaves = allCommitments.map(c => c.commitment);
        tree.loadState(leaves, treeState.filledSubtrees, treeState.root);
      } else {
        // SLOW PATH: Build tree from scratch
        for (const c of allCommitments) {
          tree.insertAt(c.leafIndex, c.commitment);
        }
      }

      // Get merkle proof for this commitment
      const merkleProof = tree.getProof(commitment.leafIndex);

      // Compute nullifier hash
      const nullifierHash = hashNullifier(commitment.nullifier, commitment.leafIndex);

      // Generate the proof
      const proofResult = await proverRef.current.proveWithdraw({
        merkleRoot: merkleProof.root,
        nullifierHash,
        amount: commitment.amount,
        recipient,
        nullifier: commitment.nullifier,
        secret: commitment.secret,
        pathElements: merkleProof.pathElements,
        pathIndices: merkleProof.pathIndices,
      });

      // Format proof for solidity
      const proof = Prover.formatProofForSolidity(proofResult.proof);

      // CRITICAL FIX: Circuit outputs recipientBinding at index 0 (output signal comes first)
      // Order: [recipientBinding, merkleRoot, nullifierHash, amount, recipient]
      const recipientBinding = BigInt(proofResult.publicSignals[0]);

      return {
        proof,
        merkleRoot: merkleProof.root,
        nullifierHash,
        amount: commitment.amount,
        recipient,
        recipientBinding,
      };
    },
    []
  );

  /**
   * Generate transfer proof for private-to-private transfers
   */
  const generateTransferProof = useCallback(
    async (params: TransferProofParams): Promise<TransferProofResult> => {
      if (!proverRef.current) {
        throw new Error('Prover not ready');
      }

      const { commitment, transferAmount, recipientNullifier, recipientSecret, allCommitments, treeState } = params;

      // Build merkle tree from all commitments
      const tree = new MerkleTree(24);

      if (treeState) {
        // FAST PATH: Use pre-computed tree state from Ponder indexer
        console.log(`[useZkProver] ⚡ FAST PATH (Transfer): Using pre-built tree state`);
        const leaves = allCommitments.map(c => c.commitment);
        tree.loadState(leaves, treeState.filledSubtrees, treeState.root);
      } else {
        // SLOW PATH: Build tree from scratch
        for (const c of allCommitments) {
          tree.insertAt(c.leafIndex, c.commitment);
        }
      }

      // Get merkle proof for this commitment
      const merkleProof = tree.getProof(commitment.leafIndex);

      // Compute nullifier hash
      const nullifierHash = hashNullifier(commitment.nullifier, commitment.leafIndex);

      // Calculate change amount
      const changeAmount = commitment.amount - transferAmount;

      // Generate change commitment secrets
      const changeNullifier = randomFieldElement();
      const changeSecret = randomFieldElement();

      // Compute commitments
      const recipientCommitment = hashCommitment(recipientNullifier, recipientSecret, transferAmount);
      const changeCommitment = changeAmount > 0n
        ? hashCommitment(changeNullifier, changeSecret, changeAmount)
        : 0n;

      // Verify input commitment matches what's in the tree
      const computedInputCommitment = hashCommitment(commitment.nullifier, commitment.secret, commitment.amount);
      const treeCommitment = allCommitments.find(c => c.leafIndex === commitment.leafIndex);

      console.log('[generateTransferProof] Input verification:', {
        computedInputCommitment: computedInputCommitment.toString().slice(0, 30) + '...',
        treeCommitment: treeCommitment?.commitment.toString().slice(0, 30) + '...',
        match: treeCommitment ? computedInputCommitment === treeCommitment.commitment : 'no tree commitment',
        leafIndex: commitment.leafIndex,
        merkleRoot: merkleProof.root.toString().slice(0, 30) + '...',
        nullifierHash: nullifierHash.toString().slice(0, 30) + '...',
        recipientCommitment: recipientCommitment.toString().slice(0, 30) + '...',
        changeCommitment: changeCommitment.toString().slice(0, 30) + '...',
        transferAmount: transferAmount.toString(),
        changeAmount: changeAmount.toString(),
      });

      if (treeCommitment && computedInputCommitment !== treeCommitment.commitment) {
        console.error('[generateTransferProof] CRITICAL: Input commitment mismatch!');
        throw new Error('Input commitment does not match on-chain commitment');
      }

      // Generate the proof
      const proofResult = await proverRef.current.proveTransfer({
        merkleRoot: merkleProof.root,
        nullifierHash,
        recipientCommitment,
        changeCommitment,
        nullifier: commitment.nullifier,
        secret: commitment.secret,
        amount: commitment.amount,
        pathElements: merkleProof.pathElements,
        pathIndices: merkleProof.pathIndices,
        transferAmount,
        recipientNullifier,
        recipientSecret,
        changeNullifier,
        changeSecret,
      });

      // Format proof for solidity
      const proof = Prover.formatProofForSolidity(proofResult.proof);

      return {
        proof,
        merkleRoot: merkleProof.root,
        nullifierHash,
        recipientCommitment,
        changeCommitment,
        changeNullifier,
        changeSecret,
      };
    },
    []
  );

  /**
   * Generate sell proof
   */
  const generateSellProof = useCallback(
    async (params: SellProofParams): Promise<SellProofResult> => {
      if (!proverRef.current) {
        throw new Error('Prover not ready');
      }

      const { commitment, tokenAmount, minEthOut, recipient, relayer, fee, allCommitments, treeState } = params;

      console.log(`[useZkProver] Building Merkle tree with ${allCommitments.length} commitments`);

      if (allCommitments.length === 0) {
        throw new Error('Merkle tree is empty. Please wait for the indexer to sync or check your connection.');
      }

      if (commitment.leafIndex >= allCommitments.length) {
        throw new Error(`Leaf index ${commitment.leafIndex} is out of bounds (tree has ${allCommitments.length} leaves). Your local wallet has stale data. Please click "Scan" in the wallet section to resync with the blockchain, or use "Reset Wallet" if the problem persists.`);
      }

      // Verify commitment integrity (derived vs on-chain)
      const calculatedCommitment = hashCommitment(commitment.nullifier, commitment.secret, commitment.amount);
      const onChainCommitmentNode = allCommitments.find(c => c.leafIndex === commitment.leafIndex);

      if (!onChainCommitmentNode) {
        throw new Error(`Commitment at leaf index ${commitment.leafIndex} not found in the provided list.`);
      }

      if (calculatedCommitment !== onChainCommitmentNode.commitment) {
        console.error('[useZkProver] Commitment mismatch:', {
          leafIndex: commitment.leafIndex,
          stored: {
            nullifier: commitment.nullifier.toString(),
            secret: commitment.secret.toString(),
            amount: commitment.amount.toString(),
            calculatedHash: calculatedCommitment.toString()
          },
          onChain: onChainCommitmentNode.commitment.toString()
        });
        throw new Error(`Commitment integrity check failed! The stored secrets do not match the on-chain commitment at index ${commitment.leafIndex}. This usually means your local data is corrupted or the wrong secrets are being used.`);
      }

      // Build merkle tree from all commitments
      const tree = new MerkleTree(24);
      const startTime = Date.now();

      // Debug: Log tree building stats (avoid spread operator with large arrays)
      const maxLeafIndex = allCommitments.reduce((max, c) => Math.max(max, c.leafIndex), 0);
      console.log(`[useZkProver] Building sell tree: ${allCommitments.length} commitments, maxLeafIndex=${maxLeafIndex}, targetLeafIndex=${commitment.leafIndex}`);

      if (treeState) {
        // FAST PATH: Use pre-computed tree state from Ponder indexer
        // This avoids expensive Poseidon hash recomputation (O(n) hashes saved)
        console.log(`[useZkProver] ⚡ FAST PATH: Using pre-built tree state`);
        const leaves = allCommitments.map(c => c.commitment);
        tree.loadState(leaves, treeState.filledSubtrees, treeState.root);
      } else {
        // SLOW PATH: Build tree from scratch (expensive Poseidon hashing)
        console.log(`[useZkProver] 🐌 SLOW PATH: Building tree from scratch...`);
        let lastLogTime = startTime;
        for (let i = 0; i < allCommitments.length; i++) {
          const c = allCommitments[i];
          tree.insertAt(c.leafIndex, c.commitment);

          // Log progress every 2 seconds
          const now = Date.now();
          if (now - lastLogTime > 2000) {
            console.log(`[useZkProver] Tree building: ${i + 1}/${allCommitments.length} leaves (${Math.round((i + 1) / allCommitments.length * 100)}%)`);
            lastLogTime = now;
          }
        }
      }

      const treeLeafCount = tree.getLeafCount();
      console.log(`[useZkProver] Tree built: ${treeLeafCount} leaves in ${((Date.now() - startTime) / 1000).toFixed(1)}s`);

      // Pre-check before getProof to give better error
      if (commitment.leafIndex >= treeLeafCount) {
        throw new Error(`TREE BUILD ERROR: leafIndex ${commitment.leafIndex} >= tree.getLeafCount() ${treeLeafCount}. allCommitments.length=${allCommitments.length}, maxLeafIndex=${maxLeafIndex}`);
      }

      // Get merkle proof for this commitment
      const merkleProof = tree.getProof(commitment.leafIndex);

      console.log('[useZkProver] Generating sell proof:', {
        leafIndex: commitment.leafIndex,
        commitment: commitment.amount.toString(),
        merkleRoot: merkleProof.root.toString(),
        treeLeaves: tree.getLeafCount(),
      });

      // Compute nullifier hash
      const nullifierHash = hashNullifier(commitment.nullifier, commitment.leafIndex);

      // Calculate change amount and generate change commitment
      const changeAmount = commitment.amount - tokenAmount;
      let changeCommitment = 0n;
      let changeNullifier = 0n;
      let changeSecret = 0n;

      if (changeAmount > 0n) {
        changeNullifier = randomFieldElement();
        changeSecret = randomFieldElement();
        changeCommitment = hashCommitment(changeNullifier, changeSecret, changeAmount);
      }

      // Generate the proof
      const proofResult = await proverRef.current.proveSell({
        merkleRoot: merkleProof.root,
        nullifierHash,
        tokenAmount,
        minEthOut,
        recipient,
        relayer,
        fee,
        changeCommitment,
        nullifier: commitment.nullifier,
        secret: commitment.secret,
        amount: commitment.amount,
        pathElements: merkleProof.pathElements,
        pathIndices: merkleProof.pathIndices,
        changeNullifier,
        changeSecret,
      });

      // Format proof for solidity
      const proof = Prover.formatProofForSolidity(proofResult.proof);

      // CRITICAL FIX: Circuit outputs publicInputsBinding at index 0 (output signal comes first)
      // Order: [publicInputsBinding, merkleRoot, nullifierHash, tokenAmount, minEthOut, recipient, relayer, fee, changeCommitment]
      const publicInputsBinding = BigInt(proofResult.publicSignals[0]);

      return {
        proof,
        merkleRoot: merkleProof.root,
        nullifierHash,
        tokenAmount,
        minEthOut,
        recipient,
        relayer,
        fee,
        changeCommitment,
        changeNullifier,
        changeSecret,
        publicInputsBinding,
      };
    },
    []
  );

  /**
   * Generate add liquidity proof
   */
  const generateAddLiquidityProof = useCallback(
    async (params: AddLiquidityProofParams): Promise<AddLiquidityProofResult> => {
      if (!proverRef.current) throw new Error('Prover not ready');

      const { commitment, tokenAmount, lpShares, allCommitments, treeState } = params;

      // Debug: Log tree building stats (avoid spread operator with large arrays)
      const maxLeafIndex = allCommitments.reduce((max, c) => Math.max(max, c.leafIndex), 0);
      console.log(`[useZkProver] Building addLP tree: ${allCommitments.length} commitments, maxLeafIndex=${maxLeafIndex}, targetLeafIndex=${commitment.leafIndex}`);

      const tree = new MerkleTree(24);
      const startTime = Date.now();

      if (treeState) {
        // FAST PATH: Use pre-computed tree state from Ponder indexer
        console.log(`[useZkProver] ⚡ FAST PATH (AddLP): Using pre-built tree state`);
        const leaves = allCommitments.map(c => c.commitment);
        tree.loadState(leaves, treeState.filledSubtrees, treeState.root);
      } else {
        // SLOW PATH: Build tree from scratch
        console.log(`[useZkProver] 🐌 SLOW PATH (AddLP): Building tree from scratch...`);
        for (const c of allCommitments) {
          tree.insertAt(c.leafIndex, c.commitment);
        }
      }

      const treeLeafCount = tree.getLeafCount();
      console.log(`[useZkProver] AddLP tree built: ${treeLeafCount} leaves in ${((Date.now() - startTime) / 1000).toFixed(1)}s`);

      if (commitment.leafIndex >= treeLeafCount) {
        throw new Error(`TREE BUILD ERROR (AddLP): leafIndex ${commitment.leafIndex} >= tree.getLeafCount() ${treeLeafCount}. allCommitments.length=${allCommitments.length}, maxLeafIndex=${maxLeafIndex}`);
      }

      const merkleProof = tree.getProof(commitment.leafIndex);

      const nullifierHash = hashNullifier(commitment.nullifier, commitment.leafIndex);

      const lpNullifier = randomFieldElement();
      const lpSecret = randomFieldElement();
      const lpCommitment = hashCommitment(lpNullifier, lpSecret, lpShares);

      const changeAmount = commitment.amount - tokenAmount;
      let changeCommitment = 0n;
      let changeNullifier = 0n;
      let changeSecret = 0n;
      if (changeAmount > 0n) {
        changeNullifier = randomFieldElement();
        changeSecret = randomFieldElement();
        changeCommitment = hashCommitment(changeNullifier, changeSecret, changeAmount);
      }

      const proofResult = await (proverRef.current as any).proveAddLiquidity({
        merkleRoot: merkleProof.root,
        nullifierHash,
        tokenAmount,
        lpCommitment,
        changeCommitment,
        nullifier: commitment.nullifier,
        secret: commitment.secret,
        amount: commitment.amount,
        pathElements: merkleProof.pathElements,
        pathIndices: merkleProof.pathIndices,
        lpNullifier,
        lpSecret,
        lpShares,
        changeNullifier,
        changeSecret,
      });

      const proof = Prover.formatProofForSolidity(proofResult.proof);

      // CRITICAL FIX: Circuit outputs publicInputsBinding at index 0 (output signal comes first)
      // Order: [publicInputsBinding, merkleRoot, nullifierHash, tokenAmount, lpCommitment, changeCommitment]
      const publicInputsBinding = BigInt(proofResult.publicSignals[0]);

      return {
        proof,
        merkleRoot: merkleProof.root,
        nullifierHash,
        tokenAmount,
        lpCommitment,
        lpNullifier,
        lpSecret,
        changeCommitment,
        changeNullifier,
        changeSecret,
        publicInputsBinding,
      };
    },
    []
  );

  /**
   * Generate remove liquidity proof
   * SECURITY FIX: Now includes tokensOut in commitment to make tokens spendable
   */
  const generateRemoveLiquidityProof = useCallback(
    async (params: RemoveLiquidityProofParams): Promise<RemoveLiquidityProofResult> => {
      if (!proverRef.current) throw new Error('Prover not ready');

      const { lpCommitment, withdrawShares, minEthOut, recipient, tokensOut, allLpCommitments } = params;

      const tree = new MerkleTree(24);
      for (const c of allLpCommitments) {
        tree.insertAt(c.leafIndex, c.commitment);
      }
      const merkleProof = tree.getProof(lpCommitment.leafIndex);

      const nullifierHash = hashNullifier(lpCommitment.nullifier, lpCommitment.leafIndex);

      const remainingShares = lpCommitment.amount - withdrawShares;
      let changeCommitment = 0n;
      let changeNullifier = 0n;
      let changeSecret = 0n;
      if (remainingShares > 0n) {
        changeNullifier = randomFieldElement();
        changeSecret = randomFieldElement();
        changeCommitment = hashCommitment(changeNullifier, changeSecret, remainingShares);
      }

      // SECURITY FIX: Generate commitment for returned tokens with actual tokensOut amount
      // This ensures the tokens are spendable (sell circuit requires amount > 0)
      const tokenNullifier = randomFieldElement();
      const tokenSecret = randomFieldElement();
      const tokenCommitment = hashCommitment(tokenNullifier, tokenSecret, tokensOut);

      const proofResult = await (proverRef.current as any).proveRemoveLiquidity({
        lpMerkleRoot: merkleProof.root,
        nullifierHash,
        commitment: lpCommitment.commitment,
        withdrawShares,
        minEthOut,
        recipient,
        changeCommitment,
        tokenCommitment,  // SECURITY FIX: Now verified in circuit
        tokensOut,        // SECURITY FIX: Public input for circuit verification
        nullifier: lpCommitment.nullifier,
        secret: lpCommitment.secret,
        totalShares: lpCommitment.amount,
        pathElements: merkleProof.pathElements,
        pathIndices: merkleProof.pathIndices,
        changeNullifier,
        changeSecret,
        tokenNullifier,   // SECURITY FIX: Private input for circuit
        tokenSecret,      // SECURITY FIX: Private input for circuit
      });

      const proof = Prover.formatProofForSolidity(proofResult.proof);

      // CRITICAL FIX: Circuit outputs publicInputsBinding at index 0 (output signal comes first)
      // Order: [publicInputsBinding, lpMerkleRoot, nullifierHash, commitment, withdrawShares, minEthOut, recipient, changeCommitment, tokenCommitment, tokensOut]
      const publicInputsBinding = BigInt(proofResult.publicSignals[0]);

      return {
        proof,
        merkleRoot: merkleProof.root,
        nullifierHash,
        commitment: lpCommitment.commitment,
        withdrawShares,
        minEthOut,
        recipient,
        changeCommitment,
        changeNullifier,
        changeSecret,
        tokenCommitment,
        tokenNullifier,
        tokenSecret,
        tokensOut,
        publicInputsBinding,
      };
    },
    []
  );

  /**
   * Generate claim fees proof
   */
  const generateClaimFeesProof = useCallback(
    async (params: ClaimFeesProofParams): Promise<ClaimFeesProofResult> => {
      if (!proverRef.current) throw new Error('Prover not ready');

      const { lpCommitment, feeEpoch, recipient, allLpCommitments } = params;

      const tree = new MerkleTree(24);
      for (const c of allLpCommitments) {
        tree.insertAt(c.leafIndex, c.commitment);
      }
      const merkleProof = tree.getProof(lpCommitment.leafIndex);

      // Compute claim nullifier
      const claimNullifier = hashClaimNullifier(
        lpCommitment.nullifier,
        feeEpoch,
        lpCommitment.leafIndex
      );

      const proofResult = await (proverRef.current as any).proveClaimFees({
        lpMerkleRoot: merkleProof.root,
        claimNullifier,
        feeEpoch,
        lpShares: lpCommitment.amount,
        recipient,
        nullifier: lpCommitment.nullifier,
        secret: lpCommitment.secret,
        pathElements: merkleProof.pathElements,
        pathIndices: merkleProof.pathIndices,
      });

      const proof = Prover.formatProofForSolidity(proofResult.proof);

      // CRITICAL FIX: Circuit outputs publicInputsBinding at index 0 (output signal comes first)
      // Order: [publicInputsBinding, lpMerkleRoot, claimNullifier, feeEpoch, lpShares, recipient]
      const publicInputsBinding = BigInt(proofResult.publicSignals[0]);

      return {
        proof,
        lpMerkleRoot: merkleProof.root,
        claimNullifier,
        feeEpoch,
        lpShares: lpCommitment.amount,
        recipient,
        publicInputsBinding,
      };
    },
    []
  );

  /**
   * Generate vote proof for governance voting
   */
  const generateVoteProof = useCallback(
    async (params: VoteProofParams): Promise<VoteProofResult> => {
      if (!proverRef.current) throw new Error('Prover not ready');

      const { commitment, proposalId, voteWeight, support, allCommitments, treeState } = params;

      // Build merkle tree
      const tree = new MerkleTree(24);
      const startTime = Date.now();

      if (treeState) {
        console.log(`[useZkProver] ⚡ FAST PATH (Vote): Using pre-built tree state`);
        const leaves = allCommitments.map(c => c.commitment);
        tree.loadState(leaves, treeState.filledSubtrees, treeState.root);
      } else {
        console.log(`[useZkProver] 🐌 SLOW PATH (Vote): Building tree from scratch...`);
        for (const c of allCommitments) {
          tree.insertAt(c.leafIndex, c.commitment);
        }
      }

      console.log(`[useZkProver] Vote tree built: ${tree.getLeafCount()} leaves in ${((Date.now() - startTime) / 1000).toFixed(1)}s`);

      const merkleProof = tree.getProof(commitment.leafIndex);

      // Vote nullifier = Poseidon(nullifier, proposalId, leafIndex)
      // This is computed by the circuit - we need to pre-compute it for verification
      const { poseidon } = await import('@r00t-fund/sdk');
      const nullifierHash = poseidon([commitment.nullifier, proposalId, BigInt(commitment.leafIndex)]);

      const proofResult = await (proverRef.current as any).proveVote({
        proposalId,
        merkleRoot: merkleProof.root,
        nullifierHash,
        voteWeight,
        support,
        nullifier: commitment.nullifier,
        secret: commitment.secret,
        amount: commitment.amount,
        pathElements: merkleProof.pathElements,
        pathIndices: merkleProof.pathIndices,
      });

      const proof = Prover.formatProofForSolidity(proofResult.proof);

      // voteBinding is the output signal (index 0)
      const voteBinding = BigInt(proofResult.publicSignals[0]);

      return {
        proof,
        merkleRoot: merkleProof.root,
        nullifierHash,
        voteWeight,
        support,
        voteBinding,
      };
    },
    []
  );

  /**
   * Generate pledge proof for proposal creation
   */
  const generatePledgeProof = useCallback(
    async (params: PledgeProofParams): Promise<PledgeProofResult> => {
      if (!proverRef.current) throw new Error('Prover not ready');

      const { commitment, pledgeAmount, creator, allCommitments, treeState } = params;

      // Build merkle tree
      const tree = new MerkleTree(24);
      const startTime = Date.now();

      if (treeState) {
        console.log(`[useZkProver] ⚡ FAST PATH (Pledge): Using pre-built tree state`);
        const leaves = allCommitments.map(c => c.commitment);
        tree.loadState(leaves, treeState.filledSubtrees, treeState.root);
      } else {
        console.log(`[useZkProver] 🐌 SLOW PATH (Pledge): Building tree from scratch...`);
        for (const c of allCommitments) {
          tree.insertAt(c.leafIndex, c.commitment);
        }
      }

      console.log(`[useZkProver] Pledge tree built: ${tree.getLeafCount()} leaves in ${((Date.now() - startTime) / 1000).toFixed(1)}s`);

      const merkleProof = tree.getProof(commitment.leafIndex);
      const nullifierHash = hashNullifier(commitment.nullifier, commitment.leafIndex);

      const proofResult = await (proverRef.current as any).provePledge({
        merkleRoot: merkleProof.root,
        nullifierHash,
        pledgeAmount,
        creator,
        nullifier: commitment.nullifier,
        secret: commitment.secret,
        pathElements: merkleProof.pathElements,
        pathIndices: merkleProof.pathIndices,
      });

      const proof = Prover.formatProofForSolidity(proofResult.proof);

      // publicInputsBinding is the output signal (index 0)
      // Order: [publicInputsBinding, merkleRoot, nullifierHash, pledgeAmount, creator]
      const publicInputsBinding = BigInt(proofResult.publicSignals[0]);

      return {
        proof,
        merkleRoot: merkleProof.root,
        nullifierHash,
        pledgeAmount,
        creator,
        publicInputsBinding,
      };
    },
    []
  );

  /**
   * Generate merge proof for privacy-preserving commitment consolidation
   * Combines two commitments into a single output commitment
   */
  const generateMergeProof = useCallback(
    async (params: MergeProofParams): Promise<MergeProofResult> => {
      if (!proverRef.current) throw new Error('Prover not ready');

      const { commitment1, commitment2, allCommitments, treeState } = params;

      // Validate commitments are different
      if (commitment1.leafIndex === commitment2.leafIndex) {
        throw new Error('Cannot merge a commitment with itself');
      }

      // Build merkle tree
      const tree = new MerkleTree(24);
      const startTime = Date.now();

      if (treeState) {
        console.log(`[useZkProver] ⚡ FAST PATH (Merge): Using pre-built tree state`);
        const leaves = allCommitments.map(c => c.commitment);
        tree.loadState(leaves, treeState.filledSubtrees, treeState.root);
      } else {
        console.log(`[useZkProver] 🐌 SLOW PATH (Merge): Building tree from scratch...`);
        for (const c of allCommitments) {
          tree.insertAt(c.leafIndex, c.commitment);
        }
      }

      console.log(`[useZkProver] Merge tree built: ${tree.getLeafCount()} leaves in ${((Date.now() - startTime) / 1000).toFixed(1)}s`);

      // Verify both commitments exist in tree
      const treeLeafCount = tree.getLeafCount();
      if (commitment1.leafIndex >= treeLeafCount) {
        throw new Error(`Commitment 1 leafIndex ${commitment1.leafIndex} is out of bounds (tree has ${treeLeafCount} leaves)`);
      }
      if (commitment2.leafIndex >= treeLeafCount) {
        throw new Error(`Commitment 2 leafIndex ${commitment2.leafIndex} is out of bounds (tree has ${treeLeafCount} leaves)`);
      }

      // Get merkle proofs for both commitments
      const merkleProof1 = tree.getProof(commitment1.leafIndex);
      const merkleProof2 = tree.getProof(commitment2.leafIndex);

      // Verify both proofs produce the same root
      if (merkleProof1.root !== merkleProof2.root) {
        throw new Error('Merkle root mismatch between commitments');
      }

      // Compute nullifier hashes for both inputs
      const nullifierHash1 = hashNullifier(commitment1.nullifier, commitment1.leafIndex);
      const nullifierHash2 = hashNullifier(commitment2.nullifier, commitment2.leafIndex);

      // Generate output commitment secrets
      const outputNullifier = randomFieldElement();
      const outputSecret = randomFieldElement();

      // Calculate total amount
      const totalAmount = commitment1.amount + commitment2.amount;

      // Compute output commitment
      const outputCommitment = hashCommitment(outputNullifier, outputSecret, totalAmount);

      console.log('[useZkProver] Generating merge proof:', {
        commitment1LeafIndex: commitment1.leafIndex,
        commitment2LeafIndex: commitment2.leafIndex,
        amount1: commitment1.amount.toString(),
        amount2: commitment2.amount.toString(),
        totalAmount: totalAmount.toString(),
        merkleRoot: merkleProof1.root.toString().slice(0, 30) + '...',
      });

      // Verify input commitments match what's in the tree
      const computedCommitment1 = hashCommitment(commitment1.nullifier, commitment1.secret, commitment1.amount);
      const computedCommitment2 = hashCommitment(commitment2.nullifier, commitment2.secret, commitment2.amount);

      const onChain1 = allCommitments.find(c => c.leafIndex === commitment1.leafIndex);
      const onChain2 = allCommitments.find(c => c.leafIndex === commitment2.leafIndex);

      if (onChain1 && computedCommitment1 !== onChain1.commitment) {
        throw new Error(`Commitment 1 integrity check failed! Stored secrets do not match on-chain commitment.`);
      }
      if (onChain2 && computedCommitment2 !== onChain2.commitment) {
        throw new Error(`Commitment 2 integrity check failed! Stored secrets do not match on-chain commitment.`);
      }

      // Generate the proof
      // Note: This requires the merge circuit to be compiled and the prover to support it
      const proofResult = await (proverRef.current as any).proveMerge({
        merkleRoot: merkleProof1.root,
        nullifierHash1,
        nullifierHash2,
        outputCommitment,
        // Input 1
        nullifier1: commitment1.nullifier,
        secret1: commitment1.secret,
        amount1: commitment1.amount,
        pathElements1: merkleProof1.pathElements,
        pathIndices1: merkleProof1.pathIndices,
        // Input 2
        nullifier2: commitment2.nullifier,
        secret2: commitment2.secret,
        amount2: commitment2.amount,
        pathElements2: merkleProof2.pathElements,
        pathIndices2: merkleProof2.pathIndices,
        // Output
        outputNullifier,
        outputSecret,
      });

      const proof = Prover.formatProofForSolidity(proofResult.proof);

      // publicInputsBinding is the output signal (index 0)
      const publicInputsBinding = BigInt(proofResult.publicSignals[0]);

      return {
        proof,
        merkleRoot: merkleProof1.root,
        nullifierHash1,
        nullifierHash2,
        outputCommitment,
        outputNullifier,
        outputSecret,
        totalAmount,
        publicInputsBinding,
      };
    },
    []
  );

  return {
    ...state,
    loadProver,
    generateWithdrawProof,
    generateTransferProof,
    generateSellProof,
    generateAddLiquidityProof,
    generateRemoveLiquidityProof,
    generateClaimFeesProof,
    generateVoteProof,
    generatePledgeProof,
    generateMergeProof,
  };
}
