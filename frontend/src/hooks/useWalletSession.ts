/**
 * Centralized wallet session manager for viewing key lifecycle
 *
 * Key features:
 * - Binds viewing key to wallet address (security)
 * - Explicit disconnect clears both wagmi connection and viewing key
 * - Restores viewing key on reconnection to same address
 * - Prevents race conditions with wagmi's isConnected state
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useAccount, useSignMessage, useDisconnect as useWagmiDisconnect } from 'wagmi';
import { keccak256, toBytes } from 'viem';

const VIEWING_KEY_STORAGE_KEY = 'r00t_viewing_key';
const WALLET_ADDRESS_STORAGE_KEY = 'r00t_wallet_address';
const SIGN_MESSAGE =
  'Sign this message to access your r00t.fund private balance.\n\nThis signature is used to derive your viewing key locally.\nIt never leaves your browser.';

export interface WalletSession {
  viewingKey: string | null;
  address: string | null;
  isUnlocked: boolean;
  isUnlocking: boolean;
  error: string | null;
  unlock: () => Promise<string | null>; // Returns the derived key on success for immediate use
  lock: () => void;
  disconnect: () => void;
}

export function useWalletSession(): WalletSession {
  const { address, isConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const { disconnect: wagmiDisconnect } = useWagmiDisconnect();

  const [viewingKey, setViewingKey] = useState<string | null>(null);
  const [isUnlocking, setIsUnlocking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Track if we've attempted restoration to prevent loops
  const hasAttemptedRestore = useRef(false);
  // Track if this is an explicit disconnect (not a page refresh)
  const isExplicitDisconnect = useRef(false);

  // Restore viewing key on mount/reconnection IF same wallet
  useEffect(() => {
    if (!address || !isConnected) return;

    // Handle explicit disconnect - don't restore, just clear the flag
    if (isExplicitDisconnect.current) {
      isExplicitDisconnect.current = false;
      hasAttemptedRestore.current = true; // Prevent restoration
      return;
    }

    // Skip if we've already restored for this session
    if (hasAttemptedRestore.current) return;
    hasAttemptedRestore.current = true;

    try {
      const storedKey = localStorage.getItem(VIEWING_KEY_STORAGE_KEY);
      const storedAddress = localStorage.getItem(WALLET_ADDRESS_STORAGE_KEY);

      // Only restore if same wallet address (case-insensitive comparison)
      if (storedKey && storedAddress?.toLowerCase() === address.toLowerCase()) {
        setViewingKey(storedKey);
        console.log('[useWalletSession] Restored viewing key for address:', address.slice(0, 8));
      } else if (storedKey && storedAddress) {
        // Different wallet - clear old session and viewing key state
        console.log('[useWalletSession] Different wallet detected, clearing old session');
        setViewingKey(null);
        localStorage.removeItem(VIEWING_KEY_STORAGE_KEY);
        localStorage.removeItem(WALLET_ADDRESS_STORAGE_KEY);
      }
    } catch (err) {
      console.error('[useWalletSession] Failed to restore session:', err);
    }
  }, [address, isConnected]);

  // Reset restoration flag when wallet disconnects (allows re-restoration on reconnect)
  useEffect(() => {
    if (!isConnected) {
      // Only reset restoration flag if this wasn't an explicit disconnect
      // Don't reset isExplicitDisconnect here - let the restoration logic handle it
      if (!isExplicitDisconnect.current) {
        hasAttemptedRestore.current = false;
      }
    }
  }, [isConnected]);

  // Unlock (sign message to derive viewing key)
  // Returns the derived key on success for immediate use (before React state updates)
  const unlock = useCallback(async (): Promise<string | null> => {
    if (!address) {
      setError('No wallet connected');
      return null;
    }

    setIsUnlocking(true);
    setError(null);

    try {
      const signature = await signMessageAsync({ message: SIGN_MESSAGE });
      const derivedKey = keccak256(toBytes(signature));

      // Save to state and localStorage (normalize address to lowercase for consistency)
      setViewingKey(derivedKey);
      localStorage.setItem(VIEWING_KEY_STORAGE_KEY, derivedKey);
      localStorage.setItem(WALLET_ADDRESS_STORAGE_KEY, address.toLowerCase());

      console.log('[useWalletSession] Viewing key unlocked and saved');
      return derivedKey; // Return for immediate use
    } catch (err: unknown) {
      const error = err as Error;
      if (error.message?.includes('rejected') || error.message?.includes('denied')) {
        setError('Signature rejected. Please sign to view your balance.');
      } else {
        setError('Failed to unlock. Please try again.');
      }
      console.error('[useWalletSession] Unlock failed:', err);
      return null;
    } finally {
      setIsUnlocking(false);
    }
  }, [address, signMessageAsync]);

  // Lock (clear viewing key from memory but keep in localStorage for next session)
  const lock = useCallback(() => {
    setViewingKey(null);
    setError(null);
    console.log('[useWalletSession] Viewing key locked (cleared from memory)');
  }, []);

  // Disconnect (explicit user action - clears everything)
  const disconnect = useCallback(() => {
    // Mark this as explicit disconnect to prevent auto-restore
    isExplicitDisconnect.current = true;

    // Clear viewing key from state and localStorage
    setViewingKey(null);
    setError(null);
    localStorage.removeItem(VIEWING_KEY_STORAGE_KEY);
    localStorage.removeItem(WALLET_ADDRESS_STORAGE_KEY);

    console.log('[useWalletSession] Session cleared - explicit disconnect');

    // Then disconnect wallet
    wagmiDisconnect();
  }, [wagmiDisconnect]);

  return {
    viewingKey,
    address: address || null,
    isUnlocked: !!viewingKey,
    isUnlocking,
    error,
    unlock,
    lock,
    disconnect,
  };
}
