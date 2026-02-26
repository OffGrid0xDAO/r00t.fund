import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAccount, usePublicClient, useWalletClient, useSignMessage, useSwitchChain, useBalance } from 'wagmi';
import { parseEther, formatEther, formatUnits, keccak256, toBytes, encodeFunctionData, decodeFunctionResult } from 'viem';
import { Wallet } from 'ethers';
import { encryptNote } from '@r00t-fund/sdk';
import { useZkProver } from '../hooks/useZkProver';
import { useRailgunBuy } from '../hooks/useRailgunBuy';
import type { WalletSession } from '../hooks/useWalletSession';
import type { Commitment } from '../hooks/usePrivateWallet';
import { getExplorerTxUrl, NETWORK, CHAIN, CONTRACTS } from '../config';
import { GlowButton } from './ui/GlowButton';
import { RootLogo } from './ui/RootLogo';
import { ZKAMM_ABI } from '../abis/zkAMM';
import { TRADE_COMPLETE_EVENT } from './PriceChart';
import { usePageVisibility } from '../hooks/usePageVisibility';
import { useCompliantVault } from './projects/hooks/useCompliantVault';

const SIGN_MESSAGE = 'Sign this message to access your r00t.fund private balance.\n\nThis signature is used to derive your viewing key locally.\nIt never leaves your browser.';



export interface TokenOption {
  address: string;
  name: string;
  symbol: string;
  isRoot: boolean;
}

type SwapDirection = 'buy' | 'sell';

// Slippage presets in basis points (1% = 100 bps)
const SLIPPAGE_PRESETS = [10, 50, 100, 300] as const; // 0.1%, 0.5%, 1%, 3%
const DEFAULT_SLIPPAGE = 100; // 1%

// Slippage Settings Popover
const SlippageSettings = ({
  value,
  onChange,
  onClose,
}: {
  value: number;
  onChange: (bps: number) => void;
  onClose: () => void;
}) => (
  <motion.div
    initial={{ opacity: 0, y: -10, scale: 0.95 }}
    animate={{ opacity: 1, y: 0, scale: 1 }}
    exit={{ opacity: 0, y: -10, scale: 0.95 }}
    className="absolute right-0 top-full mt-2 z-50 p-4 rounded-lg border border-[var(--border)]"
    style={{ background: 'var(--bg-secondary)', minWidth: '260px' }}
  >
    <div className="flex items-center justify-between mb-3">
      <span className="text-xs font-mono text-[var(--text-muted)]">
        <span className="text-[var(--accent)] opacity-60">// </span>
        slippage_tolerance
      </span>
      <button
        onClick={onClose}
        className="p-1 rounded hover:bg-[var(--bg-primary)] transition-colors"
      >
        <svg className="w-4 h-4 text-[var(--text-muted)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>

    <div className="flex gap-2 mb-3">
      {SLIPPAGE_PRESETS.map((preset) => (
        <motion.button
          key={preset}
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          onClick={() => onChange(preset)}
          className={`flex-1 py-2 px-3 rounded-md font-mono text-xs transition-colors ${value === preset
            ? 'bg-[var(--accent)] text-[var(--bg-primary)]'
            : 'bg-[var(--bg-primary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
            }`}
        >
          {preset / 100}%
        </motion.button>
      ))}
    </div>

    {value > 300 && (
      <div className="flex items-center gap-2 p-2 rounded-md bg-[var(--warning)]/10 border border-[var(--warning)]/30">
        <svg className="w-4 h-4 text-[var(--warning)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
        </svg>
        <span className="text-xs text-[var(--warning)]">High slippage may result in unfavorable rates</span>
      </div>
    )}
  </motion.div>
);

interface SwapPanelProps {
  zkAMMAddress: string;
  viewingKey: string | null;
  balance: bigint;
  commitments: Commitment[];
  availableTokens?: TokenOption[];
  selectedToken?: string;
  onTokenChange?: (address: string) => void;
  onBuySuccess?: (commitment: bigint, nullifier: bigint, secret: bigint, amount: bigint, leafIndex: number, blockNumber: number) => void;
  onSellSuccess?: (commitment: string) => void;
  removeCommitment?: (commitment: string) => void;
  fetchAllOnChainCommitments?: (targetAddress?: string) => Promise<{
    commitments: { commitment: bigint; leafIndex: number }[];
    treeState?: { filledSubtrees: bigint[]; root: bigint };
  }>;
  session?: WalletSession;
  resetWallet?: () => void;
  scan?: () => Promise<void>;
}

// Animated ETH Logo
const EthLogo = () => (
  <motion.div
    className="w-10 h-10 rounded-lg flex items-center justify-center"
    style={{
      background: 'linear-gradient(135deg, #627EEA 0%, #8C9EFF 100%)',
      boxShadow: '0 4px 12px rgba(98, 126, 234, 0.3)',
    }}
    whileHover={{ scale: 1.05, rotate: 5 }}
  >
    <svg className="w-5 h-5 text-white" viewBox="0 0 256 417" fill="currentColor">
      <path d="M127.961 0l-2.795 9.5v275.668l2.795 2.79 127.962-75.638z" fillOpacity=".6" />
      <path d="M127.962 0L0 212.32l127.962 75.639V154.158z" />
      <path d="M127.961 312.187l-1.575 1.92v98.199l1.575 4.6L256 236.587z" fillOpacity=".6" />
      <path d="M127.962 416.905v-104.72L0 236.585z" />
    </svg>
  </motion.div>
);

// ROOT Token Logo — uses the real r00t.fund root logo
const RootTokenIcon = () => (
  <RootLogo size={22} className="text-white" />
);

// Token Logo with Glow — uses ROOT icon for root tokens, deterministic gradient for others
const TokenLogo = ({ symbol, glowing = false, address }: { symbol: string; glowing?: boolean; address?: string }) => {
  // Generate deterministic hue from address for project tokens
  const hue = address
    ? parseInt(address.slice(2, 8), 16) % 360
    : 140; // Default green

  const isRoot = symbol === 'ROOT' || symbol === 'R00T' || symbol === '$ROOT';

  return (
    <motion.div
      className="relative w-10 h-10 rounded-lg flex items-center justify-center"
      style={{
        background: isRoot
          ? 'linear-gradient(135deg, var(--accent) 0%, var(--accent-secondary) 100%)'
          : `linear-gradient(135deg, hsl(${hue}, 50%, 40%) 0%, hsl(${(hue + 40) % 360}, 45%, 50%) 100%)`,
        boxShadow: glowing
          ? '0 0 20px var(--accent), 0 0 40px rgba(45, 90, 61, 0.15)'
          : '0 2px 8px rgba(0, 0, 0, 0.15)',
      }}
      whileHover={{ scale: 1.05, rotate: -5 }}
      animate={glowing ? {
        boxShadow: [
          '0 0 16px var(--accent), 0 0 32px rgba(45, 90, 61, 0.1)',
          '0 0 24px var(--accent), 0 0 48px rgba(45, 90, 61, 0.2)',
          '0 0 16px var(--accent), 0 0 32px rgba(45, 90, 61, 0.1)',
        ],
      } : {}}
      transition={{ duration: 2, repeat: Infinity }}
    >
      {isRoot ? (
        <RootTokenIcon />
      ) : (
        <span className="text-lg font-bold text-white/90">{symbol.charAt(0)}</span>
      )}
    </motion.div>
  );
};

// Privacy Mode Toggle
// Swap Input Card — Premium financial input
const SwapInput = ({
  label,
  value,
  onChange,
  token,
  onMax,
  maxLabel,
  readOnly = false,
  isToken = false,
  onTokenClick,
}: {
  label: string;
  value: string;
  onChange?: (val: string) => void;
  token: { symbol: string; isEth: boolean };
  onMax?: () => void;
  maxLabel?: string;
  readOnly?: boolean;
  isToken?: boolean;
  onTokenClick?: () => void;
}) => {
  const [isFocused, setIsFocused] = useState(false);
  const canSelectToken = !!onTokenClick;

  return (
    <motion.div
      whileHover={{ scale: readOnly ? 1 : 1.005 }}
      className="relative rounded-lg overflow-hidden group"
    >
      <div
        className="relative rounded-lg p-5 transition-all duration-300"
        style={{
          background: 'var(--bg-secondary)',
          borderLeft: `2px solid ${isFocused || isToken ? 'var(--accent)' : 'transparent'}`,
          boxShadow: isFocused ? 'inset 0 1px 4px rgba(0,0,0,0.06), var(--shadow-glow)' : 'none',
        }}
      >
        <div className="flex items-center justify-between mb-3">
          <span className="text-xs font-mono text-[var(--text-muted)] hover-glitch">
            <span className="text-[var(--accent)] opacity-60">// </span>
            {label}
          </span>
          {onMax && maxLabel && (
            <motion.button
              onClick={onMax}
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              className="text-xs font-mono px-2 py-0.5 rounded-full bg-[var(--accent)]/10 text-[var(--accent)] hover:bg-[var(--accent)]/20 transition-colors"
            >
              {maxLabel}
            </motion.button>
          )}
        </div>

        <div className="flex items-center gap-4">
          <div
            className="flex-1 px-4 py-2.5 rounded-lg transition-all duration-200"
            style={{
              background: 'var(--bg-primary)',
              border: `1px solid ${isFocused ? 'var(--border-focus)' : 'var(--border)'}`,
              boxShadow: isFocused ? '0 0 0 3px rgba(45, 90, 61, 0.08)' : 'none',
            }}
          >
            <input
              type="number"
              value={value}
              onChange={(e) => onChange?.(e.target.value)}
              onFocus={() => setIsFocused(true)}
              onBlur={() => setIsFocused(false)}
              placeholder="0"
              readOnly={readOnly}
              className={`w-full bg-transparent text-3xl font-display font-bold outline-none border-none focus:ring-0 placeholder:text-[var(--text-muted)]/40 ${readOnly ? 'text-[var(--text-secondary)]' : 'text-[var(--text-primary)]'
                }`}
              style={{ minWidth: 0 }}
            />
          </div>

          <motion.div
            whileHover={{ scale: 1.03 }}
            whileTap={{ scale: 0.98 }}
            onClick={onTokenClick}
            className={`flex items-center gap-3 px-4 py-2.5 rounded-lg ${canSelectToken ? 'cursor-pointer' : 'cursor-default'}`}
            style={{
              background: isToken
                ? 'linear-gradient(135deg, rgba(45, 90, 61, 0.12) 0%, rgba(184, 134, 11, 0.08) 100%)'
                : 'var(--bg-primary)',
              border: isToken ? '1px solid var(--accent)' : '1px solid var(--border)',
              boxShadow: isToken ? '0 0 12px rgba(45, 90, 61, 0.1)' : 'none',
            }}
          >
            {token.isEth ? <EthLogo /> : <TokenLogo symbol={token.symbol} glowing={isToken} />}
            <span className="font-mono font-medium text-[var(--text-primary)]">{token.symbol}</span>
            {canSelectToken && (
              <svg className="w-3.5 h-3.5 text-[var(--text-muted)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            )}
          </motion.div>
        </div>
      </div>
    </motion.div>
  );
};

// Animated Swap Arrow
const SwapArrow = ({ onClick }: { onClick: () => void }) => (
  <div className="flex justify-center -my-3 relative z-10">
    <motion.button
      onClick={onClick}
      whileHover={{ scale: 1.15, rotate: 180 }}
      whileTap={{ scale: 0.9 }}
      transition={{ type: 'spring', stiffness: 400, damping: 15 }}
      className="p-3 rounded-lg border-4 border-[var(--bg-primary)]"
      style={{
        background: 'linear-gradient(135deg, var(--bg-secondary) 0%, var(--bg-secondary) 100%)',
        boxShadow: '0 4px 20px rgba(0,0,0,0.2)',
      }}
    >
      <svg className="w-5 h-5 text-[var(--text-primary)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
      </svg>
    </motion.button>
  </div>
);

// Info Row with flash-on-change
const InfoRow = ({ label, value, highlight = false }: { label: string; value: string; highlight?: boolean }) => {
  const [flash, setFlash] = useState(false);
  const prevValue = useRef(value);

  useEffect(() => {
    if (value !== prevValue.current) {
      setFlash(true);
      prevValue.current = value;
      const timer = setTimeout(() => setFlash(false), 600);
      return () => clearTimeout(timer);
    }
  }, [value]);

  return (
    <div className="flex justify-between items-center py-2">
      <span className="text-xs font-mono text-[var(--text-muted)]">{label}</span>
      <span
        className={`text-sm font-mono transition-colors duration-300 rounded px-1.5 -mx-1.5 ${highlight ? 'text-[var(--accent)]' : 'text-[var(--text-secondary)]'}`}
        style={{
          backgroundColor: flash ? 'rgba(45, 90, 61, 0.1)' : 'transparent',
        }}
      >
        {value}
      </span>
    </div>
  );
};

// Custom hook for debounced value
function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);

    return () => {
      clearTimeout(handler);
    };
  }, [value, delay]);

  return debouncedValue;
}

export function SwapPanel({ zkAMMAddress, viewingKey, balance, commitments, availableTokens, selectedToken, onTokenChange, onBuySuccess, onSellSuccess, removeCommitment: _removeCommitment, fetchAllOnChainCommitments, session, resetWallet, scan }: SwapPanelProps) {
  const { isConnected, address, chainId } = useAccount();
  const publicClient = usePublicClient();
  const { data: walletClient, isLoading: isWalletLoading, refetch: refetchWallet } = useWalletClient();
  const { data: ethBalance, refetch: refetchEthBalance } = useBalance({
    address,
    chainId: CHAIN.id,
  });
  const { signMessageAsync } = useSignMessage();
  const { switchChain, isPending: isSwitchingChain } = useSwitchChain();
  const isPageVisible = usePageVisibility();
  const { stats: vaultStats } = useCompliantVault();

  const isOnCorrectChain = chainId === CHAIN.id;
  const handleSwitchToCorrectChain = useCallback(() => switchChain({ chainId: CHAIN.id }), [switchChain]);

  // Token identification — must be before useRailgunBuy so it can route correctly
  const currentToken = availableTokens?.find(t => t.address === selectedToken) || availableTokens?.find(t => t.isRoot) || { address: zkAMMAddress, name: 'r00t', symbol: 'ROOT', isRoot: true };
  const isProjectToken = !currentToken.isRoot;
  const activeAMMAddress = selectedToken || zkAMMAddress;

  const { isLoading: isBuyLoading, progress: buyProgress, buyQuickPrivate } = useRailgunBuy(zkAMMAddress, {
    isProjectToken,
    projectPoolAddress: isProjectToken ? activeAMMAddress : undefined,
  });

  useEffect(() => {
    if (isConnected && !walletClient && !isWalletLoading) refetchWallet();
  }, [isConnected, walletClient, isWalletLoading, refetchWallet]);

  const { isReady: isProverReady, isLoading: isProverLoading, generateSellProof, error: proverError } = useZkProver();

  const ensureViewingKey = useCallback(async (): Promise<string> => {
    if (viewingKey) return viewingKey;
    // Use session.unlock if available - it returns the key for immediate use
    if (session) {
      const derivedKey = await session.unlock();
      if (derivedKey) return derivedKey;
      throw new Error('Failed to unlock wallet');
    }
    // Fallback: manual signing (for backward compatibility if session not provided)
    const signature = await signMessageAsync({ message: SIGN_MESSAGE });
    const derivedKey = keccak256(toBytes(signature));
    return derivedKey;
  }, [viewingKey, signMessageAsync, session]);

  const [direction, setDirection] = useState<SwapDirection>('buy');
  const [inputAmount, setInputAmount] = useState('');
  const debouncedInputAmount = useDebounce(inputAmount, 100); // 100ms debounce for calculations
  const [isLoading, setIsLoading] = useState(false);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [tokensReceived, setTokensReceived] = useState<bigint | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Slippage settings
  const [slippageTolerance, setSlippageTolerance] = useState(DEFAULT_SLIPPAGE);
  const [showSlippageSettings, setShowSlippageSettings] = useState(false);
  const [showTokenSelector, setShowTokenSelector] = useState(false);

  // Auto-switch to buy mode when project token is selected (sell not supported yet)
  useEffect(() => {
    if (isProjectToken && direction === 'sell') {
      setDirection('buy');
    }
  }, [isProjectToken, direction]);

  // Calculate the max sellable from a single commitment (ZK circuits can only spend one at a time)
  const maxSellableFromSingleCommitment = useMemo(() => {
    const spendable = commitments.filter(c => !c.spent && c.nullifier && c.secret);
    if (spendable.length === 0) return 0n;
    return spendable.reduce((max, c) => {
      const amt = BigInt(c.amount);
      return amt > max ? amt : max;
    }, 0n);
  }, [commitments]);

  // Check if balance is spread across multiple commitments
  const hasMultipleCommitments = useMemo(() => {
    const spendable = commitments.filter(c => !c.spent && c.nullifier && c.secret);
    return spendable.length > 1 && maxSellableFromSingleCommitment < balance;
  }, [commitments, maxSellableFromSingleCommitment, balance]);

  // Get sorted spendable commitments for display
  const spendableCommitments = useMemo(() => {
    return commitments
      .filter(c => !c.spent && c.nullifier && c.secret)
      .map(c => ({ ...c, amountBigInt: BigInt(c.amount) }))
      .sort((a, b) => (b.amountBigInt > a.amountBigInt ? 1 : -1));
  }, [commitments]);

  // Check if current input amount exceeds largest commitment
  const inputExceedsLargestCommitment = useMemo(() => {
    if (!inputAmount || direction !== 'sell') return false;
    try {
      const inputBigInt = parseEther(inputAmount);
      return inputBigInt > maxSellableFromSingleCommitment;
    } catch {
      return false;
    }
  }, [inputAmount, direction, maxSellableFromSingleCommitment]);

  // Find the best commitment for the entered amount (smallest one that's sufficient)
  // This optimizes change handling - smaller change = better privacy
  const bestCommitmentForAmount = useMemo(() => {
    if (!inputAmount || direction !== 'sell') return null;
    try {
      const inputBigInt = parseEther(inputAmount);
      if (inputBigInt <= 0n) return null;

      // Filter commitments that can cover the amount, sort by size (smallest first)
      const sufficient = spendableCommitments
        .filter(c => c.amountBigInt >= inputBigInt)
        .sort((a, b) => (a.amountBigInt < b.amountBigInt ? -1 : 1));

      return sufficient.length > 0 ? sufficient[0] : null;
    } catch {
      return null;
    }
  }, [inputAmount, direction, spendableCommitments]);

  const [ethReserve, setEthReserve] = useState<bigint>(0n);
  const [tokenReserve, setTokenReserve] = useState<bigint>(0n);
  const [tokenPrice, setTokenPrice] = useState<bigint>(0n);
  // Project pool reserves (for two-hop swaps: ETH → ROOT → ProjectToken)
  const [projectR00tReserve, setProjectR00tReserve] = useState<bigint>(0n);
  const [projectTokenReserve, setProjectTokenReserve] = useState<bigint>(0n);
  const [isRateLimited, setIsRateLimited] = useState(false);
  const [, setPoolStateLoaded] = useState(false);

  useEffect(() => {
    if (!activeAMMAddress || activeAMMAddress === '0x...') return;

    const fetchPoolState = async () => {
      // Skip if rate limited - wait for cooldown
      if (isRateLimited) return;

      try {
        // Try Ponder GraphQL first (no rate limits) — skip if indexer URL not configured
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
              setPoolStateLoaded(true);
              console.log('[SwapPanel] Pool state from Ponder:', state);
              return;
            }
          }
        } catch {
          // Ponder not available, fall through to RPC
        }

        // Try wagmi publicClient - read from PAIR (state), not Router
        // In split architecture: Pair holds state, Router handles transactions
        // Note: Pair doesn't have getTokenPrice(), we calculate from reserves
        const pairAddress = CONTRACTS.zkAMMPair as `0x${string}`;
        console.log('[SwapPanel] Fetching reserves from Pair:', pairAddress);
        if (publicClient) {
          const [ethRes, rootRes] = await Promise.all([
            publicClient.readContract({ address: pairAddress, abi: ZKAMM_ABI, functionName: 'ethReserve' }),
            publicClient.readContract({ address: pairAddress, abi: ZKAMM_ABI, functionName: 'tokenReserve' }),
          ]);
          console.log('[SwapPanel] Reserves from RPC:', { ethReserve: ethRes.toString(), tokenReserve: rootRes.toString() });
          setEthReserve(ethRes);
          setTokenReserve(rootRes);
          // Calculate price: tokens per ETH
          if (ethRes > 0n) {
            setTokenPrice(rootRes * BigInt(1e18) / ethRes);
          }

          // For project tokens, also fetch the project pool reserves (ROOT/Token)
          if (isProjectToken && activeAMMAddress !== zkAMMAddress) {
            try {
              const poolAddress = activeAMMAddress as `0x${string}`;
              console.log('[SwapPanel] Fetching project pool reserves from:', poolAddress);
              const [r00tRes, projTokenRes] = await Promise.all([
                publicClient.readContract({ address: poolAddress, abi: ZKAMM_ABI, functionName: 'r00tReserve' }),
                publicClient.readContract({ address: poolAddress, abi: ZKAMM_ABI, functionName: 'tokenReserve' }),
              ]);
              console.log('[SwapPanel] Project pool reserves:', { r00tReserve: r00tRes.toString(), tokenReserve: projTokenRes.toString() });
              setProjectR00tReserve(r00tRes);
              setProjectTokenReserve(projTokenRes);

              // Calculate combined price: ETH → ROOT → Token
              if (ethRes > 0n && r00tRes > 0n) {
                // ROOT per ETH * Token per ROOT = Token per ETH
                const rootPerEth = rootRes * BigInt(1e18) / ethRes;
                const tokenPerRoot = projTokenRes * BigInt(1e18) / r00tRes;
                setTokenPrice(rootPerEth * tokenPerRoot / BigInt(1e18));
              }
            } catch (err) {
              console.error('[SwapPanel] Failed to fetch project pool reserves:', err);
            }
          } else {
            // Reset project reserves when switching back to ROOT
            setProjectR00tReserve(0n);
            setProjectTokenReserve(0n);
          }

          setPoolStateLoaded(true);
          return;
        }

        // Fallback to direct RPC calls (use config RPC URL) - read from PAIR
        const RPC_URL = NETWORK.rpcUrl;
        const ethReserveData = encodeFunctionData({ abi: ZKAMM_ABI, functionName: 'ethReserve' });
        const tokenReserveData = encodeFunctionData({ abi: ZKAMM_ABI, functionName: 'tokenReserve' });

        const [ethRes, tokenRes] = await Promise.all([
          fetch(RPC_URL, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ jsonrpc: '2.0', method: 'eth_call', params: [{ to: pairAddress, data: ethReserveData }, 'latest'], id: 1 })
          }).then(r => r.json()),
          fetch(RPC_URL, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ jsonrpc: '2.0', method: 'eth_call', params: [{ to: pairAddress, data: tokenReserveData }, 'latest'], id: 2 })
          }).then(r => r.json()),
        ]);

        if (ethRes.result && ethRes.result !== '0x') {
          const ethVal = decodeFunctionResult({ abi: ZKAMM_ABI, functionName: 'ethReserve', data: ethRes.result }) as bigint;
          setEthReserve(ethVal);
          if (tokenRes.result && tokenRes.result !== '0x') {
            const tokenVal = decodeFunctionResult({ abi: ZKAMM_ABI, functionName: 'tokenReserve', data: tokenRes.result }) as bigint;
            setTokenReserve(tokenVal);
            // Calculate price: tokens per ETH
            if (ethVal > 0n) {
              setTokenPrice(tokenVal * BigInt(1e18) / ethVal);
            }
          }
        }
        setPoolStateLoaded(true);
      } catch (err: unknown) {
        const errMsg = String(err);
        // Detect rate limiting (429 errors)
        if (errMsg.includes('429') || errMsg.includes('rate limit')) {
          console.warn('[SwapPanel] Rate limited, pausing pool state fetches for 5 minutes');
          setIsRateLimited(true);
          // Auto-reset after 5 minutes
          setTimeout(() => setIsRateLimited(false), 5 * 60 * 1000);
        } else {
          console.error('[SwapPanel] Failed to fetch pool state:', err);
        }
      }
    };

    fetchPoolState();

    // Only poll when page is visible to reduce RPC calls
    if (!isPageVisible) return;

    // Poll every 60s to minimize RPC calls
    const interval = window.setInterval(fetchPoolState, 60000);
    return () => window.clearInterval(interval);
  }, [publicClient, activeAMMAddress, isRateLimited, isPageVisible, isProjectToken, zkAMMAddress]);

  // Calculate estimated output from reserves (standard AMM formula with 0.3% fee)
  const estimatedOutput = useMemo((): string => {
    // Need valid input
    if (!debouncedInputAmount) {
      return '0';
    }

    const inputNum = parseFloat(debouncedInputAmount);
    if (isNaN(inputNum) || inputNum <= 0) {
      return '0';
    }

    // Need reserves to be loaded
    if (ethReserve === 0n || tokenReserve === 0n) {
      console.log('[SwapPanel] Reserves not loaded yet:', { ethReserve: ethReserve.toString(), tokenReserve: tokenReserve.toString() });
      return '0';
    }

    try {
      const amountIn = parseEther(debouncedInputAmount);
      console.log('[SwapPanel] Calculating quote:', {
        input: debouncedInputAmount,
        amountIn: amountIn.toString(),
        ethReserve: ethReserve.toString(),
        tokenReserve: tokenReserve.toString(),
        direction,
        isProjectToken,
      });

      if (direction === 'buy') {
        if (isProjectToken && projectR00tReserve > 0n && projectTokenReserve > 0n) {
          // Two-hop: ETH → ROOT → ProjectToken
          // Hop 1: ETH → ROOT (ROOT/ETH pair, 0.3% fee)
          const hop1InWithFee = amountIn * 997n;
          const hop1Numerator = hop1InWithFee * tokenReserve; // tokenReserve = ROOT in ROOT/ETH pair
          const hop1Denominator = ethReserve * 1000n + hop1InWithFee;
          const rootOut = hop1Numerator / hop1Denominator;

          // Hop 2: ROOT → ProjectToken (project pool, 0.3% fee)
          const hop2InWithFee = rootOut * 997n;
          const hop2Numerator = hop2InWithFee * projectTokenReserve;
          const hop2Denominator = projectR00tReserve * 1000n + hop2InWithFee;
          const tokensOut = hop2Numerator / hop2Denominator;

          const result = formatUnits(tokensOut, 18);
          console.log('[SwapPanel] Project token buy quote (two-hop):', { rootOut: rootOut.toString(), tokensOut: tokensOut.toString(), result });
          return result;
        } else {
          // Single hop: ETH → ROOT
          const amountInWithFee = amountIn * 997n;
          const numerator = amountInWithFee * tokenReserve;
          const denominator = ethReserve * 1000n + amountInWithFee;
          const tokensOut = numerator / denominator;
          const result = formatUnits(tokensOut, 18);
          console.log('[SwapPanel] Buy quote result:', result);
          return result;
        }
      } else {
        // Token -> ETH (ROOT only — project token sell disabled)
        const amountInWithFee = amountIn * 997n;
        const numerator = amountInWithFee * ethReserve;
        const denominator = tokenReserve * 1000n + amountInWithFee;
        const ethOut = numerator / denominator;
        const result = formatEther(ethOut);
        console.log('[SwapPanel] Sell quote result:', result);
        return result;
      }
    } catch (err) {
      console.error('[SwapPanel] Quote calculation error:', err);
      return '0';
    }
  }, [debouncedInputAmount, ethReserve, tokenReserve, direction, isProjectToken, projectR00tReserve, projectTokenReserve]);

  // Calculate price impact
  const priceImpact = useMemo((): { value: number; color: string } => {
    if (!debouncedInputAmount || ethReserve === 0n || tokenReserve === 0n) {
      return { value: 0, color: 'var(--text-muted)' };
    }

    const inputNum = parseFloat(debouncedInputAmount);
    const outputNum = parseFloat(estimatedOutput);
    if (isNaN(inputNum) || inputNum <= 0 || isNaN(outputNum) || outputNum <= 0) {
      return { value: 0, color: 'var(--text-muted)' };
    }

    try {
      // Spot price (current rate without trade impact)
      const spotPrice = direction === 'buy'
        ? Number(formatUnits(tokenReserve, 18)) / Number(formatEther(ethReserve))
        : Number(formatEther(ethReserve)) / Number(formatUnits(tokenReserve, 18));

      // Execution price (rate for this specific trade)
      const executionPrice = outputNum / inputNum;

      // Price impact as percentage (how much worse than spot)
      const impact = ((spotPrice - executionPrice) / spotPrice) * 100;
      const absImpact = Math.abs(impact);

      // Color coding based on severity
      let color = 'var(--success)'; // Green: < 1%
      if (absImpact >= 1 && absImpact < 3) color = 'var(--warning)'; // Yellow: 1-3%
      else if (absImpact >= 3 && absImpact < 5) color = '#FF8C00'; // Orange: 3-5%
      else if (absImpact >= 5) color = 'var(--error)'; // Red: > 5%

      return { value: absImpact, color };
    } catch {
      return { value: 0, color: 'var(--text-muted)' };
    }
  }, [debouncedInputAmount, estimatedOutput, ethReserve, tokenReserve, direction]);

  const handleBuy = async () => {
    if (!inputAmount || parseFloat(inputAmount) <= 0) { setError('Please enter an amount'); return; }
    setIsLoading(true); setError(null); setTxHash(null); setTokensReceived(null);
    try {
      const currentViewingKey = await ensureViewingKey();
      const result = await buyQuickPrivate({ ethAmount: inputAmount, viewingKey: currentViewingKey, onProgress: () => { }, slippageBps: slippageTolerance });
      if (result.success) {
        if (result.txHash) setTxHash(result.txHash);
        if (result.tokensReceived) setTokensReceived(result.tokensReceived);
        if (result.error) setError(result.error);
        if (onBuySuccess && result.commitment && result.nullifier && result.secret && result.tokensReceived) {
          onBuySuccess(result.commitment, result.nullifier, result.secret, result.tokensReceived, result.leafIndex || 0, 0);
        }
        setInputAmount('');
        // Refresh ETH balance after successful buy
        refetchEthBalance();
        // Inject trade directly into live feed (works even without Ponder)
        const tradeDetail = {
          type: 'buy' as const,
          ethAmount: parseFloat(inputAmount),
          tokenAmount: result.tokensReceived ? Number(result.tokensReceived) / 1e18 : 0,
          price: result.tokensReceived ? parseFloat(inputAmount) / (Number(result.tokensReceived) / 1e18) : 0,
          timestamp: Date.now(),
          txHash: result.txHash || '',
          blockNumber: 0,
        };
        window.dispatchEvent(new CustomEvent(TRADE_COMPLETE_EVENT, { detail: tradeDetail }));
        // Also retry after delay in case Ponder has the full data
        setTimeout(() => window.dispatchEvent(new CustomEvent(TRADE_COMPLETE_EVENT)), 5000);
      } else { setError(result.error || 'Transaction failed'); }
    } catch (err: unknown) {
      const error = err as Error;
      let errorMessage = error.message || 'Transaction failed';
      if (errorMessage.includes('User rejected')) errorMessage = 'Transaction rejected by user';
      else if (errorMessage.includes('insufficient funds')) errorMessage = 'Insufficient ETH balance';
      setError(errorMessage);
    } finally { setIsLoading(false); }
  };

  const handleSell = async () => {
    if (!walletClient || !publicClient || !inputAmount || !address) return;
    setIsLoading(true); setError(null); setTxHash(null);
    try {
      const tokenAmount = parseEther(inputAmount);
      if (tokenAmount > balance) throw new Error('Insufficient private balance');

      // Debug: Log available commitments
      console.log(`[SwapPanel] handleSell: Looking for commitment with >= ${tokenAmount} tokens`);
      console.log(`[SwapPanel] Available commitments:`, commitments.map(c => ({
        leafIndex: c.leafIndex,
        amount: BigInt(c.amount).toString(),
        spent: c.spent,
        hasNullifier: !!c.nullifier,
        hasSecret: !!c.secret,
      })));

      // Use bestCommitmentForAmount which finds the smallest sufficient commitment
      // This minimizes change and improves privacy
      const commitmentToSpend = bestCommitmentForAmount ||
        commitments.find(c => !c.spent && c.nullifier && c.secret && BigInt(c.amount) >= tokenAmount);

      console.log(`[SwapPanel] Best commitment selected:`, commitmentToSpend ? {
        leafIndex: commitmentToSpend.leafIndex,
        amount: BigInt(commitmentToSpend.amount).toString(),
        change: (BigInt(commitmentToSpend.amount) - tokenAmount).toString(),
      } : 'none');

      if (!commitmentToSpend?.nullifier || !commitmentToSpend?.secret) {
        // Find the largest available commitment to give a helpful error
        const largestCommitment = commitments
          .filter(c => !c.spent && c.nullifier && c.secret)
          .reduce((max, c) => BigInt(c.amount) > BigInt(max?.amount || '0') ? c : max, null as typeof commitments[0] | null);

        if (largestCommitment) {
          const maxSellable = formatEther(BigInt(largestCommitment.amount));
          throw new Error(`Amount exceeds largest commitment. Max sellable in one tx: ${Number(maxSellable).toFixed(2)} tokens`);
        }
        throw new Error('No commitment with stored secrets found. Try refreshing your wallet.');
      }
      if (!isProverReady) throw new Error(isProverLoading ? 'ZK prover loading...' : proverError || 'ZK prover failed');
      if (!fetchAllOnChainCommitments) throw new Error('Cannot fetch commitments');

      // Use Router for getAmountOut (Pair may have stricter validation)
      const routerAddress = (CONTRACTS.zkAMMRouter || activeAMMAddress) as `0x${string}`;
      const estimatedEthOut = await publicClient.readContract({ address: routerAddress, abi: ZKAMM_ABI, functionName: 'getAmountOut', args: [tokenAmount, tokenReserve, ethReserve] });
      // Apply user-configured slippage tolerance
      const minEthOut = estimatedEthOut * BigInt(10000 - slippageTolerance) / 10000n;
      // Fetch on-chain commitments with retry (network issues can cause 0 results)
      let allCommitmentHashes: { commitment: bigint; leafIndex: number }[] = [];
      let treeState: { filledSubtrees: bigint[]; root: bigint } | undefined;
      for (let attempt = 0; attempt < 3; attempt++) {
        const result = await fetchAllOnChainCommitments(commitmentToSpend.address);
        allCommitmentHashes = result.commitments;
        treeState = result.treeState;
        if (allCommitmentHashes.length > 0) break;
        console.warn(`[SwapPanel] fetchAllOnChainCommitments returned 0 results (attempt ${attempt + 1}/3), retrying...`);
        await new Promise(r => setTimeout(r, 1000 * (attempt + 1))); // 1s, 2s backoff
      }

      console.log(`[SwapPanel] Generating sell proof for leaf ${commitmentToSpend.leafIndex} with ${allCommitmentHashes.length} total commitments, treeState: ${treeState ? 'available' : 'NOT available'}`);

      // PRE-FLIGHT VALIDATION: Check if the commitment exists in on-chain data
      // IMPORTANT: If we got 0 results, this is likely a fetch failure - do NOT delete the commitment
      if (allCommitmentHashes.length === 0) {
        throw new Error(`Failed to fetch on-chain commitment data from indexer. Please check your internet connection and try again. Your commitment is safe and has NOT been removed.`);
      }

      if (commitmentToSpend.leafIndex >= allCommitmentHashes.length) {
        console.error(`[SwapPanel] PRE-FLIGHT FAILED: leafIndex ${commitmentToSpend.leafIndex} >= on-chain tree size ${allCommitmentHashes.length}`);
        // Don't auto-remove - the indexer may just be behind. Let the user decide.
        throw new Error(`Commitment at leafIndex ${commitmentToSpend.leafIndex} not found on-chain yet (indexer has ${allCommitmentHashes.length} commitments). The indexer may still be syncing. Please wait a moment and try again. Your commitment has NOT been removed.`);
      }

      // Also verify the commitment hash matches what's on-chain at that index
      const onChainCommitment = allCommitmentHashes.find(c => c.leafIndex === commitmentToSpend.leafIndex);
      if (!onChainCommitment) {
        console.error(`[SwapPanel] PRE-FLIGHT FAILED: No commitment found at leafIndex ${commitmentToSpend.leafIndex}`);
        throw new Error(`Commitment at leafIndex ${commitmentToSpend.leafIndex} not found in on-chain data. The indexer may still be syncing. Please wait and try again.`);
      }

      const proofResult = await generateSellProof({
        commitment: { nullifier: BigInt(commitmentToSpend.nullifier), secret: BigInt(commitmentToSpend.secret), amount: BigInt(commitmentToSpend.amount), leafIndex: commitmentToSpend.leafIndex },
        tokenAmount, minEthOut, recipient: address, relayer: '0x0000000000000000000000000000000000000000', fee: 0n, allCommitments: allCommitmentHashes,
        treeState, // Use pre-computed tree state from Ponder for instant proof generation
      });

      // Pre-flight validation: check merkle root and nullifier before submitting tx
      const pairAddress = CONTRACTS.zkAMMPair as `0x${string}`;
      console.log(`[SwapPanel] Pre-flight check on Pair ${pairAddress}`);
      console.log(`[SwapPanel] Computed merkle root: ${proofResult.merkleRoot.toString()}`);
      console.log(`[SwapPanel] Nullifier hash: ${proofResult.nullifierHash.toString()}`);

      const [isRootKnown, isNullifierSpent] = await Promise.all([
        publicClient.readContract({ address: pairAddress, abi: ZKAMM_ABI, functionName: 'isKnownRoot', args: [proofResult.merkleRoot] }),
        publicClient.readContract({ address: pairAddress, abi: ZKAMM_ABI, functionName: 'isNullifierSpent', args: [proofResult.nullifierHash] }),
      ]);

      console.log(`[SwapPanel] isKnownRoot: ${isRootKnown}, isNullifierSpent: ${isNullifierSpent}`);

      if (!isRootKnown) {
        throw new Error(`Merkle root not recognized on-chain. Root: ${proofResult.merkleRoot.toString().slice(0, 20)}... This usually means the indexer is out of sync - try refreshing or waiting a few blocks.`);
      }
      if (isNullifierSpent) {
        throw new Error('This commitment has already been spent. Please refresh your wallet.');
      }

      // Log all public signals for debugging proof verification
      console.log('[SwapPanel] ====== SELL PROOF PUBLIC SIGNALS ======');
      console.log('[SwapPanel] [0] merkleRoot:', proofResult.merkleRoot.toString());
      console.log('[SwapPanel] [1] nullifierHash:', proofResult.nullifierHash.toString());
      console.log('[SwapPanel] [2] tokenAmount:', tokenAmount.toString());
      console.log('[SwapPanel] [3] minEthOut:', minEthOut.toString());
      console.log('[SwapPanel] [4] recipient:', address, '=', BigInt(address).toString());
      console.log('[SwapPanel] [5] relayer: 0x0 =', BigInt('0x0000000000000000000000000000000000000000').toString());
      console.log('[SwapPanel] [6] fee:', '0');
      console.log('[SwapPanel] [7] changeCommitment:', proofResult.changeCommitment.toString());
      console.log('[SwapPanel] [8] publicInputsBinding:', proofResult.publicInputsBinding.toString());
      console.log('[SwapPanel] proof[0..7]:', proofResult.proof.map(p => p.toString().slice(0, 20) + '...'));
      // Must go through Router so Ponder indexes the trade (TokensSold event)
      const sellAddress = CONTRACTS.zkAMMRouter || activeAMMAddress;
      console.log('[SwapPanel] Sending sellPrivate to Router:', sellAddress);
      console.log('[SwapPanel] ==========================================');

      const changeAmount = BigInt(commitmentToSpend.amount) - tokenAmount;
      let changeNote: `0x${string}` = '0x';
      if (changeAmount > 0n && viewingKey) {
        // Use proper ECDH + AES-GCM encryption so change commitment can be recovered from chain
        const wallet = new Wallet(viewingKey);
        const viewingPublicKey = wallet.signingKey.compressedPublicKey;
        changeNote = await encryptNote(proofResult.changeNullifier, proofResult.changeSecret, changeAmount, viewingPublicKey) as `0x${string}`;
      }

      const proof: [bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint] = [proofResult.proof[0], proofResult.proof[1], proofResult.proof[2], proofResult.proof[3], proofResult.proof[4], proofResult.proof[5], proofResult.proof[6], proofResult.proof[7]];
      // Deadline: use chain's block timestamp (Tenderly VNet timestamps can differ from real time)
      const latestBlock = await publicClient.getBlock();
      const deadline = latestBlock.timestamp + 1200n;
      const hash = await walletClient.writeContract({
        address: sellAddress as `0x${string}`, abi: ZKAMM_ABI, functionName: 'sellPrivate',
        args: [proof, proofResult.merkleRoot, proofResult.nullifierHash, tokenAmount, minEthOut, address, '0x0000000000000000000000000000000000000000', 0n, proofResult.changeCommitment, proofResult.publicInputsBinding, deadline, changeNote],
        chain: CHAIN,
      });
      setTxHash(hash);
      const receipt = await publicClient.waitForTransactionReceipt({ hash });

      // Only mark as spent if transaction actually succeeded on-chain
      if (receipt.status === 'success') {
        // Mark the commitment as spent so it can't be double-spent
        if (onSellSuccess) {
          onSellSuccess(commitmentToSpend.commitment);
        }
      } else {
        throw new Error('Transaction reverted on-chain. Your tokens are safe - try again.');
      }

      setInputAmount('');
      // Refresh ETH balance after successful sell (user received ETH)
      refetchEthBalance();
      // Inject trade directly into live feed (works even without Ponder)
      const sellTradeDetail = {
        type: 'sell' as const,
        ethAmount: parseFloat(inputAmount),
        tokenAmount: Number(tokenAmount) / 1e18,
        price: Number(tokenAmount) > 0 ? parseFloat(inputAmount) / (Number(tokenAmount) / 1e18) : 0,
        timestamp: Date.now(),
        txHash: hash,
        blockNumber: Number(receipt.blockNumber),
      };
      window.dispatchEvent(new CustomEvent(TRADE_COMPLETE_EVENT, { detail: sellTradeDetail }));
      // Also retry after delay in case Ponder has the full data
      setTimeout(() => window.dispatchEvent(new CustomEvent(TRADE_COMPLETE_EVENT)), 5000);
    } catch (err: unknown) {
      const errorMessage = (err as Error).message || 'Transaction failed';
      setError(errorMessage);

      // Auto-trigger scan if we detect stale wallet data
      // Note: Pre-flight validation above handles most cases now, but keep this for other edge cases
      if (errorMessage.includes('out of bounds') || errorMessage.includes('stale data') || errorMessage.includes('integrity check failed')) {
        console.log('[SwapPanel] Detected stale wallet data, auto-triggering scan...');
        if (scan) {
          scan().then(() => {
            console.log('[SwapPanel] Scan completed. Allowing state to propagate...');
            // Add delay to ensure React state updates have propagated
            setTimeout(() => {
              setError('Wallet synced with blockchain. Invalid commitments have been removed. Please try again.');
            }, 500);
          });
        }
      }
    } finally { setIsLoading(false); }
  };

  const handleSwap = () => direction === 'buy' ? handleBuy() : handleSell();
  const formattedPrice = tokenPrice > 0n ? Number(formatUnits(tokenPrice, 18)).toLocaleString(undefined, { maximumFractionDigits: 0 }) : '...';
  const canSell = viewingKey && balance > 0n;

  return (
    <div className="space-y-5">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex items-center justify-between"
      >
        <div>
          <h2 className="text-xl font-display font-bold text-[var(--text-primary)]">
            {direction === 'buy' ? 'Buy' : 'Sell'}{' '}
            <span className="text-[var(--accent)]">${currentToken.symbol}</span>
          </h2>
          <p className="text-xs font-mono text-[var(--text-muted)] mt-1">
            {direction === 'buy'
              ? '// ZK commitments — only you see balance'
              : '// sell privately — ETH to any address'}
          </p>
        </div>

        <div className="flex items-center gap-2">
          {/* Tool buttons — grouped in a flex row */}
          <div className="relative flex items-center gap-1.5 px-1.5 py-1 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border)]">
            <motion.button
              whileHover={{ scale: 1.1, rotate: 90 }}
              whileTap={{ scale: 0.9 }}
              onClick={() => setShowSlippageSettings(!showSlippageSettings)}
              className={`p-1.5 rounded transition-colors ${showSlippageSettings
                ? 'bg-[var(--accent)] text-[var(--bg-primary)]'
                : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                }`}
              title="Slippage Settings"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </motion.button>

            {scan && (
              <motion.button
                whileHover={{ scale: 1.1 }}
                whileTap={{ scale: 0.9 }}
                onClick={() => scan()}
                className="p-1.5 rounded text-[var(--text-muted)] hover:text-[var(--accent)] transition-colors"
                title="Rescan Wallet"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
              </motion.button>
            )}

            {resetWallet && (
              <motion.button
                whileHover={{ scale: 1.1, rotate: 180 }}
                whileTap={{ scale: 0.9 }}
                onClick={() => {
                  if (window.confirm('Are you sure you want to reset your wallet? This will clear local storage and rescan the blockchain. Your funds are safe on-chain.')) {
                    resetWallet();
                  }
                }}
                className="p-1.5 rounded text-[var(--text-muted)] hover:text-[var(--warning)] transition-colors"
                title="Reset Wallet"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
              </motion.button>
            )}

            {/* Slippage indicator badge */}
            {slippageTolerance !== DEFAULT_SLIPPAGE && (
              <span className="absolute -top-1.5 -right-1.5 px-1.5 py-0.5 text-[10px] font-mono bg-[var(--accent)] text-[var(--bg-primary)] rounded-full">
                {slippageTolerance / 100}%
              </span>
            )}

            {/* Slippage Settings Popover */}
            <AnimatePresence>
              {showSlippageSettings && (
                <SlippageSettings
                  value={slippageTolerance}
                  onChange={setSlippageTolerance}
                  onClose={() => setShowSlippageSettings(false)}
                />
              )}
            </AnimatePresence>
          </div>

        </div>
      </motion.div>


      {/* Sell Warning */}
      <AnimatePresence>
        {direction === 'sell' && !viewingKey && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
          >
            <div className="p-4 rounded-lg border border-[var(--warning)]/30" style={{ background: 'var(--warning)10' }}>
              <p className="text-sm text-[var(--warning)] flex items-center gap-2">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                unlock wallet in vault tab to sell
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Commitment Breakdown - shows when selling with multiple commitments */}
      <AnimatePresence>
        {direction === 'sell' && viewingKey && hasMultipleCommitments && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div
              className="p-4 rounded-lg border"
              style={{
                background: inputExceedsLargestCommitment
                  ? 'var(--warning)08'
                  : 'var(--bg-secondary)',
                borderColor: inputExceedsLargestCommitment
                  ? 'var(--warning)40'
                  : 'var(--border)',
              }}
            >
              <div className="flex items-center gap-2 mb-3">
                <svg className="w-4 h-4 text-[var(--text-muted)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                </svg>
                <span className="text-xs font-mono text-[var(--text-muted)]">
                  <span className="text-[var(--accent)] opacity-60">// </span>
                  spendable_commitments ({spendableCommitments.length})
                </span>
              </div>

              <div className="space-y-2">
                {spendableCommitments.slice(0, 4).map((c, i) => {
                  const isSelected = bestCommitmentForAmount?.leafIndex === c.leafIndex;
                  const isLargest = i === 0;
                  // Round down slightly to avoid dust issues, but keep 2 decimal precision
                  const displayAmount = Math.floor(Number(formatUnits(c.amountBigInt, 18)) * 100) / 100;
                  return (
                    <motion.button
                      key={c.leafIndex}
                      onClick={() => setInputAmount(displayAmount.toString())}
                      whileHover={{ scale: 1.01 }}
                      whileTap={{ scale: 0.99 }}
                      className={`w-full flex items-center justify-between p-2.5 rounded-md transition-all ${
                        isSelected
                          ? 'bg-[var(--success)]/15 border-2 border-[var(--success)]/50'
                          : isLargest
                            ? 'bg-[var(--accent)]/10 border border-[var(--accent)]/30'
                            : 'bg-[var(--bg-primary)] border border-[var(--border)] hover:border-[var(--accent)]/30'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <span className={`text-xs font-mono ${isSelected ? 'text-[var(--success)]' : isLargest ? 'text-[var(--accent)]' : 'text-[var(--text-muted)]'}`}>
                          #{c.leafIndex}
                        </span>
                        {isSelected && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--success)]/20 text-[var(--success)] font-mono flex items-center gap-1">
                            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                            </svg>
                            selected
                          </span>
                        )}
                        {!isSelected && isLargest && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--accent)]/20 text-[var(--accent)] font-mono">
                            largest
                          </span>
                        )}
                      </div>
                      <span className={`text-sm font-mono ${isSelected ? 'text-[var(--success)]' : isLargest ? 'text-[var(--text-primary)]' : 'text-[var(--text-secondary)]'}`}>
                        {Number(formatUnits(c.amountBigInt, 18)).toLocaleString(undefined, { maximumFractionDigits: 2 })} {currentToken.symbol}
                      </span>
                    </motion.button>
                  );
                })}
                {spendableCommitments.length > 4 && (
                  <p className="text-xs text-[var(--text-muted)] text-center font-mono">
                    +{spendableCommitments.length - 4} more commitments
                  </p>
                )}
              </div>

              {/* Change preview when a commitment is selected */}
              {bestCommitmentForAmount && inputAmount && (
                <div className="mt-3 p-2 rounded-md bg-[var(--bg-primary)] border border-[var(--border)]">
                  <div className="flex justify-between items-center text-xs font-mono">
                    <span className="text-[var(--text-muted)]">change returned:</span>
                    <span className="text-[var(--text-secondary)]">
                      {(() => {
                        try {
                          const inputBigInt = parseEther(inputAmount);
                          const change = bestCommitmentForAmount.amountBigInt - inputBigInt;
                          if (change <= 0n) return '0';
                          return `${Number(formatUnits(change, 18)).toLocaleString(undefined, { maximumFractionDigits: 2 })} ${currentToken.symbol}`;
                        } catch {
                          return '0';
                        }
                      })()}
                    </span>
                  </div>
                </div>
              )}

              <p className="text-xs text-[var(--text-muted)] mt-3 flex items-center gap-1.5">
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                ZK circuits spend one commitment per tx. Click to select amount.
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Amount Exceeds Warning */}
      <AnimatePresence>
        {direction === 'sell' && viewingKey && inputExceedsLargestCommitment && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="p-3 rounded-lg border border-[var(--warning)]/40 flex items-start gap-3"
            style={{ background: 'var(--warning)10' }}
          >
            <svg className="w-4 h-4 text-[var(--warning)] mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <div>
              <p className="text-sm text-[var(--warning)] font-medium">
                Amount exceeds largest commitment
              </p>
              <p className="text-xs text-[var(--text-muted)] mt-1">
                Max per tx: {Number(formatUnits(maxSellableFromSingleCommitment, 18)).toLocaleString(undefined, { maximumFractionDigits: 2 })} {currentToken.symbol}.
                Sell in multiple transactions to spend more.
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Swap Interface */}
      <div className="space-y-1">
        <SwapInput
          label={direction === 'buy' ? 'you_pay' : 'you_sell'}
          value={inputAmount}
          onChange={setInputAmount}
          token={{ symbol: direction === 'buy' ? 'ETH' : currentToken.symbol, isEth: direction === 'buy' }}
          onMax={direction === 'buy' && ethBalance ? () => {
            // Reserve 0.01 ETH for gas when buying
            const maxBuyable = ethBalance.value > parseEther('0.01')
              ? ethBalance.value - parseEther('0.01')
              : 0n;
            const rounded = Math.floor(Number(formatEther(maxBuyable)) * 10000) / 10000;
            setInputAmount(rounded.toString());
          } : direction === 'sell' && viewingKey ? () => {
            // Round down to 2 decimals to avoid long decimal strings in UI
            const rounded = Math.floor(Number(formatUnits(maxSellableFromSingleCommitment, 18)) * 100) / 100;
            setInputAmount(rounded.toString());
          } : undefined}
          maxLabel={direction === 'buy' && ethBalance ? (
            `bal: ${Number(formatEther(ethBalance.value)).toFixed(4)} ETH`
          ) : direction === 'sell' && viewingKey ? (
            hasMultipleCommitments
              ? `max per tx: ${Number(formatUnits(maxSellableFromSingleCommitment, 18)).toFixed(2)}`
              : `max: ${Number(formatUnits(balance, 18)).toFixed(2)}`
          ) : undefined}
          onTokenClick={direction === 'sell' ? () => setShowTokenSelector(true) : undefined}
        />

        <SwapArrow onClick={() => {
          if (isProjectToken) {
            // Project tokens can only be bought (ETH → ROOT → Token)
            // Selling requires a different ZK circuit (swapTokenForR00t)
            if (direction === 'buy') {
              setError('Sell not available for project tokens yet — requires a different ZK circuit');
              return;
            }
          }
          setDirection(direction === 'buy' ? 'sell' : 'buy');
        }} />

        <SwapInput
          label="you_receive"
          value={estimatedOutput === '0' ? '0' : direction === 'sell' ? Number(estimatedOutput).toFixed(8) : Math.floor(Number(estimatedOutput)).toString()}
          token={{ symbol: direction === 'buy' ? currentToken.symbol : 'ETH', isEth: direction === 'sell' }}
          readOnly
          isToken={direction === 'buy'}
          onTokenClick={direction === 'buy' ? () => setShowTokenSelector(true) : undefined}
        />
      </div>

      {/* Pool Info */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        transition={{ duration: 0.4 }}
        className="px-4 py-3 rounded-lg"
        style={{ background: 'var(--bg-secondary)50' }}
      >
        <InfoRow label="rate" value={`1 ETH = ${formattedPrice} $${currentToken.symbol}`} highlight />
        <div className="border-t border-[var(--border)] my-1" />

        {/* Price Impact Row */}
        {inputAmount && parseFloat(inputAmount) > 0 && (
          <div className="flex justify-between items-center py-2">
            <span className="text-xs font-mono text-[var(--text-muted)]">price_impact</span>
            <span
              className="text-sm font-mono"
              style={{ color: priceImpact.color }}
            >
              {priceImpact.value < 0.01 ? '<0.01' : priceImpact.value.toFixed(2)}%
              {priceImpact.value >= 5 && (
                <span className="ml-1">⚠️</span>
              )}
            </span>
          </div>
        )}

        {/* Slippage Row */}
        <div className="flex justify-between items-center py-2">
          <span className="text-xs font-mono text-[var(--text-muted)]">max_slippage</span>
          <span className="text-sm font-mono text-[var(--text-secondary)]">
            {slippageTolerance / 100}%
          </span>
        </div>

        <div className="border-t border-[var(--border)] my-1" />
        <InfoRow label="liquidity" value={`${formatEther(ethReserve)} ETH / ${Number(formatUnits(tokenReserve, 18)).toLocaleString()} $${currentToken.symbol}`} />
      </motion.div>

      {/* W6 Compliant Vault Status */}
      {vaultStats && (
        <div
          className="flex items-center gap-2.5 px-4 py-2.5 rounded-lg text-[10px] font-mono"
          style={{ background: 'var(--bg-secondary)50' }}
        >
          <span className="relative flex h-1.5 w-1.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[var(--success)] opacity-75" />
            <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-[var(--success)]" />
          </span>
          <span className="text-[var(--accent)]">W6</span>
          <span className="text-[var(--text-muted)]">compliant_vault</span>
          <span className="text-[var(--text-secondary)] ml-auto">
            {Number(formatEther(vaultStats.totalVolume)).toLocaleString(undefined, { maximumFractionDigits: 4 })} ETH vol
          </span>
          <span className="text-[var(--text-muted)]">{vaultStats.totalRequests} txns</span>
        </div>
      )}

      {/* Error/Success Messages */}
      <AnimatePresence>
        {error && (
          <motion.div
            key="error-message"
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="p-4 rounded-lg border border-[var(--error)]/30 flex items-center gap-3"
            style={{ background: 'var(--error)10' }}
          >
            <div className="w-2 h-2 rounded-full bg-[var(--error)]" />
            <span className="text-sm text-[var(--error)]">{error}</span>
          </motion.div>
        )}

        {txHash && (
          <motion.div
            key="tx-success"
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="p-4 rounded-lg border border-[var(--success)]/30"
            style={{ background: 'var(--success)10' }}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <motion.div
                  animate={{ scale: [1, 1.2, 1] }}
                  transition={{ duration: 1, repeat: Infinity }}
                  className="w-2 h-2 rounded-full bg-[var(--success)]"
                />
                <div>
                  <span className="text-sm text-[var(--success)]">
                    {tokensReceived ? `+${Number(formatUnits(tokensReceived, 18)).toLocaleString(undefined, { maximumFractionDigits: 0 })} ${currentToken.symbol}` : 'transaction submitted'}
                  </span>
                  {tokensReceived !== null && tokensReceived > 0n && (
                    <p className="text-[10px] text-[var(--text-muted)] font-mono">
                      added to private balance
                    </p>
                  )}
                </div>
              </div>
              {getExplorerTxUrl(txHash) ? (
                <a
                  href={getExplorerTxUrl(txHash)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs font-mono text-[var(--success)] hover:underline flex items-center gap-1"
                >
                  view
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                  </svg>
                </a>
              ) : (
                <span className="text-xs font-mono text-[var(--success)] opacity-70">{txHash.slice(0, 10)}...</span>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Action Button */}
      {!isConnected ? (
        <GlowButton disabled fullWidth size="lg">
          <span className="flex items-center justify-center gap-2">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
            connect() to swap
          </span>
        </GlowButton>
      ) : !isOnCorrectChain ? (
        <GlowButton onClick={handleSwitchToCorrectChain} loading={isSwitchingChain} fullWidth size="lg" variant="secondary">
          {isSwitchingChain ? 'switching...' : `switch to ${NETWORK.name}`}
        </GlowButton>
      ) : zkAMMAddress === '0x...' ? (
        <GlowButton disabled fullWidth size="lg">contract not deployed</GlowButton>
      ) : !walletClient ? (
        <GlowButton disabled fullWidth size="lg">{isWalletLoading ? 'initializing...' : 'wallet not ready'}</GlowButton>
      ) : direction === 'sell' && !canSell ? (
        <GlowButton disabled fullWidth size="lg">unlock() in vault to sell</GlowButton>
      ) : (
        <GlowButton
          onClick={handleSwap}
          disabled={!inputAmount || isLoading || isBuyLoading}
          loading={isLoading || isBuyLoading}
          fullWidth
          size="lg"
          variant="primary"
        >
          <span className="flex items-center justify-center gap-2">
            {isLoading || isBuyLoading ? (
              buyProgress || 'processing...'
            ) : direction === 'buy' ? (
              <>
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                </svg>
                buy_private()
              </>
            ) : (
              <>
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                sell_private()
              </>
            )}
          </span>
        </GlowButton>
      )}

      {/* Footer Info */}
      <motion.div
        initial={{ opacity: 0, y: 5 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        transition={{ delay: 0.3, duration: 0.4 }}
        className="text-center pt-2"
      >
        <p className="text-xs text-[var(--text-muted)] flex items-center justify-center gap-2">
          <motion.span
            animate={{ opacity: [0.5, 1, 0.5] }}
            transition={{ duration: 2, repeat: Infinity }}
            className="w-1.5 h-1.5 rounded-full bg-[var(--accent)]"
          />
          {direction === 'buy'
            ? 'tokens stored as ZK commitments — fully private'
            : 'uses zk proofs — nobody sees what you spend'}
        </p>
      </motion.div>

      {/* Token Selector Modal */}
      <AnimatePresence>
        {showTokenSelector && (
          <motion.div
            key="token-selector-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50"
            onClick={() => setShowTokenSelector(false)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.92, y: 24 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.92, y: 24 }}
              transition={{ type: 'spring', damping: 22, stiffness: 300 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-sm mx-4 rounded-xl bg-[var(--bg-elevated)] border border-[var(--border)] shadow-2xl overflow-hidden"
            >
              {/* Modal Header */}
              <div className="flex items-center justify-between px-5 pt-5 pb-3">
                <div>
                  <p className="text-[9px] font-mono text-[var(--text-muted)] uppercase mb-1">
                    <span className="text-[var(--accent)] opacity-60">// </span>select_token
                  </p>
                  <h3 className="text-lg font-semibold text-[var(--text-primary)]">Choose a token</h3>
                </div>
                <button
                  onClick={() => setShowTokenSelector(false)}
                  className="p-2 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-secondary)] transition-colors"
                >
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              {/* Token List */}
              <div className="px-3 pb-4 space-y-1.5">
                {availableTokens && availableTokens.length > 0 ? availableTokens.map((token, idx) => {
                  const isSelected = token.address === currentToken.address;
                  return (
                    <motion.button
                      key={token.address}
                      initial={{ opacity: 0, x: -12 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: idx * 0.04, duration: 0.25 }}
                      onClick={() => {
                        onTokenChange?.(token.address);
                        setShowTokenSelector(false);
                        setInputAmount('');
                      }}
                      className={`w-full text-left px-4 py-3.5 rounded-lg flex items-center gap-3.5 transition-all duration-200 group ${
                        isSelected
                          ? 'bg-[var(--accent)]/10 border border-[var(--accent)]/30'
                          : 'hover:bg-[var(--bg-secondary)] border border-transparent hover:border-[var(--border)]'
                      }`}
                    >
                      {/* Token Icon */}
                      <div
                        className="w-10 h-10 rounded-full flex items-center justify-center shrink-0 text-sm font-bold"
                        style={{
                          background: token.isRoot
                            ? 'linear-gradient(135deg, var(--accent), color-mix(in srgb, var(--accent) 60%, black))'
                            : `linear-gradient(135deg, hsl(${(token.symbol.charCodeAt(0) * 37) % 360}, 55%, 45%), hsl(${(token.symbol.charCodeAt(0) * 37 + 40) % 360}, 55%, 35%))`,
                          color: 'white',
                          boxShadow: isSelected ? '0 0 16px var(--accent)40' : 'none',
                        }}
                      >
                        {token.isRoot ? (
                          <RootLogo size={22} />
                        ) : (
                          <span>{token.symbol.slice(0, 2)}</span>
                        )}
                      </div>

                      {/* Token Info */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className={`font-semibold text-sm ${isSelected ? 'text-[var(--accent)]' : 'text-[var(--text-primary)]'}`}>
                            ${token.symbol}
                          </span>
                          {token.isRoot && (
                            <span className="text-[8px] font-mono px-1.5 py-0.5 rounded-full bg-[var(--accent)]/10 text-[var(--accent)] uppercase tracking-wider">
                              base
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-[var(--text-muted)] truncate mt-0.5">{token.name}</p>
                        <p className="text-[10px] font-mono text-[var(--text-muted)] opacity-50 mt-0.5">
                          {token.address.slice(0, 6)}...{token.address.slice(-4)}
                        </p>
                      </div>

                      {/* Selected check */}
                      {isSelected && (
                        <motion.div
                          initial={{ scale: 0 }}
                          animate={{ scale: 1 }}
                          className="w-6 h-6 rounded-full bg-[var(--accent)] flex items-center justify-center shrink-0"
                        >
                          <svg className="w-3.5 h-3.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                          </svg>
                        </motion.div>
                      )}

                      {/* Hover arrow */}
                      {!isSelected && (
                        <svg className="w-4 h-4 text-[var(--text-muted)] opacity-0 group-hover:opacity-60 transition-opacity shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                        </svg>
                      )}
                    </motion.button>
                  );
                }) : (
                  <div className="text-center py-8">
                    <p className="text-sm text-[var(--text-muted)] font-mono">// no tokens available</p>
                  </div>
                )}
              </div>

              {/* Footer hint */}
              <div className="px-5 py-3 border-t border-[var(--border)]">
                <p className="text-[10px] font-mono text-[var(--text-muted)] text-center">
                  project tokens appear after proposals are executed
                </p>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
