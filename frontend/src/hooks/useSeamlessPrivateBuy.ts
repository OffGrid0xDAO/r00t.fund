/**
 * useSeamlessPrivateBuy - One-Click Anonymous Token Purchase
 *
 * This hook provides TRUE anonymity with a seamless UX:
 *
 * Option 1: "Quick Private" (default)
 * - User's wallet calls buyPrivate() directly
 * - Tokens are private (stored as commitments)
 * - BUT: The buy transaction is visible on-chain
 *
 * Option 2: "Full Anonymous"
 * - Shield ETH to Railgun first (one-time setup)
 * - Then buy using shielded balance via cross-contract call
 * - COMPLETE privacy: no link between wallet and purchase
 *
 * The key insight: Shielding is done ONCE, then all subsequent
 * buys are anonymous via cross-contract calls.
 */

import { useState, useCallback, useEffect } from 'react';
import { useAccount, usePublicClient, useWalletClient } from 'wagmi';
import {
  parseEther,
  keccak256,
  toBytes,
  type Address,
  type Hex
} from 'viem';
import { Wallet } from 'ethers';
import { hashCommitment as poseidonHashCommitment, randomFieldElement, encryptNote } from '@r00t-fund/sdk';
import { EXTERNAL, EVENTS, CHAIN, CONTRACTS } from '../config';

// Storage keys
const ANON_MODE_KEY = 'r00t_anon_mode';
const SHIELD_STATE_KEY = 'r00t_shield_state';

// Contract ABIs
const WETH_ABI = [
  { name: 'deposit', type: 'function', stateMutability: 'payable', inputs: [], outputs: [] },
  { name: 'approve', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [{ type: 'bool' }] },
  { name: 'balanceOf', type: 'function', stateMutability: 'view', inputs: [{ name: 'account', type: 'address' }], outputs: [{ type: 'uint256' }] },
] as const;

const ZKAMM_ABI = [
  {
    name: 'buyPrivate',
    type: 'function',
    stateMutability: 'payable',
    inputs: [
      { name: 'newCommitment', type: 'uint256' },
      { name: 'minTokensOut', type: 'uint256' },
      { name: 'deadline', type: 'uint256' },
      { name: 'encryptedNote', type: 'bytes' },
    ],
    outputs: [],
  },
  {
    name: 'getAmountOut',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'amountIn', type: 'uint256' },
      { name: 'reserveIn', type: 'uint256' },
      { name: 'reserveOut', type: 'uint256' },
    ],
    outputs: [{ type: 'uint256' }],
  },
  { name: 'ethReserve', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { name: 'tokenReserve', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
] as const;

// Railgun Proxy ABI
const RAILGUN_PROXY_ABI = [{
  name: 'shield',
  type: 'function',
  stateMutability: 'nonpayable',
  inputs: [{
    name: 'shieldRequests',
    type: 'tuple[]',
    components: [
      { name: 'preImage', type: 'tuple', components: [
        { name: 'npk', type: 'bytes32' },
        { name: 'token', type: 'tuple', components: [
          { name: 'tokenType', type: 'uint8' },
          { name: 'tokenAddress', type: 'address' },
          { name: 'tokenSubID', type: 'uint256' }
        ]},
        { name: 'value', type: 'uint128' }
      ]},
      { name: 'encryptedRandom', type: 'bytes16[2]' }
    ]
  }],
  outputs: []
}] as const;

type PrivacyMode = 'quick' | 'anonymous';

interface BuyParams {
  ethAmount: string;
  minTokensOut: bigint;
  viewingKey: string;
  onProgress?: (step: string, percent: number) => void;
}

interface BuyResult {
  success: boolean;
  txHash?: string;
  commitment?: bigint;
  nullifier?: bigint;
  secret?: bigint;
  tokensReceived?: bigint;
  leafIndex?: number;
  error?: string;
}

interface ShieldState {
  isShielded: boolean;
  shieldedBalance: bigint;
  lastShieldTx: string | null;
}

/**
 * Hook for seamless private token purchases
 */
export function useSeamlessPrivateBuy(zkAMMAddress: string) {
  const { address, isConnected } = useAccount();
  const publicClient = usePublicClient();
  const { data: walletClient, isLoading: isWalletLoading, refetch: refetchWallet } = useWalletClient({ chainId: CHAIN.id });

  // State
  const [privacyMode, setPrivacyMode] = useState<PrivacyMode>('quick');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState({ step: '', percent: 0 });
  const [shieldState, setShieldState] = useState<ShieldState>({
    isShielded: false,
    shieldedBalance: 0n,
    lastShieldTx: null,
  });

  // Load saved state
  useEffect(() => {
    if (!address) return;

    // Load privacy mode preference
    const savedMode = localStorage.getItem(`${ANON_MODE_KEY}_${address}`);
    if (savedMode === 'anonymous' || savedMode === 'quick') {
      setPrivacyMode(savedMode);
    }

    // Load shield state
    const savedShield = localStorage.getItem(`${SHIELD_STATE_KEY}_${address}`);
    if (savedShield) {
      const parsed = JSON.parse(savedShield);
      setShieldState({
        isShielded: parsed.isShielded || false,
        shieldedBalance: BigInt(parsed.shieldedBalance || '0'),
        lastShieldTx: parsed.lastShieldTx || null,
      });
    }
  }, [address]);

  // Save privacy mode preference
  const togglePrivacyMode = useCallback(() => {
    const newMode = privacyMode === 'quick' ? 'anonymous' : 'quick';
    setPrivacyMode(newMode);
    if (address) {
      localStorage.setItem(`${ANON_MODE_KEY}_${address}`, newMode);
    }
  }, [privacyMode, address]);

  // Try to refetch wallet client when connected but missing
  useEffect(() => {
    if (isConnected && !walletClient && !isWalletLoading) {
      refetchWallet();
    }
  }, [isConnected, walletClient, isWalletLoading, refetchWallet]);

  /**
   * Quick Private Buy - Direct contract call
   * Fast but your wallet address is visible in the buy tx
   */
  const buyQuickPrivate = useCallback(async ({
    ethAmount,
    minTokensOut: _minTokensOut,
    viewingKey,
    onProgress
  }: BuyParams): Promise<BuyResult> => {
    void _minTokensOut; // Unused for now - will be used for slippage protection
    if (!walletClient || !publicClient || !address) {
      return { success: false, error: 'Wallet not connected' };
    }

    setIsLoading(true);
    setError(null);

    const updateProgress = (step: string, percent: number) => {
      setProgress({ step, percent });
      onProgress?.(step, percent);
    };

    try {
      const ethAmountWei = parseEther(ethAmount);

      updateProgress('Estimating output...', 10);

      // Get pool reserves - read from PAIR contract (state), not Router
      const pairAddress = CONTRACTS.zkAMMPair as Address;
      const [ethReserve, tokenReserve] = await Promise.all([
        publicClient.readContract({
          address: pairAddress,
          abi: ZKAMM_ABI,
          functionName: 'ethReserve',
        }),
        publicClient.readContract({
          address: pairAddress,
          abi: ZKAMM_ABI,
          functionName: 'tokenReserve',
        }),
      ]);

      // Estimate tokens out
      const tokensOut = await publicClient.readContract({
        address: zkAMMAddress as Address,
        abi: ZKAMM_ABI,
        functionName: 'getAmountOut',
        args: [ethAmountWei, ethReserve, tokenReserve],
      });

      updateProgress('Generating commitment...', 20);

      // Generate commitment with Poseidon hash
      const nullifier = randomFieldElement();
      const secret = randomFieldElement();
      const commitment = poseidonHashCommitment(nullifier, secret, tokensOut);

      // Create encrypted note using proper ECDH + AES-GCM encryption
      // The viewingKey is the private key, we need to derive the public key for encryption
      const wallet = new Wallet(viewingKey);
      const viewingPublicKey = wallet.signingKey.compressedPublicKey;
      const encryptedNote = await encryptNote(nullifier, secret, tokensOut, viewingPublicKey) as Hex;

      updateProgress('Simulating transaction...', 30);

      // Deadline: 20 minutes from now
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 1200);

      // Simulate first
      await publicClient.simulateContract({
        address: zkAMMAddress as Address,
        abi: ZKAMM_ABI,
        functionName: 'buyPrivate',
        args: [commitment, 0n, deadline, encryptedNote],
        value: ethAmountWei,
        account: address,
      });

      updateProgress('Sending transaction...', 50);

      // Execute buy
      const hash = await walletClient.writeContract({
        address: zkAMMAddress as Address,
        abi: ZKAMM_ABI,
        functionName: 'buyPrivate',
        args: [commitment, 0n, deadline, encryptedNote],
        value: ethAmountWei,
        chain: CHAIN,
      });

      updateProgress('Confirming...', 70);

      const receipt = await publicClient.waitForTransactionReceipt({ hash });

      // Debug: Log all events in receipt
      console.log('[buyPrivate] Receipt logs count:', receipt.logs.length);
      console.log('[buyPrivate] Looking for NewCommitment event:', EVENTS.newCommitment);
      receipt.logs.forEach((log, i) => {
        console.log(`[buyPrivate] Log ${i}: address=${log.address}, topic0=${log.topics[0]}`);
      });

      // Extract leafIndex from NewCommitment event
      // Note: NewCommitment is emitted by the PAIR contract, not the Router
      const commitmentLog = receipt.logs.find(log =>
        log.topics[0]?.toLowerCase() === EVENTS.newCommitment.toLowerCase()
      );

      if (!commitmentLog) {
        console.error('[buyPrivate] NewCommitment event NOT FOUND in receipt!');
        console.error('[buyPrivate] This means the commitment was NOT inserted into the tree.');
        console.error('[buyPrivate] Check if buyPrivate actually succeeded on-chain.');
      } else {
        console.log('[buyPrivate] Found NewCommitment event:', {
          address: commitmentLog.address,
          commitment: commitmentLog.topics[1],
          leafIndex: commitmentLog.topics[2],
        });
      }

      const leafIndex = commitmentLog ? Number(BigInt(commitmentLog.topics[2] || '0')) : -1; // Use -1 to indicate error

      if (leafIndex === -1) {
        throw new Error('Failed to extract leafIndex from NewCommitment event. The transaction may have failed.');
      }

      updateProgress('Complete!', 100);

      return {
        success: true,
        txHash: hash,
        commitment,
        nullifier,
        secret,
        tokensReceived: tokensOut,
        leafIndex,
      };

    } catch (err) {
      const errorMsg = (err as Error).message || 'Transaction failed';
      setError(errorMsg);
      return { success: false, error: errorMsg };
    } finally {
      setIsLoading(false);
    }
  }, [walletClient, publicClient, address, zkAMMAddress]);

  /**
   * Shield ETH to Railgun (first step of anonymous mode)
   */
  const shieldEth = useCallback(async (
    ethAmount: string,
    viewingKey: string,
    onProgress?: (step: string, percent: number) => void
  ): Promise<{ success: boolean; error?: string }> => {
    if (!walletClient || !publicClient || !address) {
      return { success: false, error: 'Wallet not connected' };
    }

    setIsLoading(true);
    setError(null);

    const updateProgress = (step: string, percent: number) => {
      setProgress({ step, percent });
      onProgress?.(step, percent);
    };

    try {
      const ethAmountWei = parseEther(ethAmount);

      // Step 1: Wrap ETH → WETH
      updateProgress('Wrapping ETH...', 15);

      const wrapHash = await walletClient.writeContract({
        address: EXTERNAL.weth as Address,
        abi: WETH_ABI,
        functionName: 'deposit',
        value: ethAmountWei,
        chain: CHAIN,
      });
      await publicClient.waitForTransactionReceipt({ hash: wrapHash });

      // Step 2: Approve Railgun
      updateProgress('Approving privacy protocol...', 35);

      const approveHash = await walletClient.writeContract({
        address: EXTERNAL.weth as Address,
        abi: WETH_ABI,
        functionName: 'approve',
        args: [EXTERNAL.railgunProxy as Address, ethAmountWei],
        chain: CHAIN,
      });
      await publicClient.waitForTransactionReceipt({ hash: approveHash });

      // Step 3: Shield to Railgun
      updateProgress('Shielding to privacy pool...', 55);

      const npk = keccak256(toBytes(viewingKey + 'npk')) as Hex;
      const random1 = keccak256(toBytes(viewingKey + Date.now().toString())).slice(0, 34) as Hex;
      const random2 = keccak256(toBytes(random1 + viewingKey)).slice(0, 34) as Hex;

      // 0.25% Railgun fee
      const fee = ethAmountWei * 25n / 10000n;
      const netAmount = ethAmountWei - fee;

      const shieldRequest = {
        preImage: {
          npk,
          token: {
            tokenType: 0,
            tokenAddress: EXTERNAL.weth as Address,
            tokenSubID: 0n
          },
          value: netAmount
        },
        encryptedRandom: [random1, random2] as readonly [Hex, Hex]
      };

      const shieldHash = await walletClient.writeContract({
        address: EXTERNAL.railgunProxy as Address,
        abi: RAILGUN_PROXY_ABI,
        functionName: 'shield',
        args: [[shieldRequest]],
        chain: CHAIN,
      });

      updateProgress('Confirming shield...', 85);
      await publicClient.waitForTransactionReceipt({ hash: shieldHash });

      // Update state
      const newState = {
        isShielded: true,
        shieldedBalance: shieldState.shieldedBalance + netAmount,
        lastShieldTx: shieldHash,
      };
      setShieldState(newState);

      // Save to localStorage
      localStorage.setItem(`${SHIELD_STATE_KEY}_${address}`, JSON.stringify({
        ...newState,
        shieldedBalance: newState.shieldedBalance.toString(),
      }));

      updateProgress('Shield complete!', 100);

      return { success: true };

    } catch (err) {
      const errorMsg = (err as Error).message || 'Shield failed';
      setError(errorMsg);
      return { success: false, error: errorMsg };
    } finally {
      setIsLoading(false);
    }
  }, [walletClient, publicClient, address, shieldState.shieldedBalance]);

  /**
   * Full Anonymous Buy via Railgun
   *
   * If not yet shielded: Shield first, then show instructions for Railway
   * If already shielded: Create cross-contract call data for Railway
   *
   * NOTE: Full in-app anonymous execution requires Railgun's relayer network
   * which needs heavy SDK integration. For now, we shield in-app and
   * guide users to Railway for the final anonymous buy.
   */
  const buyAnonymous = useCallback(async ({
    ethAmount,
    minTokensOut: _minTokensOut,
    viewingKey,
    onProgress
  }: BuyParams): Promise<BuyResult> => {
    void _minTokensOut; // Will be used when full relayer integration is added
    if (!walletClient || !publicClient || !address) {
      return { success: false, error: 'Wallet not connected' };
    }

    // If not shielded yet, shield first
    if (!shieldState.isShielded || shieldState.shieldedBalance < parseEther(ethAmount)) {
      const shieldResult = await shieldEth(ethAmount, viewingKey, onProgress);

      if (!shieldResult.success) {
        return { success: false, error: shieldResult.error };
      }

      // After shielding, open Railway for the anonymous buy
      // This is the most private option
      return {
        success: true,
        error: `ETH shielded successfully! Your funds are now in Railgun's privacy pool. Open Railway.xyz to complete your anonymous purchase.`,
      };
    }

    // If already shielded, direct them to Railway
    return {
      success: true,
      error: 'You have shielded funds in Railgun. Open Railway.xyz to buy anonymously.',
    };
  }, [walletClient, publicClient, address, shieldState, shieldEth]);

  /**
   * Main buy function - uses appropriate method based on privacy mode
   */
  const buy = useCallback(async (params: BuyParams): Promise<BuyResult> => {
    if (privacyMode === 'anonymous') {
      return buyAnonymous(params);
    }
    return buyQuickPrivate(params);
  }, [privacyMode, buyAnonymous, buyQuickPrivate]);

  /**
   * Open Railway wallet
   */
  const openRailway = useCallback(() => {
    window.open('https://app.railway.xyz', '_blank');
  }, []);

  return {
    // State
    isLoading,
    error,
    progress,
    isConnected,
    hasWallet: !!walletClient,
    isWalletLoading,

    // Privacy mode
    privacyMode,
    togglePrivacyMode,
    setPrivacyMode: (mode: PrivacyMode) => {
      setPrivacyMode(mode);
      if (address) {
        localStorage.setItem(`${ANON_MODE_KEY}_${address}`, mode);
      }
    },

    // Shield state
    isShielded: shieldState.isShielded,
    shieldedBalance: shieldState.shieldedBalance,
    lastShieldTx: shieldState.lastShieldTx,

    // Actions
    buy,
    buyQuickPrivate,
    buyAnonymous,
    shieldEth,
    openRailway,
    refetchWallet,

    // Info
    railgunProxy: EXTERNAL.railgunProxy,
    relayAdapt: EXTERNAL.relayAdapt,
    shieldFeePercent: 0.25,
  };
}
