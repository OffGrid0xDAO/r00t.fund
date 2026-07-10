/**
 * Contract-backed PatronageBackend — pledges to a real Land contract.
 *
 * Swaps in for mockPatronageBackend (see patronage.ts) with no change to
 * usePilotState or the UI. fund() maps a plot → its on-chain parcelId, pulls the
 * pledge in USDC (approve if needed), and calls Land.pledgeUSDC — which forwards
 * 100% to the treasury and mints the parcel's culture token to the backer at the
 * live v4 pool price. Falls back to a thrown-safe ok:false on any revert.
 *
 * INVARIANT: parcelIdOf(plot.id) must match the id the steward passed to
 * Land.createParcel on-chain. Keep both sides on keccak256(utf8(plot.id)).
 */
import { keccak256, toBytes, parseUnits, parseEther } from 'viem';
import type { PublicClient, WalletClient } from 'viem';
import { LAND_ABI, ERC20_ABI } from '../../abis/land';
import { CHAIN } from '../../config';
import type { PatronageBackend, FundReceipt } from './patronage';

/** Deterministic on-chain parcel id for a plot. Must match Land.createParcel. */
export function parcelIdOf(plotId: string): `0x${string}` {
  return keccak256(toBytes(plotId));
}

export interface ContractBackendOpts {
  publicClient: PublicClient;
  walletClient: WalletClient;
  account: `0x${string}`;
  landAddress: `0x${string}`;
}

export function makeContractPatronageBackend(opts: ContractBackendOpts): PatronageBackend {
  const { publicClient, walletClient, account, landAddress } = opts;
  return {
    async fund(targetId, amountEur, backer, rewards, pay): Promise<FundReceipt> {
      const fail = (): FundReceipt => ({ ok: false, target: targetId, amountEur, backer, at: Date.now(), rewards, ref: '' });
      try {
        const parcelId = parcelIdOf(targetId);
        let hash: `0x${string}`;

        if (!pay || pay.asset === 'ETH') {
          // ETH pledge (default) — msg.value funds the treasury directly
          const value = parseEther(String(pay?.ethAmount ?? amountEur / 3000));
          hash = await walletClient.writeContract({
            address: landAddress, abi: LAND_ABI, functionName: 'pledgeETH', args: [parcelId],
            value, chain: CHAIN, account,
          });
        } else {
          // USDC pledge — approve if the current allowance is short, then pledge
          const amount = parseUnits(String(amountEur), 6); // € treated 1:1 USD → USDC 6dp
          const usdc = (await publicClient.readContract({
            address: landAddress, abi: LAND_ABI, functionName: 'usdc',
          })) as `0x${string}`;
          const allowance = (await publicClient.readContract({
            address: usdc, abi: ERC20_ABI, functionName: 'allowance', args: [account, landAddress],
          })) as bigint;
          if (allowance < amount) {
            const approveHash = await walletClient.writeContract({
              address: usdc, abi: ERC20_ABI, functionName: 'approve', args: [landAddress, amount],
              chain: CHAIN, account,
            });
            await publicClient.waitForTransactionReceipt({ hash: approveHash });
          }
          hash = await walletClient.writeContract({
            address: landAddress, abi: LAND_ABI, functionName: 'pledgeUSDC', args: [parcelId, amount],
            chain: CHAIN, account,
          });
        }

        const receipt = await publicClient.waitForTransactionReceipt({ hash });
        if (receipt.status !== 'success') return fail();
        return { ok: true, target: targetId, amountEur, backer, at: Date.now(), rewards, ref: hash };
      } catch (e) {
        console.error('[landBackend] pledge failed', e);
        return fail();
      }
    },
  };
}
