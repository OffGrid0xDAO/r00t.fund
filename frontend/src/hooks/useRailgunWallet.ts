/**
 * useRailgunWallet Hook
 *
 * Generates a Railgun wallet (0zk... address) deterministically from the user's
 * Ethereum wallet signature. This allows seamless in-app shielding without
 * requiring users to use external tools like Railway.xyz.
 *
 * Flow:
 * 1. User signs a message
 * 2. Signature is hashed to derive entropy
 * 3. Entropy generates a BIP39 mnemonic (12 words)
 * 4. Mnemonic + encryption key creates Railgun wallet
 * 5. 0zk address is returned and cached
 *
 * Security:
 * - Mnemonic is never stored (regenerated from signature each session)
 * - Only the 0zk address is cached (public info)
 * - Same ETH wallet always produces same Railgun address (deterministic)
 */

import { useState, useCallback, useEffect } from 'react';
import { useAccount, useWalletClient } from 'wagmi';
import { keccak256, toBytes, hexToBytes } from 'viem';
import { entropyToMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';
import { initializeEngine, loadArbitrumProvider, createWallet, isEngineReady } from '../services/railgunEngine';
import { EXTERNAL } from '../config';

// Railgun contract addresses on Arbitrum (for backward compatibility)
const RAILGUN_PROXY_ARBITRUM = EXTERNAL.railgunProxy;
const WETH_ARBITRUM = EXTERNAL.weth;

const WALLET_MESSAGE = `Sign to generate your r00t.fund private wallet.

This signature creates a deterministic Railgun address for anonymous transactions.

It does NOT grant access to your funds.`;

const WALLET_STORAGE_KEY = 'r00t_railgun_wallet';

interface RailgunWalletState {
  railgunAddress: string | null;
  walletId: string | null;
  isGenerating: boolean;
  error: string | null;
}

export function useRailgunWallet() {
  const { address, isConnected } = useAccount();
  const { data: walletClient } = useWalletClient();
  const [state, setState] = useState<RailgunWalletState>({
    railgunAddress: null,
    walletId: null,
    isGenerating: false,
    error: null,
  });

  // Reset when address changes
  useEffect(() => {
    setState({
      railgunAddress: null,
      walletId: null,
      isGenerating: false,
      error: null,
    });
  }, [address]);

  // Try to load cached address on mount
  useEffect(() => {
    if (address && !state.railgunAddress) {
      try {
        const cached = localStorage.getItem(`${WALLET_STORAGE_KEY}_${address}`);
        if (cached && cached.startsWith('0zk')) {
          setState(s => ({ ...s, railgunAddress: cached }));
          console.log('[useRailgunWallet] Loaded cached address:', cached.slice(0, 20) + '...');
        }
      } catch {
        // Ignore localStorage errors
      }
    }
  }, [address, state.railgunAddress]);

  /**
   * Generate a Railgun wallet from the user's signature
   */
  const generateWallet = useCallback(async (
    onProgress?: (step: string, percent: number) => void
  ): Promise<{ railgunAddress: string; walletId: string }> => {
    if (!walletClient || !address) {
      throw new Error('Wallet not connected');
    }

    setState(s => ({ ...s, isGenerating: true, error: null }));

    try {
      onProgress?.('Requesting signature...', 10);

      // Step 1: Get deterministic signature from user
      const signature = await walletClient.signMessage({ message: WALLET_MESSAGE });
      console.log('[useRailgunWallet] Got signature');

      // Step 2: Derive entropy from signature hash
      const entropyHash = keccak256(toBytes(signature));
      console.log('[useRailgunWallet] Generated entropy hash');

      // Step 3: Generate BIP39 mnemonic from entropy (first 16 bytes = 12 words)
      const entropyBytes = hexToBytes(entropyHash as `0x${string}`).slice(0, 16);
      const mnemonic = entropyToMnemonic(entropyBytes, wordlist);
      console.log('[useRailgunWallet] Generated mnemonic:', mnemonic.split(' ').length, 'words');

      // Step 4: Create encryption key from different part of signature
      const encryptionKey = keccak256(toBytes(signature + 'encryption'));

      onProgress?.('Initializing privacy engine...', 30);

      // Step 5: Initialize Railgun engine if needed
      if (!isEngineReady()) {
        await initializeEngine(onProgress);
        await loadArbitrumProvider(undefined, onProgress);
      }

      onProgress?.('Creating Railgun wallet...', 70);

      // Step 6: Create Railgun wallet using the SDK
      const { walletId, railgunAddress } = await createWallet(
        encryptionKey,
        mnemonic,
        onProgress
      );

      console.log('[useRailgunWallet] Created wallet:', railgunAddress.slice(0, 20) + '...');

      // Cache in localStorage for quick access (only address, not secrets)
      try {
        localStorage.setItem(`${WALLET_STORAGE_KEY}_${address}`, railgunAddress);
      } catch {
        // Ignore localStorage errors
      }

      setState({
        railgunAddress,
        walletId,
        isGenerating: false,
        error: null,
      });

      onProgress?.('Wallet ready!', 100);

      return { railgunAddress, walletId };

    } catch (err) {
      const error = (err as Error).message || 'Failed to generate wallet';
      console.error('[useRailgunWallet] Error:', error);
      setState(s => ({ ...s, isGenerating: false, error }));
      throw err;
    }
  }, [walletClient, address]);

  /**
   * Get the Railgun address, generating if necessary
   */
  const getRailgunAddress = useCallback(async (
    onProgress?: (step: string, percent: number) => void
  ): Promise<string> => {
    if (state.railgunAddress) {
      return state.railgunAddress;
    }
    const { railgunAddress } = await generateWallet(onProgress);
    return railgunAddress;
  }, [state.railgunAddress, generateWallet]);

  /**
   * Clear the cached wallet (for testing/debugging)
   */
  const clearWallet = useCallback(() => {
    if (address) {
      localStorage.removeItem(`${WALLET_STORAGE_KEY}_${address}`);
    }
    setState({
      railgunAddress: null,
      walletId: null,
      isGenerating: false,
      error: null,
    });
  }, [address]);

  /**
   * Open Railway wallet for full Railgun functionality
   */
  const openRailway = useCallback(() => {
    window.open('https://app.railway.xyz', '_blank');
  }, []);

  return {
    // State
    railgunAddress: state.railgunAddress,
    walletId: state.walletId,
    isGenerating: state.isGenerating,
    error: state.error,
    hasWallet: !!state.railgunAddress,
    isConnected,
    address,

    // Actions
    generateWallet,
    getRailgunAddress,
    clearWallet,
    openRailway,

    // Constants (for backward compatibility)
    RAILGUN_PROXY: RAILGUN_PROXY_ARBITRUM,
    WETH_ADDRESS: WETH_ARBITRUM,
  };
}

export default useRailgunWallet;
