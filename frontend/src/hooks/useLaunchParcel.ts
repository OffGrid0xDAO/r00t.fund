/**
 * useLaunchParcel — ONE code path to launch a parcel token as a Continuous Clearing Auction on the
 * RegenLaunchpad (used by both the Steward Console CCAPanel and the create-land wizard). Deploys the
 * parcel ERC20, mints supply, approves, and calls createParcel (opens the CCA; on clear it seeds the
 * private zkAMM + public Uniswap v4 pool + wires the arb hook). Reports step-by-step progress.
 */
import { useCallback, useState } from 'react';
import { useAccount, useWalletClient, usePublicClient, useSwitchChain, useChainId } from 'wagmi';
import { parseEther, stringToHex, padHex } from 'viem';
import { HACKATHON } from '../config';
import { TEST_TOKEN_ABI, TEST_TOKEN_BYTECODE } from '../lib/testToken';

const lpAbi = [
  { type: 'function', name: 'createParcel', stateMutability: 'nonpayable', inputs: [
    { type: 'bytes32' }, { type: 'address' }, { type: 'address' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'uint64' },
  ], outputs: [] },
] as const;

export interface ParcelSpec {
  ticker: string;      // e.g. CACTUS
  name?: string;       // display name (defaults to `${ticker} Parcel`)
  sale: number;        // parcel tokens auctioned
  pool: number;        // parcel tokens reserved for both pools
  floorR00T: number;   // floor price (R00T per token) — keep >= OTC floor
  windowHours: number; // CCA duration
  treasury: string;    // land regen treasury (receives the raise)
}

export function useLaunchParcel() {
  const { address } = useAccount();
  const { data: walletClient } = useWalletClient();
  const publicClient = usePublicClient();
  const { switchChainAsync } = useSwitchChain();
  const chainId = useChainId();
  const [steps, setSteps] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const launch = useCallback(async (p: ParcelSpec): Promise<{ token: `0x${string}`; parcelId: `0x${string}` } | null> => {
    if (!walletClient || !address || !publicClient) return null;
    setBusy(true);
    const log = (s: string) => setSteps((prev) => [...prev, s]);
    const tx = async (hash: `0x${string}`) => { await publicClient.waitForTransactionReceipt({ hash }); };
    try {
      if (chainId !== HACKATHON.chainId) await switchChainAsync({ chainId: HACKATHON.chainId });
      const sale = parseEther(String(p.sale)), pool = parseEther(String(p.pool));
      const supply = sale + pool + parseEther('10000');

      log(`deploying $${p.ticker}…`);
      const dh = await walletClient.deployContract({ abi: TEST_TOKEN_ABI as any, bytecode: TEST_TOKEN_BYTECODE, args: [p.name || `${p.ticker} Parcel`, p.ticker] });
      const rc = await publicClient.waitForTransactionReceipt({ hash: dh });
      const token = rc.contractAddress as `0x${string}`;
      log(`token ${token.slice(0, 8)}… deployed`);

      log('minting supply…');
      await tx(await walletClient.writeContract({ address: token, abi: TEST_TOKEN_ABI as any, functionName: 'mint', args: [address, supply] }));
      log('approving launchpad…');
      await tx(await walletClient.writeContract({ address: token, abi: TEST_TOKEN_ABI as any, functionName: 'approve', args: [HACKATHON.launchpad, supply] }));

      const parcelId = padHex(stringToHex(`${p.ticker}-RAISE`), { size: 32, dir: 'right' }) as `0x${string}`;
      log(`opening CCA for $${p.ticker}…`);
      await tx(await walletClient.writeContract({
        address: HACKATHON.launchpad as `0x${string}`, abi: lpAbi, functionName: 'createParcel',
        args: [parcelId, token, p.treasury as `0x${string}`, sale, pool, parseEther(String(p.floorR00T)), BigInt(Math.round(p.windowHours * 3600))],
      }));
      log(`✓ $${p.ticker} raise LIVE`);
      return { token, parcelId };
    } catch (e: any) {
      log('✗ ' + (e?.shortMessage || e?.message || 'failed').slice(0, 80));
      return null;
    } finally { setBusy(false); }
  }, [walletClient, address, publicClient, chainId, switchChainAsync]);

  return { launch, steps, busy, resetSteps: () => setSteps([]) };
}
