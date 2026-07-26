/**
 * useLaunchParcel — ONE code path to launch a parcel token as a Continuous Clearing Auction on the
 * RegenLaunchpad (used by both the Steward Console CCAPanel and the create-land wizard). Deploys the
 * parcel ERC20, mints supply, approves, and calls createParcel (opens the CCA; on clear it seeds the
 * private zkAMM + public Uniswap v4 pool + wires the arb hook). Reports step-by-step progress.
 */
import { useCallback, useState } from 'react';
import { useAccount, useWalletClient, usePublicClient, useSwitchChain, useChainId } from 'wagmi';
import { parseEther, stringToHex, padHex, decodeEventLog } from 'viem';
import { HACKATHON } from '../config';
import { TEST_TOKEN_ABI, TEST_TOKEN_BYTECODE } from '../lib/testToken';

const lpAbi = [
  { type: 'function', name: 'createParcel', stateMutability: 'nonpayable', inputs: [
    { type: 'bytes32' }, { type: 'address' }, { type: 'address' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'uint64' },
  ], outputs: [] },
] as const;
const lpClearAbi = [
  { type: 'function', name: 'clearAndLaunch', stateMutability: 'nonpayable', inputs: [{ type: 'bytes32' }], outputs: [] },
] as const;

// one-tx launcher: openRaise(name, symbol, sale, pool, reserveR00T, window, treasury) → ParcelOpened event
const launcherAbi = [
  { type: 'function', name: 'openRaise', stateMutability: 'nonpayable', inputs: [
    { name: 'name_', type: 'string' }, { name: 'symbol_', type: 'string' }, { name: 'sale', type: 'uint256' },
    { name: 'pool', type: 'uint256' }, { name: 'reserveR00T', type: 'uint256' }, { name: 'window', type: 'uint64' }, { name: 'treasury', type: 'address' },
  ], outputs: [{ name: 'token', type: 'address' }, { name: 'parcelId', type: 'bytes32' }] },
  { type: 'function', name: 'clear', stateMutability: 'nonpayable', inputs: [{ name: 'parcelId', type: 'bytes32' }, { name: 'r00tSeed', type: 'uint256' }], outputs: [] },
  { type: 'event', name: 'ParcelOpened', inputs: [
    { name: 'parcelId', type: 'bytes32', indexed: true }, { name: 'steward', type: 'address', indexed: true },
    { name: 'token', type: 'address', indexed: false }, { name: 'symbol', type: 'string', indexed: false },
  ] },
] as const;
const LAUNCHER = ((HACKATHON as any).parcelLauncher as string) || '';

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
      const reserve = parseEther(String(p.floorR00T));
      const windowSec = BigInt(Math.round(p.windowHours * 3600));

      // ── ONE-TX path: the ParcelLauncher deploys+mints+approves+opens the CCA in a single signature ──
      if (LAUNCHER) {
        log(`opening $${p.ticker} raise (1 tx)…`);
        const h = await walletClient.writeContract({
          address: LAUNCHER as `0x${string}`, abi: launcherAbi, functionName: 'openRaise',
          args: [p.name || `${p.ticker} Parcel`, p.ticker, sale, pool, reserve, windowSec, p.treasury as `0x${string}`],
        });
        const receipt = await publicClient.waitForTransactionReceipt({ hash: h });
        let token = '0x' as `0x${string}`; let parcelId = '0x' as `0x${string}`;
        for (const lg of receipt.logs) {
          if (lg.address.toLowerCase() !== LAUNCHER.toLowerCase()) continue;
          try {
            const ev = decodeEventLog({ abi: launcherAbi, data: lg.data, topics: lg.topics });
            if (ev.eventName === 'ParcelOpened') { token = (ev.args as any).token; parcelId = (ev.args as any).parcelId; break; }
          } catch { /* not our event */ }
        }
        log(`✓ $${p.ticker} raise LIVE`);
        return { token, parcelId };
      }

      // ── fallback: 4-signature browser flow ──
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

  // clearAndLaunch a raise → seeds the zkAMM + public Uniswap v4 pool + wires the hook. The pool's R00T
  // side is self-seeded from the steward, so we top up test R00T if the balance is low, then approve.
  const MAX = (2n ** 255n);
  const SEED = parseEther('50000'); // generous self-seed; the launcher refunds any unused R00T
  const clear = useCallback(async (parcelId: `0x${string}`): Promise<boolean> => {
    if (!walletClient || !address || !publicClient) return false;
    setBusy(true);
    const log = (s: string) => setSteps((prev) => [...prev, s]);
    const tx = async (hash: `0x${string}`) => { await publicClient.waitForTransactionReceipt({ hash }); };
    const root = HACKATHON.root as `0x${string}`;
    try {
      if (chainId !== HACKATHON.chainId) await switchChainAsync({ chainId: HACKATHON.chainId });
      const bal = await publicClient.readContract({ address: root, abi: TEST_TOKEN_ABI as any, functionName: 'balanceOf', args: [address] }) as bigint;
      if (bal < SEED) { log('minting test R00T…'); await tx(await walletClient.writeContract({ address: root, abi: TEST_TOKEN_ABI as any, functionName: 'mint', args: [address, SEED] })); }

      if (LAUNCHER) {
        log('approving R00T…');
        await tx(await walletClient.writeContract({ address: root, abi: TEST_TOKEN_ABI as any, functionName: 'approve', args: [LAUNCHER, MAX] }));
        log('clearAndLaunch (1 tx)…');
        await tx(await walletClient.writeContract({ address: LAUNCHER as `0x${string}`, abi: launcherAbi, functionName: 'clear', args: [parcelId, SEED] }));
      } else {
        log('approving R00T…');
        await tx(await walletClient.writeContract({ address: root, abi: TEST_TOKEN_ABI as any, functionName: 'approve', args: [HACKATHON.launchpad as `0x${string}`, MAX] }));
        log('clearAndLaunch…');
        await tx(await walletClient.writeContract({ address: HACKATHON.launchpad as `0x${string}`, abi: lpClearAbi, functionName: 'clearAndLaunch', args: [parcelId] }));
      }
      log('✓ launched — zkAMM + Uniswap v4 pool + hook live');
      return true;
    } catch (e: any) {
      log('✗ ' + (e?.shortMessage || e?.message || 'failed').slice(0, 80));
      return false;
    } finally { setBusy(false); }
  }, [walletClient, address, publicClient, chainId, switchChainAsync]);

  return { launch, clear, steps, busy, resetSteps: () => setSteps([]) };
}
