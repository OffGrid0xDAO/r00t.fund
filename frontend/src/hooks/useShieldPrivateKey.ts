/**
 * useShieldPrivateKey Hook
 *
 * Adapted from ScopeLift/token-shielder
 * Derives shield private key from user's wallet signature.
 * The key is cached per address to avoid repeated signature requests.
 */

import { useEffect, useState, useCallback } from 'react';
import { useAccount, useWalletClient } from 'wagmi';
import { keccak256, toBytes } from 'viem';
import { getShieldPrivateKeySignatureMessage } from '@railgun-community/wallet';

export function useShieldPrivateKey() {
  const { address } = useAccount();
  const { data: walletClient } = useWalletClient();
  const [shieldPrivateKey, setShieldPrivateKey] = useState<string>();

  // Reset shield private key when address changes
  useEffect(() => {
    setShieldPrivateKey(undefined);
  }, [address]);

  /**
   * Get or derive the shield private key
   * Returns cached key if available, otherwise prompts for signature
   */
  const getShieldPrivateKey = useCallback(async (): Promise<string> => {
    // Return cached key if we have it
    if (shieldPrivateKey) return shieldPrivateKey;

    if (!walletClient) {
      throw new Error('Wallet not connected');
    }

    // Get the signature message from Railgun SDK
    const message = getShieldPrivateKeySignatureMessage();

    // Request signature from user
    const signature = await walletClient.signMessage({ message });

    // Hash the signature to derive the shield private key
    // This is how token-shielder does it
    const spk = keccak256(toBytes(signature));

    // Cache and return
    setShieldPrivateKey(spk);
    return spk;
  }, [walletClient, shieldPrivateKey]);

  return {
    shieldPrivateKey,
    getShieldPrivateKey,
  };
}

export default useShieldPrivateKey;
