/**
 * useLandFactory — open a new Land from the browser (StartYourLand onboarding).
 *
 * Targets the multi-tenant LandFactory LIVE on Ethereum Sepolia (the hackathon chain) — mirrors the
 * Robinhood Chain rail so the full steward flow is testable before mainnet. Approves the steward's
 * $R00T pledge, calls createLand, and decodes the LandCreated event for the new Land address.
 * Switches the wallet to Sepolia first (like useLaunchParcel). No-ops with a clear status otherwise.
 */
import { useCallback, useState } from 'react';
import { useAccount, usePublicClient, useWalletClient, useSwitchChain, useChainId } from 'wagmi';
import { decodeEventLog, keccak256, toBytes, parseUnits } from 'viem';
import { HACKATHON, isContractDeployed } from '../config';
import { LAND_FACTORY_ABI, ERC20_ABI } from '../abis/land';

export type CreateLandStatus = 'idle' | 'approving' | 'creating' | 'done' | 'error';

export interface CreateLandInput {
  name: string;
  region: string;
  boundaryText?: string; // raw boundary file → hashed on-chain
  topoText?: string;     // raw heightmap/topo file → hashed on-chain
  cid?: string;
  treasury: `0x${string}`;
  ethPriceE6?: bigint;   // default $3,000
  r00tPledge: bigint;    // 18-dp $R00T to seed parcel liquidity
}

const hashOf = (text?: string): `0x${string}` =>
  text ? keccak256(toBytes(text)) : ('0x' + '00'.repeat(32)) as `0x${string}`;

export function useLandFactory() {
  const { address } = useAccount();
  const publicClient = usePublicClient({ chainId: HACKATHON.chainId });
  const { data: walletClient } = useWalletClient();
  const { switchChainAsync } = useSwitchChain();
  const chainId = useChainId();
  const factory = HACKATHON.landFactory as `0x${string}`;
  const root = HACKATHON.root as `0x${string}`;
  const configured = isContractDeployed(factory);

  const [status, setStatus] = useState<CreateLandStatus>('idle');
  const [landAddress, setLandAddress] = useState<`0x${string}` | null>(null);
  const [txHash, setTxHash] = useState<`0x${string}` | null>(null);
  const [error, setError] = useState<string | null>(null);

  const createLand = useCallback(async (input: CreateLandInput) => {
    setError(null);
    setLandAddress(null);
    if (!configured || !address || !publicClient || !walletClient) {
      setError('Connect a wallet — the land factory is not configured on this network yet.');
      setStatus('error');
      return null;
    }
    try {
      if (chainId !== HACKATHON.chainId) await switchChainAsync({ chainId: HACKATHON.chainId });

      const allowance = (await publicClient.readContract({
        address: root, abi: ERC20_ABI, functionName: 'allowance', args: [address, factory],
      })) as bigint;
      if (allowance < input.r00tPledge) {
        setStatus('approving');
        const approveHash = await walletClient.writeContract({
          address: root, abi: ERC20_ABI, functionName: 'approve', args: [factory, input.r00tPledge],
          account: address,
        });
        await publicClient.waitForTransactionReceipt({ hash: approveHash });
      }

      setStatus('creating');
      const hash = await walletClient.writeContract({
        address: factory, abi: LAND_FACTORY_ABI, functionName: 'createLand',
        args: [{
          name: input.name,
          region: input.region,
          boundaryHash: hashOf(input.boundaryText),
          topoHash: hashOf(input.topoText),
          cid: input.cid ?? '',
          treasury: input.treasury,
          ethPriceE6: input.ethPriceE6 ?? 3000_000000n,
          r00tPledge: input.r00tPledge,
        }],
        account: address,
      });
      setTxHash(hash);
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== 'success') throw new Error('createLand reverted');

      let created: `0x${string}` | null = null;
      for (const log of receipt.logs) {
        if (log.address.toLowerCase() !== factory.toLowerCase()) continue;
        try {
          const ev = decodeEventLog({ abi: LAND_FACTORY_ABI, data: log.data, topics: log.topics });
          if (ev.eventName === 'LandCreated') {
            created = (ev.args as { land: `0x${string}` }).land;
            break;
          }
        } catch { /* not our event */ }
      }
      setLandAddress(created);
      setStatus('done');
      return { hash, land: created };
    } catch (e) {
      console.error('[useLandFactory] createLand failed', e);
      setError(e instanceof Error ? e.message : 'createLand failed');
      setStatus('error');
      return null;
    }
  }, [configured, address, publicClient, walletClient, factory, root, chainId, switchChainAsync]);

  // Convenience: pledge amount helper for the UI (whole $R00T → 18dp)
  const toPledge = (whole: number) => parseUnits(String(whole), 18);

  return { createLand, status, landAddress, txHash, error, configured, toPledge };
}
