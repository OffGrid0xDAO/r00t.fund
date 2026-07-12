import { useState, useEffect, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAccount, usePublicClient, useWalletClient, useBalance, useSwitchChain } from 'wagmi';
import { parseEther, formatEther, formatUnits } from 'viem';
import { CONTRACTS, NETWORK, CHAIN, getExplorerTxUrl } from '../config';
import { switchToRobinhood } from '../utils/switchChain';
import { GlowButton } from './ui/GlowButton';

// R00TShorts ABI - matches deployed R00TShorts contract
const SHORTS_ABI = [
  {
    name: 'openShort',
    type: 'function',
    stateMutability: 'payable',
    inputs: [
      { name: 'minTokensShorted', type: 'uint256' },
    ],
    outputs: [{ name: 'positionId', type: 'uint256' }],
  },
  {
    name: 'closeShort',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'positionId', type: 'uint256' },
      { name: 'maxRepurchaseCost', type: 'uint256' },
    ],
    outputs: [],
  },
  {
    name: 'getPosition',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'positionId', type: 'uint256' }],
    outputs: [
      {
        name: 'position',
        type: 'tuple',
        components: [
          { name: 'ethCollateral', type: 'uint256' },
          { name: 'ethFromSale', type: 'uint256' },
          { name: 'tokenAmountShorted', type: 'uint256' },
          { name: 'entryPrice', type: 'uint256' },
          { name: 'openedAt', type: 'uint256' },
          { name: 'isOpen', type: 'bool' },
        ],
      },
    ],
  },
  {
    name: 'positionOwner',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'positionId', type: 'uint256' }],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    name: 'getUserPositions',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'user', type: 'address' }],
    outputs: [{ name: '', type: 'uint256[]' }],
  },
  {
    name: 'calculatePnL',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'positionId', type: 'uint256' }],
    outputs: [
      { name: 'pnl', type: 'int256' },
      { name: 'repurchaseCost', type: 'uint256' },
    ],
  },
  {
    name: 'isLiquidatable',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'positionId', type: 'uint256' }],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    name: 'liquidate',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'positionId', type: 'uint256' },
      { name: 'maxRepurchaseCost', type: 'uint256' },
    ],
    outputs: [],
  },
  {
    name: 'getAvailableTokens',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'totalOpenInterest',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'MIN_POSITION_ETH',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'MAX_POSITION_ETH',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'FEE_BPS',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'LIQUIDATION_THRESHOLD_BPS',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  // Custom errors — REQUIRED so viem can decode a revert like 0x945e9268 into its NAME.
  // Without these, a failed short surfaces as raw hex and the friendly-message mapping
  // below never matches (this was the "raw revert, no message" UI bug).
  { type: 'error', name: 'PositionTooSmall', inputs: [] },
  { type: 'error', name: 'PositionTooLarge', inputs: [] },
  { type: 'error', name: 'OpenInterestLimitExceeded', inputs: [] },
  { type: 'error', name: 'SlippageExceeded', inputs: [] },
  { type: 'error', name: 'PositionNotOpen', inputs: [] },
  { type: 'error', name: 'NotPositionOwner', inputs: [] },
  { type: 'error', name: 'CooldownNotMet', inputs: [] },
  { type: 'error', name: 'PositionNotLiquidatable', inputs: [] },
  { type: 'error', name: 'TransferFailed', inputs: [] },
  { type: 'error', name: 'InsufficientReserves', inputs: [] },
  { type: 'error', name: 'OracleNotReady', inputs: [] },
] as const;

// Pair ABI for price data
const PAIR_ABI = [
  {
    name: 'ethReserve',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'tokenReserve',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const;

interface Position {
  id: bigint;
  owner: string;
  ethCollateral: bigint;
  ethFromSale: bigint;
  tokenAmountShorted: bigint;
  entryPrice: bigint;
  openedAt: bigint;
  isOpen: boolean;
  pnl?: bigint;
  repurchaseCost?: bigint;
  isLiquidatable?: boolean;
}

// Position Card Component
const COOLDOWN_SECONDS = 3600; // 1 hour

const PositionCard = ({
  position,
  onClose,
  onLiquidate,
  isClosing,
  currentPrice,
  blockTimestamp,
}: {
  position: Position;
  onClose: () => void;
  onLiquidate: () => void;
  isClosing: boolean;
  currentPrice: bigint;
  blockTimestamp: bigint;
}) => {
  const pnlColor = position.pnl !== undefined && position.pnl > 0n
    ? 'var(--success)'
    : position.pnl !== undefined && position.pnl < 0n
      ? 'var(--error)'
      : 'var(--text-muted)';

  // Calculate PnL percent relative to collateral
  const pnlPercent = position.pnl !== undefined && position.ethCollateral > 0n
    ? (position.pnl * 10000n) / BigInt(position.ethCollateral)
    : 0n;

  // Cooldown: position can only be closed after 1 hour
  const cooldownEnd = Number(position.openedAt) + COOLDOWN_SECONDS;
  const currentTs = blockTimestamp > 0n ? Number(blockTimestamp) : Math.floor(Date.now() / 1000);
  const cooldownRemaining = Math.max(0, cooldownEnd - currentTs);
  const isInCooldown = cooldownRemaining > 0;

  const formatCooldown = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}m ${s}s`;
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="p-4 rounded-lg border"
      style={{
        background: position.isLiquidatable ? 'rgba(166, 61, 47, 0.1)' : 'var(--bg-secondary)',
        borderColor: position.isLiquidatable ? 'var(--error)' : 'var(--border)',
      }}
    >
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="text-xs font-mono text-[var(--text-muted)]">#{position.id.toString()}</span>
          <span className="px-2 py-0.5 rounded text-xs font-mono bg-[var(--error)]/20 text-[var(--error)]">
            SHORT
          </span>
          {position.isLiquidatable && (
            <span className="px-2 py-0.5 rounded text-xs font-mono bg-[var(--warning)]/20 text-[var(--warning)] animate-pulse">
              LIQUIDATABLE
            </span>
          )}
          {isInCooldown && !position.isLiquidatable && (
            <span className="px-2 py-0.5 rounded text-xs font-mono bg-[var(--warning)]/10 text-[var(--warning)]">
              COOLDOWN {formatCooldown(cooldownRemaining)}
            </span>
          )}
        </div>
        <span className="text-xs font-mono text-[var(--text-muted)]">
          {new Date(Number(position.openedAt) * 1000).toLocaleDateString()}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-4 mb-4">
        <div>
          <p className="text-xs text-[var(--text-muted)] mb-1">Collateral</p>
          <p className="text-lg font-mono font-bold">{formatEther(position.ethCollateral)} ETH</p>
        </div>
        <div>
          <p className="text-xs text-[var(--text-muted)] mb-1">Shorted</p>
          <p className="text-lg font-mono font-bold">{Number(formatUnits(position.tokenAmountShorted, 18)).toLocaleString()} ROOT</p>
        </div>
        <div>
          <p className="text-xs text-[var(--text-muted)] mb-1">Entry Price</p>
          <p className="text-sm font-mono">{Number(formatUnits(position.entryPrice, 18)).toFixed(8)} ETH/ROOT</p>
        </div>
        <div>
          <p className="text-xs text-[var(--text-muted)] mb-1">Current Price</p>
          <p className="text-sm font-mono">{Number(formatUnits(currentPrice, 18)).toFixed(8)} ETH/ROOT</p>
        </div>
      </div>

      {position.pnl !== undefined && (
        <div className="flex items-center justify-between p-3 rounded-md mb-4" style={{ background: 'var(--bg-primary)' }}>
          <span className="text-xs text-[var(--text-muted)]">P&L</span>
          <div className="flex items-center gap-2">
            <span className="font-mono font-bold" style={{ color: pnlColor }}>
              {position.pnl > 0n ? '+' : ''}{formatEther(position.pnl)} ETH
            </span>
            <span className="text-xs font-mono" style={{ color: pnlColor }}>
              ({pnlPercent > 0n ? '+' : ''}{Number(pnlPercent) / 100}%)
            </span>
          </div>
        </div>
      )}

      <div className="flex gap-2">
        <GlowButton
          onClick={onClose}
          disabled={isClosing || !!position.isLiquidatable || isInCooldown}
          loading={isClosing}
          fullWidth
          size="sm"
          variant="secondary"
        >
          {isInCooldown ? `cooldown (${formatCooldown(cooldownRemaining)})` : 'close_position()'}
        </GlowButton>
        {position.isLiquidatable && (
          <GlowButton onClick={onLiquidate} size="sm" variant="primary">
            liquidate()
          </GlowButton>
        )}
      </div>
    </motion.div>
  );
};

export function ShortsPanel() {
  const { address, isConnected, chainId } = useAccount();
  const publicClient = usePublicClient();
  const { data: walletClient } = useWalletClient();
  const { data: ethBalance, refetch: refetchBalance } = useBalance({ address, chainId: CHAIN.id });
  const { switchChainAsync, isPending: isSwitchingChain } = useSwitchChain();

  const isOnCorrectChain = chainId === CHAIN.id;

  const [collateralAmount, setCollateralAmount] = useState('');
  const [slippageBps, setSlippageBps] = useState(100); // 1% default
  const [isLoading, setIsLoading] = useState(false);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [txConfirmed, setTxConfirmed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [positions, setPositions] = useState<Position[]>([]);
  const [closingPositionId, setClosingPositionId] = useState<bigint | null>(null);

  const [ethReserve, setEthReserve] = useState<bigint>(0n);
  const [tokenReserve, setTokenReserve] = useState<bigint>(0n);
  const [availableTokens, setAvailableTokens] = useState<bigint>(0n);
  const [totalOpenInterest, setTotalOpenInterest] = useState<bigint>(0n);
  const [blockTimestamp, setBlockTimestamp] = useState<bigint>(0n);

  const shortsAddress = CONTRACTS.shortsContract as `0x${string}`;
  const pairAddress = CONTRACTS.zkAMMPair as `0x${string}`;

  // Calculate current price
  const currentPrice = useMemo(() => {
    if (ethReserve === 0n || tokenReserve === 0n) return 0n;
    return (ethReserve * BigInt(1e18)) / tokenReserve;
  }, [ethReserve, tokenReserve]);

  // Calculate estimated short position (mirrors contract logic)
  // Contract: fee = msg.value * 500 / 10000, collateral = msg.value - fee
  // tokensToShort = getAmountOut(collateral, ethReserve, tokenReserve)
  const estimatedShort = useMemo(() => {
    if (!collateralAmount || ethReserve === 0n || tokenReserve === 0n) return 0n;
    try {
      const ethIn = parseEther(collateralAmount);
      // 5% fee
      const fee = (ethIn * 500n) / 10000n;
      const collateral = ethIn - fee;
      // AMM getAmountOut with 1% fee
      const amountInWithFee = collateral * (10000n - 100n);
      const numerator = amountInWithFee * tokenReserve;
      const denominator = ethReserve * 10000n + amountInWithFee;
      return numerator / denominator;
    } catch {
      return 0n;
    }
  }, [collateralAmount, ethReserve, tokenReserve]);

  // Fetch pool state
  useEffect(() => {
    if (!publicClient || shortsAddress === '0x...') return;

    const fetchState = async () => {
      try {
        const [ethRes, tokenRes, available, openInterest, block] = await Promise.all([
          publicClient.readContract({ address: pairAddress, abi: PAIR_ABI, functionName: 'ethReserve' }),
          publicClient.readContract({ address: pairAddress, abi: PAIR_ABI, functionName: 'tokenReserve' }),
          publicClient.readContract({ address: shortsAddress, abi: SHORTS_ABI, functionName: 'getAvailableTokens' }).catch(() => 0n),
          publicClient.readContract({ address: shortsAddress, abi: SHORTS_ABI, functionName: 'totalOpenInterest' }).catch(() => 0n),
          publicClient.getBlock(),
        ]);
        setEthReserve(ethRes);
        setTokenReserve(tokenRes);
        setAvailableTokens(available);
        setTotalOpenInterest(openInterest);
        setBlockTimestamp(block.timestamp);
      } catch (err) {
        console.error('[ShortsPanel] Failed to fetch state:', err);
      }
    };

    fetchState();
    const interval = setInterval(fetchState, 30000);
    return () => clearInterval(interval);
  }, [publicClient, shortsAddress, pairAddress]);

  // Fetch user positions
  const fetchPositions = useCallback(async () => {
    if (!publicClient || !address || shortsAddress === '0x...') return;

    try {
      const positionIds = await publicClient.readContract({
        address: shortsAddress,
        abi: SHORTS_ABI,
        functionName: 'getUserPositions',
        args: [address],
      });

      const positionsData = await Promise.all(
        positionIds.map(async (id) => {
          const [posData, owner, pnlData, liquidatable] = await Promise.all([
            publicClient.readContract({
              address: shortsAddress,
              abi: SHORTS_ABI,
              functionName: 'getPosition',
              args: [id],
            }),
            publicClient.readContract({
              address: shortsAddress,
              abi: SHORTS_ABI,
              functionName: 'positionOwner',
              args: [id],
            }).catch(() => address),
            publicClient.readContract({
              address: shortsAddress,
              abi: SHORTS_ABI,
              functionName: 'calculatePnL',
              args: [id],
            }).catch(() => [0n, 0n] as const),
            publicClient.readContract({
              address: shortsAddress,
              abi: SHORTS_ABI,
              functionName: 'isLiquidatable',
              args: [id],
            }).catch(() => false),
          ]);

          return {
            id,
            owner: owner as string,
            ethCollateral: posData.ethCollateral,
            ethFromSale: posData.ethFromSale,
            tokenAmountShorted: posData.tokenAmountShorted,
            entryPrice: posData.entryPrice,
            openedAt: posData.openedAt,
            isOpen: posData.isOpen,
            pnl: pnlData[0],
            repurchaseCost: pnlData[1],
            isLiquidatable: liquidatable,
          } as Position;
        })
      );

      setPositions(positionsData.filter(p => p.isOpen));
    } catch (err) {
      console.error('[ShortsPanel] Failed to fetch positions:', err);
    }
  }, [publicClient, address, shortsAddress]);

  useEffect(() => {
    fetchPositions();
    const interval = setInterval(fetchPositions, 15000);
    return () => clearInterval(interval);
  }, [fetchPositions]);

  // Open short position
  const handleOpenShort = async () => {
    if (!walletClient || !publicClient || !collateralAmount || !address) return;

    setIsLoading(true);
    setError(null);
    setTxHash(null);
    setTxConfirmed(false);

    try {
      const ethValue = parseEther(collateralAmount);

      // Estimated tokens to short (calculated same as contract)
      const tokenAmount = estimatedShort;

      if (tokenAmount === 0n) {
        throw new Error('Invalid short amount');
      }

      if (tokenAmount > availableTokens) {
        throw new Error('Insufficient tokens available for shorting');
      }

      // minTokensShorted = estimated * (1 - slippageBps/10000)
      const minTokens = tokenAmount - (tokenAmount * BigInt(slippageBps)) / 10000n;

      // PRE-FLIGHT: simulate first so a doomed short (thin pool, OI cap, under-seeded
      // shorts reserve, etc.) surfaces its decoded custom error HERE — before we pop the
      // wallet and burn gas on a tx that would revert. viem decodes the revert against
      // SHORTS_ABI's error entries, so the catch-block mapping gets a named message.
      await publicClient.simulateContract({
        address: shortsAddress,
        abi: SHORTS_ABI,
        functionName: 'openShort',
        args: [minTokens],
        value: ethValue,
        account: address,
      });

      const hash = await walletClient.writeContract({
        address: shortsAddress,
        abi: SHORTS_ABI,
        functionName: 'openShort',
        args: [minTokens],
        value: ethValue,
        chain: CHAIN,
      });

      setTxHash(hash);
      const receipt = await publicClient.waitForTransactionReceipt({ hash });

      if (receipt.status === 'reverted') {
        throw new Error('Transaction reverted on-chain');
      }

      setTxConfirmed(true);
      setCollateralAmount('');
      refetchBalance();
      fetchPositions();
    } catch (err: unknown) {
      const error = err as Error;
      let msg = error.message || 'Failed to open short';
      if (msg.includes('User rejected') || msg.includes('User denied')) msg = 'Transaction rejected';
      else if (msg.includes('insufficient funds')) msg = 'Insufficient ETH balance';
      else if (msg.includes('PositionTooSmall')) msg = 'Minimum collateral is 0.001 ETH';
      else if (msg.includes('PositionTooLarge')) msg = 'Maximum collateral is 100 ETH';
      else if (msg.includes('InsufficientReserves')) msg = 'Short too large for current liquidity — try a smaller size';
      else if (msg.includes('InsufficientLiquidity')) msg = 'Pool too shallow for this short right now — try a smaller size';
      else if (msg.includes('OpenInterestLimitExceeded')) msg = 'Open interest limit reached — try again later';
      else if (msg.includes('SlippageExceeded')) msg = 'Slippage exceeded — increase tolerance or reduce size';
      else if (msg.includes('OracleNotReady')) msg = 'Price oracle still warming up — try again shortly';
      else msg = 'Short failed to open — the pool may be too shallow. Try a smaller size.';
      setError(msg);
    } finally {
      setIsLoading(false);
    }
  };

  // Close position
  const handleClosePosition = async (positionId: bigint) => {
    if (!walletClient || !publicClient) {
      setError('Wallet not connected — please connect your wallet first');
      return;
    }

    setClosingPositionId(positionId);
    setError(null);

    try {
      // Get current repurchase cost for slippage calculation
      const position = positions.find(p => p.id === positionId);
      let maxRepurchaseCost: bigint;

      if (position?.repurchaseCost) {
        // Allow slippage on top of current repurchase cost
        maxRepurchaseCost = position.repurchaseCost + (position.repurchaseCost * BigInt(slippageBps)) / 10000n;
      } else {
        // Fallback: use a very high value
        maxRepurchaseCost = parseEther('1000');
      }

      const hash = await walletClient.writeContract({
        address: shortsAddress,
        abi: SHORTS_ABI,
        functionName: 'closeShort',
        args: [positionId, maxRepurchaseCost],
        chain: CHAIN,
        account: address,
      });

      setTxHash(hash);
      const receipt = await publicClient.waitForTransactionReceipt({ hash });

      if (receipt.status === 'reverted') {
        throw new Error('Transaction reverted on-chain');
      }

      setTxConfirmed(true);
      refetchBalance();
      fetchPositions();
    } catch (err: unknown) {
      const error = err as Error;
      let msg = error.message || 'Failed to close position';
      if (msg.includes('User rejected') || msg.includes('user rejected')) msg = 'Transaction rejected';
      else if (msg.includes('CooldownNotMet')) msg = 'Must wait 1 hour after opening to close (cooldown period)';
      else if (msg.includes('SlippageExceeded')) msg = 'Slippage exceeded, try increasing tolerance';
      else if (msg.includes('NotPositionOwner')) msg = 'You are not the owner of this position';
      else if (msg.includes('PositionNotOpen')) msg = 'Position is already closed';
      else if (msg.includes('TransferFailed')) msg = 'ETH transfer failed during close';
      else if (msg.length > 200) msg = msg.slice(0, 200) + '...';
      setError(msg);
    } finally {
      setClosingPositionId(null);
    }
  };

  // Liquidate position
  const handleLiquidate = async (positionId: bigint) => {
    if (!walletClient || !publicClient) return;

    setClosingPositionId(positionId);
    setError(null);

    try {
      // Get current repurchase cost for slippage protection
      const [, repurchaseCost] = await publicClient.readContract({
        address: shortsAddress,
        abi: SHORTS_ABI,
        functionName: 'calculatePnL',
        args: [positionId],
      }) as [bigint, bigint];

      // Add 10% slippage buffer
      const maxRepurchaseCost = repurchaseCost + (repurchaseCost * 10n / 100n);

      const hash = await walletClient.writeContract({
        address: shortsAddress,
        abi: SHORTS_ABI,
        functionName: 'liquidate',
        args: [positionId, maxRepurchaseCost],
        chain: CHAIN,
      });

      await publicClient.waitForTransactionReceipt({ hash });
      refetchBalance();
      fetchPositions();
    } catch (err: unknown) {
      let msg = (err as Error).message || 'Failed to liquidate';
      if (msg.includes('PositionNotLiquidatable')) msg = 'Position is not eligible for liquidation yet';
      else if (msg.includes('SlippageExceeded')) msg = 'Price moved too much, try again';
      else if (msg.includes('User rejected')) msg = 'Transaction rejected';
      setError(msg);
    } finally {
      setClosingPositionId(null);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex items-center justify-between"
      >
        <div>
          <h2 className="text-xl font-display font-bold text-[var(--text-primary)]">
            Short <span className="text-[var(--error)]">$ROOT</span>
          </h2>
          <p className="text-xs font-mono text-[var(--text-muted)] mt-1">
            <span className="text-[var(--error)] opacity-60">// </span>
            1x leveraged short positions
          </p>
        </div>
      </motion.div>

      {/* Pool Stats */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="grid grid-cols-3 gap-4"
      >
        <div className="p-3 rounded-lg" style={{ background: 'var(--bg-secondary)' }}>
          <p className="text-xs text-[var(--text-muted)] mb-1">Current Price</p>
          <p className="text-sm font-mono font-bold">
            {currentPrice > 0n ? Number(formatUnits(currentPrice, 18)).toFixed(8) : '...'} ETH/ROOT
          </p>
        </div>
        <div className="p-3 rounded-lg" style={{ background: 'var(--bg-secondary)' }}>
          <p className="text-xs text-[var(--text-muted)] mb-1">Available to Short</p>
          <p className="text-sm font-mono font-bold">
            {Number(formatUnits(availableTokens, 18)).toLocaleString()} ROOT
          </p>
        </div>
        <div className="p-3 rounded-lg" style={{ background: 'var(--bg-secondary)' }}>
          <p className="text-xs text-[var(--text-muted)] mb-1">Open Interest</p>
          <p className="text-sm font-mono font-bold">
            {Number(formatUnits(totalOpenInterest, 18)).toLocaleString()} ROOT
          </p>
        </div>
      </motion.div>

      {/* Open Short Form */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="p-5 rounded-lg border"
        style={{ background: 'var(--bg-secondary)', borderColor: 'var(--border)' }}
      >
        <div className="mb-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-mono text-[var(--text-muted)]">
              <span className="text-[var(--error)] opacity-60">// </span>
              collateral (ETH)
            </span>
            {ethBalance && (
              <button
                onClick={() => {
                  const maxCollateral = ethBalance.value > parseEther('0.01')
                    ? ethBalance.value - parseEther('0.01')
                    : 0n;
                  // Cap at 100 ETH max collateral
                  const capped = maxCollateral > parseEther('100') ? parseEther('100') : maxCollateral;
                  setCollateralAmount(formatEther(capped));
                }}
                className="text-xs font-mono text-[var(--accent)] hover:underline"
              >
                max: {Number(formatEther(ethBalance.value)).toFixed(4)} ETH
              </button>
            )}
          </div>
          <div
            className="px-4 py-3 rounded-lg"
            style={{ background: 'var(--bg-primary)', border: '1px solid var(--border)' }}
          >
            <input
              type="number"
              value={collateralAmount}
              onChange={(e) => setCollateralAmount(e.target.value)}
              placeholder="0.0"
              className="w-full bg-transparent text-2xl font-mono font-bold outline-none placeholder:text-[var(--text-muted)]"
            />
          </div>
          <p className="text-xs text-[var(--text-muted)] mt-2">
            Min: 0.001 ETH | Max: 100 ETH
          </p>
        </div>

        <div className="flex items-center justify-between p-3 rounded-lg mb-4" style={{ background: 'var(--bg-primary)' }}>
          <span className="text-xs text-[var(--text-muted)]">Tokens to Short</span>
          <span className="font-mono font-bold text-[var(--error)]">
            {estimatedShort > 0n ? Number(formatUnits(estimatedShort, 18)).toLocaleString() : '0'} ROOT
          </span>
        </div>

        <div className="flex items-center justify-between p-3 rounded-lg mb-4" style={{ background: 'var(--bg-primary)' }}>
          <span className="text-xs text-[var(--text-muted)]">5% Opening Fee</span>
          <span className="font-mono text-[var(--warning)]">
            {collateralAmount
              ? `${Number(formatEther((parseEther(collateralAmount) * 500n) / 10000n)).toFixed(6)} ETH`
              : '...'}
          </span>
        </div>

        {/* Slippage */}
        <div className="flex items-center justify-between mb-4">
          <span className="text-xs text-[var(--text-muted)]">Max Slippage</span>
          <div className="flex gap-2">
            {[50, 100, 200, 300].map((bps) => (
              <button
                key={bps}
                onClick={() => setSlippageBps(bps)}
                className={`px-2 py-1 rounded text-xs font-mono transition-colors ${
                  slippageBps === bps
                    ? 'bg-[var(--accent)] text-[var(--accent-ink)]'
                    : 'bg-[var(--bg-primary)] text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                }`}
              >
                {bps / 100}%
              </button>
            ))}
          </div>
        </div>

        {/* Error/Success */}
        <AnimatePresence>
          {error && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="p-3 rounded-lg border border-[var(--error)]/30 mb-4"
              style={{ background: 'rgba(166, 61, 47, 0.1)' }}
            >
              <span className="text-sm text-[var(--error)]">{error}</span>
            </motion.div>
          )}
          {txHash && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className={`p-3 rounded-lg border mb-4 ${txConfirmed ? 'border-[var(--success)]/30' : 'border-[var(--warning)]/30'}`}
              style={{ background: txConfirmed ? 'rgba(76, 175, 80, 0.1)' : 'rgba(255, 193, 7, 0.1)' }}
            >
              <div className="flex items-center justify-between">
                <span className={`text-sm ${txConfirmed ? 'text-[var(--success)]' : 'text-[var(--warning)]'}`}>
                  {txConfirmed ? 'Short opened!' : 'Transaction pending...'}
                </span>
                {getExplorerTxUrl(txHash) ? (
                  <a
                    href={getExplorerTxUrl(txHash)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-[var(--success)] hover:underline"
                  >
                    view tx
                  </a>
                ) : (
                  <span className="text-xs text-[var(--success)] font-mono opacity-70">{txHash.slice(0, 10)}...</span>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Action Button */}
        {!isConnected ? (
          <GlowButton disabled fullWidth size="lg">
            connect() to short
          </GlowButton>
        ) : !isOnCorrectChain ? (
          <GlowButton
            onClick={() => switchToRobinhood(switchChainAsync)}
            loading={isSwitchingChain}
            fullWidth
            size="lg"
            variant="secondary"
          >
            switch to {NETWORK.name}
          </GlowButton>
        ) : shortsAddress === '0x...' ? (
          <GlowButton disabled fullWidth size="lg">
            shorts not deployed
          </GlowButton>
        ) : (
          <GlowButton
            onClick={handleOpenShort}
            disabled={!collateralAmount || isLoading || estimatedShort > availableTokens}
            loading={isLoading}
            fullWidth
            size="lg"
            variant="primary"
          >
            <span className="flex items-center justify-center gap-2">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 17h8m0 0V9m0 8l-8-8-4 4-6-6" />
              </svg>
              open_short()
            </span>
          </GlowButton>
        )}
      </motion.div>

      {/* Open Positions */}
      {positions.length > 0 && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="space-y-4"
        >
          <h3 className="text-sm font-mono text-[var(--text-muted)]">
            <span className="text-[var(--accent)] opacity-60">// </span>
            your_positions ({positions.length})
          </h3>
          {positions.map((position) => (
            <PositionCard
              key={position.id.toString()}
              position={position}
              onClose={() => handleClosePosition(position.id)}
              onLiquidate={() => handleLiquidate(position.id)}
              isClosing={closingPositionId === position.id}
              currentPrice={currentPrice}
              blockTimestamp={blockTimestamp}
            />
          ))}
        </motion.div>
      )}

      {/* Info Footer */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="text-center pt-2"
      >
        <p className="text-xs text-[var(--text-muted)] flex items-center justify-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-[var(--error)]" />
          Short ROOT with 1x leverage. Profit when price goes down.
        </p>
      </motion.div>
    </div>
  );
}
