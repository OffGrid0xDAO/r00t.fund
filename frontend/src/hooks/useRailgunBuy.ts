/**
 * useRailgunBuy - Private Buy Hook
 *
 * Handles buying ROOT tokens (ETH → ROOT) and project tokens (ETH → ROOT → Token).
 * Uses ZK commitments for privacy — tokens are stored as commitments on-chain.
 */

import { useState, useCallback } from 'react';
import { useAccount, usePublicClient, useWalletClient } from 'wagmi';
import { parseEther, keccak256, toBytes, type Address, type Hex } from 'viem';
import { hashCommitment as poseidonHashCommitment, randomFieldElement, encryptNote } from '@r00t-fund/sdk';
import { Wallet } from 'ethers';
import { EVENTS, CHAIN, CONTRACTS } from '../config';
import { ZKAMM_ABI } from '../abis/zkAMM';

// Pack a snarkjs groth16 proof into the uint256[8] the Solidity verifier expects (b-coord swap).
function packProof(p: { pi_a: string[]; pi_b: string[][]; pi_c: string[] }): [bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint] {
  return [p.pi_a[0], p.pi_a[1], p.pi_b[0][1], p.pi_b[0][0], p.pi_b[1][1], p.pi_b[1][0], p.pi_c[0], p.pi_c[1]].map(BigInt) as
    [bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint];
}

// Lazy snarkjs (browser). Deposit circuit served from public/circuits/deposit/.
async function generateDepositProof(input: { amount: bigint; commitment: bigint; nullifier: bigint; secret: bigint }) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const snarkjs: any = await import('snarkjs');
  const { proof, publicSignals } = await snarkjs.groth16.fullProve(
    { amount: input.amount.toString(), commitment: input.commitment.toString(), nullifier: input.nullifier.toString(), secret: input.secret.toString() },
    '/circuits/deposit/deposit.wasm',
    '/circuits/deposit/deposit_final.zkey',
  );
  // Circuit: public [amount, commitment], output binding → publicSignals = [binding, amount, commitment]
  return { binding: BigInt(publicSignals[0]), packed: packProof(proof) };
}

interface BuyResult {
  success: boolean;
  error?: string;
  txHash?: string;
  commitment?: bigint;
  nullifier?: bigint;
  secret?: bigint;
  tokensReceived?: bigint;
  leafIndex?: number;
}

interface UseRailgunBuyOptions {
  isProjectToken?: boolean;
  projectPoolAddress?: string;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function useRailgunBuy(_zkAMMAddress: string, options?: UseRailgunBuyOptions) {
  const { address } = useAccount();
  const publicClient = usePublicClient();
  const { data: walletClient } = useWalletClient();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState('');

  const buyQuickPrivate = useCallback(async (params: {
    ethAmount: string;
    viewingKey: string;
    onProgress?: (step: string, percent: number) => void;
    slippageBps?: number;
  }): Promise<BuyResult> => {
    const { ethAmount, viewingKey, onProgress, slippageBps = 100 } = params;

    if (!walletClient || !publicClient || !address) {
      return { success: false, error: 'Wallet not connected' };
    }

    setIsLoading(true);
    setError(null);

    try {
      const ethAmountWei = parseEther(ethAmount);
      const routerAddress = CONTRACTS.zkAMMRouter as Address;
      const pairAddress = CONTRACTS.zkAMMPair as Address;
      const isProject = options?.isProjectToken && options?.projectPoolAddress;

      onProgress?.('Getting pool state...', 20);
      setProgress('Getting pool state...');

      // Always read ROOT/ETH reserves (needed for both ROOT and project token buys)
      const [ethReserve, rootReserve] = await Promise.all([
        publicClient.readContract({ address: pairAddress, abi: ZKAMM_ABI, functionName: 'ethReserve' }),
        publicClient.readContract({ address: pairAddress, abi: ZKAMM_ABI, functionName: 'tokenReserve' }),
      ]);

      let tokensOut: bigint;

      if (isProject) {
        // Two-hop: ETH → ROOT → ProjectToken
        // Hop 1: estimate ROOT output
        const rootOut = await publicClient.readContract({
          address: routerAddress, abi: ZKAMM_ABI, functionName: 'getAmountOut',
          args: [ethAmountWei, ethReserve as bigint, rootReserve as bigint],
        }) as bigint;

        // Hop 2: estimate project token output from project pool reserves
        const poolAddress = options!.projectPoolAddress as Address;
        const [r00tRes, projTokenRes] = await Promise.all([
          publicClient.readContract({ address: poolAddress, abi: ZKAMM_ABI, functionName: 'r00tReserve' }),
          publicClient.readContract({ address: poolAddress, abi: ZKAMM_ABI, functionName: 'tokenReserve' }),
        ]);

        tokensOut = await publicClient.readContract({
          address: routerAddress, abi: ZKAMM_ABI, functionName: 'getAmountOut',
          args: [rootOut, r00tRes as bigint, projTokenRes as bigint],
        }) as bigint;

        console.log('[usePrivateBuy] Two-hop estimate:', {
          ethIn: ethAmountWei.toString(),
          rootOut: rootOut.toString(),
          tokensOut: tokensOut.toString(),
          pool: poolAddress,
        });
      } else {
        // Single hop: ETH → ROOT
        tokensOut = await publicClient.readContract({
          address: routerAddress, abi: ZKAMM_ABI, functionName: 'getAmountOut',
          args: [ethAmountWei, ethReserve as bigint, rootReserve as bigint],
        }) as bigint;
      }

      // EXACT-OUT: the secure buyPrivate delivers EXACTLY `committedTokensOut` and refunds
      // the ETH difference. Commit to slightly fewer tokens than the raw quote so the curve's
      // ethRequired stays under msg.value (our max-in) even after rounding/fees — otherwise it
      // reverts SlippageExceeded. The note's amount MUST equal committedTokensOut (it's bound
      // by the deposit proof), so we build the commitment from it.
      const committedTokensOut = tokensOut * BigInt(10000 - slippageBps) / 10000n;

      const nullifier = randomFieldElement();
      const secret = randomFieldElement();
      const commitment = poseidonHashCommitment(nullifier, secret, committedTokensOut);

      const wallet = new Wallet(viewingKey);
      const viewingPublicKey = wallet.signingKey.compressedPublicKey;
      const encryptedNoteData = await encryptNote(nullifier, secret, committedTokensOut, viewingPublicKey);

      // Deadline: use chain's block timestamp (Tenderly VNet timestamps can differ from real time)
      const latestBlock = await publicClient.getBlock();
      const deadline = latestBlock.timestamp + 1200n;

      let hash: `0x${string}`;

      if (isProject) {
        const minTokensOut = committedTokensOut;
        // Project token buy: ETH → ROOT → Token via Router's swapETHForProjectToken
        const minR00TOut = 0n; // Let minTokensOut protect the final output
        const userEntropy = keccak256(toBytes(`${nullifier}${secret}${Date.now()}`));

        hash = await walletClient.writeContract({
          address: routerAddress,
          abi: ZKAMM_ABI,
          functionName: 'swapETHForProjectToken',
          args: [
            options!.projectPoolAddress as Address,
            minR00TOut,
            minTokensOut,
            commitment,
            deadline,
            encryptedNoteData as Hex,
            userEntropy as Hex,
          ],
          value: ethAmountWei,
          chain: CHAIN,
        });
      } else {
        // ROOT buy: ETH → ROOT via the SECURE 6-arg buyPrivate (CRITICAL-1).
        // Generate the deposit-binding proof so the note's amount is provably == committedTokensOut.
        onProgress?.('Generating zero-knowledge proof…', 45);
        setProgress('Generating zero-knowledge proof…');
        const { binding, packed } = await generateDepositProof({ amount: committedTokensOut, commitment, nullifier, secret });

        const buyArgs = [commitment, committedTokensOut, binding, packed, deadline, encryptedNoteData as Hex] as const;

        // PRE-FLIGHT: simulate so a doomed buy (slippage, bad proof, thin pool) fails HERE with
        // a decoded error — before the wallet popup, and so we never record a phantom note.
        onProgress?.('Submitting private swap…', 60);
        setProgress('Submitting private swap…');
        await publicClient.simulateContract({
          address: routerAddress, abi: ZKAMM_ABI, functionName: 'buyPrivate',
          args: buyArgs, value: ethAmountWei, account: address,
        });

        hash = await walletClient.writeContract({
          address: routerAddress,
          abi: ZKAMM_ABI,
          functionName: 'buyPrivate',
          args: buyArgs,
          value: ethAmountWei,
          chain: CHAIN,
        });
      }

      onProgress?.('Confirming...', 80);
      setProgress('Confirming...');
      const receipt = await publicClient.waitForTransactionReceipt({ hash });

      // CRITICAL: only treat the buy as real if the tx actually succeeded. Previously this
      // returned success even on a reverted tx, so the caller saved a phantom note that could
      // never be sold (nothing on-chain). Gate on receipt.status.
      if (receipt.status !== 'success') {
        setProgress('');
        return { success: false, error: 'Transaction reverted on-chain — no tokens were bought.' };
      }

      const commitmentLog = receipt.logs.find(log =>
        log.topics[0] === EVENTS.newCommitment
      );
      const leafIndex = commitmentLog ? Number(BigInt(commitmentLog.topics[2] || '0')) : 0;

      onProgress?.('Complete!', 100);
      setProgress('');

      return {
        success: true,
        txHash: hash,
        commitment,
        nullifier,
        secret,
        // The note holds committedTokensOut (exact-out); that's what's actually spendable.
        tokensReceived: isProject ? tokensOut : committedTokensOut,
        leafIndex,
      };

    } catch (err) {
      const errorMsg = (err as Error).message || 'Transaction failed';
      setError(errorMsg);
      return { success: false, error: errorMsg };
    } finally {
      setIsLoading(false);
      setProgress('');
    }
  }, [walletClient, publicClient, address, options]);

  return {
    isLoading,
    error,
    progress,
    buyQuickPrivate,
  };
}

export default useRailgunBuy;
