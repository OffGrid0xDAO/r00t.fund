import { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAccount, usePublicClient, useWalletClient } from 'wagmi';
import { formatUnits, parseEther, isAddress } from 'viem';
import { usePrivateWallet } from '../hooks/usePrivateWallet';
import { useZkProver } from '../hooks/useZkProver';
import type { WalletSession } from '../hooks/useWalletSession';
import { LiquidityPanel } from './LiquidityPanel';
import { GlowButton } from './ui/GlowButton';
import { AnimatedTabs } from './ui/AnimatedTabs';
import { CONTRACTS, isContractDeployed, CHAIN, getExplorerTxUrl } from '../config';
import { usePageVisibility } from '../hooks/usePageVisibility';

interface PortfolioPanelProps {
  zkAMMAddress: string;
  pairAddress: string;
  session: WalletSession;
  balance?: bigint;
  initialTab?: PortfolioTab;
}

const ERC20_ABI = [
  {
    name: 'balanceOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ type: 'uint256' }],
  },
] as const;

type PortfolioTab = 'overview' | 'transfer' | 'withdraw' | 'consolidate' | 'liquidity';

const ZKAMM_ABI = [
  {
    name: 'transferPrivate',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'proof', type: 'uint256[8]' },
      { name: 'merkleRoot', type: 'uint256' },
      { name: 'nullifierHash', type: 'uint256' },
      { name: 'recipientCommitment', type: 'uint256' },
      { name: 'changeCommitment', type: 'uint256' },
      { name: 'recipientNote', type: 'bytes' },
      { name: 'changeNote', type: 'bytes' },
    ],
    outputs: [],
  },
  {
    name: 'withdrawPublic',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'proof', type: 'uint256[8]' },
      { name: 'merkleRoot', type: 'uint256' },
      { name: 'nullifierHash', type: 'uint256' },
      { name: 'amount', type: 'uint256' },
      { name: 'recipient', type: 'address' },
      { name: 'recipientBinding', type: 'uint256' },
    ],
    outputs: [],
  },
  {
    name: 'mergeCommitments',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'proof', type: 'uint256[8]' },
      { name: 'merkleRoot', type: 'uint256' },
      { name: 'nullifierHash1', type: 'uint256' },
      { name: 'nullifierHash2', type: 'uint256' },
      { name: 'outputCommitment', type: 'uint256' },
      { name: 'publicInputsBinding', type: 'uint256' },
      { name: 'deadline', type: 'uint256' },
      { name: 'encryptedNote', type: 'bytes' },
    ],
    outputs: [],
  },
] as const;

// Field prime for BN254 curve
const FIELD_PRIME = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;

function randomFieldElement(): bigint {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let value = 0n;
  for (let i = 0; i < 32; i++) {
    value = (value << 8n) + BigInt(bytes[i]);
  }
  return value % FIELD_PRIME;
}

// Balance Card component
function BalanceCard({
  label,
  balance,
  symbol,
  badge,
  badgeColor,
  subtext,
  delay = 0,
  glowing = false,
}: {
  label: string;
  balance: string;
  symbol: string;
  badge: string;
  badgeColor: string;
  subtext: string;
  delay?: number;
  glowing?: boolean;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay }}
      whileHover={{ y: -4, scale: 1.01 }}
      className={`rounded-lg p-5 bg-[var(--bg-secondary)] border border-[var(--border)] hover:border-[var(--border-focus)] transition-all duration-300 ${glowing ? 'relative overflow-hidden' : ''}`}
    >
      {glowing && (
        <div
          className="absolute inset-0 opacity-20 pointer-events-none"
          style={{
            background: 'radial-gradient(circle at 50% 0%, var(--accent) 0%, transparent 70%)',
          }}
        />
      )}
      <div className="flex items-start justify-between mb-3 relative">
        <p className="text-xs font-mono text-[var(--text-muted)]">
          <span className="text-[var(--accent)] opacity-60">// </span>
          {label}
        </p>
        <motion.span
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: delay + 0.1 }}
          className="px-2 py-0.5 rounded-full text-[10px] font-mono uppercase tracking-wider flex items-center gap-1.5"
          style={{ color: badgeColor, background: `${badgeColor}20`, border: `1px solid ${badgeColor}40` }}
        >
          <span className="w-1.5 h-1.5 rounded-full" style={{ background: badgeColor }} />
          {badge}
        </motion.span>
      </div>
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.3, delay: delay + 0.15 }}
        className="text-2xl font-bold text-[var(--text-primary)] relative"
      >
        {balance}
        <span className="text-sm ml-2 text-[var(--text-accent)]">{symbol}</span>
      </motion.div>
      <div className="text-xs text-[var(--text-muted)] mt-2">{subtext}</div>
    </motion.div>
  );
}

export function PortfolioPanel({
  zkAMMAddress,
  pairAddress,
  session,
  balance: externalBalance,
  initialTab,
}: PortfolioPanelProps) {
  const { isConnected, address } = useAccount();
  const publicClient = usePublicClient();
  const isPageVisible = usePageVisibility();
  const { data: walletClient } = useWalletClient();

  const [activeTab, setActiveTab] = useState<PortfolioTab>(initialTab || 'overview');
  const [publicBalance, setPublicBalance] = useState<bigint>(0n);

  // Update tab when initialTab prop changes
  useEffect(() => {
    if (initialTab) {
      setActiveTab(initialTab);
    }
  }, [initialTab]);

  // Transfer state
  const [transferAmount, setTransferAmount] = useState('');
  const [recipientKey, setRecipientKey] = useState('');
  const [isTransferring, setIsTransferring] = useState(false);
  const [transferError, setTransferError] = useState<string | null>(null);
  const [transferSuccess, setTransferSuccess] = useState<string | null>(null);
  const [selectedTransferCommitment, setSelectedTransferCommitment] = useState<any>(null);

  // Withdraw state
  const [withdrawAmount, setWithdrawAmount] = useState('');
  const [withdrawRecipient, setWithdrawRecipient] = useState('');
  const [isWithdrawing, setIsWithdrawing] = useState(false);
  const [withdrawError, setWithdrawError] = useState<string | null>(null);
  const [withdrawSuccess, setWithdrawSuccess] = useState<{ message: string; txHash: string } | null>(null);
  const [selectedWithdrawCommitment, setSelectedWithdrawCommitment] = useState<any>(null);

  // Consolidate state
  const [selectedConsolidateCommitments, setSelectedConsolidateCommitments] = useState<any[]>([]);
  const [isConsolidating, setIsConsolidating] = useState(false);
  const [consolidateError, setConsolidateError] = useState<string | null>(null);
  const [consolidateSuccess, setConsolidateSuccess] = useState<string | null>(null);

  const {
    balance: internalBalance,
    commitments,
    allCommitments,
    publicKey,
    isScanning,
    scan,
    spendCommitment,
    storeCommitment,
    fetchAllOnChainCommitments,
  } = usePrivateWallet(zkAMMAddress, pairAddress, session.viewingKey);

  const { isReady: isProverReady, isLoading: isProverLoading, generateWithdrawProof, generateTransferProof, generateMergeProof, error: proverError } = useZkProver();

  const balance = externalBalance ?? internalBalance;

  // Get spendable commitments for withdraw (sorted by amount, largest first)
  // Also validate that the commitment hash matches (filters out corrupted commitments)
  const spendableCommitments = useMemo(() => {
    const validCommitments: (typeof commitments[0] & { amountBigInt: bigint; isValid: boolean })[] = [];

    for (const c of commitments) {
      if (c.spent || !c.nullifier || !c.secret || BigInt(c.amount) <= 0n) continue;

      // Check if we have the on-chain commitment hash to validate against
      // If commitment field exists, we can verify the hash
      const amountBigInt = BigInt(c.amount);

      // Add to list - we'll validate on-chain during withdraw
      validCommitments.push({
        ...c,
        amountBigInt,
        isValid: true, // Will be validated during actual withdraw
      });
    }

    return validCommitments.sort((a, b) => (b.amountBigInt > a.amountBigInt ? 1 : -1));
  }, [commitments]);

  // Auto-select largest commitment if none selected
  useEffect(() => {
    if (!selectedWithdrawCommitment && spendableCommitments.length > 0) {
      setSelectedWithdrawCommitment(spendableCommitments[0]);
    }
  }, [spendableCommitments, selectedWithdrawCommitment]);

  // Tab configuration with icons
  const tabs = [
    {
      id: 'overview' as const, label: '_overview', icon: (
        <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path strokeLinecap="round" strokeLinejoin="round" d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
        </svg>
      )
    },
    {
      id: 'transfer' as const, label: '_transfer', icon: (
        <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path strokeLinecap="round" strokeLinejoin="round" d="M7 11l5-5m0 0l5 5m-5-5v12" />
        </svg>
      )
    },
    {
      id: 'withdraw' as const, label: '_withdraw', icon: (
        <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      )
    },
    {
      id: 'consolidate' as const, label: '_merge', icon: (
        <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
        </svg>
      )
    },
    {
      id: 'liquidity' as const, label: '_lp', icon: (
        <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path strokeLinecap="round" strokeLinejoin="round" d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" />
        </svg>
      )
    },
  ];

  // Fetch public ROOT balance (only if token contract is deployed)
  useEffect(() => {
    if (!publicClient || !address) {
      setPublicBalance(0n);
      return;
    }

    // Skip if ROOT token contract isn't deployed
    if (!isContractDeployed(CONTRACTS.rootToken)) {
      setPublicBalance(0n);
      return;
    }

    const fetchPublicBalance = async () => {
      try {
        const bal = await publicClient.readContract({
          address: CONTRACTS.rootToken as `0x${string}`,
          abi: ERC20_ABI,
          functionName: 'balanceOf',
          args: [address],
        });
        setPublicBalance(bal);
      } catch {
        // Silently handle errors - token may not be deployed on this network
        setPublicBalance(0n);
      }
    };

    fetchPublicBalance();

    // Only poll when page is visible to reduce RPC calls
    if (!isPageVisible) return;

    // Poll every 60s to minimize RPC calls
    const interval = window.setInterval(fetchPublicBalance, 60000);
    return () => window.clearInterval(interval);
  }, [publicClient, address, isPageVisible]);

  // NOTE: Viewing key lifecycle is now managed by useWalletSession hook
  // The buggy useEffect that cleared viewing key on disconnect has been removed
  // This fixes the issue where viewing key was lost during page refresh

  const handleTransfer = async () => {
    if (!walletClient || !publicClient || !transferAmount || !recipientKey || !address || !session.viewingKey) return;

    setIsTransferring(true);
    setTransferError(null);
    setTransferSuccess(null);

    try {
      const amount = parseEther(transferAmount);
      if (!recipientKey.startsWith('0x') || recipientKey.length < 66) {
        throw new Error('Invalid recipient public key format');
      }

      // Use selected commitment
      const commitmentToSpend = selectedTransferCommitment;

      if (!commitmentToSpend || !commitmentToSpend.nullifier || !commitmentToSpend.secret) {
        throw new Error('Please select a commitment to transfer from.');
      }

      const commitmentAmount = BigInt(commitmentToSpend.amount);
      if (amount > commitmentAmount) {
        throw new Error(`Amount exceeds selected commitment. Max: ${Number(formatUnits(commitmentAmount, 18)).toFixed(2)} tokens`);
      }

      if (!isProverReady) {
        throw new Error(
          isProverLoading
            ? 'ZK prover is still loading circuit artifacts...'
            : proverError || 'ZK prover failed to initialize'
        );
      }

      // Fetch ALL on-chain commitments for building the merkle tree
      console.log('[handleTransfer] Fetching all on-chain commitments for merkle tree...');
      const { commitments: commitmentsForProof, treeState: transferTreeState } = await fetchAllOnChainCommitments(pairAddress);

      if (commitmentsForProof.length === 0) {
        throw new Error('No commitments found in indexer. Try refreshing or waiting for indexer to sync.');
      }

      console.log(`[handleTransfer] Generating ZK proof with ${commitmentsForProof.length} commitments, treeState: ${transferTreeState ? 'available' : 'NOT available'}`);

      // Commitment verification (same as withdraw)
      const commitmentNullifier = BigInt(commitmentToSpend.nullifier);
      const commitmentSecret = BigInt(commitmentToSpend.secret);
      const commitmentAmountBigInt = BigInt(commitmentToSpend.amount);
      const storedCommitmentHash = commitmentToSpend.commitment ? BigInt(commitmentToSpend.commitment) : null;

      console.log('[handleTransfer] Commitment details:', {
        leafIndex: commitmentToSpend.leafIndex,
        storedAmount: commitmentAmountBigInt.toString(),
        nullifier: commitmentNullifier.toString().slice(0, 20) + '...',
        secret: commitmentSecret.toString().slice(0, 20) + '...',
        storedCommitmentHash: storedCommitmentHash?.toString().slice(0, 20) + '...',
      });

      // Verify the commitment hash matches what's on-chain
      const { hashCommitment: sdkHashCommitment } = await import('@r00t-fund/sdk');
      const computedHash = sdkHashCommitment(commitmentNullifier, commitmentSecret, commitmentAmountBigInt);

      // Find on-chain commitment by leafIndex and by hash
      const onChainCommitment = commitmentsForProof.find(c => c.leafIndex === commitmentToSpend.leafIndex);
      const onChainByHash = storedCommitmentHash
        ? commitmentsForProof.find(c => c.commitment === storedCommitmentHash)
        : null;

      console.log('[handleTransfer] Commitment hash verification:', {
        computedHash: computedHash.toString().slice(0, 20) + '...',
        storedHash: storedCommitmentHash?.toString().slice(0, 20) + '...',
        onChainHashByIndex: onChainCommitment?.commitment.toString().slice(0, 20) + '...',
        onChainLeafIndexByHash: onChainByHash?.leafIndex,
      });

      // Use stored hash to find correct leafIndex if available
      const actualLeafIndex = onChainByHash ? onChainByHash.leafIndex : commitmentToSpend.leafIndex;

      if (onChainByHash && onChainByHash.leafIndex !== commitmentToSpend.leafIndex) {
        console.warn(`[handleTransfer] LeafIndex mismatch! Stored: ${commitmentToSpend.leafIndex}, Actual: ${onChainByHash.leafIndex}. Using actual.`);
      }

      if (!onChainCommitment && !onChainByHash) {
        throw new Error(`Commitment not found on-chain! LeafIndex: ${commitmentToSpend.leafIndex}. The indexer may be out of sync.`);
      }

      // Generate secrets for recipient commitment
      const recipientNullifier = randomFieldElement();
      const recipientSecret = randomFieldElement();

      // Generate the ZK proof
      const proofResult = await generateTransferProof({
        commitment: {
          nullifier: commitmentNullifier,
          secret: commitmentSecret,
          amount: commitmentAmountBigInt,
          leafIndex: actualLeafIndex,
        },
        transferAmount: amount,
        recipientNullifier,
        recipientSecret,
        allCommitments: commitmentsForProof,
        treeState: transferTreeState, // Use pre-computed tree state for fast proof generation
      });

      console.log('[handleTransfer] Proof generated:', {
        merkleRoot: proofResult.merkleRoot.toString(),
        nullifierHash: proofResult.nullifierHash.toString(),
        recipientCommitment: proofResult.recipientCommitment.toString(),
        changeCommitment: proofResult.changeCommitment.toString(),
        proof: proofResult.proof.map(p => p.toString()),
      });

      // Debug: Query the transfer verifier address to verify it's correct
      try {
        const transferVerifierAddr = await publicClient.readContract({
          address: pairAddress as `0x${string}`,
          abi: [{ name: 'transferVerifier', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] }],
          functionName: 'transferVerifier',
        });
        console.log('[handleTransfer] Transfer verifier address:', transferVerifierAddr);
      } catch (e) {
        console.log('[handleTransfer] Could not query transfer verifier:', e);
      }

      // Create encrypted notes using proper ECDH encryption from SDK
      const { encryptNote } = await import('@r00t-fund/sdk');

      // Encrypt note for recipient using their public key
      const recipientNote = await encryptNote(
        recipientNullifier,
        recipientSecret,
        amount,
        recipientKey // recipient's viewing public key
      ) as `0x${string}`;

      console.log('[handleTransfer] Encrypted recipient note:', recipientNote.slice(0, 40) + '...');

      const changeAmount = commitmentAmountBigInt - amount;
      let changeNote: `0x${string}` = '0x';

      if (changeAmount > 0n) {
        // Derive our viewing public key from our viewing key
        const { Wallet } = await import('ethers');
        const ourViewingWallet = new Wallet(session.viewingKey);
        const ourViewingPublicKey = ourViewingWallet.signingKey.compressedPublicKey;

        // Encrypt change note for ourselves using our viewing public key
        changeNote = await encryptNote(
          proofResult.changeNullifier,
          proofResult.changeSecret,
          changeAmount,
          ourViewingPublicKey
        ) as `0x${string}`;
        console.log('[handleTransfer] Encrypted change note:', changeNote.slice(0, 40) + '...');
      }

      const proof: [bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint] = [
        proofResult.proof[0],
        proofResult.proof[1],
        proofResult.proof[2],
        proofResult.proof[3],
        proofResult.proof[4],
        proofResult.proof[5],
        proofResult.proof[6],
        proofResult.proof[7],
      ];

      // Pre-flight checks to diagnose failures
      const [isRootKnown, isNullifierSpent] = await Promise.all([
        publicClient.readContract({
          address: pairAddress as `0x${string}`,
          abi: [{ name: 'isKnownRoot', type: 'function', stateMutability: 'view', inputs: [{ type: 'uint256' }], outputs: [{ type: 'bool' }] }],
          functionName: 'isKnownRoot',
          args: [proofResult.merkleRoot],
        }) as Promise<boolean>,
        publicClient.readContract({
          address: pairAddress as `0x${string}`,
          abi: [{ name: 'isNullifierSpent', type: 'function', stateMutability: 'view', inputs: [{ type: 'uint256' }], outputs: [{ type: 'bool' }] }],
          functionName: 'isNullifierSpent',
          args: [proofResult.nullifierHash],
        }) as Promise<boolean>,
      ]);

      console.log('[handleTransfer] Pre-flight checks:', { isRootKnown, isNullifierSpent });

      if (!isRootKnown) {
        throw new Error(`Merkle root not recognized by contract. The indexer may be out of sync. Root: ${proofResult.merkleRoot.toString().slice(0, 20)}...`);
      }
      if (isNullifierSpent) {
        throw new Error('This commitment has already been spent. Please refresh your wallet.');
      }

      // Simulate first to get better error message
      try {
        await publicClient.simulateContract({
          address: pairAddress as `0x${string}`,
          abi: ZKAMM_ABI,
          functionName: 'transferPrivate',
          args: [proof, proofResult.merkleRoot, proofResult.nullifierHash, proofResult.recipientCommitment, proofResult.changeCommitment, recipientNote, changeNote],
          account: address,
        });
        console.log('[handleTransfer] Simulation passed!');
      } catch (simError: any) {
        console.error('[handleTransfer] Simulation failed:', simError);
        throw new Error(`Transaction would fail: ${simError.shortMessage || simError.message}`);
      }

      await walletClient.writeContract({
        address: pairAddress as `0x${string}`,
        abi: ZKAMM_ABI,
        functionName: 'transferPrivate',
        args: [proof, proofResult.merkleRoot, proofResult.nullifierHash, proofResult.recipientCommitment, proofResult.changeCommitment, recipientNote, changeNote],
        chain: CHAIN,
      });

      // Mark the commitment as spent locally
      spendCommitment(commitmentToSpend.commitment);

      // Store change commitment if there's change
      if (changeAmount > 0n && proofResult.changeCommitment !== 0n) {
        storeCommitment(
          proofResult.changeCommitment,
          proofResult.changeNullifier,
          proofResult.changeSecret,
          changeAmount,
          commitmentsForProof.length, // New leaf index will be at the end
          0
        );
      }

      setTransferSuccess('Transfer submitted! The recipient can scan to see their new balance.');
      setTransferAmount('');
      setRecipientKey('');
      setSelectedTransferCommitment(null);
    } catch (err: unknown) {
      setTransferError((err as Error).message || 'Transfer failed');
    } finally {
      setIsTransferring(false);
    }
  };

  const handleWithdraw = async () => {
    if (!walletClient || !publicClient || !withdrawAmount || !withdrawRecipient || !address) return;

    setIsWithdrawing(true);
    setWithdrawError(null);
    setWithdrawSuccess(null);

    try {
      const amount = parseEther(withdrawAmount);
      if (!isAddress(withdrawRecipient)) throw new Error('Invalid recipient address');

      // Use selected commitment
      const commitmentToSpend = selectedWithdrawCommitment;

      if (!commitmentToSpend || !commitmentToSpend.nullifier || !commitmentToSpend.secret) {
        throw new Error('Please select a commitment to withdraw from.');
      }

      const commitmentAmount = BigInt(commitmentToSpend.amount);
      if (amount > commitmentAmount) {
        throw new Error(`Amount exceeds selected commitment. Max: ${Number(formatUnits(commitmentAmount, 18)).toFixed(2)} tokens`);
      }

      if (!isProverReady) {
        throw new Error(
          isProverLoading
            ? 'ZK prover is still loading circuit artifacts...'
            : proverError || 'ZK prover failed to initialize'
        );
      }

      // Fetch ALL on-chain commitments for building the merkle tree (not just user's commitments)
      console.log('[handleWithdraw] Fetching all on-chain commitments for merkle tree...');
      const { commitments: commitmentsForProof, treeState: withdrawTreeState } = await fetchAllOnChainCommitments(pairAddress);

      if (commitmentsForProof.length === 0) {
        throw new Error('No commitments found in indexer. Try refreshing or waiting for indexer to sync.');
      }

      console.log(`[handleWithdraw] Generating ZK proof with ${commitmentsForProof.length} commitments, treeState: ${withdrawTreeState ? 'available' : 'NOT available'}`);

      // Debug: Log commitment details
      const commitmentNullifier = BigInt(commitmentToSpend.nullifier);
      const commitmentSecret = BigInt(commitmentToSpend.secret);
      const commitmentAmountBigInt = BigInt(commitmentToSpend.amount);
      const storedCommitmentHash = commitmentToSpend.commitment ? BigInt(commitmentToSpend.commitment) : null;

      console.log('[handleWithdraw] Commitment details:', {
        leafIndex: commitmentToSpend.leafIndex,
        storedAmount: commitmentAmountBigInt.toString(),
        nullifier: commitmentNullifier.toString().slice(0, 20) + '...',
        secret: commitmentSecret.toString().slice(0, 20) + '...',
        storedCommitmentHash: storedCommitmentHash?.toString().slice(0, 20) + '...',
      });

      // Verify the commitment hash matches what's on-chain
      const { hashCommitment: sdkHashCommitment } = await import('@r00t-fund/sdk');
      const computedHash = sdkHashCommitment(commitmentNullifier, commitmentSecret, commitmentAmountBigInt);

      // Find on-chain commitment by leafIndex
      const onChainCommitment = commitmentsForProof.find(c => c.leafIndex === commitmentToSpend.leafIndex);

      // Also try to find by stored commitment hash (in case leafIndex is wrong)
      const onChainByHash = storedCommitmentHash
        ? commitmentsForProof.find(c => c.commitment === storedCommitmentHash)
        : null;

      console.log('[handleWithdraw] Commitment hash verification:', {
        computedHash: computedHash.toString().slice(0, 20) + '...',
        storedHash: storedCommitmentHash?.toString().slice(0, 20) + '...',
        onChainHashByIndex: onChainCommitment?.commitment.toString().slice(0, 20) + '...',
        onChainLeafIndexByHash: onChainByHash?.leafIndex,
        computedMatchesStored: storedCommitmentHash ? computedHash === storedCommitmentHash : 'no stored hash',
        computedMatchesOnChain: onChainCommitment ? computedHash === onChainCommitment.commitment : 'no on-chain data',
        storedMatchesOnChain: (storedCommitmentHash && onChainCommitment) ? storedCommitmentHash === onChainCommitment.commitment : 'n/a',
      });

      // If stored hash doesn't match computed, the stored secrets are corrupted
      if (storedCommitmentHash && computedHash !== storedCommitmentHash) {
        console.error('[handleWithdraw] CRITICAL: Stored commitment hash does not match recomputed hash!');
        console.error('[handleWithdraw] This means the stored nullifier/secret/amount are inconsistent with the stored hash.');
        // Continue anyway - use the stored hash for lookup since it was saved at transaction time
      }

      // Use stored hash to find correct leafIndex if available, otherwise use the stored leafIndex
      const actualLeafIndex = onChainByHash ? onChainByHash.leafIndex : commitmentToSpend.leafIndex;

      if (onChainByHash && onChainByHash.leafIndex !== commitmentToSpend.leafIndex) {
        console.warn(`[handleWithdraw] LeafIndex mismatch! Stored: ${commitmentToSpend.leafIndex}, Actual: ${onChainByHash.leafIndex}. Using actual.`);
      }

      // Verify we can find this commitment on-chain
      if (!onChainCommitment && !onChainByHash) {
        throw new Error(`Commitment not found on-chain! LeafIndex: ${commitmentToSpend.leafIndex}. The indexer may be out of sync.`);
      }

      const proofResult = await generateWithdrawProof({
        commitment: {
          nullifier: commitmentNullifier,
          secret: commitmentSecret,
          amount: commitmentAmountBigInt,
          leafIndex: actualLeafIndex,
        },
        recipient: withdrawRecipient,
        allCommitments: commitmentsForProof,
        treeState: withdrawTreeState, // Use pre-computed tree state for fast proof generation
      });

      console.log('[handleWithdraw] Proof generated:', {
        merkleRoot: proofResult.merkleRoot.toString().slice(0, 20) + '...',
        nullifierHash: proofResult.nullifierHash.toString().slice(0, 20) + '...',
        amount: proofResult.amount.toString(),
        recipientBinding: proofResult.recipientBinding.toString().slice(0, 20) + '...',
      });

      // Pre-flight checks to diagnose failures
      const [isRootKnown, isNullifierSpent] = await Promise.all([
        publicClient.readContract({
          address: pairAddress as `0x${string}`,
          abi: [{ name: 'isKnownRoot', type: 'function', stateMutability: 'view', inputs: [{ type: 'uint256' }], outputs: [{ type: 'bool' }] }],
          functionName: 'isKnownRoot',
          args: [proofResult.merkleRoot],
        }) as Promise<boolean>,
        publicClient.readContract({
          address: pairAddress as `0x${string}`,
          abi: [{ name: 'isNullifierSpent', type: 'function', stateMutability: 'view', inputs: [{ type: 'uint256' }], outputs: [{ type: 'bool' }] }],
          functionName: 'isNullifierSpent',
          args: [proofResult.nullifierHash],
        }) as Promise<boolean>,
      ]);

      console.log('[handleWithdraw] Pre-flight checks:', { isRootKnown, isNullifierSpent });

      if (!isRootKnown) {
        throw new Error(`Merkle root not recognized by contract. The indexer may be out of sync. Root: ${proofResult.merkleRoot.toString().slice(0, 20)}...`);
      }
      if (isNullifierSpent) {
        throw new Error('This commitment has already been spent. Please refresh your wallet.');
      }

      const proof: [bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint] = [
        proofResult.proof[0],
        proofResult.proof[1],
        proofResult.proof[2],
        proofResult.proof[3],
        proofResult.proof[4],
        proofResult.proof[5],
        proofResult.proof[6],
        proofResult.proof[7],
      ];

      // withdrawPublic is on the Router (Pair reverts with NotImplemented)
      const withdrawRouterAddress = CONTRACTS.zkAMMRouter as `0x${string}`;

      // Simulate first to get better error message
      try {
        await publicClient.simulateContract({
          address: withdrawRouterAddress,
          abi: ZKAMM_ABI,
          functionName: 'withdrawPublic',
          args: [
            proof,
            proofResult.merkleRoot,
            proofResult.nullifierHash,
            proofResult.amount,
            withdrawRecipient as `0x${string}`,
            proofResult.recipientBinding,
          ],
          account: address,
        });
        console.log('[handleWithdraw] Simulation passed!');
      } catch (simError: any) {
        console.error('[handleWithdraw] Simulation failed:', simError);
        throw new Error(`Transaction would fail: ${simError.shortMessage || simError.message}`);
      }

      const hash = await walletClient.writeContract({
        address: withdrawRouterAddress,
        abi: ZKAMM_ABI,
        functionName: 'withdrawPublic',
        args: [
          proof,
          proofResult.merkleRoot,
          proofResult.nullifierHash,
          proofResult.amount,
          withdrawRecipient as `0x${string}`,
          proofResult.recipientBinding,
        ],
        chain: CHAIN,
      });

      await publicClient.waitForTransactionReceipt({ hash });

      setWithdrawSuccess({
        message: `Withdrawn ${withdrawAmount} $ROOT to ${withdrawRecipient.slice(0, 6)}...${withdrawRecipient.slice(-4)}`,
        txHash: hash,
      });
      setWithdrawAmount('');
      setWithdrawRecipient('');

      scan();
    } catch (err: unknown) {
      console.error('[handleWithdraw] Error:', err);
      setWithdrawError((err as Error).message || 'Withdraw failed');
    } finally {
      setIsWithdrawing(false);
    }
  };

  const handleConsolidate = async () => {
    if (!walletClient || !publicClient || !address || !session.viewingKey || selectedConsolidateCommitments.length !== 2) return;

    setIsConsolidating(true);
    setConsolidateError(null);
    setConsolidateSuccess(null);

    try {
      const [commitment1, commitment2] = selectedConsolidateCommitments;

      if (!commitment1.nullifier || !commitment1.secret || !commitment2.nullifier || !commitment2.secret) {
        throw new Error('Selected commitments are missing secrets. Please select valid commitments.');
      }

      if (!isProverReady) {
        throw new Error(
          isProverLoading
            ? 'ZK prover is still loading circuit artifacts...'
            : proverError || 'ZK prover failed to initialize'
        );
      }

      // Fetch all on-chain commitments for merkle tree
      console.log('[handleConsolidate] Fetching all on-chain commitments...');
      const { commitments: allOnChainCommitments, treeState } = await fetchAllOnChainCommitments(pairAddress);

      if (allOnChainCommitments.length === 0) {
        throw new Error('No commitments found. The indexer may be out of sync.');
      }

      console.log(`[handleConsolidate] Got ${allOnChainCommitments.length} commitments for merkle tree`);

      // Generate merge proof
      console.log('[handleConsolidate] Generating merge proof...');
      const proofResult = await generateMergeProof({
        commitment1: {
          nullifier: BigInt(commitment1.nullifier),
          secret: BigInt(commitment1.secret),
          amount: BigInt(commitment1.amount),
          leafIndex: commitment1.leafIndex,
        },
        commitment2: {
          nullifier: BigInt(commitment2.nullifier),
          secret: BigInt(commitment2.secret),
          amount: BigInt(commitment2.amount),
          leafIndex: commitment2.leafIndex,
        },
        allCommitments: allOnChainCommitments,
        treeState,
      });

      console.log('[handleConsolidate] Merge proof generated:', {
        merkleRoot: proofResult.merkleRoot.toString().slice(0, 20) + '...',
        nullifierHash1: proofResult.nullifierHash1.toString().slice(0, 20) + '...',
        nullifierHash2: proofResult.nullifierHash2.toString().slice(0, 20) + '...',
        outputCommitment: proofResult.outputCommitment.toString().slice(0, 20) + '...',
        totalAmount: formatUnits(proofResult.totalAmount, 18),
      });

      // Pre-flight checks
      const [isRootKnown, isNullifier1Spent, isNullifier2Spent] = await Promise.all([
        publicClient.readContract({
          address: pairAddress as `0x${string}`,
          abi: [{ name: 'isKnownRoot', type: 'function', stateMutability: 'view', inputs: [{ type: 'uint256' }], outputs: [{ type: 'bool' }] }],
          functionName: 'isKnownRoot',
          args: [proofResult.merkleRoot],
        }) as Promise<boolean>,
        publicClient.readContract({
          address: pairAddress as `0x${string}`,
          abi: [{ name: 'isNullifierSpent', type: 'function', stateMutability: 'view', inputs: [{ type: 'uint256' }], outputs: [{ type: 'bool' }] }],
          functionName: 'isNullifierSpent',
          args: [proofResult.nullifierHash1],
        }) as Promise<boolean>,
        publicClient.readContract({
          address: pairAddress as `0x${string}`,
          abi: [{ name: 'isNullifierSpent', type: 'function', stateMutability: 'view', inputs: [{ type: 'uint256' }], outputs: [{ type: 'bool' }] }],
          functionName: 'isNullifierSpent',
          args: [proofResult.nullifierHash2],
        }) as Promise<boolean>,
      ]);

      console.log('[handleConsolidate] Pre-flight checks:', { isRootKnown, isNullifier1Spent, isNullifier2Spent });

      if (!isRootKnown) {
        throw new Error(`Merkle root not recognized by contract. The indexer may be out of sync.`);
      }
      if (isNullifier1Spent) {
        throw new Error('First commitment has already been spent. Please refresh your wallet.');
      }
      if (isNullifier2Spent) {
        throw new Error('Second commitment has already been spent. Please refresh your wallet.');
      }

      // Create encrypted note for the output commitment
      const { encryptNote } = await import('@r00t-fund/sdk');
      const { Wallet } = await import('ethers');
      const ourViewingWallet = new Wallet(session.viewingKey);
      const ourViewingPublicKey = ourViewingWallet.signingKey.compressedPublicKey;

      const encryptedNote = await encryptNote(
        proofResult.outputNullifier,
        proofResult.outputSecret,
        proofResult.totalAmount,
        ourViewingPublicKey
      ) as `0x${string}`;

      console.log('[handleConsolidate] Encrypted note created:', encryptedNote.slice(0, 40) + '...');

      const proof: [bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint] = [
        proofResult.proof[0], proofResult.proof[1], proofResult.proof[2], proofResult.proof[3],
        proofResult.proof[4], proofResult.proof[5], proofResult.proof[6], proofResult.proof[7],
      ];

      // mergeCommitments is on the Router, not the Pair
      const routerAddress = CONTRACTS.zkAMMRouter as `0x${string}`;

      // 10-minute deadline
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 600);

      // Simulate first to get better error message
      try {
        await publicClient.simulateContract({
          address: routerAddress,
          abi: ZKAMM_ABI,
          functionName: 'mergeCommitments',
          args: [
            proof,
            proofResult.merkleRoot,
            proofResult.nullifierHash1,
            proofResult.nullifierHash2,
            proofResult.outputCommitment,
            proofResult.publicInputsBinding,
            deadline,
            encryptedNote,
          ],
          account: address,
        });
        console.log('[handleConsolidate] Simulation passed!');
      } catch (simError: any) {
        console.error('[handleConsolidate] Simulation failed:', simError);
        throw new Error(`Transaction would fail: ${simError.shortMessage || simError.message}`);
      }

      const hash = await walletClient.writeContract({
        address: routerAddress,
        abi: ZKAMM_ABI,
        functionName: 'mergeCommitments',
        args: [
          proof,
          proofResult.merkleRoot,
          proofResult.nullifierHash1,
          proofResult.nullifierHash2,
          proofResult.outputCommitment,
          proofResult.publicInputsBinding,
          deadline,
          encryptedNote,
        ],
        chain: CHAIN,
      });

      await publicClient.waitForTransactionReceipt({ hash });

      // Mark old commitments as spent
      spendCommitment(commitment1.commitment);
      spendCommitment(commitment2.commitment);

      // Store new merged commitment
      storeCommitment(
        proofResult.outputCommitment,
        proofResult.outputNullifier,
        proofResult.outputSecret,
        proofResult.totalAmount,
        allOnChainCommitments.length, // New leaf index
        0
      );

      setConsolidateSuccess(
        `Successfully merged! Combined amount: ${Number(formatUnits(proofResult.totalAmount, 18)).toLocaleString()} ROOT`
      );
      setSelectedConsolidateCommitments([]);

      // Refresh wallet to show updated commitments
      scan();
    } catch (err: unknown) {
      console.error('[handleConsolidate] Error:', err);
      setConsolidateError((err as Error).message || 'Consolidation failed');
    } finally {
      setIsConsolidating(false);
    }
  };

  const toggleConsolidateCommitment = (commitment: any) => {
    setSelectedConsolidateCommitments(prev => {
      const isSelected = prev.some(c => c.leafIndex === commitment.leafIndex);
      if (isSelected) {
        return prev.filter(c => c.leafIndex !== commitment.leafIndex);
      } else if (prev.length < 2) {
        return [...prev, commitment];
      }
      return prev;
    });
  };

  if (!isConnected) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="text-center py-12 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border)]"
      >
        <p className="text-xs font-mono text-[var(--text-muted)] mb-4">
          <span className="text-[var(--accent)] opacity-60">// </span>
          wallet_required
        </p>
        <h3 className="text-lg font-semibold mb-2 text-[var(--text-primary)]">connect to view portfolio</h3>
        <p className="text-[var(--text-muted)] text-sm">
          connect your wallet to see your private $ROOT balance
        </p>
      </motion.div>
    );
  }

  if (!session.viewingKey) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="space-y-6"
      >
        <div className="text-center py-8 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border)]">
          <p className="text-xs font-mono text-[var(--text-muted)] mb-4">
            <span className="text-[var(--accent)] opacity-60">// </span>
            viewing_key
          </p>
          <h3 className="text-lg font-semibold mb-2 text-[var(--text-primary)]">unlock()</h3>
          <p className="text-[var(--text-secondary)] text-sm mb-6">
            Sign a message to derive your viewing key locally
          </p>
        </div>

        <AnimatePresence>
          {session.error && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="p-3 rounded-md text-sm"
              style={{ background: 'var(--error)20', border: '1px solid var(--error)40', color: 'var(--error)' }}
            >
              {session.error}
            </motion.div>
          )}
        </AnimatePresence>

        <GlowButton
          onClick={session.unlock}
          disabled={session.isUnlocking}
          loading={session.isUnlocking}
          variant="primary"
          size="lg"
          className="w-full"
        >
          {session.isUnlocking ? 'waiting for signature...' : 'sign_to_unlock()'}
        </GlowButton>

        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="p-4 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border)] text-xs text-[var(--text-muted)] space-y-2"
        >
          {[
            'no seed phrase required',
            'same key every time from same wallet',
            'nothing stored — sign each visit',
          ].map((text, i) => (
            <motion.p
              key={text}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.3 + i * 0.1 }}
              className="flex items-center gap-2"
            >
              <span style={{ color: 'var(--success)' }}>✓</span>
              {text}
            </motion.p>
          ))}
        </motion.div>
      </motion.div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Balance Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <BalanceCard
          label="private_balance"
          balance={Number(formatUnits(balance, 18)).toLocaleString(undefined, { maximumFractionDigits: 2 })}
          symbol="$ROOT"
          badge="hidden"
          badgeColor="var(--success)"
          subtext={`${commitments.length} commitment${commitments.length !== 1 ? 's' : ''}`}
          delay={0}
          glowing
        />
        <BalanceCard
          label="public_balance"
          balance={Number(formatUnits(publicBalance, 18)).toLocaleString(undefined, { maximumFractionDigits: 2 })}
          symbol="$ROOT"
          badge="ERC20"
          badgeColor="var(--accent-earth)"
          subtext="in your wallet"
          delay={0.1}
        />
      </div>

      {/* Total Balance */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
        className="rounded-md p-4 border"
        style={{
          background: 'var(--accent)10',
          borderColor: 'var(--accent)30',
        }}
      >
        <div className="flex items-center justify-between">
          <span className="text-sm text-[var(--text-muted)] font-mono">// total_balance</span>
          <span className="text-xl font-bold text-[var(--text-primary)]">
            {Number(formatUnits(balance + publicBalance, 18)).toLocaleString(undefined, { maximumFractionDigits: 2 })}
            <span className="text-sm ml-2 text-[var(--text-accent)]">$ROOT</span>
          </span>
        </div>
      </motion.div>

      {/* Sub-tabs */}
      <AnimatedTabs
        tabs={tabs}
        activeTab={activeTab}
        onTabChange={(tab) => setActiveTab(tab as PortfolioTab)}
      />

      {/* Tab Content */}
      <AnimatePresence mode="wait">
        {/* Overview Tab */}
        {activeTab === 'overview' && (
          <motion.div
            key="overview"
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 20 }}
            transition={{ duration: 0.3 }}
            className="space-y-4"
          >
            {/* Actions */}
            <div className="flex gap-2">
              <GlowButton onClick={scan} disabled={isScanning} loading={isScanning} variant="primary" className="flex-1">
                {isScanning ? 'scanning...' : 'scan()'}
              </GlowButton>
              <GlowButton onClick={session.lock} variant="ghost">
                lock()
              </GlowButton>
            </div>

            {/* Recipient Key */}
            {publicKey && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.1 }}
                className="p-4 rounded-md bg-[var(--bg-secondary)] border border-[var(--border)]"
              >
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs font-mono text-[var(--text-muted)]">
                    <span className="text-[var(--accent)] opacity-60">// </span>
                    your_recipient_key
                  </p>
                  <GlowButton
                    onClick={() => navigator.clipboard.writeText(publicKey)}
                    variant="ghost"
                    size="sm"
                  >
                    copy
                  </GlowButton>
                </div>
                <p className="font-mono text-xs text-[var(--text-muted)] break-all bg-[var(--bg-secondary)] p-2 rounded-lg">
                  {publicKey}
                </p>
                <p className="text-xs text-[var(--text-muted)] mt-2 flex items-center gap-2">
                  <span style={{ color: 'var(--accent-earth)' }}>*</span>
                  share this key with friends so they can send you $ROOT privately
                </p>
              </motion.div>
            )}

            {/* Commitments */}
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 }}
            >
              <p className="text-xs font-mono text-[var(--text-muted)] mb-2">
                <span className="text-[var(--accent)] opacity-60">// </span>
                commitments
              </p>
              {commitments.length === 0 ? (
                <div className="text-center py-6 text-[var(--text-muted)] rounded-md bg-[var(--bg-secondary)] border border-[var(--border)]">
                  <p className="text-sm">no commitments found</p>
                  <p className="text-xs mt-1">buy $ROOT to get started</p>
                </div>
              ) : (
                <div className="space-y-2 max-h-48 overflow-y-auto">
                  {commitments.map((c, i) => (
                    <motion.div
                      key={i}
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: 0.1 * i }}
                      whileHover={{ scale: 1.01 }}
                      className="flex items-center justify-between p-3 rounded-md bg-[var(--bg-secondary)] border border-[var(--border)]"
                    >
                      <div>
                        <div className="text-sm font-medium text-[var(--text-primary)]">
                          {Number(formatUnits(BigInt(c.amount), 18)).toLocaleString()} $ROOT
                        </div>
                        <div className="text-xs text-[var(--text-muted)] font-mono">block #{c.blockNumber}</div>
                      </div>
                      <span
                        className="px-2 py-0.5 rounded-full text-[10px] font-mono"
                        style={{ color: 'var(--success)', background: 'var(--success)20', border: '1px solid var(--success)40' }}
                      >
                        available
                      </span>
                    </motion.div>
                  ))}
                </div>
              )}

              {allCommitments.filter((c) => c.spent).length > 0 && (
                <div className="mt-3">
                  <p className="text-xs font-mono text-[var(--text-muted)] mb-1.5">// spent</p>
                  <div className="space-y-1 opacity-50">
                    {allCommitments
                      .filter((c) => c.spent)
                      .map((c, i) => (
                        <div key={i} className="flex items-center justify-between p-2 rounded-lg bg-[var(--bg-secondary)] text-xs">
                          <span className="text-[var(--text-muted)]">
                            {Number(formatUnits(BigInt(c.amount), 18)).toLocaleString()} $ROOT
                          </span>
                          <span className="text-[var(--text-muted)]">spent</span>
                        </div>
                      ))}
                  </div>
                </div>
              )}
            </motion.div>
          </motion.div>
        )}

        {/* Transfer Tab */}
        {activeTab === 'transfer' && (
          <motion.div
            key="transfer"
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 20 }}
            transition={{ duration: 0.3 }}
            className="space-y-4"
          >
            <p className="text-xs text-[var(--text-muted)] font-mono">
              // send $ROOT privately — nobody can see sender, recipient, or amount
            </p>

            {/* Commitment Selector for Transfer */}
            {spendableCommitments.length > 0 && (
              <div className="p-3 rounded-md bg-[var(--bg-secondary)] border border-[var(--border)]">
                <div className="flex items-center gap-2 mb-3">
                  <svg className="w-4 h-4 text-[var(--text-muted)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                  </svg>
                  <span className="text-xs font-mono text-[var(--text-muted)]">
                    <span className="text-[var(--accent)] opacity-60">// </span>
                    select_commitment ({spendableCommitments.length})
                  </span>
                </div>

                <div className="space-y-2 max-h-48 overflow-y-auto">
                  {spendableCommitments.map((c, i) => {
                    const isSelected = selectedTransferCommitment?.leafIndex === c.leafIndex;
                    const amount = Number(formatUnits(c.amountBigInt, 18));
                    return (
                      <motion.button
                        key={c.leafIndex}
                        onClick={() => {
                          setSelectedTransferCommitment(c);
                          // Auto-fill amount with full commitment (rounded)
                          const rounded = Math.floor(amount * 100) / 100;
                          setTransferAmount(rounded.toString());
                        }}
                        whileHover={{ scale: 1.01 }}
                        whileTap={{ scale: 0.99 }}
                        className={`w-full flex items-center justify-between p-2.5 rounded-md transition-all ${
                          isSelected
                            ? 'bg-[var(--accent)]/15 border-2 border-[var(--accent)]/50'
                            : 'bg-[var(--bg-primary)] border border-[var(--border)] hover:border-[var(--accent)]/30'
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <span className={`text-xs font-mono ${isSelected ? 'text-[var(--accent)]' : 'text-[var(--text-muted)]'}`}>
                            #{c.leafIndex}
                          </span>
                          {isSelected && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--accent)]/20 text-[var(--accent)] font-mono flex items-center gap-1">
                              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                              </svg>
                              selected
                            </span>
                          )}
                          {i === 0 && !isSelected && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--text-muted)]/20 text-[var(--text-muted)] font-mono">
                              largest
                            </span>
                          )}
                        </div>
                        <span className={`text-sm font-mono ${isSelected ? 'text-[var(--text-primary)]' : 'text-[var(--text-secondary)]'}`}>
                          {amount.toLocaleString(undefined, { maximumFractionDigits: 2 })} ROOT
                        </span>
                      </motion.button>
                    );
                  })}
                </div>
              </div>
            )}

            <div>
              <p className="text-xs font-mono text-[var(--text-muted)] mb-1.5">
                <span className="text-[var(--accent)] opacity-60">// </span>
                amount
              </p>
              <div className="relative">
                <input
                  type="number"
                  value={transferAmount}
                  onChange={(e) => setTransferAmount(e.target.value)}
                  placeholder="0.0"
                  className="w-full px-4 py-3 rounded-md bg-[var(--bg-secondary)] border border-[var(--border)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--border-focus)] focus:outline-none transition-colors pr-16"
                />
                <button
                  onClick={() => {
                    if (selectedTransferCommitment) {
                      setTransferAmount(formatUnits(BigInt(selectedTransferCommitment.amount), 18));
                    } else {
                      setTransferAmount(formatUnits(balance, 18));
                    }
                  }}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-xs px-2 py-1 rounded bg-[var(--bg-secondary)] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
                >
                  max
                </button>
              </div>
            </div>

            <div>
              <p className="text-xs font-mono text-[var(--text-muted)] mb-1.5">
                <span className="text-[var(--accent)] opacity-60">// </span>
                recipient_key
              </p>
              <textarea
                value={recipientKey}
                onChange={(e) => setRecipientKey(e.target.value)}
                placeholder="0x..."
                className="w-full px-4 py-3 rounded-md bg-[var(--bg-secondary)] border border-[var(--border)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--border-focus)] focus:outline-none transition-colors resize-none h-16 font-mono text-xs"
              />
            </div>

            <AnimatePresence>
              {transferError && (
                <motion.div
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  className="p-2.5 rounded-md text-xs"
                  style={{ background: 'var(--error)20', border: '1px solid var(--error)40', color: 'var(--error)' }}
                >
                  {transferError}
                </motion.div>
              )}
              {transferSuccess && (
                <motion.div
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  className="p-2.5 rounded-md text-xs"
                  style={{ background: 'var(--success)20', border: '1px solid var(--success)40', color: 'var(--success)' }}
                >
                  {transferSuccess}
                </motion.div>
              )}
            </AnimatePresence>

            <GlowButton
              onClick={handleTransfer}
              disabled={!transferAmount || !recipientKey || isTransferring || balance === 0n}
              loading={isTransferring}
              variant="primary"
              size="lg"
              className="w-full"
            >
              {isTransferring ? 'generating zk proof...' : 'transfer_private()'}
            </GlowButton>
          </motion.div>
        )}

        {/* Withdraw Tab */}
        {activeTab === 'withdraw' && (
          <motion.div
            key="withdraw"
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 20 }}
            transition={{ duration: 0.3 }}
            className="space-y-4"
          >
            <div
              className="p-3 rounded-md border"
              style={{ background: 'var(--accent)10', borderColor: 'var(--accent)30' }}
            >
              <p className="text-xs text-[var(--text-primary)]">
                // withdraw to receive ERC20 $ROOT tokens in your wallet
              </p>
              <p className="text-xs text-[var(--text-muted)] mt-1">
                tokens can be traded on Uniswap, transferred, etc.
              </p>
            </div>

            {/* Commitment Selector */}
            {spendableCommitments.length > 0 && (
              <div className="p-3 rounded-md bg-[var(--bg-secondary)] border border-[var(--border)]">
                <div className="flex items-center gap-2 mb-3">
                  <svg className="w-4 h-4 text-[var(--text-muted)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                  </svg>
                  <span className="text-xs font-mono text-[var(--text-muted)]">
                    <span className="text-[var(--accent)] opacity-60">// </span>
                    select_commitment ({spendableCommitments.length})
                  </span>
                </div>

                <div className="space-y-2 max-h-48 overflow-y-auto">
                  {spendableCommitments.map((c, i) => {
                    const isSelected = selectedWithdrawCommitment?.leafIndex === c.leafIndex;
                    const amount = Number(formatUnits(c.amountBigInt, 18));
                    return (
                      <motion.button
                        key={c.leafIndex}
                        onClick={() => {
                          setSelectedWithdrawCommitment(c);
                          // Auto-fill amount with full commitment (rounded)
                          const rounded = Math.floor(amount * 100) / 100;
                          setWithdrawAmount(rounded.toString());
                        }}
                        whileHover={{ scale: 1.01 }}
                        whileTap={{ scale: 0.99 }}
                        className={`w-full flex items-center justify-between p-2.5 rounded-md transition-all ${
                          isSelected
                            ? 'bg-[var(--accent)]/15 border-2 border-[var(--accent)]/50'
                            : 'bg-[var(--bg-primary)] border border-[var(--border)] hover:border-[var(--accent)]/30'
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <span className={`text-xs font-mono ${isSelected ? 'text-[var(--accent)]' : 'text-[var(--text-muted)]'}`}>
                            #{c.leafIndex}
                          </span>
                          {isSelected && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--accent)]/20 text-[var(--accent)] font-mono flex items-center gap-1">
                              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                              </svg>
                              selected
                            </span>
                          )}
                          {i === 0 && !isSelected && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--text-muted)]/20 text-[var(--text-muted)] font-mono">
                              largest
                            </span>
                          )}
                        </div>
                        <span className={`text-sm font-mono ${isSelected ? 'text-[var(--text-primary)]' : 'text-[var(--text-secondary)]'}`}>
                          {amount.toLocaleString(undefined, { maximumFractionDigits: 2 })} ROOT
                        </span>
                      </motion.button>
                    );
                  })}
                </div>

                <p className="text-xs text-[var(--text-muted)] mt-3 flex items-center gap-1.5">
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  Click to select. You can withdraw full or partial amount.
                </p>
              </div>
            )}

            <div>
              <p className="text-xs font-mono text-[var(--text-muted)] mb-1.5">
                <span className="text-[var(--accent)] opacity-60">// </span>
                amount
              </p>
              <div className="relative">
                <input
                  type="number"
                  value={withdrawAmount}
                  onChange={(e) => setWithdrawAmount(e.target.value)}
                  placeholder="0.0"
                  className="w-full px-4 py-3 rounded-md bg-[var(--bg-secondary)] border border-[var(--border)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--border-focus)] focus:outline-none transition-colors pr-24"
                />
                <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1">
                  <button
                    onClick={() => {
                      if (selectedWithdrawCommitment) {
                        const amt = Number(formatUnits(BigInt(selectedWithdrawCommitment.amount), 18));
                        const rounded = Math.floor(amt * 100) / 100;
                        setWithdrawAmount(rounded.toString());
                      }
                    }}
                    className="text-xs px-2 py-1 rounded bg-[var(--bg-secondary)] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
                  >
                    max
                  </button>
                </div>
              </div>
              {selectedWithdrawCommitment && (
                <p className="text-xs text-[var(--text-muted)] mt-1 font-mono">
                  selected: {Number(formatUnits(BigInt(selectedWithdrawCommitment.amount), 18)).toLocaleString(undefined, { maximumFractionDigits: 2 })} ROOT
                </p>
              )}
            </div>

            <div>
              <p className="text-xs font-mono text-[var(--text-muted)] mb-1.5">
                <span className="text-[var(--accent)] opacity-60">// </span>
                recipient_address
              </p>
              <div className="relative">
                <input
                  type="text"
                  value={withdrawRecipient}
                  onChange={(e) => setWithdrawRecipient(e.target.value)}
                  placeholder="0x..."
                  className="w-full px-4 py-3 rounded-md bg-[var(--bg-secondary)] border border-[var(--border)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--border-focus)] focus:outline-none transition-colors font-mono text-xs pr-14"
                />
                <button
                  onClick={() => address && setWithdrawRecipient(address)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-xs px-2 py-1 rounded bg-[var(--bg-secondary)] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
                >
                  me
                </button>
              </div>
            </div>

            <AnimatePresence>
              {withdrawError && (
                <motion.div
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  className="p-2.5 rounded-md text-xs"
                  style={{ background: 'var(--error)20', border: '1px solid var(--error)40', color: 'var(--error)' }}
                >
                  {withdrawError}
                </motion.div>
              )}
              {withdrawSuccess && (
                <motion.div
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  className="p-2.5 rounded-md text-xs"
                  style={{ background: 'var(--success)20', border: '1px solid var(--success)40', color: 'var(--success)' }}
                >
                  <div className="flex items-center justify-between">
                    <span>{withdrawSuccess.message}</span>
                    <a
                      href={getExplorerTxUrl(withdrawSuccess.txHash)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1 text-[var(--text-accent)] hover:underline ml-2"
                    >
                      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                      </svg>
                      tx
                    </a>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            <GlowButton
              onClick={handleWithdraw}
              disabled={!withdrawAmount || !withdrawRecipient || isWithdrawing || !selectedWithdrawCommitment}
              loading={isWithdrawing}
              variant="primary"
              size="lg"
              className="w-full"
            >
              {isWithdrawing ? 'generating zk proof...' : 'withdraw_public()'}
            </GlowButton>
          </motion.div>
        )}

        {/* Consolidate Tab */}
        {activeTab === 'consolidate' && (
          <motion.div
            key="consolidate"
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 20 }}
            transition={{ duration: 0.3 }}
            className="space-y-4"
          >
            <div
              className="p-3 rounded-md border"
              style={{ background: 'var(--accent)10', borderColor: 'var(--accent)30' }}
            >
              <p className="text-xs text-[var(--text-primary)]">
                // merge two commitments into one (privacy-preserving)
              </p>
              <p className="text-xs text-[var(--text-muted)] mt-1">
                Select exactly 2 commitments to combine into a single larger commitment
              </p>
            </div>

            {/* Commitment Selector for Merge */}
            {spendableCommitments.length >= 2 ? (
              <div className="p-3 rounded-md bg-[var(--bg-secondary)] border border-[var(--border)]">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <svg className="w-4 h-4 text-[var(--text-muted)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4" />
                    </svg>
                    <span className="text-xs font-mono text-[var(--text-muted)]">
                      <span className="text-[var(--accent)] opacity-60">// </span>
                      select 2 commitments ({selectedConsolidateCommitments.length}/2)
                    </span>
                  </div>
                  {selectedConsolidateCommitments.length > 0 && (
                    <button
                      onClick={() => setSelectedConsolidateCommitments([])}
                      className="text-xs px-2 py-1 rounded bg-[var(--bg-primary)] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
                    >
                      clear
                    </button>
                  )}
                </div>

                <div className="space-y-2 max-h-64 overflow-y-auto">
                  {spendableCommitments.map((c, i) => {
                    const isSelected = selectedConsolidateCommitments.some(s => s.leafIndex === c.leafIndex);
                    const selectionIndex = selectedConsolidateCommitments.findIndex(s => s.leafIndex === c.leafIndex);
                    const amount = Number(formatUnits(c.amountBigInt, 18));
                    const canSelect = selectedConsolidateCommitments.length < 2 || isSelected;

                    return (
                      <motion.button
                        key={c.leafIndex}
                        onClick={() => toggleConsolidateCommitment(c)}
                        disabled={!canSelect}
                        whileHover={canSelect ? { scale: 1.01 } : {}}
                        whileTap={canSelect ? { scale: 0.99 } : {}}
                        className={`w-full flex items-center justify-between p-2.5 rounded-md transition-all ${
                          isSelected
                            ? 'bg-[var(--accent)]/15 border-2 border-[var(--accent)]/50'
                            : canSelect
                            ? 'bg-[var(--bg-primary)] border border-[var(--border)] hover:border-[var(--accent)]/30'
                            : 'bg-[var(--bg-primary)] border border-[var(--border)] opacity-40 cursor-not-allowed'
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <span className={`text-xs font-mono ${isSelected ? 'text-[var(--accent)]' : 'text-[var(--text-muted)]'}`}>
                            #{c.leafIndex}
                          </span>
                          {isSelected && (
                            <span className="text-[10px] w-5 h-5 flex items-center justify-center rounded-full bg-[var(--accent)] text-white font-bold">
                              {selectionIndex + 1}
                            </span>
                          )}
                          {i === 0 && !isSelected && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--text-muted)]/20 text-[var(--text-muted)] font-mono">
                              largest
                            </span>
                          )}
                        </div>
                        <span className={`text-sm font-mono ${isSelected ? 'text-[var(--text-primary)]' : 'text-[var(--text-secondary)]'}`}>
                          {amount.toLocaleString(undefined, { maximumFractionDigits: 2 })} ROOT
                        </span>
                      </motion.button>
                    );
                  })}
                </div>

                {/* Selection Summary */}
                {selectedConsolidateCommitments.length === 2 && (
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="mt-4 p-3 rounded-md bg-[var(--accent)]/10 border border-[var(--accent)]/30"
                  >
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-[var(--text-muted)] font-mono">// merged_amount</span>
                      <span className="text-[var(--text-primary)] font-bold">
                        {Number(formatUnits(
                          selectedConsolidateCommitments.reduce((sum, c) => sum + BigInt(c.amount), 0n),
                          18
                        )).toLocaleString(undefined, { maximumFractionDigits: 2 })} ROOT
                      </span>
                    </div>
                    <div className="mt-2 text-xs text-[var(--text-muted)] flex items-center gap-1">
                      <svg className="w-3 h-3 text-[var(--accent)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      Both commitments will be spent and replaced with a single new one
                    </div>
                  </motion.div>
                )}
              </div>
            ) : (
              <div className="text-center py-8 rounded-md bg-[var(--bg-secondary)] border border-[var(--border)]">
                <p className="text-sm text-[var(--text-muted)]">
                  You need at least 2 commitments to merge
                </p>
                <p className="text-xs text-[var(--text-muted)] mt-1">
                  Current: {spendableCommitments.length} spendable commitment{spendableCommitments.length !== 1 ? 's' : ''}
                </p>
              </div>
            )}

            <AnimatePresence>
              {consolidateError && (
                <motion.div
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  className="p-2.5 rounded-md text-xs"
                  style={{ background: 'var(--error)20', border: '1px solid var(--error)40', color: 'var(--error)' }}
                >
                  {consolidateError}
                </motion.div>
              )}
              {consolidateSuccess && (
                <motion.div
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  className="p-2.5 rounded-md text-xs"
                  style={{ background: 'var(--success)20', border: '1px solid var(--success)40', color: 'var(--success)' }}
                >
                  {consolidateSuccess}
                </motion.div>
              )}
            </AnimatePresence>

            <GlowButton
              onClick={handleConsolidate}
              disabled={selectedConsolidateCommitments.length !== 2 || isConsolidating}
              loading={isConsolidating}
              variant="primary"
              size="lg"
              className="w-full"
            >
              {isConsolidating ? 'generating zk proof...' : 'merge_commitments()'}
            </GlowButton>

            <div className="text-xs text-[var(--text-muted)] p-3 rounded-md bg-[var(--bg-secondary)] border border-[var(--border)]">
              <p className="flex items-center gap-1.5 mb-1">
                <svg className="w-3.5 h-3.5 text-[var(--accent)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                </svg>
                <span className="font-semibold">Privacy-preserving merge</span>
              </p>
              <p>
                This operation uses ZK proofs to combine commitments without revealing amounts or linkage.
                Both input commitments are spent and replaced with a single output commitment.
              </p>
            </div>
          </motion.div>
        )}

        {/* Liquidity Tab */}
        {activeTab === 'liquidity' && (
          <motion.div
            key="liquidity"
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 20 }}
            transition={{ duration: 0.3 }}
          >
            <LiquidityPanel
              zkAMMAddress={zkAMMAddress}
              viewingKey={session.viewingKey}
              tokenCommitments={commitments}
              onCommitmentSpent={spendCommitment}
              onStoreCommitment={storeCommitment}
              onRefreshBalance={scan}
            />
          </motion.div>
        )}

      </AnimatePresence>
    </div>
  );
}
