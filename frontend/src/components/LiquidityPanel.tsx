import { useState, useEffect, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAccount, usePublicClient, useWalletClient, useBalance } from 'wagmi';
import { formatEther, parseEther } from 'viem';
import { Wallet } from 'ethers';
import { GlowButton } from './ui/GlowButton';
import { AnimatedTabs } from './ui/AnimatedTabs';
import { getExplorerTxUrl, CHAIN, CONTRACTS, NETWORK, EVENTS, TOKEN } from '../config';
import { TRADE_COMPLETE_EVENT } from './PriceChart';
import { encryptNote, decryptNote } from '@r00t-fund/sdk';
import { getBytes } from 'ethers';
import { useZkProver } from '../hooks/useZkProver';
import { usePageVisibility } from '../hooks/usePageVisibility';

// ZkAMM ABI (LP functions) - Updated for dual-sided LP with ZK proofs
const ZKAMM_V3_ABI = [
  {
    name: 'addLiquidityPrivate',
    type: 'function',
    stateMutability: 'payable',
    inputs: [
      { name: 'proof', type: 'uint256[8]' },
      { name: 'merkleRoot', type: 'uint256' },
      { name: 'nullifierHash', type: 'uint256' },
      { name: 'tokenAmount', type: 'uint256' },
      { name: 'lpCommitment', type: 'uint256' },
      { name: 'changeCommitment', type: 'uint256' },
      { name: 'userLpShares', type: 'uint256' }, // LP shares used in commitment (must be within 1% of calculated)
      { name: 'publicInputsBinding', type: 'uint256' },
      { name: 'deadline', type: 'uint256' },
      { name: 'lpNote', type: 'bytes' },
      { name: 'changeNote', type: 'bytes' },
    ],
    outputs: [],
  },
  {
    name: 'removeLiquidityPrivate',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'proof', type: 'uint256[8]' },
      { name: 'merkleRoot', type: 'uint256' },
      { name: 'nullifierHash', type: 'uint256' },
      { name: 'commitment', type: 'uint256' },
      { name: 'lpShares', type: 'uint256' },
      { name: 'minEthOut', type: 'uint256' },
      { name: 'recipient', type: 'address' },
      { name: 'tokenCommitment', type: 'uint256' },
      { name: 'changeLPCommitment', type: 'uint256' },
      { name: 'tokensOut', type: 'uint256' }, // User's claimed tokensOut (validated against calculated)
      { name: 'publicInputsBinding', type: 'uint256' },
      { name: 'deadline', type: 'uint256' },
      { name: 'tokenNote', type: 'bytes' },
      { name: 'changeNote', type: 'bytes' },
    ],
    outputs: [],
  },
  {
    name: 'claimLPFees',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'proof', type: 'uint256[8]' },
      { name: 'lpMerkleRoot', type: 'uint256' },
      { name: 'claimNullifier', type: 'uint256' },
      { name: 'lpShares', type: 'uint256' },
      { name: 'recipient', type: 'address' },
      { name: 'publicInputsBinding', type: 'uint256' },
    ],
    outputs: [],
  },
  {
    name: 'getLPInfo',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [
      { name: '_totalShares', type: 'uint256' },
      { name: '_feePerShare', type: 'uint256' },
      { name: '_accumulatedFees', type: 'uint256' },
    ],
  },
  {
    name: 'ethReserve',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint256' }],
  },
  {
    name: 'tokenReserve',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint256' }],
  },
  {
    name: 'totalLPShares',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint256' }],
  },
  {
    name: 'getRequiredEthForTokens',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'tokenAmount', type: 'uint256' }],
    outputs: [{ name: 'ethRequired', type: 'uint256' }],
  },
  {
    name: 'getRequiredTokensForEth',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'ethAmount', type: 'uint256' }],
    outputs: [{ name: 'tokensRequired', type: 'uint256' }],
  },
  {
    name: 'previewAddLiquidity',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'ethAmount', type: 'uint256' },
      { name: 'tokenAmount', type: 'uint256' },
    ],
    outputs: [{ name: 'lpSharesOut', type: 'uint256' }],
  },
  {
    name: 'currentMerkleRoot',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint256' }],
  },
  {
    name: 'getClaimableFees',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'lpShares', type: 'uint256' }],
    outputs: [{ name: 'claimable', type: 'uint256' }],
  },
] as const;


interface LPPosition {
  commitment: string;
  lpShares: string;
  ethAmount: string;
  tokenAmount: string;
  timestamp: number;
  nullifier: string;
  secret: string;
}

interface LPLockInfo {
  isLocked: boolean;
  depositTime: number;
  unlockTime: number;
  storedShares: bigint;
}

// Token commitment from private wallet
interface TokenCommitment {
  commitment: string;
  amount: string;
  leafIndex: number;
  nullifier?: string;
  secret?: string;
  spent: boolean;
}

interface CommitmentsResult {
  commitments: { commitment: bigint; leafIndex: number }[];
  treeState?: { filledSubtrees: bigint[]; root: bigint };
}

interface LiquidityPanelProps {
  zkAMMAddress: string;
  viewingKey: string | null;
  tokenCommitments: TokenCommitment[];
  onCommitmentSpent: (commitment: string) => void;
  onStoreCommitment?: (
    commitmentHash: bigint,
    nullifier: bigint,
    secret: bigint,
    amount: bigint,
    leafIndex: number,
    blockNumber: number
  ) => void;
  onRefreshBalance?: () => void; // Called after LP removal to refresh token balance
  fetchAllOnChainCommitments?: (targetAddress?: string) => Promise<CommitmentsResult>;
}

type LPTab = 'add' | 'remove' | 'claim';

export function LiquidityPanel({
  zkAMMAddress,
  viewingKey,
  tokenCommitments,
  onCommitmentSpent,
  onStoreCommitment,
  onRefreshBalance,
  fetchAllOnChainCommitments,
}: LiquidityPanelProps) {
  const { isConnected, address } = useAccount();
  const publicClient = usePublicClient();
  const { data: walletClient } = useWalletClient();
  const { data: ethBalance } = useBalance({ address });
  const isPageVisible = usePageVisibility();
  const {
    generateAddLiquidityProof,
    generateRemoveLiquidityProof,
    generateClaimFeesProof,
    isReady: proverReady
  } = useZkProver();

  const [activeTab, setActiveTab] = useState<LPTab>('add');
  const [claimableFees, setClaimableFees] = useState<string>('0');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<{ message: string; txHash?: string } | null>(null);

  // Fee epoch info
  const [epochInfo, setEpochInfo] = useState({
    currentEpoch: 0n,
    lastEpochIncrementTime: 0,
    epochIncrementPending: false,
    nextEpochTime: 0, // When next epoch can be triggered (lastIncrement + 7 days)
  });
  const [hasClaimedThisEpoch, setHasClaimedThisEpoch] = useState(false);

  // Add liquidity state - dual-sided
  const [selectedCommitment, setSelectedCommitment] = useState<TokenCommitment | null>(null);
  const [tokenAmount, setTokenAmount] = useState('');
  const [requiredEth, setRequiredEth] = useState('0');
  const [estimatedShares, setEstimatedShares] = useState('0');

  // Spendable commitments (has nullifier/secret)
  const spendableCommitments = useMemo(() =>
    tokenCommitments.filter(c => !c.spent && c.nullifier && c.secret && BigInt(c.amount) > 0n),
    [tokenCommitments]
  );


  // Pool info
  const [poolInfo, setPoolInfo] = useState({
    totalShares: 0n,
    feePerShare: 0n,
    accumulatedFees: 0n,
    ethReserve: 0n,
    tokenReserve: 0n,
    merkleRoot: 0n,
  });

  // LP positions (stored locally, encrypted on chain)
  const [lpPositions, setLpPositions] = useState<LPPosition[]>([]);

  // LP lock info per position (commitment -> lock info)
  const [lpLockInfo, setLpLockInfo] = useState<Record<string, LPLockInfo>>({});

  // Current time for countdown (updates every second when locked positions exist)
  const [currentTime, setCurrentTime] = useState(Math.floor(Date.now() / 1000));

  // Fetch pool info - extracted as callback so it can be called after transactions
  const fetchPoolInfo = useCallback(async () => {
    if (!publicClient || !zkAMMAddress || zkAMMAddress === '0x...') return;

    // Read state from PAIR contract (not Router)
    const pairAddress = CONTRACTS.zkAMMPair as `0x${string}`;
    try {
      const [lpInfo, ethRes, tokenRes, merkleRoot] = await Promise.all([
        publicClient.readContract({
          address: pairAddress,
          abi: ZKAMM_V3_ABI,
          functionName: 'getLPInfo',
        }).catch(() => [0n, 0n, 0n] as const),
        publicClient.readContract({
          address: pairAddress,
          abi: ZKAMM_V3_ABI,
          functionName: 'ethReserve',
        }).catch(() => 0n),
        publicClient.readContract({
          address: pairAddress,
          abi: ZKAMM_V3_ABI,
          functionName: 'tokenReserve',
        }).catch(() => 0n),
        publicClient.readContract({
          address: pairAddress,
          abi: ZKAMM_V3_ABI,
          functionName: 'currentMerkleRoot',
        }).catch(() => 0n),
      ]);

      setPoolInfo({
        totalShares: lpInfo[0],
        feePerShare: lpInfo[1],
        accumulatedFees: lpInfo[2],
        ethReserve: ethRes,
        tokenReserve: tokenRes,
        merkleRoot: merkleRoot,
      });
    } catch (err) {
      console.error('[LiquidityPanel] Failed to fetch pool info:', err);
    }
  }, [publicClient, zkAMMAddress]);

  // Fetch pool info on mount and poll when visible
  useEffect(() => {
    fetchPoolInfo();

    // Only poll when page is visible to reduce RPC calls
    if (!isPageVisible) return;

    const interval = window.setInterval(fetchPoolInfo, 60000); // Reduced from 30s to 60s
    return () => window.clearInterval(interval);
  }, [fetchPoolInfo, isPageVisible]);

  // LP lock period constant (1 minute for testnet, 24 hours for mainnet)
  const LP_LOCK_PERIOD = 1 * 60; // TESTNET: 60 seconds (matches contract)

  // Fetch lock info for all LP positions and filter out withdrawn ones
  useEffect(() => {
    if (!publicClient || lpPositions.length === 0 || !address) return;

    const fetchLockInfo = async () => {
      const pairAddress = CONTRACTS.zkAMMPair as `0x${string}`;
      const lockInfoMap: Record<string, LPLockInfo> = {};
      const withdrawnCommitments: string[] = [];

      for (const pos of lpPositions) {
        try {
          const commitmentInfo = await publicClient.readContract({
            address: pairAddress,
            abi: [{
              name: 'getLPCommitmentInfo',
              type: 'function',
              stateMutability: 'view',
              inputs: [{ name: 'commitment', type: 'uint256' }],
              outputs: [
                { name: 'lpShares', type: 'uint256' },
                { name: 'depositTime', type: 'uint256' },
                { name: 'feePerShareSnapshot', type: 'uint256' },
                { name: 'isWithdrawn', type: 'bool' },
                { name: 'isLocked', type: 'bool' },
              ],
            }],
            functionName: 'getLPCommitmentInfo',
            args: [BigInt(pos.commitment)],
          }) as [bigint, bigint, bigint, boolean, boolean];

          const isWithdrawn = commitmentInfo[3];

          // Track withdrawn positions for cleanup
          if (isWithdrawn || commitmentInfo[0] === 0n) {
            console.log(`[LiquidityPanel] LP position ${pos.commitment.slice(0, 16)}... is withdrawn, removing from local state`);
            withdrawnCommitments.push(pos.commitment);
            continue;
          }

          const depositTime = Number(commitmentInfo[1]);
          const unlockTime = depositTime + LP_LOCK_PERIOD;

          lockInfoMap[pos.commitment] = {
            isLocked: commitmentInfo[4],
            depositTime,
            unlockTime,
            storedShares: commitmentInfo[0],
          };
        } catch (err) {
          console.error(`[LiquidityPanel] Failed to fetch lock info for ${pos.commitment.slice(0, 16)}...`, err);
        }
      }

      setLpLockInfo(lockInfoMap);

      // Remove withdrawn positions from local state and storage
      if (withdrawnCommitments.length > 0) {
        const remainingPositions = lpPositions.filter(p => !withdrawnCommitments.includes(p.commitment));
        setLpPositions(remainingPositions);
        const key = `lp_positions_${address.toLowerCase()}_${zkAMMAddress.toLowerCase()}`;
        localStorage.setItem(key, JSON.stringify(remainingPositions));
        console.log(`[LiquidityPanel] Cleaned up ${withdrawnCommitments.length} withdrawn LP positions`);
      }
    };

    fetchLockInfo();
  }, [publicClient, lpPositions.length, address, zkAMMAddress]); // Use lpPositions.length to avoid infinite loop

  // Update current time for countdown when there are locked positions
  useEffect(() => {
    // Use local time-based check, NOT the contract's isLocked field.
    // The contract computes isLocked using block.timestamp which can differ
    // from real time on Tenderly VNet, causing the timer to never start.
    const now = Math.floor(Date.now() / 1000);
    const hasLockedPositions = Object.values(lpLockInfo).some(info => now < info.unlockTime);
    if (!hasLockedPositions) return;

    const interval = setInterval(() => {
      setCurrentTime(Math.floor(Date.now() / 1000));
    }, 1000);

    return () => clearInterval(interval);
  }, [lpLockInfo]);

  // Helper to format time remaining
  const formatTimeRemaining = (unlockTime: number): string => {
    const remaining = unlockTime - currentTime;
    if (remaining <= 0) return 'ready!'; // Changed from 'unlocking...' since we now calculate locally

    const hours = Math.floor(remaining / 3600);
    const minutes = Math.floor((remaining % 3600) / 60);
    const seconds = remaining % 60;

    if (hours > 0) {
      return `${hours}h ${minutes}m ${seconds}s`;
    } else if (minutes > 0) {
      return `${minutes}m ${seconds}s`;
    }
    return `${seconds}s`;
  };

  // Calculate required ETH and LP shares when token amount changes
  useEffect(() => {
    if (!tokenAmount || parseFloat(tokenAmount) <= 0 || !publicClient) {
      setRequiredEth('0');
      setEstimatedShares('0');
      return;
    }

    const calculate = async () => {
      try {
        const tokensIn = parseEther(tokenAmount);

        // Always calculate based on current reserve ratio
        if (poolInfo.ethReserve > 0n && poolInfo.tokenReserve > 0n) {
          // Calculate proportional ETH requirement based on current price
          const ethRequired = (tokensIn * poolInfo.ethReserve) / poolInfo.tokenReserve;
          setRequiredEth(formatEther(ethRequired));

          // Apply protocol fee (0.3% = 30 bps) to match contract calculation
          const LP_ADD_PROTOCOL_FEE_BPS = 30n;
          const FEE_DENOMINATOR = 10000n;
          const ethAfterFee = (ethRequired * (FEE_DENOMINATOR - LP_ADD_PROTOCOL_FEE_BPS)) / FEE_DENOMINATOR;

          if (poolInfo.totalShares === 0n) {
            // First LP - shares = sqrt(ethAfterFee * tokens)
            const shares = sqrt(ethAfterFee * tokensIn);
            setEstimatedShares(formatEther(shares));
          } else {
            // Calculate LP shares based on ETH contribution (matching contract)
            // Contract: calculatedLpShares = (ethAfterFee * totalLPShares) / ethReserve
            const shares = (ethAfterFee * poolInfo.totalShares) / poolInfo.ethReserve;
            setEstimatedShares(formatEther(shares));
          }
        } else {
          // No liquidity yet - can't add (shouldn't happen in practice)
          setRequiredEth('0');
          setEstimatedShares('0');
        }
      } catch (err) {
        console.error('[LiquidityPanel] Calculate error:', err);
        setRequiredEth('0');
        setEstimatedShares('0');
      }
    };

    calculate();
  }, [tokenAmount, poolInfo, publicClient]);

  // Helper: integer square root (for first LP shares calculation)
  function sqrt(n: bigint): bigint {
    if (n < 0n) return 0n;
    if (n < 2n) return n;
    let x = n;
    let y = (x + 1n) / 2n;
    while (y < x) {
      x = y;
      y = (x + n / x) / 2n;
    }
    return x;
  }


  // Load LP positions from localStorage
  useEffect(() => {
    if (!viewingKey || !address) return;

    const key = `lp_positions_${address.toLowerCase()}_${zkAMMAddress.toLowerCase()}`;
    try {
      const stored = localStorage.getItem(key);
      if (stored) {
        setLpPositions(JSON.parse(stored));
      }
    } catch {
      // Ignore
    }
  }, [viewingKey, address, zkAMMAddress]);

  // Scan for LP positions from on-chain data (recovery mechanism)
  const [isScanning, setIsScanning] = useState(false);
  const scanLPPositions = useCallback(async () => {
    if (!viewingKey || !address) return;

    setIsScanning(true);
    console.log('[LiquidityPanel] Scanning for LP positions...');

    try {
      const indexerUrl = NETWORK.indexerUrl;
      if (!indexerUrl) {
        console.log('[LiquidityPanel] No indexer URL configured, skipping LP scan');
        setIsScanning(false);
        return;
      }

      // Fetch LP commitments from Ponder with encrypted notes
      const response = await fetch(`${indexerUrl}/graphql`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: `{ lpPositionss(limit: 500, orderBy: "timestamp", orderDirection: "desc") { items { commitment leafIndex lpShares encryptedNote ethAmount tokenAmount } } }`
        })
      });

      const data = await response.json();
      const lpItems = data?.data?.lpPositionss?.items || [];

      if (lpItems.length === 0) {
        console.log('[LiquidityPanel] No LP commitments found in indexer');
        setIsScanning(false);
        return;
      }

      console.log(`[LiquidityPanel] Found ${lpItems.length} LP commitments, attempting decryption...`);

      // Convert viewing key to bytes for decryption
      const viewingKeyBytes = viewingKey.startsWith('0x')
        ? getBytes(viewingKey)
        : getBytes('0x' + viewingKey);

      const recoveredPositions: LPPosition[] = [];
      const existingCommitments = new Set(lpPositions.map(p => p.commitment));

      console.log(`[LiquidityPanel] Viewing key (first 20 chars): ${viewingKey.slice(0, 20)}...`);

      for (const item of lpItems) {
        // Skip if we already have this position
        if (existingCommitments.has(item.commitment)) {
          console.log(`[LiquidityPanel] Skipping ${item.commitment.slice(0, 16)}... (already exists)`);
          continue;
        }

        // Skip if no encrypted note or too short
        if (!item.encryptedNote || item.encryptedNote.length < 100) {
          console.log(`[LiquidityPanel] Skipping ${item.commitment.slice(0, 16)}... (no/short note: ${item.encryptedNote?.length || 0})`);
          continue;
        }

        console.log(`[LiquidityPanel] Trying to decrypt LP commitment: ${item.commitment.slice(0, 16)}...`);
        console.log(`[LiquidityPanel]   leafIndex: ${item.leafIndex}, lpShares: ${item.lpShares}`);
        console.log(`[LiquidityPanel]   encryptedNote length: ${item.encryptedNote.length}, first 40 chars: ${item.encryptedNote.slice(0, 40)}`);

        try {
          const decrypted = await decryptNote(item.encryptedNote, viewingKeyBytes);
          if (decrypted) {
            // CRITICAL: Use decrypted.amount for lpShares, NOT item.lpShares from Ponder
            // The commitment was computed as hash(nullifier, secret, amount) using the encrypted amount
            // The on-chain event's lpShares might differ due to rounding/slippage
            const decryptedLpShares = formatEther(decrypted.amount);
            console.log(`[LiquidityPanel] ✅ Recovered LP position! commitment: ${item.commitment.slice(0, 20)}...`);
            console.log(`[LiquidityPanel]   decrypted lpShares: ${decryptedLpShares}, ponder lpShares: ${item.lpShares}`);
            recoveredPositions.push({
              commitment: item.commitment,
              lpShares: decryptedLpShares, // Must use decrypted amount for circuit verification
              ethAmount: item.ethAmount || '0',
              tokenAmount: item.tokenAmount || '0',
              timestamp: Date.now(),
              nullifier: decrypted.nullifier.toString(),
              secret: decrypted.secret.toString(),
            });
          } else {
            console.log(`[LiquidityPanel] ❌ decryptNote returned null/undefined`);
          }
        } catch (decryptErr) {
          // Decryption failed - not our position (expected) or error
          console.log(`[LiquidityPanel] ❌ Decryption failed: ${(decryptErr as Error).message}`);
        }
      }

      if (recoveredPositions.length > 0) {
        console.log(`[LiquidityPanel] Recovered ${recoveredPositions.length} LP positions!`);
        const key = `lp_positions_${address.toLowerCase()}_${zkAMMAddress.toLowerCase()}`;
        const mergedPositions = [...lpPositions, ...recoveredPositions];
        setLpPositions(mergedPositions);
        localStorage.setItem(key, JSON.stringify(mergedPositions));
      } else {
        console.log('[LiquidityPanel] No recoverable LP positions found');
      }
    } catch (err) {
      console.error('[LiquidityPanel] LP scan failed:', err);
    } finally {
      setIsScanning(false);
    }
  }, [viewingKey, address, zkAMMAddress, lpPositions]);

  // Auto-scan when viewing key becomes available and no positions loaded
  useEffect(() => {
    if (viewingKey && address && lpPositions.length === 0) {
      scanLPPositions();
    }
  }, [viewingKey, address]); // Don't include lpPositions to avoid loop

  // Save LP position (with token amount for dual-sided LP)
  // Uses functional update to avoid stale closure — handleAddLiquidity runs for minutes
  // (proof generation + tx confirmation), during which lpPositions ref can go stale
  const saveLPPosition = useCallback((position: LPPosition) => {
    if (!address) return;

    const key = `lp_positions_${address.toLowerCase()}_${zkAMMAddress.toLowerCase()}`;
    setLpPositions(prev => {
      const newPositions = [...prev, position];
      localStorage.setItem(key, JSON.stringify(newPositions));
      return newPositions;
    });
  }, [address, zkAMMAddress]);

  const handleAddLiquidity = async () => {
    if (!walletClient || !publicClient || !selectedCommitment || !tokenAmount || !address || !viewingKey) {
      setError('Please select a token commitment and enter amount');
      return;
    }

    if (!proverReady) {
      setError('ZK Prover is still loading. Please wait...');
      return;
    }

    if (!selectedCommitment.nullifier || !selectedCommitment.secret) {
      setError('Selected commitment missing secrets - cannot generate proof');
      return;
    }

    setIsLoading(true);
    setError(null);
    setSuccess(null);

    try {
      const tokensToDeposit = parseEther(tokenAmount);
      const ethAmount = parseEther(requiredEth);
      const lpShares = parseEther(estimatedShares);

      // Validate balances
      if (ethBalance && ethAmount > ethBalance.value) {
        throw new Error('Insufficient ETH balance');
      }
      const commitmentTokens = BigInt(selectedCommitment.amount);
      if (tokensToDeposit > commitmentTokens) {
        throw new Error('Token amount exceeds commitment balance');
      }

      // Fetch all on-chain commitments using the shared function (has Ponder + RPC fallback)
      if (!fetchAllOnChainCommitments) {
        throw new Error('fetchAllOnChainCommitments not available — cannot build merkle tree');
      }

      console.log('[LiquidityPanel] Fetching commitments via fetchAllOnChainCommitments...');
      const { commitments: commitmentsWithIndex, treeState } = await fetchAllOnChainCommitments();

      if (commitmentsWithIndex.length === 0) {
        throw new Error('No commitments found. Please wait for the indexer to sync or check your connection.');
      }

      console.log(`[LiquidityPanel] Generating proof with ${commitmentsWithIndex.length} commitments, treeState: ${treeState ? 'available' : 'NOT available'}`);

      // Generate ZK proof
      const proofResult = await generateAddLiquidityProof({
        commitment: {
          nullifier: BigInt(selectedCommitment.nullifier),
          secret: BigInt(selectedCommitment.secret),
          amount: BigInt(selectedCommitment.amount),
          leafIndex: selectedCommitment.leafIndex,
        },
        tokenAmount: tokensToDeposit,
        lpShares: lpShares,
        allCommitments: commitmentsWithIndex,
        treeState, // Use pre-computed tree state from Ponder for instant proof generation
      });

      // Derive public key from viewing key for encryption
      const viewingWallet = new Wallet(viewingKey);
      const viewingPublicKey = viewingWallet.signingKey.compressedPublicKey;

      // Encrypt LP note for recovery (using LP secrets, not change secrets)
      const lpNoteEncrypted = await encryptNote(
        proofResult.lpNullifier,
        proofResult.lpSecret,
        lpShares,
        viewingPublicKey
      );

      // Encrypt change note if there's change
      let changeNoteEncrypted = '0x';
      const changeAmount = commitmentTokens - tokensToDeposit;
      if (changeAmount > 0n) {
        changeNoteEncrypted = await encryptNote(
          proofResult.changeNullifier,
          proofResult.changeSecret,
          changeAmount,
          viewingPublicKey
        );
      }

      // Deadline: use chain's block timestamp (Tenderly VNet timestamps can differ from real time)
      const latestBlock = await publicClient.getBlock();
      const deadline = latestBlock.timestamp + 1800n;

      console.log('[LiquidityPanel] Adding liquidity with ZK proof:', {
        proof: proofResult.proof.map(p => p.toString()),
        merkleRoot: proofResult.merkleRoot.toString(),
        nullifierHash: proofResult.nullifierHash.toString(),
        tokenAmount: tokensToDeposit.toString(),
        lpCommitment: proofResult.lpCommitment.toString(),
        changeCommitment: proofResult.changeCommitment.toString(),
        publicInputsBinding: proofResult.publicInputsBinding.toString(),
        ethAmount: ethAmount.toString(),
        deadline: deadline.toString(),
      });

      // DEBUG: Verify merkle root matches contract
      const tokenPoolAddress = CONTRACTS.tokenPool as `0x${string}`;

      // Get contract's current merkle root
      const contractRoot = await publicClient.readContract({
        address: tokenPoolAddress,
        abi: [{ name: 'root', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] }],
        functionName: 'root',
      }) as bigint;

      // Check if our computed root is known
      const isRootKnown = await publicClient.readContract({
        address: tokenPoolAddress,
        abi: [{ name: 'isKnownRoot', type: 'function', stateMutability: 'view', inputs: [{ name: '_root', type: 'uint256' }], outputs: [{ type: 'bool' }] }],
        functionName: 'isKnownRoot',
        args: [proofResult.merkleRoot],
      }) as boolean;

      console.log('[LiquidityPanel] Merkle root comparison:', {
        frontendRoot: proofResult.merkleRoot.toString(),
        contractCurrentRoot: contractRoot.toString(),
        rootsMatch: proofResult.merkleRoot === contractRoot,
        isRootKnown: isRootKnown,
        commitmentCount: commitmentsWithIndex.length,
        maxLeafIndex: commitmentsWithIndex.length - 1,
      });

      if (!isRootKnown) {
        console.error('[LiquidityPanel] MERKLE ROOT MISMATCH! The frontend-computed root is NOT known by the contract.');
        console.log('[LiquidityPanel] This likely means the merkle tree is built differently between frontend and contract.');
        throw new Error(`Merkle root mismatch: Frontend root ${proofResult.merkleRoot.toString().slice(0, 20)}... is not recognized by contract`);
      }

      // Simulate the transaction first to catch errors
      const routerAddress = CONTRACTS.zkAMMRouter as `0x${string}`;
      console.log('[LiquidityPanel] Router address:', routerAddress);

      try {
        await publicClient.simulateContract({
          address: routerAddress,
          abi: ZKAMM_V3_ABI,
          functionName: 'addLiquidityPrivate',
          args: [
            proofResult.proof as any,
            proofResult.merkleRoot,
            proofResult.nullifierHash,
            tokensToDeposit,
            proofResult.lpCommitment,
            proofResult.changeCommitment,
            lpShares, // User's LP shares (must be within 1% of calculated)
            proofResult.publicInputsBinding,
            deadline,
            lpNoteEncrypted as `0x${string}`,
            changeNoteEncrypted as `0x${string}`,
          ],
          value: ethAmount,
          account: address,
        });
        console.log('[LiquidityPanel] Simulation passed!');
      } catch (simError: any) {
        console.error('[LiquidityPanel] Simulation FAILED:', simError);
        throw new Error(`Transaction would fail: ${simError.message || simError}`);
      }

      const hash = await walletClient.writeContract({
        address: routerAddress,
        abi: ZKAMM_V3_ABI,
        functionName: 'addLiquidityPrivate',
        args: [
          proofResult.proof as any,
          proofResult.merkleRoot,
          proofResult.nullifierHash,
          tokensToDeposit,
          proofResult.lpCommitment,
          proofResult.changeCommitment,
          lpShares, // User's LP shares (must be within 1% of calculated)
          proofResult.publicInputsBinding,
          deadline,
          lpNoteEncrypted as `0x${string}`,
          changeNoteEncrypted as `0x${string}`,
        ],
        value: ethAmount,
        chain: CHAIN,
      });

      const receipt = await publicClient.waitForTransactionReceipt({ hash });

      // Mark the original commitment as spent
      onCommitmentSpent(selectedCommitment.commitment);

      // Save LP position locally (using LP secrets, not change secrets)
      saveLPPosition({
        commitment: proofResult.lpCommitment.toString(),
        lpShares: estimatedShares,
        ethAmount: requiredEth,
        tokenAmount: tokenAmount,
        timestamp: Date.now(),
        nullifier: proofResult.lpNullifier.toString(),
        secret: proofResult.lpSecret.toString(),
      });

      // Store change commitment if applicable
      if (changeAmount > 0n && onStoreCommitment) {
        // Extract leafIndex from NewCommitment event in receipt
        // Find the log that matches the change commitment (there may be multiple NewCommitment events)
        const changeCommitmentHex = '0x' + proofResult.changeCommitment.toString(16).padStart(64, '0');
        const changeLog = receipt.logs.find(log =>
          log.topics[0]?.toLowerCase() === EVENTS.newCommitment.toLowerCase() &&
          log.topics[1]?.toLowerCase() === changeCommitmentHex.toLowerCase()
        );
        const changeLeafIndex = changeLog?.topics[2]
          ? Number(BigInt(changeLog.topics[2]))
          : 0; // Fallback to 0 if not found (will be corrected on next scan)

        console.log(`[LiquidityPanel] Change commitment leafIndex from receipt: ${changeLeafIndex}`);

        onStoreCommitment(
          proofResult.changeCommitment,
          proofResult.changeNullifier,
          proofResult.changeSecret,
          changeAmount,
          changeLeafIndex,
          Number(receipt.blockNumber)
        );
      }

      setSuccess({
        message: `Added ${tokenAmount} tokens + ${requiredEth} ETH as LP`,
        txHash: hash,
      });
      setSelectedCommitment(null);
      setTokenAmount('');

      // Refresh pool info after successful add
      await fetchPoolInfo();

      // Inject trade directly into live feed (works even without Ponder)
      window.dispatchEvent(new CustomEvent(TRADE_COMPLETE_EVENT, {
        detail: {
          type: 'add_lp',
          ethAmount: parseFloat(requiredEth),
          tokenAmount: parseFloat(tokenAmount),
          price: 0,
          lpShares: parseFloat(estimatedShares),
          timestamp: Date.now(),
          txHash: hash,
          blockNumber: Number(receipt.blockNumber),
        }
      }));
    } catch (err: unknown) {
      console.error('[LiquidityPanel] Add liquidity error:', err);
      setError((err as Error).message || 'Failed to add liquidity');
    } finally {
      setIsLoading(false);
    }
  };

  const handleRemoveLiquidity = async (position: LPPosition) => {
    if (!walletClient || !publicClient || !address || !viewingKey) return;
    if (!proverReady) {
      setError('ZK Prover is still loading...');
      return;
    }

    setIsLoading(true);
    setError(null);
    setSuccess(null);

    try {
      // The commitment was created with an estimated lpShares, but the contract
      // stores the ACTUAL lpShares (which may be slightly different due to rounding).
      // We need to use:
      // - The decrypted amount for circuit verification (matches commitment hash)
      // - The minimum of (decrypted, stored) for withdrawShares to pass contract check
      const decryptedLpShares = parseEther(position.lpShares);

      // Query the actual stored lpShares from the contract
      const pairAddress = CONTRACTS.zkAMMPair as `0x${string}`;
      const commitmentInfo = await publicClient.readContract({
        address: pairAddress,
        abi: [{
          name: 'getLPCommitmentInfo',
          type: 'function',
          stateMutability: 'view',
          inputs: [{ name: 'commitment', type: 'uint256' }],
          outputs: [
            { name: 'lpShares', type: 'uint256' },
            { name: 'depositTime', type: 'uint256' },
            { name: 'feePerShareSnapshot', type: 'uint256' },
            { name: 'isWithdrawn', type: 'bool' },
            { name: 'isLocked', type: 'bool' },
          ],
        }],
        functionName: 'getLPCommitmentInfo',
        args: [BigInt(position.commitment)],
      }) as [bigint, bigint, bigint, boolean, boolean];

      const storedLpShares = commitmentInfo[0];
      console.log('[LiquidityPanel] LP shares comparison:', {
        decrypted: decryptedLpShares.toString(),
        stored: storedLpShares.toString(),
        diff: (decryptedLpShares - storedLpShares).toString(),
      });

      if (storedLpShares === 0n) {
        throw new Error('LP commitment not found on-chain or already withdrawn');
      }

      // CRITICAL: The commitment hash contains the lpShares value that was used when creating it.
      // For the circuit to verify, we MUST use that exact value as totalShares.
      // For the contract to accept, withdrawShares must <= storedShares.
      //
      // If decryptedLpShares != storedLpShares, there's a mismatch between what's in the
      // commitment and what's stored on-chain. This happens when:
      // 1. The position was recovered with wrong lpShares (from Ponder's actual shares instead of decrypted)
      // 2. There was rounding between estimated and actual shares during add liquidity
      //
      // If decryptedLpShares > storedLpShares: We can't withdraw all - would need change commitment
      //   but contract's change would be 0 while circuit's would be (decrypted - stored).
      // If decryptedLpShares <= storedLpShares: We can withdraw decryptedLpShares (full from commitment's POV)

      // If there's a mismatch, try to get the correct amount from the on-chain event
      let actualCommitmentShares = decryptedLpShares;

      if (decryptedLpShares !== storedLpShares) {
        console.log('[LiquidityPanel] LP shares mismatch, fetching encryptedNote from on-chain event...');

        // Fetch NewLPCommitment event directly from blockchain to get the correct encryptedNote
        try {
          const pairAddress = CONTRACTS.zkAMMPair as `0x${string}`;
          const logs = await publicClient.getLogs({
            address: pairAddress,
            event: {
              type: 'event',
              name: 'NewLPCommitment',
              inputs: [
                { type: 'uint256', indexed: true, name: 'commitment' },
                { type: 'uint256', indexed: true, name: 'leafIndex' },
                { type: 'uint256', indexed: false, name: 'lpShares' },
                { type: 'bytes', indexed: false, name: 'encryptedNote' },
              ],
            },
            args: {
              commitment: BigInt(position.commitment),
            },
            fromBlock: 7131193n, // Robinhood Chain (4663) DEX deploy block
            toBlock: 'latest',
          });

          if (logs.length > 0 && logs[0].args.encryptedNote) {
            const encryptedNote = logs[0].args.encryptedNote as string;
            console.log('[LiquidityPanel] Found on-chain encryptedNote, decrypting...');

            const viewingKeyBytes = getBytes(viewingKey);
            const decrypted = await decryptNote(encryptedNote, viewingKeyBytes);

            if (decrypted && decrypted.amount > 0n) {
              actualCommitmentShares = decrypted.amount;
              console.log('[LiquidityPanel] Decrypted correct amount from on-chain:', actualCommitmentShares.toString());
            }
          }
        } catch (err) {
          console.warn('[LiquidityPanel] Failed to fetch on-chain event:', err);
        }
      }

      // Now check if we can withdraw
      if (actualCommitmentShares > storedLpShares) {
        const diff = actualCommitmentShares - storedLpShares;
        const diffPercent = (Number(diff) / Number(actualCommitmentShares) * 100).toFixed(4);
        console.error('[LiquidityPanel] MISMATCH: commitment has more shares than on-chain!', {
          commitment: actualCommitmentShares.toString(),
          stored: storedLpShares.toString(),
          diff: diff.toString(),
          diffPercent: `${diffPercent}%`,
        });
        throw new Error(
          `LP position mismatch: commitment has ${diffPercent}% more shares than stored on-chain (${actualCommitmentShares} vs ${storedLpShares}). ` +
          `This is a known issue from add liquidity rounding. The position cannot be withdrawn until a contract upgrade.`
        );
      }

      // Use the actual commitment shares for the circuit
      const withdrawShares = actualCommitmentShares;
      const minEthOut = 0n; // For demo, no slippage protection

      // Fetch all LP commitments from Ponder indexer
      // Try LP Pool address first, fallback to all positions if none found
      const indexerUrl = NETWORK.indexerUrl;
      if (!indexerUrl) throw new Error('Indexer not available — LP withdrawal requires the Ponder indexer to build merkle proofs');
      const lpPoolAddressLower = CONTRACTS.lpPool.toLowerCase();

      let lpResponse = await fetch(`${indexerUrl}/graphql`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: `{ lpPositionss(limit: 1000, orderBy: "leafIndex", where: { address: "${lpPoolAddressLower}" }) { items { commitment leafIndex } } }`
        })
      });

      let lpData = await lpResponse.json();
      let lpItems = lpData?.data?.lpPositionss?.items || [];

      // Fallback: if no positions found with LP Pool address, try without filter
      // This handles cases where positions were indexed before the address fix
      if (lpItems.length === 0) {
        console.log('[LiquidityPanel] No LP positions found with LPPool address, trying without filter...');
        lpResponse = await fetch(`${indexerUrl}/graphql`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            query: `{ lpPositionss(limit: 1000, orderBy: "leafIndex") { items { commitment leafIndex } } }`
          })
        });
        lpData = await lpResponse.json();
        lpItems = lpData?.data?.lpPositionss?.items || [];
      }

      if (lpItems.length === 0) {
        throw new Error('No LP positions found in indexer. Try refreshing or waiting for indexer to sync.');
      }

      // Build array with LP commitments at their correct leaf indices
      const maxLPIndex = Math.max(...lpItems.map((c: any) => Number(c.leafIndex)));

      const ZERO_VALUE = 21663839004416932945382355908790599225266501822907911457504978515578255421292n;
      const allLpCommitments: bigint[] = new Array(maxLPIndex + 1).fill(ZERO_VALUE);

      for (const item of lpItems) {
        const idx = Number(item.leafIndex);
        allLpCommitments[idx] = BigInt(item.commitment);
      }

      // Find leaf index for the commitment
      const leafIndex = allLpCommitments.findIndex(c => c.toString() === position.commitment);
      if (leafIndex === -1) throw new Error('LP commitment not found in tree');

      // Generate ZK proof
      // Map LP commitment hashes to include leafIndex (array index = leafIndex)
      const lpCommitmentsWithIndex = allLpCommitments.map((commitment, index) => ({
        commitment,
        leafIndex: index,
      }));

      // Calculate expected tokens out: tokensOut = (withdrawShares * tokenReserve) / totalLPShares
      // This matches the contract calculation in ZkAMMRouter.sol:476
      // SECURITY FIX: Now calculated BEFORE proof generation and included in circuit
      const expectedTokensOut = poolInfo.totalShares > 0n
        ? (withdrawShares * poolInfo.tokenReserve) / poolInfo.totalShares
        : 0n;

      console.log('[LiquidityPanel] Expected tokens out:', {
        withdrawShares: withdrawShares.toString(),
        tokenReserve: poolInfo.tokenReserve.toString(),
        totalShares: poolInfo.totalShares.toString(),
        expectedTokensOut: expectedTokensOut.toString(),
      });

      // Use actualCommitmentShares for circuit's totalShares (must match commitment hash)
      // withdrawShares is the same since we verified actualCommitmentShares <= storedLpShares
      // SECURITY FIX: tokensOut is now included in proof to make tokens spendable
      const proofResult = await generateRemoveLiquidityProof({
        lpCommitment: {
          nullifier: BigInt(position.nullifier),
          secret: BigInt(position.secret),
          amount: actualCommitmentShares, // Circuit verifies: commitment == hash(nullifier, secret, amount)
          leafIndex: leafIndex,
          commitment: BigInt(position.commitment),
        },
        withdrawShares: withdrawShares, // Same as actualCommitmentShares
        minEthOut: minEthOut,
        recipient: address,
        tokensOut: expectedTokensOut, // SECURITY FIX: Circuit verifies tokenCommitment includes this amount
        allLpCommitments: lpCommitmentsWithIndex,
      });

      // Derive public key from viewing key for encryption
      const viewingWallet = new Wallet(viewingKey);
      const viewingPublicKey = viewingWallet.signingKey.compressedPublicKey;

      // SECURITY FIX: Token commitment now includes tokensOut amount, making tokens SPENDABLE
      // The circuit verifies: tokenCommitment == hash(tokenNullifier, tokenSecret, tokensOut)
      const tokenNoteEncrypted = await encryptNote(
        proofResult.tokenNullifier,
        proofResult.tokenSecret,
        proofResult.tokensOut, // Use the tokensOut from proof result (same as expectedTokensOut)
        viewingPublicKey
      );

      // Encrypt change LP note if any
      let changeNoteEncrypted = '0x';
      if (proofResult.changeCommitment !== 0n) {
        changeNoteEncrypted = await encryptNote(
          proofResult.changeNullifier,
          proofResult.changeSecret,
          0n, // Amount will be determined on-chain
          viewingPublicKey
        );
      }

      // Deadline: use chain's block timestamp (Tenderly VNet timestamps can differ from real time)
      const latestBlock = await publicClient.getBlock();
      const deadline = latestBlock.timestamp + 1800n;

      const routerForRemove = CONTRACTS.zkAMMRouter as `0x${string}`;
      console.log('[LiquidityPanel] Sending removeLiquidityPrivate to Router:', routerForRemove);

      const hash = await walletClient.writeContract({
        address: routerForRemove,
        abi: ZKAMM_V3_ABI,
        functionName: 'removeLiquidityPrivate',
        args: [
          proofResult.proof as any,
          proofResult.merkleRoot,
          proofResult.nullifierHash,
          BigInt(position.commitment),
          withdrawShares, // Use the capped amount (min of decrypted, stored)
          minEthOut,
          address,
          proofResult.tokenCommitment,
          proofResult.changeCommitment,
          proofResult.tokensOut, // Pass tokensOut to contract (validated against calculated)
          proofResult.publicInputsBinding,
          deadline,
          tokenNoteEncrypted as `0x${string}`,
          changeNoteEncrypted as `0x${string}`,
        ],
        chain: CHAIN,
      });

      const receipt = await publicClient.waitForTransactionReceipt({ hash });

      // Remove from local state
      const newPositions = lpPositions.filter(p => p.commitment !== position.commitment);

      // If there's a change commitment, add it back as a new position
      if (proofResult.changeCommitment !== 0n) {
        const remainingShares = decryptedLpShares - withdrawShares;
        newPositions.push({
          commitment: proofResult.changeCommitment.toString(),
          lpShares: formatEther(remainingShares),
          ethAmount: '0', // Will be updated on next scan
          tokenAmount: '0',
          timestamp: Date.now(),
          nullifier: proofResult.changeNullifier.toString(),
          secret: proofResult.changeSecret.toString(),
        });
      }

      setLpPositions(newPositions);
      const key = `lp_positions_${address.toLowerCase()}_${zkAMMAddress.toLowerCase()}`;
      localStorage.setItem(key, JSON.stringify(newPositions));

      // Store the new token commitment in the private wallet with the calculated token amount
      // SECURITY FIX: Use proofResult.tokensOut which is verified in the circuit
      if (onStoreCommitment) {
        // Extract leafIndex from NewCommitment event in receipt
        const tokenCommitmentHex = '0x' + proofResult.tokenCommitment.toString(16).padStart(64, '0');
        const tokenLog = receipt.logs.find(log =>
          log.topics[0]?.toLowerCase() === EVENTS.newCommitment.toLowerCase() &&
          log.topics[1]?.toLowerCase() === tokenCommitmentHex.toLowerCase()
        );
        const tokenLeafIndex = tokenLog?.topics[2]
          ? Number(BigInt(tokenLog.topics[2]))
          : 0; // Fallback - will be corrected on next scan

        console.log('[LiquidityPanel] Token commitment leafIndex from receipt:', tokenLeafIndex);
        console.log('[LiquidityPanel] Storing token commitment with amount:', proofResult.tokensOut.toString());

        onStoreCommitment(
          proofResult.tokenCommitment,
          proofResult.tokenNullifier,
          proofResult.tokenSecret,
          proofResult.tokensOut, // SECURITY FIX: Use tokensOut from proof (verified in circuit)
          tokenLeafIndex,
          Number(receipt.blockNumber)
        );
      }

      setSuccess({
        message: `Removed ${position.lpShares} LP shares`,
        txHash: hash,
      });

      // Refresh pool info after successful remove
      await fetchPoolInfo();

      // Inject trade directly into live feed (works even without Ponder)
      window.dispatchEvent(new CustomEvent(TRADE_COMPLETE_EVENT, {
        detail: {
          type: 'remove_lp',
          ethAmount: parseFloat(position.ethAmount),
          tokenAmount: parseFloat(position.tokenAmount || '0'),
          price: 0,
          lpShares: parseFloat(position.lpShares),
          timestamp: Date.now(),
          txHash: hash,
          blockNumber: Number(receipt.blockNumber),
        }
      }));

      // Refresh balance after LP removal (new token commitment was added)
      if (onRefreshBalance) {
        // Small delay to ensure on-chain state is updated
        setTimeout(() => {
          onRefreshBalance();
        }, 1000);
      }
    } catch (err: any) {
      console.error('[LiquidityPanel] Remove liquidity error:', err);
      setError(err.message || 'Failed to remove liquidity');
    } finally {
      setIsLoading(false);
    }
  };

  const handleClaimFees = async () => {
    console.log('[LiquidityPanel] handleClaimFees called');
    console.log('[LiquidityPanel] State check:', {
      hasWalletClient: !!walletClient,
      hasPublicClient: !!publicClient,
      address,
      hasViewingKey: !!viewingKey,
      lpPositionsCount: lpPositions.length,
      proverReady,
    });

    if (!walletClient || !publicClient || !address || !viewingKey) {
      setError('Please connect wallet and unlock viewing key');
      return;
    }
    if (lpPositions.length === 0) {
      setError('No LP positions found');
      return;
    }
    if (!proverReady) {
      setError('ZK Prover is still loading...');
      return;
    }

    setIsLoading(true);
    setError(null);
    setSuccess(null);

    try {
      const pairAddress = CONTRACTS.zkAMMPair as `0x${string}`;
      const routerAddress = CONTRACTS.zkAMMRouter as `0x${string}`;

      console.log('[LiquidityPanel] Fetching current fee epoch from Pair:', pairAddress);

      // Get current fee epoch
      const feeEpoch = await publicClient.readContract({
        address: pairAddress,
        abi: [{ name: 'currentFeeEpoch', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] }],
        functionName: 'currentFeeEpoch',
      }) as bigint;

      console.log('[LiquidityPanel] Current fee epoch:', feeEpoch.toString());

      // Fetch all LP commitments from Ponder indexer
      // Try without address filter first since positions might be indexed with different address
      const indexerUrl = NETWORK.indexerUrl;
      if (!indexerUrl) throw new Error('Indexer not available — fee claims require the Ponder indexer to build merkle proofs');

      console.log('[LiquidityPanel] Fetching LP positions from indexer:', indexerUrl);

      let lpResponse = await fetch(`${indexerUrl}/graphql`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: `{ lpPositionss(limit: 1000, orderBy: "leafIndex") { items { commitment leafIndex } } }`
        })
      });

      const lpData = await lpResponse.json();
      const lpItems = lpData?.data?.lpPositionss?.items || [];

      console.log('[LiquidityPanel] Found LP items from indexer:', lpItems.length);

      if (lpItems.length === 0) {
        setError('No LP commitments found in indexer. Wait for sync or try again.');
        return;
      }

      const maxIndex = Math.max(...lpItems.map((c: any) => Number(c.leafIndex)));
      const ZERO_VALUE = 21663839004416932945382355908790599225266501822907911457504978515578255421292n;
      const allLpCommitments: bigint[] = new Array(maxIndex + 1).fill(ZERO_VALUE);

      for (const item of lpItems) {
        allLpCommitments[Number(item.leafIndex)] = BigInt(item.commitment);
      }

      console.log('[LiquidityPanel] Built LP merkle tree with', allLpCommitments.length, 'leaves');

      let claimCount = 0;
      let lastHash = '';
      let totalClaimed = 0n;

      for (const position of lpPositions) {
        const lpShares = parseEther(position.lpShares);

        console.log('[LiquidityPanel] Processing position:', {
          commitment: position.commitment.slice(0, 20) + '...',
          lpShares: position.lpShares,
        });

        // Check if this position has fees to claim
        const claimable = await publicClient.readContract({
          address: pairAddress,
          abi: ZKAMM_V3_ABI as any,
          functionName: 'getClaimableFees',
          args: [lpShares],
        }) as bigint;

        console.log('[LiquidityPanel] Claimable fees for position:', formatEther(claimable), 'ETH');

        if (claimable === 0n) {
          console.log('[LiquidityPanel] Skipping position - no claimable fees');
          continue;
        }

        const leafIndex = allLpCommitments.findIndex(c => c.toString() === position.commitment);
        console.log('[LiquidityPanel] Leaf index for commitment:', leafIndex);

        if (leafIndex === -1) {
          console.log('[LiquidityPanel] Skipping position - commitment not found in tree');
          continue;
        }

        // Generate ZK proof
        console.log('[LiquidityPanel] Generating claim fees proof...');
        const lpCommitmentsWithIndex = allLpCommitments.map((commitment, index) => ({
          commitment,
          leafIndex: index,
        }));

        const proofResult = await generateClaimFeesProof({
          lpCommitment: {
            nullifier: BigInt(position.nullifier),
            secret: BigInt(position.secret),
            amount: lpShares,
            leafIndex: leafIndex,
          },
          feeEpoch: feeEpoch,
          recipient: address,
          allLpCommitments: lpCommitmentsWithIndex,
        });

        console.log('[LiquidityPanel] Proof generated:', {
          lpMerkleRoot: proofResult.lpMerkleRoot.toString().slice(0, 20) + '...',
          claimNullifier: proofResult.claimNullifier.toString().slice(0, 20) + '...',
          publicInputsBinding: proofResult.publicInputsBinding.toString().slice(0, 20) + '...',
        });

        // Pre-flight checks
        const [isRootKnown, isNullifierSpent] = await Promise.all([
          publicClient.readContract({
            address: pairAddress,
            abi: [{ name: 'isKnownLPRoot', type: 'function', stateMutability: 'view', inputs: [{ type: 'uint256' }], outputs: [{ type: 'bool' }] }],
            functionName: 'isKnownLPRoot',
            args: [proofResult.lpMerkleRoot],
          }) as Promise<boolean>,
          publicClient.readContract({
            address: pairAddress,
            abi: [{ name: 'isClaimNullifierSpent', type: 'function', stateMutability: 'view', inputs: [{ type: 'uint256' }], outputs: [{ type: 'bool' }] }],
            functionName: 'isClaimNullifierSpent',
            args: [proofResult.claimNullifier],
          }) as Promise<boolean>,
        ]);

        console.log('[LiquidityPanel] Pre-flight checks:', { isRootKnown, isNullifierSpent });

        if (!isRootKnown) {
          throw new Error(`LP Merkle root not recognized. Root: ${proofResult.lpMerkleRoot.toString().slice(0, 20)}...`);
        }
        if (isNullifierSpent) {
          console.log('[LiquidityPanel] Skipping position - claim nullifier already spent (already claimed this epoch)');
          continue;
        }

        console.log('[LiquidityPanel] Sending claimLPFees tx to Router:', routerAddress);

        const hash = await walletClient.writeContract({
          address: routerAddress,
          abi: ZKAMM_V3_ABI,
          functionName: 'claimLPFees',
          args: [
            proofResult.proof as any,
            proofResult.lpMerkleRoot,
            proofResult.claimNullifier,
            lpShares,
            address,
            proofResult.publicInputsBinding,
          ],
          chain: CHAIN,
        });

        console.log('[LiquidityPanel] Transaction submitted:', hash);

        lastHash = hash;
        claimCount++;
        totalClaimed += claimable;

        // Wait for first transaction to avoid nonce issues if many positions
        if (claimCount === 1) {
          const receipt = await publicClient.waitForTransactionReceipt({ hash });
          console.log('[LiquidityPanel] Transaction confirmed:', receipt.status);
        }
      }

      if (claimCount > 0) {
        setSuccess({
          message: `Claimed ${formatEther(totalClaimed)} ETH from ${claimCount} position${claimCount > 1 ? 's' : ''}`,
          txHash: lastHash,
        });

        // Immediately update UI
        setClaimableFees('0');
        setHasClaimedThisEpoch(true);

        // Refresh pool info after successful claim
        await fetchPoolInfo();

        // Trigger live feed refresh
        window.dispatchEvent(new CustomEvent(TRADE_COMPLETE_EVENT));
      } else {
        setError('No fees available to claim for any position');
      }
    } catch (err: any) {
      console.error('[LiquidityPanel] Claim fees error:', err);
      setError(err.message || 'Failed to claim fees');
    } finally {
      setIsLoading(false);
    }
  };

  // Fetch claimable fees - batched to reduce RPC calls
  useEffect(() => {
    if (!publicClient || lpPositions.length === 0) {
      setClaimableFees('0');
      return;
    }

    const fetchClaimableFees = async () => {
      try {
        const pairAddress = CONTRACTS.zkAMMPair as `0x${string}`;

        // Batch all fee queries with Promise.all instead of sequential loop
        const feePromises = lpPositions.map(pos =>
          publicClient.readContract({
            address: pairAddress,
            abi: ZKAMM_V3_ABI as any,
            functionName: 'getClaimableFees',
            args: [parseEther(pos.lpShares)],
          }) as Promise<bigint>
        );

        const fees = await Promise.all(feePromises);
        const totalClaimable = fees.reduce((sum, fee) => sum + fee, 0n);

        setClaimableFees(formatEther(totalClaimable));
      } catch (err) {
        console.error('[LiquidityPanel] Failed to fetch claimable fees:', err);
      }
    };

    fetchClaimableFees();

    // Only poll when page is visible to reduce RPC calls
    if (!isPageVisible) return;

    const interval = setInterval(fetchClaimableFees, 60000); // Reduced from 30s to 60s
    return () => clearInterval(interval);
  }, [publicClient, lpPositions, isPageVisible]);

  // Fetch epoch info and check if user has claimed this epoch
  useEffect(() => {
    if (!publicClient || lpPositions.length === 0) return;

    const fetchEpochInfo = async () => {
      try {
        const pairAddress = CONTRACTS.zkAMMPair as `0x${string}`;

        // Fetch epoch info from Pair contract
        const [currentEpoch, lastEpochTime, pendingIncrement] = await Promise.all([
          publicClient.readContract({
            address: pairAddress,
            abi: [{ name: 'currentFeeEpoch', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] }],
            functionName: 'currentFeeEpoch',
          }) as Promise<bigint>,
          publicClient.readContract({
            address: pairAddress,
            abi: [{ name: 'lastEpochIncrementTime', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] }],
            functionName: 'lastEpochIncrementTime',
          }) as Promise<bigint>,
          publicClient.readContract({
            address: pairAddress,
            abi: [{ name: 'epochIncrementPending', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'bool' }] }],
            functionName: 'epochIncrementPending',
          }) as Promise<boolean>,
        ]);

        const MIN_EPOCH_DURATION = 7 * 24 * 60 * 60; // 7 days in seconds
        const nextEpochTime = Number(lastEpochTime) + MIN_EPOCH_DURATION;

        setEpochInfo({
          currentEpoch,
          lastEpochIncrementTime: Number(lastEpochTime),
          epochIncrementPending: pendingIncrement,
          nextEpochTime,
        });

        // Check if user has already claimed this epoch (check first position's claim nullifier)
        if (lpPositions.length > 0) {
          const pos = lpPositions[0];
          // Compute claim nullifier for this position + current epoch
          // We need to use the SDK's hashClaimNullifier function
          // For now, just check via contract call
          const { hashClaimNullifier } = await import('@r00t-fund/sdk');

          // Find leaf index for the commitment from indexer
          const indexerUrl = NETWORK.indexerUrl;
          if (indexerUrl) {
            const lpResponse = await fetch(`${indexerUrl}/graphql`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                query: `{ lpPositionss(limit: 1000, orderBy: "leafIndex") { items { commitment leafIndex } } }`
              })
            });
            const lpData = await lpResponse.json();
            const lpItems = lpData?.data?.lpPositionss?.items || [];
            const leafIndex = lpItems.findIndex((item: any) => item.commitment === pos.commitment);

            if (leafIndex !== -1) {
              const claimNullifier = hashClaimNullifier(
                BigInt(pos.nullifier),
                currentEpoch,
                leafIndex
              );

              const isSpent = await publicClient.readContract({
                address: pairAddress,
                abi: [{ name: 'isClaimNullifierSpent', type: 'function', stateMutability: 'view', inputs: [{ type: 'uint256' }], outputs: [{ type: 'bool' }] }],
                functionName: 'isClaimNullifierSpent',
                args: [claimNullifier],
              }) as boolean;

              setHasClaimedThisEpoch(isSpent);
            }
          }
        }
      } catch (err) {
        console.error('[LiquidityPanel] Failed to fetch epoch info:', err);
      }
    };

    fetchEpochInfo();
  }, [publicClient, lpPositions]);

  const tabs = [
    { id: 'add' as const, label: '_add' },
    { id: 'remove' as const, label: '_remove' },
    { id: 'claim' as const, label: '_claim' },
  ];

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
        <h3 className="text-lg font-semibold mb-2 text-[var(--text-primary)]">connect to provide liquidity</h3>
      </motion.div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Pool Info */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="grid grid-cols-2 sm:grid-cols-4 gap-3"
      >
        <div className="p-3 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border)]">
          <p className="text-xs text-[var(--text-muted)] font-mono">// tvl</p>
          <p className="text-lg font-bold text-[var(--text-primary)]">
            {Number(formatEther(poolInfo.ethReserve)).toFixed(4)} <span className="text-sm text-[var(--text-muted)]">ETH</span>
          </p>
          <p className="text-xs text-[var(--text-muted)]">
            + {Number(formatEther(poolInfo.tokenReserve)).toFixed(0)} ${TOKEN.symbol}
          </p>
        </div>
        <div className="p-3 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border)]">
          <p className="text-xs text-[var(--text-muted)] font-mono">// total_lp</p>
          <p className="text-lg font-bold text-[var(--text-primary)]">
            {Number(formatEther(poolInfo.totalShares)).toFixed(2)}
          </p>
          <p className="text-xs text-[var(--text-muted)]">shares</p>
        </div>
        <div className="p-3 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border)]">
          <p className="text-xs text-[var(--text-muted)] font-mono">// lp_fees</p>
          <p className="text-lg font-bold text-[var(--accent)]">
            {Number(formatEther(poolInfo.accumulatedFees)).toFixed(6)} <span className="text-sm text-[var(--text-muted)]">ETH</span>
          </p>
          <p className="text-xs text-[var(--text-muted)]">0.7% per swap</p>
        </div>
        <div className="p-3 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border)] relative overflow-hidden">
          {(() => {
            const yourShares = lpPositions.reduce((sum, p) => sum + parseFloat(p.lpShares), 0);
            const totalSharesNum = Number(formatEther(poolInfo.totalShares)) || 1;
            const poolPct = totalSharesNum > 0 ? (yourShares / totalSharesNum) * 100 : 0;
            const yourEth = poolPct > 0 ? (poolPct / 100) * Number(formatEther(poolInfo.ethReserve)) : 0;
            const yourTokens = poolPct > 0 ? (poolPct / 100) * Number(formatEther(poolInfo.tokenReserve)) : 0;
            return (
              <>
                {poolPct > 0 && (
                  <div
                    className="absolute inset-0 opacity-20 pointer-events-none"
                    style={{ background: 'radial-gradient(circle at 50% 0%, var(--accent) 0%, transparent 70%)' }}
                  />
                )}
                <p className="text-xs text-[var(--text-muted)] font-mono">// your_lp</p>
                <p className="text-lg font-bold text-[var(--text-primary)]">
                  {poolPct.toFixed(2)}<span className="text-sm text-[var(--text-muted)]">%</span>
                </p>
                <p className="text-xs text-[var(--text-muted)]">
                  {yourEth.toFixed(4)} ETH + {yourTokens.toFixed(0)} tokens
                </p>
              </>
            );
          })()}
        </div>
      </motion.div>

      {/* Tabs */}
      <AnimatedTabs
        tabs={tabs}
        activeTab={activeTab}
        onTabChange={(tab) => setActiveTab(tab as LPTab)}
      />

      {/* Tab Content */}
      <AnimatePresence mode="wait">
        {/* Add Liquidity Tab - Dual-sided (ETH + Tokens) */}
        {activeTab === 'add' && (
          <motion.div
            key="add"
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
                // add ETH + tokens as LP — earn 0.7% of all swaps
              </p>
              <p className="text-xs text-[var(--text-muted)] mt-1">
                dual-sided LP • 24h lock • 0.3% protocol fee on add
              </p>
            </div>

            {/* Token Commitment Selector */}
            <div>
              <p className="text-xs font-mono text-[var(--text-muted)] mb-1.5">
                <span className="text-[var(--accent)] opacity-60">// </span>
                select_token_commitment
              </p>
              {spendableCommitments.length === 0 ? (
                <div className="p-3 rounded-md bg-[var(--bg-secondary)] border border-[var(--border)] text-center">
                  <p className="text-xs text-[var(--text-muted)]">no spendable token commitments</p>
                  <p className="text-[10px] text-[var(--text-muted)] mt-1">buy tokens first to add liquidity</p>
                </div>
              ) : (
                <div className="space-y-2 max-h-32 overflow-y-auto">
                  {spendableCommitments.map((c, i) => (
                    <button
                      key={i}
                      onClick={() => {
                        setSelectedCommitment(c);
                        // Auto-fill with full amount
                        setTokenAmount(formatEther(BigInt(c.amount)));
                      }}
                      className={`w-full p-2 rounded-md text-left transition-all ${selectedCommitment?.commitment === c.commitment
                        ? 'bg-[var(--accent)20] border-[var(--accent)]'
                        : 'bg-[var(--bg-secondary)] border-[var(--border)] hover:border-[var(--border-focus)]'
                        } border`}
                    >
                      <div className="flex justify-between items-center">
                        <span className="text-xs font-mono text-[var(--text-primary)]">
                          {Number(formatEther(BigInt(c.amount))).toFixed(4)} ${TOKEN.symbol}
                        </span>
                        <span className="text-[10px] text-[var(--text-muted)]">
                          leaf #{c.leafIndex}
                        </span>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Token Amount Input */}
            {selectedCommitment && (
              <div>
                <p className="text-xs font-mono text-[var(--text-muted)] mb-1.5">
                  <span className="text-[var(--accent)] opacity-60">// </span>
                  token_amount
                </p>
                <div className="relative">
                  <input
                    type="number"
                    value={tokenAmount}
                    onChange={(e) => setTokenAmount(e.target.value)}
                    placeholder="0.0"
                    max={formatEther(BigInt(selectedCommitment.amount))}
                    className="w-full px-4 py-3 rounded-md bg-[var(--bg-secondary)] border border-[var(--border)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--border-focus)] focus:outline-none transition-colors pr-20"
                  />
                  <button
                    onClick={() => setTokenAmount(formatEther(BigInt(selectedCommitment.amount)))}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-xs px-2 py-1 rounded bg-[var(--bg-secondary)] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
                  >
                    max
                  </button>
                </div>
                <p className="text-[10px] text-[var(--text-muted)] mt-1">
                  available: {Number(formatEther(BigInt(selectedCommitment.amount))).toFixed(4)} ${TOKEN.symbol}
                </p>
              </div>
            )}

            {/* Required ETH & LP Preview */}
            {tokenAmount && parseFloat(tokenAmount) > 0 && (
              <div className="p-3 rounded-md bg-[var(--bg-secondary)] border border-[var(--border)] space-y-2">
                <div className="flex justify-between text-xs">
                  <span className="text-[var(--text-muted)]">required ETH</span>
                  <span className="text-[var(--text-primary)] font-mono">
                    {Number(requiredEth).toFixed(6)} ETH
                    {ethBalance && parseFloat(requiredEth) > parseFloat(formatEther(ethBalance.value)) && (
                      <span className="text-[var(--error)] ml-1">(insufficient)</span>
                    )}
                  </span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-[var(--text-muted)]">estimated LP shares</span>
                  <span className="text-[var(--text-primary)] font-mono">{Number(estimatedShares).toFixed(4)}</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-[var(--text-muted)]">fee share</span>
                  <span className="text-[var(--accent)] font-mono">0.7% per swap</span>
                </div>
                {selectedCommitment && parseFloat(tokenAmount) < parseFloat(formatEther(BigInt(selectedCommitment.amount))) && (
                  <div className="flex justify-between text-xs pt-1 border-t border-[var(--border)]">
                    <span className="text-[var(--text-muted)]">change returned</span>
                    <span className="text-[var(--text-primary)] font-mono">
                      {(Number(formatEther(BigInt(selectedCommitment.amount))) - parseFloat(tokenAmount)).toFixed(4)} ${TOKEN.symbol}
                    </span>
                  </div>
                )}
              </div>
            )}

            <AnimatePresence>
              {error && (
                <motion.div
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  className="p-2.5 rounded-md text-xs"
                  style={{ background: 'var(--error)20', border: '1px solid var(--error)40', color: 'var(--error)' }}
                >
                  {error}
                </motion.div>
              )}
              {success && (
                <motion.div
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  className="p-2.5 rounded-md text-xs"
                  style={{ background: 'var(--success)20', border: '1px solid var(--success)40', color: 'var(--success)' }}
                >
                  <div className="flex items-center justify-between">
                    <span>{success.message}</span>
                    {success.txHash && getExplorerTxUrl(success.txHash) ? (
                      <a
                        href={getExplorerTxUrl(success.txHash)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1 hover:underline ml-2"
                      >
                        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                        </svg>
                        tx
                      </a>
                    ) : success.txHash ? (
                      <span className="text-xs font-mono opacity-70 ml-2">{success.txHash.slice(0, 10)}...</span>
                    ) : null}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            <GlowButton
              onClick={handleAddLiquidity}
              disabled={
                !selectedCommitment ||
                !tokenAmount ||
                !viewingKey ||
                isLoading ||
                parseFloat(tokenAmount) <= 0 ||
                parseFloat(requiredEth) <= 0 ||
                (ethBalance && parseFloat(requiredEth) > parseFloat(formatEther(ethBalance.value)))
              }
              loading={isLoading}
              variant="primary"
              size="lg"
              className="w-full"
            >
              {!viewingKey
                ? 'unlock() first'
                : !selectedCommitment
                  ? 'select commitment'
                  : isLoading
                    ? 'adding liquidity...'
                    : `add_liquidity(${Number(tokenAmount).toFixed(2)} + ${Number(requiredEth).toFixed(4)} ETH)`}
            </GlowButton>
          </motion.div>
        )}

        {/* Remove Liquidity Tab */}
        {activeTab === 'remove' && (
          <motion.div
            key="remove"
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 20 }}
            transition={{ duration: 0.3 }}
            className="space-y-4"
          >
            <div
              className="p-3 rounded-md border"
              style={{ background: 'var(--warning)10', borderColor: 'var(--warning)30' }}
            >
              <p className="text-xs text-[var(--text-primary)]">
                // remove liquidity — returns ETH + tokens
              </p>
              <p className="text-xs text-[var(--text-muted)] mt-1">
                requires ZK proof • 24h lock after deposit
              </p>
            </div>

            {lpPositions.length > 0 ? (
              <div className="space-y-2">
                <p className="text-xs font-mono text-[var(--text-muted)]">// your_positions</p>
                {lpPositions.map((pos, i) => {
                  // Calculate current value based on pool ratios
                  const lpShares = parseFloat(pos.lpShares);
                  const totalSharesNum = Number(formatEther(poolInfo.totalShares)) || 1;
                  const shareRatio = lpShares / totalSharesNum;
                  const currentEth = shareRatio * Number(formatEther(poolInfo.ethReserve));
                  const currentTokens = shareRatio * Number(formatEther(poolInfo.tokenReserve));

                  // Get lock info for this position
                  const lockInfo = lpLockInfo[pos.commitment];
                  // FIXED: Calculate isLocked locally based on currentTime so UI updates when timer reaches 0
                  // Previously used lockInfo?.isLocked which required page refresh to update
                  const isLocked = lockInfo ? currentTime < lockInfo.unlockTime : true; // Default to locked if unknown

                  return (
                    <div
                      key={i}
                      className={`p-3 rounded-md bg-[var(--bg-secondary)] border ${
                        isLocked ? 'border-[var(--warning)]/50' : 'border-[var(--border)]'
                      }`}
                    >
                      <div className="flex justify-between items-start mb-2">
                        <div>
                          <p className="text-sm font-medium text-[var(--text-primary)]">
                            {lpShares.toFixed(4)} LP
                          </p>
                          {/* Lock status indicator */}
                          {lockInfo && (
                            <div className="mt-1">
                              {isLocked ? (
                                <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-mono bg-[var(--warning)]/20 text-[var(--warning)] border border-[var(--warning)]/40">
                                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                                  </svg>
                                  unlocks in {formatTimeRemaining(lockInfo.unlockTime)}
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-mono bg-[var(--success)]/20 text-[var(--success)] border border-[var(--success)]/40">
                                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 11V7a4 4 0 118 0m-4 8v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2z" />
                                  </svg>
                                  unlocked
                                </span>
                              )}
                            </div>
                          )}
                        </div>
                        <GlowButton
                          onClick={() => handleRemoveLiquidity(pos)}
                          disabled={isLoading || isLocked}
                          loading={isLoading}
                          variant="secondary"
                          size="sm"
                          title={isLocked ? 'Position is locked for 24h after deposit' : 'Remove liquidity'}
                        >
                          {isLocked ? 'locked' : 'remove'}
                        </GlowButton>
                      </div>
                      <div className="grid grid-cols-2 gap-2 text-xs">
                        <div>
                          <p className="text-[var(--text-muted)]">deposited</p>
                          <p className="text-[var(--text-primary)] font-mono">
                            {pos.ethAmount} ETH + {pos.tokenAmount || '0'} tokens
                          </p>
                        </div>
                        <div>
                          <p className="text-[var(--text-muted)]">current value</p>
                          <p className="text-[var(--accent)] font-mono">
                            {currentEth.toFixed(4)} ETH + {currentTokens.toFixed(2)} tokens
                          </p>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="text-center py-8 rounded-md bg-[var(--bg-secondary)] border border-[var(--border)]">
                <p className="text-sm text-[var(--text-muted)]">no LP positions</p>
                <p className="text-xs text-[var(--text-muted)] mt-1">add liquidity to get started</p>
                <button
                  onClick={scanLPPositions}
                  disabled={isScanning}
                  className="mt-3 text-xs px-3 py-1.5 rounded bg-[var(--bg-tertiary)] border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:border-[var(--accent)] transition-colors disabled:opacity-50"
                >
                  {isScanning ? 'scanning...' : 'scan for lost positions'}
                </button>
              </div>
            )}
          </motion.div>
        )}

        {/* Claim Fees Tab */}
        {activeTab === 'claim' && (
          <motion.div
            key="claim"
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
                // claim accumulated LP fees without removing liquidity
              </p>
              <p className="text-xs text-[var(--text-muted)] mt-1">
                requires ZK proof • one claim per epoch
              </p>
            </div>

            {/* Epoch Info */}
            <div className="p-3 rounded-md bg-[var(--bg-secondary)] border border-[var(--border)]">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className="text-xs font-mono text-[var(--text-muted)]">// current_epoch</p>
                  <p className="text-lg font-bold text-[var(--text-primary)]">
                    #{epochInfo.currentEpoch.toString()}
                  </p>
                </div>
                <div>
                  <p className="text-xs font-mono text-[var(--text-muted)]">// next_epoch_in</p>
                  <p className="text-lg font-bold text-[var(--text-primary)]">
                    {(() => {
                      const remaining = epochInfo.nextEpochTime - currentTime;
                      if (remaining <= 0) return 'ready';
                      const days = Math.floor(remaining / 86400);
                      const hours = Math.floor((remaining % 86400) / 3600);
                      if (days > 0) return `${days}d ${hours}h`;
                      const mins = Math.floor((remaining % 3600) / 60);
                      return `${hours}h ${mins}m`;
                    })()}
                  </p>
                </div>
              </div>
              {hasClaimedThisEpoch && (
                <div className="mt-3 pt-3 border-t border-[var(--border)]">
                  <div className="flex items-center gap-2 text-[var(--warning)]">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <p className="text-xs font-mono">
                      already claimed this epoch — wait for next epoch to claim again
                    </p>
                  </div>
                </div>
              )}
            </div>

            <div className="p-4 rounded-md bg-[var(--bg-secondary)] border border-[var(--border)]">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <p className="text-xs font-mono text-[var(--text-muted)] mb-1">// your_claimable_fees</p>
                  <p className="text-2xl font-bold text-[var(--text-primary)]">
                    {Number(claimableFees).toLocaleString(undefined, { maximumFractionDigits: 6 })}
                    <span className="text-sm ml-2 text-[var(--text-accent)]">ETH</span>
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-xs font-mono text-[var(--text-muted)] mb-1">// status</p>
                  {hasClaimedThisEpoch ? (
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-mono bg-[var(--warning)]/20 text-[var(--warning)] border border-[var(--warning)]/40">
                      claimed_this_epoch
                    </span>
                  ) : Number(claimableFees) > 0 ? (
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-mono bg-[var(--success)]/20 text-[var(--success)] border border-[var(--success)]/40">
                      ready_to_claim
                    </span>
                  ) : (
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-mono bg-[var(--text-muted)]/20 text-[var(--text-muted)] border border-[var(--text-muted)]/40">
                      no_fees
                    </span>
                  )}
                </div>
              </div>

              <GlowButton
                onClick={handleClaimFees}
                disabled={isLoading || Number(claimableFees) === 0 || hasClaimedThisEpoch}
                loading={isLoading}
                variant="primary"
                className="w-full"
              >
                {hasClaimedThisEpoch ? 'already_claimed_this_epoch' : 'claim_fees()'}
              </GlowButton>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
