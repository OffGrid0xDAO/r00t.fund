/**
 * useLandBackend — returns a PatronageBackend for the pilot Land.
 *
 * Contract-backed (real pledgeUSDC) when the pilot Land is deployed AND a wallet
 * is connected; otherwise the local mock so the demo loop still works. Drop the
 * returned `backend` straight into usePilotState.
 */
import { useMemo } from 'react';
import { useAccount, usePublicClient, useWalletClient } from 'wagmi';
import type { PublicClient, WalletClient } from 'viem';
import { CONTRACTS, isContractDeployed } from '../config';
import { mockPatronageBackend, type PatronageBackend } from '../components/pilot/patronage';
import { makeContractPatronageBackend } from '../components/pilot/landBackend';

export function useLandBackend(): { backend: PatronageBackend; onChain: boolean } {
  const { address } = useAccount();
  const publicClient = usePublicClient();
  const { data: walletClient } = useWalletClient();
  const land = CONTRACTS.pilotLand;

  return useMemo(() => {
    if (isContractDeployed(land) && address && publicClient && walletClient) {
      return {
        backend: makeContractPatronageBackend({
          publicClient: publicClient as unknown as PublicClient,
          walletClient: walletClient as unknown as WalletClient,
          account: address,
          landAddress: land as `0x${string}`,
        }),
        onChain: true,
      };
    }
    return { backend: mockPatronageBackend, onChain: false };
  }, [land, address, publicClient, walletClient]);
}
