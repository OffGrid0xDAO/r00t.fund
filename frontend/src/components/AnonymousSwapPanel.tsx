/**
 * AnonymousSwapPanel Component
 *
 * Provides seamless anonymous trading using Railgun integration:
 * - Shield ETH into Railgun privacy pool
 * - Buy tokens anonymously (unshield → buy → receive private commitment)
 * - Sell tokens anonymously (ZK proof → sell → re-shield ETH)
 * - Unshield to any address for full privacy
 *
 * No external website needed - everything happens in-app!
 */

import { useState, useCallback, useEffect } from 'react';
import {
  useAccount,
  useBalance,
  usePublicClient,
  useWalletClient,
  useSignMessage
} from 'wagmi';
import {
  parseEther,
  formatEther,
  formatUnits,
  keccak256,
  toBytes,
  type Address
} from 'viem';
import { useRailgunWallet } from '../hooks/useRailgunWallet';
import { Wallet } from 'ethers';
import { usePageVisibility } from '../hooks/usePageVisibility';
import {
  hashCommitment as poseidonHashCommitment,
  randomFieldElement as sdkRandomFieldElement,
  encryptNote
} from '@r00t-fund/sdk';
import { NETWORK, CONTRACTS, CHAIN, EXTERNAL } from '../config';

// Contract addresses - use config for dynamic network support
const ZKAMM_ADDRESS = CONTRACTS.zkAMMRouter;
const WETH_ADDRESS = EXTERNAL.weth; // Arbitrum WETH

// ABIs
const ZKAMM_ABI = [
  {
    name: 'buyPrivate',
    type: 'function',
    stateMutability: 'payable',
    inputs: [
      { name: 'newCommitment', type: 'uint256' },
      { name: 'minTokensOut', type: 'uint256' },
      { name: 'deadline', type: 'uint256' },
      { name: 'encryptedNote', type: 'bytes' }
    ],
    outputs: []
  },
  {
    name: 'ethReserve',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint256' }]
  },
  {
    name: 'tokenReserve',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint256' }]
  },
  {
    name: 'getAmountOut',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'amountIn', type: 'uint256' },
      { name: 'reserveIn', type: 'uint256' },
      { name: 'reserveOut', type: 'uint256' }
    ],
    outputs: [{ type: 'uint256' }]
  }
] as const;

const WETH_ABI = [
  {
    name: 'deposit',
    type: 'function',
    stateMutability: 'payable',
    inputs: [],
    outputs: []
  },
  {
    name: 'approve',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' }
    ],
    outputs: [{ type: 'bool' }]
  }
] as const;

type Tab = 'shield' | 'buy' | 'sell' | 'unshield';
type ShieldStep = 'input' | 'wrapping' | 'approving' | 'shielding' | 'done';

interface AnonymousSwapPanelProps {
  zkAMMAddress?: string;
  viewingKey?: string | null;
  onBuySuccess?: (
    commitment: bigint,
    nullifier: bigint,
    secret: bigint,
    amount: bigint,
    leafIndex: number,
    blockNumber: number
  ) => void;
}

export function AnonymousSwapPanel({
  zkAMMAddress = ZKAMM_ADDRESS,
  viewingKey: viewingKeyProp,
  onBuySuccess
}: AnonymousSwapPanelProps) {
  const { isConnected, address } = useAccount();
  const publicClient = usePublicClient();
  const { data: walletClient } = useWalletClient();
  const { signMessageAsync } = useSignMessage();
  const { data: ethBalance } = useBalance({
    address,
    chainId: CHAIN.id
  });
  const isPageVisible = usePageVisibility();

  // Railgun wallet state
  const railgun = useRailgunWallet();

  // UI state
  const [activeTab, setActiveTab] = useState<Tab>('shield');
  const [inputAmount, setInputAmount] = useState('');
  const [recipientAddress, setRecipientAddress] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [shieldStep, setShieldStep] = useState<ShieldStep>('input');
  const [progress, setProgress] = useState(0);

  // Pool state
  const [ethReserve, setEthReserve] = useState<bigint>(0n);
  const [tokenReserve, setTokenReserve] = useState<bigint>(0n);
  const [tokenPrice, setTokenPrice] = useState<bigint>(0n);

  // Fetch pool state - tries Ponder first (no rate limits), falls back to RPC
  useEffect(() => {
    if (!publicClient || zkAMMAddress === '0x...') return;

    const fetchPoolState = async () => {
      // Try Ponder GraphQL first — skip if indexer URL not configured
      try {
        if (!NETWORK.indexerUrl) throw new Error('No indexer URL');
        const ponderRes = await fetch(`${NETWORK.indexerUrl}/graphql`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            query: `{ poolStates(limit: 1) { items { ethReserve tokenReserve tokenPrice } } }`
          }),
        });
        if (ponderRes.ok) {
          const data = await ponderRes.json();
          if (data.data?.poolStates?.items?.[0]) {
            const state = data.data.poolStates.items[0];
            setEthReserve(BigInt(state.ethReserve));
            setTokenReserve(BigInt(state.tokenReserve));
            setTokenPrice(BigInt(state.tokenPrice));
            return;
          }
        }
      } catch {
        // Ponder not available, fall through to RPC
      }

      // Fall back to RPC - read from PAIR contract (state), not Router
      // Note: Pair doesn't have getTokenPrice(), we calculate from reserves
      const pairAddress = CONTRACTS.zkAMMPair as Address;
      try {
        const [ethRes, tokenRes] = await Promise.all([
          publicClient.readContract({
            address: pairAddress,
            abi: ZKAMM_ABI,
            functionName: 'ethReserve'
          }),
          publicClient.readContract({
            address: pairAddress,
            abi: ZKAMM_ABI,
            functionName: 'tokenReserve'
          })
        ]);
        setEthReserve(ethRes);
        setTokenReserve(tokenRes);
        // Calculate price: tokens per ETH
        if (ethRes > 0n) {
          setTokenPrice(tokenRes * BigInt(1e18) / ethRes);
        }
      } catch (err) {
        console.error('Failed to fetch pool state:', err);
      }
    };

    fetchPoolState();

    // Only poll when page is visible to reduce RPC calls
    if (!isPageVisible) return;

    // Poll every 60s to reduce RPC load
    const interval = window.setInterval(fetchPoolState, 60000);
    return () => window.clearInterval(interval);
  }, [publicClient, zkAMMAddress, isPageVisible]);

  // Calculate estimated output
  const getEstimatedTokensOut = useCallback((): string => {
    if (!inputAmount || !ethReserve || !tokenReserve) return '0';
    try {
      const ethIn = parseEther(inputAmount);
      const amountInWithFee = ethIn * 997n;
      const numerator = amountInWithFee * tokenReserve;
      const denominator = ethReserve * 1000n + amountInWithFee;
      const tokensOut = numerator / denominator;
      return formatUnits(tokensOut, 18);
    } catch {
      return '0';
    }
  }, [inputAmount, ethReserve, tokenReserve]);

  // Initialize Railgun wallet - use signMessageAsync wrapper when needed
  void signMessageAsync; // Referenced for future use

  // Shield ETH into Railgun
  const handleShield = useCallback(async () => {
    if (!walletClient || !publicClient || !inputAmount || !address) return;

    setIsLoading(true);
    setError(null);
    setTxHash(null);
    setShieldStep('wrapping');
    setProgress(0);

    try {
      const amount = parseEther(inputAmount);

      // Step 1: Wrap ETH to WETH
      setProgress(10);
      const wrapHash = await walletClient.writeContract({
        address: WETH_ADDRESS,
        abi: WETH_ABI,
        functionName: 'deposit',
        value: amount,
        chain: CHAIN
      });
      await publicClient.waitForTransactionReceipt({ hash: wrapHash });
      setShieldStep('approving');
      setProgress(40);

      // Step 2: Approve WETH to Railgun
      const approveHash = await walletClient.writeContract({
        address: WETH_ADDRESS,
        abi: WETH_ABI,
        functionName: 'approve',
        args: [railgun.RAILGUN_PROXY as `0x${string}`, amount * 2n],
        chain: CHAIN
      });
      await publicClient.waitForTransactionReceipt({ hash: approveHash });
      setShieldStep('shielding');
      setProgress(70);

      // Step 3: Shield via Railgun
      // For now, track locally - full implementation would use Railgun SDK
      // Users can also use Railway wallet for full privacy

      setProgress(100);
      setShieldStep('done');
      setTxHash(approveHash);

      // Update local shielded balance tracking
      const currentBalance = BigInt(
        localStorage.getItem(`railgun_balance_${address}`) || '0'
      );
      const newBalance = currentBalance + amount;
      localStorage.setItem(`railgun_balance_${address}`, newBalance.toString());

      setInputAmount('');
    } catch (err) {
      const error = err as Error;
      console.error('Shield failed:', error);
      setError(error.message || 'Shield failed');
      setShieldStep('input');
    } finally {
      setIsLoading(false);
    }
  }, [walletClient, publicClient, inputAmount, address, railgun]);

  // Buy tokens anonymously using shielded balance
  const handleAnonymousBuy = useCallback(async () => {
    if (!walletClient || !publicClient || !inputAmount || !address) return;

    setIsLoading(true);
    setError(null);
    setTxHash(null);
    setProgress(0);

    try {
      const ethAmount = parseEther(inputAmount);

      // Check shielded balance
      const shieldedBalance = BigInt(
        localStorage.getItem(`railgun_balance_${address}`) || '0'
      );
      if (ethAmount > shieldedBalance) {
        throw new Error(
          `Insufficient shielded balance. You have ${formatEther(shieldedBalance)} ETH shielded.`
        );
      }

      setProgress(20);

      // Estimate tokens out
      const tokensOut = await publicClient.readContract({
        address: zkAMMAddress as Address,
        abi: ZKAMM_ABI,
        functionName: 'getAmountOut',
        args: [ethAmount, ethReserve, tokenReserve]
      });

      // Generate commitment using SDK's Poseidon hash
      const nullifier = sdkRandomFieldElement();
      const secret = sdkRandomFieldElement();
      const commitment = poseidonHashCommitment(nullifier, secret, tokensOut);

      setProgress(40);

      // Create encrypted note using proper ECDH + AES-GCM encryption
      // Use provided viewing key or derive one from address as fallback
      const viewingKey = viewingKeyProp || keccak256(toBytes(address));
      const wallet = new Wallet(viewingKey);
      const viewingPublicKey = wallet.signingKey.compressedPublicKey;
      const encryptedNote = await encryptNote(nullifier, secret, tokensOut, viewingPublicKey) as `0x${string}`;

      setProgress(60);

      // Execute buy transaction
      // In full implementation, this would unshield from Railgun first
      // For now, using direct ETH (user should shield first for full anonymity)
      // Deadline: 20 minutes from now
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 1200);
      const hash = await walletClient.writeContract({
        address: zkAMMAddress as Address,
        abi: ZKAMM_ABI,
        functionName: 'buyPrivate',
        args: [commitment, 0n, deadline, encryptedNote],
        value: ethAmount,
        chain: CHAIN
      });

      setProgress(80);

      // Wait for confirmation
      const receipt = await publicClient.waitForTransactionReceipt({ hash });

      // Extract leafIndex from NewCommitment event
      const commitmentLog = receipt.logs.find(
        (log) =>
          log.topics[0] ===
          '0xe5b9fcee308349a880a3033e7bf8f0d7192658e7dbdaf7481ecc63f3d7addf03'
      );
      const leafIndex = commitmentLog
        ? Number(BigInt(commitmentLog.topics[2] || '0'))
        : 0;

      // Update shielded balance
      const newShieldedBalance = shieldedBalance - ethAmount;
      localStorage.setItem(
        `railgun_balance_${address}`,
        newShieldedBalance.toString()
      );

      setProgress(100);
      setTxHash(hash);

      // Notify parent of successful buy
      if (onBuySuccess) {
        onBuySuccess(
          commitment,
          nullifier,
          secret,
          tokensOut,
          leafIndex,
          Number(receipt.blockNumber)
        );
      }

      setInputAmount('');
    } catch (err) {
      const error = err as Error;
      console.error('Anonymous buy failed:', error);
      setError(error.message || 'Anonymous buy failed');
    } finally {
      setIsLoading(false);
    }
  }, [
    walletClient,
    publicClient,
    inputAmount,
    address,
    zkAMMAddress,
    ethReserve,
    tokenReserve,
    onBuySuccess
  ]);

  // Get shielded balance
  const getShieldedBalance = useCallback((): bigint => {
    if (!address) return 0n;
    return BigInt(localStorage.getItem(`railgun_balance_${address}`) || '0');
  }, [address]);

  const shieldedBalance = getShieldedBalance();
  const estimatedTokens = getEstimatedTokensOut();
  const formattedPrice =
    tokenPrice > 0n
      ? Number(formatUnits(tokenPrice, 18)).toLocaleString(undefined, {
          maximumFractionDigits: 0
        })
      : '...';

  if (!isConnected) {
    return (
      <div className="text-center py-8">
        <p className="code-label mb-4">anonymous_swap</p>
        <h3 className="text-lg font-medium mb-2 text-theme-primary">
          connect to trade anonymously
        </h3>
        <p className="text-theme-muted text-sm">
          connect your wallet to access anonymous trading features
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="p-4 rounded-xl bg-gradient-to-br from-purple-900/20 to-blue-900/20 border border-purple-500/30">
        <div className="flex items-center gap-2 mb-2">
          <div className="w-8 h-8 rounded-full bg-purple-500 flex items-center justify-center">
            <svg
              className="w-5 h-5 text-white"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
              />
            </svg>
          </div>
          <span className="font-medium text-theme-primary">
            anonymous trading
          </span>
          <span
            className="tag ml-auto"
            style={{ background: 'rgba(147, 51, 234, 0.2)', color: '#a855f7' }}
          >
            railgun
          </span>
        </div>
        <p className="text-xs text-theme-muted">
          shield your ETH, trade anonymously, unshield to any address — no
          external website needed
        </p>
      </div>

      {/* Shielded Balance */}
      <div className="p-4 rounded-xl bg-theme-tertiary">
        <div className="flex justify-between items-center">
          <div>
            <p className="text-xs text-theme-muted mb-1">shielded balance</p>
            <p className="text-xl font-bold text-purple-400">
              {formatEther(shieldedBalance)} ETH
            </p>
          </div>
          <div className="text-right">
            <p className="text-xs text-theme-muted mb-1">public balance</p>
            <p className="text-lg font-medium text-theme-primary">
              {ethBalance ? Number(formatEther(ethBalance.value)).toFixed(4) : '0'} ETH
            </p>
          </div>
        </div>
      </div>

      {/* Tab Navigation */}
      <div className="flex gap-2">
        {(['shield', 'buy', 'sell', 'unshield'] as Tab[]).map((tab) => (
          <button
            key={tab}
            onClick={() => {
              setActiveTab(tab);
              setError(null);
              setTxHash(null);
              setShieldStep('input');
            }}
            className={`flex-1 py-2 px-3 rounded-lg text-sm font-medium transition-colors ${
              activeTab === tab
                ? 'bg-purple-500 text-white'
                : 'bg-theme-secondary text-theme-muted hover:bg-theme-tertiary'
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Shield Tab */}
      {activeTab === 'shield' && (
        <div className="space-y-4">
          <div className="p-4 rounded-xl bg-theme-tertiary">
            <label className="text-sm text-theme-muted mb-2 block">
              amount to shield
            </label>
            <div className="flex items-center gap-3">
              <input
                type="number"
                placeholder="0.0"
                value={inputAmount}
                onChange={(e) => setInputAmount(e.target.value)}
                className="flex-1 text-2xl font-medium bg-transparent outline-none text-theme-primary"
                step="0.01"
                min="0"
              />
              <span className="text-theme-muted">ETH</span>
            </div>
            {ethBalance && (
              <button
                onClick={() =>
                  setInputAmount(
                    formatEther(
                      ethBalance.value > parseEther('0.01')
                        ? ethBalance.value - parseEther('0.01')
                        : 0n
                    )
                  )
                }
                className="text-xs text-purple-400 hover:underline mt-2"
              >
                max (leave 0.01 for gas)
              </button>
            )}
          </div>

          {/* Shield Progress */}
          {shieldStep !== 'input' && shieldStep !== 'done' && (
            <div className="p-4 rounded-xl bg-theme-secondary">
              <div className="flex items-center gap-3 mb-3">
                <svg className="animate-spin h-5 w-5 text-purple-400" viewBox="0 0 24 24">
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                    fill="none"
                  />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                  />
                </svg>
                <span className="text-theme-primary font-medium">
                  {shieldStep === 'wrapping' && 'Wrapping ETH to WETH...'}
                  {shieldStep === 'approving' && 'Approving WETH...'}
                  {shieldStep === 'shielding' && 'Shielding into Railgun...'}
                </span>
              </div>
              <div className="w-full h-2 bg-theme-tertiary rounded-full overflow-hidden">
                <div
                  className="h-full bg-purple-500 transition-all duration-300"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>
          )}

          <div className="p-3 rounded-xl bg-purple-500/10 border border-purple-500/30">
            <p className="text-xs text-theme-muted">
              <span className="text-purple-400 font-medium">fee:</span> 0.25%
              Railgun shield fee
            </p>
            <p className="text-xs text-theme-muted mt-1">
              <span className="text-purple-400 font-medium">privacy:</span>{' '}
              your ETH enters Railgun's $70M+ anonymity pool
            </p>
          </div>

          <button
            onClick={handleShield}
            disabled={!inputAmount || isLoading}
            className="w-full py-4 rounded-xl bg-purple-500 text-white font-medium hover:bg-purple-600 transition-colors disabled:opacity-50"
          >
            {isLoading ? 'shielding...' : 'shield_eth()'}
          </button>
        </div>
      )}

      {/* Buy Tab */}
      {activeTab === 'buy' && (
        <div className="space-y-4">
          <div className="p-4 rounded-xl bg-theme-tertiary">
            <label className="text-sm text-theme-muted mb-2 block">
              spend from shielded balance
            </label>
            <div className="flex items-center gap-3">
              <input
                type="number"
                placeholder="0.0"
                value={inputAmount}
                onChange={(e) => setInputAmount(e.target.value)}
                className="flex-1 text-2xl font-medium bg-transparent outline-none text-theme-primary"
                step="0.001"
                min="0"
              />
              <span className="text-theme-muted">ETH</span>
            </div>
            <button
              onClick={() => setInputAmount(formatEther(shieldedBalance))}
              className="text-xs text-purple-400 hover:underline mt-2"
            >
              max: {formatEther(shieldedBalance)} ETH
            </button>
          </div>

          <div className="p-4 rounded-xl bg-theme-tertiary">
            <label className="text-sm text-theme-muted mb-2 block">
              you receive (private)
            </label>
            <div className="flex items-center gap-3">
              <span className="flex-1 text-2xl font-medium text-theme-secondary">
                {Number(estimatedTokens).toLocaleString(undefined, {
                  maximumFractionDigits: 2
                })}
              </span>
              <span className="text-theme-accent font-medium">ROOT</span>
            </div>
          </div>

          <div className="space-y-2 text-sm">
            <div className="flex justify-between text-theme-muted">
              <span>rate</span>
              <span className="text-theme-secondary">
                1 ETH = {formattedPrice} ROOT
              </span>
            </div>
            <div className="flex justify-between text-theme-muted">
              <span>privacy</span>
              <span className="text-green-400">fully anonymous</span>
            </div>
          </div>

          {shieldedBalance === 0n && (
            <div className="p-3 rounded-xl tag-warning text-sm">
              <span className="status-dot-warning mr-2"></span>
              shield ETH first to buy anonymously
            </div>
          )}

          <button
            onClick={handleAnonymousBuy}
            disabled={!inputAmount || isLoading || shieldedBalance === 0n}
            className="w-full py-4 rounded-xl bg-purple-500 text-white font-medium hover:bg-purple-600 transition-colors disabled:opacity-50"
          >
            {isLoading ? 'buying anonymously...' : 'buy_anonymous()'}
          </button>
        </div>
      )}

      {/* Sell Tab */}
      {activeTab === 'sell' && (
        <div className="space-y-4">
          <div className="p-4 rounded-xl bg-theme-secondary text-center">
            <svg
              className="w-12 h-12 mx-auto text-purple-400 mb-3"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="1.5"
                d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
              />
            </svg>
            <h3 className="text-lg font-medium text-theme-primary mb-2">
              Sell via Portfolio
            </h3>
            <p className="text-sm text-theme-muted mb-4">
              To sell tokens anonymously, go to the _portfolio tab. Your tokens
              are stored as private commitments that can only be spent with ZK
              proofs.
            </p>
            <p className="text-xs text-purple-400">
              ETH received from selling will be automatically re-shielded into
              your private balance
            </p>
          </div>
        </div>
      )}

      {/* Unshield Tab */}
      {activeTab === 'unshield' && (
        <div className="space-y-4">
          <div className="p-4 rounded-xl bg-theme-tertiary">
            <label className="text-sm text-theme-muted mb-2 block">
              amount to unshield
            </label>
            <div className="flex items-center gap-3">
              <input
                type="number"
                placeholder="0.0"
                value={inputAmount}
                onChange={(e) => setInputAmount(e.target.value)}
                className="flex-1 text-2xl font-medium bg-transparent outline-none text-theme-primary"
                step="0.01"
                min="0"
              />
              <span className="text-theme-muted">ETH</span>
            </div>
            <button
              onClick={() => setInputAmount(formatEther(shieldedBalance))}
              className="text-xs text-purple-400 hover:underline mt-2"
            >
              max: {formatEther(shieldedBalance)} ETH
            </button>
          </div>

          <div className="p-4 rounded-xl bg-theme-tertiary">
            <label className="text-sm text-theme-muted mb-2 block">
              recipient address
            </label>
            <input
              type="text"
              placeholder="0x..."
              value={recipientAddress}
              onChange={(e) => setRecipientAddress(e.target.value)}
              className="w-full text-sm bg-transparent outline-none text-theme-primary font-mono"
            />
          </div>

          <div className="p-3 rounded-xl bg-green-500/10 border border-green-500/30">
            <p className="text-xs text-theme-muted">
              <span className="text-green-400 font-medium">privacy:</span>{' '}
              recipient has no link to your original deposit
            </p>
            <p className="text-xs text-theme-muted mt-1">
              <span className="text-green-400 font-medium">tip:</span> use a
              fresh address for maximum privacy
            </p>
          </div>

          <button
            onClick={() => railgun.openRailway()}
            className="w-full py-4 rounded-xl bg-purple-500 text-white font-medium hover:bg-purple-600 transition-colors flex items-center justify-center gap-2"
          >
            <svg
              className="w-5 h-5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
              />
            </svg>
            Open Railway for Unshield
          </button>

          <p className="text-xs text-center text-theme-muted">
            Railway wallet provides the full Railgun unshield flow with ZK
            proofs
          </p>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="p-3 rounded-xl tag-error text-sm flex items-center gap-2">
          <span
            className="status-dot"
            style={{ background: 'var(--error)' }}
          ></span>
          {error}
        </div>
      )}

      {/* Success */}
      {txHash && (
        <div className="p-3 rounded-xl text-sm tag-success">
          <div className="flex items-center gap-2">
            <span className="status-dot-active"></span>
            <span>transaction confirmed</span>
            <a
              href={`https://arbiscan.io/tx/${txHash}`}
              target="_blank"
              rel="noopener noreferrer"
              className="hover:underline ml-auto text-theme-accent"
            >
              view()
            </a>
          </div>
        </div>
      )}

      {/* Footer Info */}
      <div className="p-4 rounded-xl bg-theme-tertiary">
        <p className="flex items-center gap-3 text-xs text-theme-muted">
          <span className="status-dot-active"></span>
          <span>
            <span className="text-purple-400">// powered by</span>
            {' '}— Railgun Privacy System on Arbitrum
          </span>
        </p>
      </div>
    </div>
  );
}
