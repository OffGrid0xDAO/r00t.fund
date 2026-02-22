import { useState, useEffect, useCallback } from 'react';
import { useAccount, usePublicClient, useWalletClient } from 'wagmi';
import type { ISuccessResult } from '@worldcoin/idkit';
import { WORLD_ID_GATEKEEPER_ABI } from '../constants';

interface UseWorldIdVerificationParams {
  worldIdGatekeeperAddress?: string;
}

export function useWorldIdVerification({ worldIdGatekeeperAddress }: UseWorldIdVerificationParams) {
  const { address } = useAccount();
  const publicClient = usePublicClient();
  const { data: walletClient } = useWalletClient();

  const [worldIdVerified, setWorldIdVerified] = useState(false);
  const [worldIdPending, setWorldIdPending] = useState(false);
  const [worldIdError, setWorldIdError] = useState<string | null>(null);

  const worldIdEnabled = !!worldIdGatekeeperAddress
    && worldIdGatekeeperAddress !== '0x0000000000000000000000000000000000000000'
    && worldIdGatekeeperAddress !== '0x...'
    && worldIdGatekeeperAddress.length === 42;

  // Check verification status
  useEffect(() => {
    if (!publicClient || !address || !worldIdEnabled) return;

    const checkVerification = async () => {
      try {
        const verified = await publicClient.readContract({
          address: worldIdGatekeeperAddress as `0x${string}`,
          abi: WORLD_ID_GATEKEEPER_ABI,
          functionName: 'isVerified',
          args: [address],
        });
        setWorldIdVerified(verified as boolean);
      } catch (err) {
        console.error('Failed to check World ID status:', err);
      }
    };

    checkVerification();

    if (worldIdPending) {
      const interval = window.setInterval(checkVerification, 5000);
      return () => window.clearInterval(interval);
    }
  }, [publicClient, address, worldIdGatekeeperAddress, worldIdEnabled, worldIdPending]);

  const handleWorldIdSuccess = useCallback(async (result: ISuccessResult) => {
    if (!walletClient || !publicClient || !address || !worldIdEnabled) return;

    setWorldIdPending(true);
    setWorldIdError(null);

    try {
      const nullifierHash = result.nullifier_hash as `0x${string}`;
      const merkleRoot = result.merkle_root as `0x${string}`;

      const proofStr = result.proof;
      const proofBigInts: bigint[] = [];
      const cleanProof = proofStr.startsWith('0x') ? proofStr.slice(2) : proofStr;
      for (let i = 0; i < 8; i++) {
        const chunk = cleanProof.slice(i * 64, (i + 1) * 64);
        proofBigInts.push(chunk ? BigInt('0x' + chunk) : 0n);
      }
      while (proofBigInts.length < 8) proofBigInts.push(0n);

      const proof = proofBigInts.slice(0, 8) as [bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint];
      const verificationLevel = result.verification_level === 'orb' ? 'orb' : 'device';

      const hash = await walletClient.writeContract({
        address: worldIdGatekeeperAddress as `0x${string}`,
        abi: WORLD_ID_GATEKEEPER_ABI,
        functionName: 'requestVerification',
        args: [nullifierHash, merkleRoot, proof, verificationLevel],
      });

      await publicClient.waitForTransactionReceipt({ hash });
    } catch (err: unknown) {
      const error = err as Error;
      console.error('World ID submission failed:', error);
      setWorldIdError(error.message || 'Failed to submit World ID proof');
      setWorldIdPending(false);
    }
  }, [walletClient, publicClient, address, worldIdGatekeeperAddress, worldIdEnabled]);

  return {
    worldIdVerified,
    worldIdPending,
    worldIdError,
    worldIdEnabled,
    handleWorldIdSuccess,
  };
}
