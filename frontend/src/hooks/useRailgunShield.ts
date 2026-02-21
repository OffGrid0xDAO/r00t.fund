/**
 * useRailgunShield Hook
 *
 * Adapted from ScopeLift/token-shielder's useRailgunTx.tsx
 * Uses the Railgun SDK's populateShieldBaseToken for proper shielding.
 *
 * Updated for @railgun-community/wallet v10 and shared-models v8
 * Now auto-generates 0zk address via useRailgunWallet if needed.
 */

import { useState, useCallback } from 'react';
import { useAccount, useWalletClient, usePublicClient } from 'wagmi';
import { parseEther, type Address } from 'viem';
import { NetworkName, TXIDVersion, type RailgunERC20Amount, type RailgunERC20AmountRecipient } from '@railgun-community/shared-models';
import { populateShieldBaseToken, populateShield } from '@railgun-community/wallet';
import { useShieldPrivateKey } from './useShieldPrivateKey';
import { useRailgunWallet } from './useRailgunWallet';
import { CHAIN, EXTERNAL } from '../config';

// WETH address - imported from config
const WETH_ADDRESS = EXTERNAL.weth;

// Storage key for tracking shielded balances
const SHIELD_STORAGE_KEY = 'r00t_shielded';

// Use V2 for Arbitrum (V3 may not be deployed yet)
const TXID_VERSION = TXIDVersion.V2_PoseidonMerkle;

interface ShieldResult {
  success: boolean;
  txHash?: string;
  amountShielded?: bigint;
  error?: string;
}

/**
 * Hook for shielding ETH/tokens to Railgun
 * Based on token-shielder's useRailgunTx implementation
 */
export function useRailgunShield() {
  const { address, isConnected } = useAccount();
  const { data: walletClient } = useWalletClient();
  const publicClient = usePublicClient();
  const { shieldPrivateKey, getShieldPrivateKey } = useShieldPrivateKey();
  const { railgunAddress, getRailgunAddress, hasWallet, isGenerating: isGeneratingWallet } = useRailgunWallet();

  const [isShielding, setIsShielding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastShieldTx, setLastShieldTx] = useState<string | null>(null);

  /**
   * Shield ETH to Railgun (wraps to WETH internally)
   * Based on token-shielder's shieldBaseToken function
   * Now auto-generates 0zk address if not provided
   */
  const shieldETH = useCallback(async (
    ethAmount: string, // In ETH units (e.g., "0.1")
    recipientOverride?: string, // Optional 0zk... Railgun address (auto-generates if not provided)
    onProgress?: (step: string, percent: number) => void
  ): Promise<ShieldResult> => {
    if (!walletClient || !address || !publicClient) {
      return { success: false, error: 'Wallet not connected' };
    }

    setIsShielding(true);
    setError(null);

    try {
      // Get or generate the recipient 0zk address
      let recipient = recipientOverride;
      if (!recipient) {
        onProgress?.('Generating Railgun address...', 5);
        recipient = await getRailgunAddress(onProgress);
        console.log('[shieldETH] Using auto-generated address:', recipient.slice(0, 20) + '...');
      }

      onProgress?.('Requesting signature...', 10);

      // Get shield private key (will prompt for signature if not cached)
      const spk = await getShieldPrivateKey();

      onProgress?.('Preparing shield transaction...', 30);

      // Format amount as bigint (SDK v8+ uses bigint, not string)
      const amountWei = parseEther(ethAmount);

      const wrappedERC20Amount: RailgunERC20Amount = {
        tokenAddress: WETH_ADDRESS,
        amount: amountWei,
      };

      // Generate the shield transaction using SDK
      // SDK v10 signature: (txidVersion, networkName, railgunAddress, shieldPrivateKey, wrappedERC20Amount, gasDetails?)
      const response = await populateShieldBaseToken(
        TXID_VERSION,
        NetworkName.Arbitrum,
        recipient,
        spk,
        wrappedERC20Amount
      );

      // Response contains transaction: ContractTransaction
      if (!response.transaction) {
        throw new Error('Failed to generate shield transaction');
      }

      onProgress?.('Sending transaction...', 50);

      // Send the transaction
      // The shield transaction expects ETH value to wrap to WETH
      const hash = await walletClient.sendTransaction({
        to: response.transaction.to as Address,
        data: response.transaction.data as `0x${string}`,
        value: amountWei,
        chain: CHAIN,
      });

      onProgress?.('Confirming...', 80);

      // Wait for confirmation
      await publicClient.waitForTransactionReceipt({ hash });

      onProgress?.('Shield complete!', 100);

      // Calculate net amount after 0.25% fee
      const fee = amountWei * 25n / 10000n;
      const netAmount = amountWei - fee;

      // Update local state
      setLastShieldTx(hash);

      // Save to localStorage
      const saved = localStorage.getItem(SHIELD_STORAGE_KEY) || '{}';
      const data = JSON.parse(saved);
      data[address] = {
        shieldedBalance: (BigInt(data[address]?.shieldedBalance || '0') + netAmount).toString(),
        lastShieldTx: hash,
      };
      localStorage.setItem(SHIELD_STORAGE_KEY, JSON.stringify(data));

      return {
        success: true,
        txHash: hash,
        amountShielded: netAmount,
      };
    } catch (err) {
      const errorMsg = (err as Error).message || 'Shield failed';
      setError(errorMsg);
      return { success: false, error: errorMsg };
    } finally {
      setIsShielding(false);
    }
  }, [walletClient, address, publicClient, getShieldPrivateKey, getRailgunAddress]);

  /**
   * Shield ERC20 token to Railgun
   * Based on token-shielder's shieldToken function
   */
  const shieldToken = useCallback(async (
    tokenAddress: string,
    tokenAmount: string,
    tokenDecimals: number,
    recipient: string, // 0zk... Railgun address
    onProgress?: (step: string, percent: number) => void
  ): Promise<ShieldResult> => {
    if (!walletClient || !address || !publicClient) {
      return { success: false, error: 'Wallet not connected' };
    }

    setIsShielding(true);
    setError(null);

    try {
      onProgress?.('Requesting signature...', 10);

      // Get shield private key
      const spk = await getShieldPrivateKey();

      onProgress?.('Preparing shield transaction...', 30);

      // Format amount as bigint (SDK v8+ uses bigint)
      const amountWei = BigInt(Math.floor(parseFloat(tokenAmount) * 10 ** tokenDecimals));

      const erc20AmountRecipients: RailgunERC20AmountRecipient[] = [
        {
          tokenAddress,
          amount: amountWei,
          recipientAddress: recipient,
        },
      ];

      // Generate the shield transaction using SDK
      // SDK v10 signature: (txidVersion, networkName, shieldPrivateKey, erc20AmountRecipients, nftAmountRecipients, gasDetails?)
      const response = await populateShield(
        TXID_VERSION,
        NetworkName.Arbitrum,
        spk,
        erc20AmountRecipients,
        [] // No NFTs
      );

      if (!response.transaction) {
        throw new Error('Failed to generate shield transaction');
      }

      onProgress?.('Sending transaction...', 50);

      // Send the transaction (no ETH value for ERC20 shield)
      const hash = await walletClient.sendTransaction({
        to: response.transaction.to as Address,
        data: response.transaction.data as `0x${string}`,
        chain: CHAIN,
      });

      onProgress?.('Confirming...', 80);

      // Wait for confirmation
      await publicClient.waitForTransactionReceipt({ hash });

      onProgress?.('Shield complete!', 100);

      setLastShieldTx(hash);

      return {
        success: true,
        txHash: hash,
        amountShielded: amountWei,
      };
    } catch (err) {
      const errorMsg = (err as Error).message || 'Shield failed';
      setError(errorMsg);
      return { success: false, error: errorMsg };
    } finally {
      setIsShielding(false);
    }
  }, [walletClient, address, publicClient, getShieldPrivateKey]);

  /**
   * Combined shield function (like token-shielder's shield())
   * Automatically detects if base token or ERC20
   */
  const shield = useCallback(async (
    tokenAddress: string,
    tokenAmount: string,
    tokenDecimals: number,
    recipient: string,
    onProgress?: (step: string, percent: number) => void
  ): Promise<ShieldResult> => {
    // ETH_ADDRESS constant from token-shielder
    const ETH_ADDRESS = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE';

    if (tokenAddress.toLowerCase() === ETH_ADDRESS.toLowerCase()) {
      return shieldETH(tokenAmount, recipient, onProgress);
    } else {
      return shieldToken(tokenAddress, tokenAmount, tokenDecimals, recipient, onProgress);
    }
  }, [shieldETH, shieldToken]);

  /**
   * Get local estimate of shielded balance
   * Note: For accurate balance, use Railway.xyz
   */
  const getShieldedBalance = useCallback(() => {
    if (!address) return 0n;

    const saved = localStorage.getItem(SHIELD_STORAGE_KEY);
    if (!saved) return 0n;

    const data = JSON.parse(saved);
    return BigInt(data[address]?.shieldedBalance || '0');
  }, [address]);

  /**
   * Open Railway wallet for full Railgun functionality
   */
  const openRailway = useCallback(() => {
    window.open('https://app.railway.xyz', '_blank');
  }, []);

  return {
    // State
    isShielding: isShielding || isGeneratingWallet,
    error,
    lastShieldTx,
    shieldPrivateKey,

    // Railgun Wallet (0zk address)
    railgunAddress,
    hasRailgunWallet: hasWallet,

    // Actions
    shield,
    shieldETH,
    shieldToken,
    getShieldedBalance,
    openRailway,

    // Info
    isConnected,
    hasWallet: !!walletClient,

    // Fee info
    shieldFeePercent: 0.25,
  };
}

export default useRailgunShield;
