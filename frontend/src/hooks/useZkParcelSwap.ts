/**
 * useZkParcelSwap — clean, native private parcel↔R00T swapping (NO Railgun).
 *
 * Trades a parcel token (e.g. $OAK) against $R00T fully shielded via the deployed
 * ZkParcelPool, reusing the on-chain swap/deposit/withdraw verifiers. Flow:
 *   shieldR00T : real R00T → shielded R00T note (deposit-bound)   [entry]
 *   buyParcel  : R00T note → shielded parcel note (swap proof)
 *   sellParcel : parcel note → shielded R00T note (swap proof)
 *   withdraw   : note → real tokens at any wallet (withdraw proof) [exit]
 *
 * This whole recipe is validated on-chain (shield+buy succeeded with real proofs).
 * Notes are persisted client-side (recoverable from chain via events); every write
 * pre-flights with simulateContract and only records a note on receipt.status === success.
 */
import { useCallback, useMemo, useRef, useState, useEffect } from 'react';
import { useAccount, useWalletClient, usePublicClient } from 'wagmi';
import { parseAbi, type Address } from 'viem';
import { poseidon2 } from 'poseidon-lite';
import { hashCommitment, randomFieldElement } from '@r00t-fund/sdk';
import { CONTRACTS, CHAIN, NETWORK } from '../config';

const DEPTH = 24;
const ZERO_VALUE = 21663839004416932945382355908790599225266501822907911457504978515578255421292n;
const FIELD = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;

const poolAbi = parseAbi([
  'function shieldR00T(uint256 amount,uint256 commitment,uint256 binding,uint256[8] depositProof,bytes note)',
  'function buyParcel(uint256[8] proof,uint256 inputMerkleRoot,uint256 inputNullifierHash,uint256 inputAmount,uint256 outputCommitment,uint256 minOutputAmount,uint256 changeCommitment,uint256 publicInputsBinding,uint256 deadline,bytes parcelNote,bytes changeNote)',
  'function sellParcel(uint256[8] proof,uint256 inputMerkleRoot,uint256 inputNullifierHash,uint256 inputAmount,uint256 outputCommitment,uint256 minOutputAmount,uint256 changeCommitment,uint256 publicInputsBinding,uint256 deadline,bytes r00tNote,bytes changeNote)',
  'function r00tNotePool() view returns (address)',
  'function parcelPool() view returns (address)',
  'function getReserves() view returns (uint256,uint256)',
  'function getAmountOut(uint256,uint256,uint256) pure returns (uint256)',
]);
const erc20Abi = parseAbi(['function approve(address,uint256) returns (bool)', 'function balanceOf(address) view returns (uint256)']);
const tpAbi = parseAbi(['function root() view returns (uint256)']);

// pack a groth16 proof into uint256[8] (b-coord swap)
function packProof(p: { pi_a: string[]; pi_b: string[][]; pi_c: string[] }): readonly [bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint] {
  return [p.pi_a[0], p.pi_a[1], p.pi_b[0][1], p.pi_b[0][0], p.pi_b[1][1], p.pi_b[1][0], p.pi_c[0], p.pi_c[1]].map(BigInt) as unknown as
    readonly [bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint];
}
function zeroHashes(): bigint[] { const z = [ZERO_VALUE]; for (let i = 1; i < DEPTH; i++) z.push(poseidon2([z[i - 1], z[i - 1]])); return z; }
function buildPath(leaves: bigint[], leafIndex: number) {
  const zeros = zeroHashes(); const pathElements: bigint[] = []; const pathIndices: number[] = [];
  let idx = leafIndex; let level = leaves.slice();
  for (let d = 0; d < DEPTH; d++) {
    const isRight = idx & 1; const sibIdx = isRight ? idx - 1 : idx + 1;
    pathElements.push(sibIdx < level.length ? level[sibIdx] : zeros[d]); pathIndices.push(isRight);
    const next: bigint[] = [];
    for (let i = 0; i < level.length; i += 2) next.push(poseidon2([level[i], i + 1 < level.length ? level[i + 1] : zeros[d]]));
    level = next.length ? next : [zeros[d + 1] ?? 0n]; idx >>= 1;
  }
  return { pathElements, pathIndices };
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function fullProve(input: Record<string, unknown>, wasm: string, zkey: string) { const s: any = await import('snarkjs'); return s.groth16.fullProve(input, wasm, zkey); }

// Rebuild a pool tree's ordered leaves from NewCommitment logs (trustless; indexer-independent).
async function scanLeaves(publicClient: NonNullable<ReturnType<typeof usePublicClient>>, pool: Address): Promise<bigint[]> {
  const logs = await publicClient.getLogs({
    address: pool,
    event: { type: 'event', name: 'NewCommitment', inputs: [
      { name: 'commitment', type: 'uint256', indexed: true },
      { name: 'leafIndex', type: 'uint256', indexed: true },
      { name: 'encryptedNote', type: 'bytes', indexed: false },
    ] },
    fromBlock: 0n, toBlock: 'latest',
  });
  const byIndex = new Map<number, bigint>();
  for (const l of logs) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const a = (l as any).args; byIndex.set(Number(a.leafIndex), BigInt(a.commitment));
  }
  const max = byIndex.size ? Math.max(...byIndex.keys()) : -1;
  const leaves: bigint[] = [];
  for (let i = 0; i <= max; i++) leaves.push(byIndex.get(i) ?? ZERO_VALUE);
  return leaves;
}

export interface ParcelNote {
  id: string; kind: 'r00t' | 'parcel'; commitment: string; nullifier: string; secret: string; amount: string; spent?: boolean;
}

export function useZkParcelSwap(poolAddress?: string) {
  const pool = (poolAddress || CONTRACTS.zkParcelPool) as Address;
  const { address } = useAccount();
  const { data: walletClient } = useWalletClient();
  const publicClient = usePublicClient();
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState<ParcelNote[]>([]);
  const notesRef = useRef<ParcelNote[]>([]);

  const key = useMemo(() => `r00t_parcel_notes_${pool}_${address ?? 'anon'}`, [pool, address]);
  useEffect(() => {
    try { const raw = localStorage.getItem(key); const n = raw ? JSON.parse(raw) : []; notesRef.current = n; setNotes(n); } catch { /* noop */ }
  }, [key]);
  const persist = useCallback((n: ParcelNote[]) => { notesRef.current = n; setNotes(n); try { localStorage.setItem(key, JSON.stringify(n)); } catch { /* noop */ } }, [key]);

  const WASM = (c: string) => `/circuits/${c}/${c}.wasm`;
  const ZKEY = (c: string) => `/circuits/${c}/${c}_final.zkey`;

  /** Shield real R00T into a private R00T note (entry point for buying). */
  const shieldR00T = useCallback(async (amount: bigint) => {
    if (!walletClient || !publicClient || !address) throw new Error('connect wallet');
    setBusy(true); setError(null);
    try {
      setProgress('Approving R00T…');
      let hash = await walletClient.writeContract({ address: CONTRACTS.rootToken as Address, abi: erc20Abi, functionName: 'approve', args: [pool, amount], chain: CHAIN });
      await publicClient.waitForTransactionReceipt({ hash });

      const nullifier = randomFieldElement(); const secret = randomFieldElement();
      const commitment = hashCommitment(nullifier, secret, amount);
      setProgress('Generating deposit proof…');
      const dep = await fullProve({ amount: amount.toString(), commitment: commitment.toString(), nullifier: nullifier.toString(), secret: secret.toString() }, WASM('deposit'), ZKEY('deposit'));
      const binding = BigInt(dep.publicSignals[0]);
      const args = [amount, commitment, binding, packProof(dep.proof), '0x'] as const;
      setProgress('Shielding R00T…');
      await publicClient.simulateContract({ address: pool, abi: poolAbi, functionName: 'shieldR00T', args, account: address });
      hash = await walletClient.writeContract({ address: pool, abi: poolAbi, functionName: 'shieldR00T', args, chain: CHAIN });
      const rc = await publicClient.waitForTransactionReceipt({ hash });
      if (rc.status !== 'success') throw new Error('shield reverted');
      persist([...notesRef.current, { id: hash, kind: 'r00t', commitment: commitment.toString(), nullifier: nullifier.toString(), secret: secret.toString(), amount: amount.toString() }]);
      return hash;
    } catch (e) { setError((e as Error).message); throw e; } finally { setBusy(false); setProgress(''); }
  }, [walletClient, publicClient, address, pool, persist]);

  /** Swap a note for the other side (isBuy: R00T note→parcel note; else parcel note→R00T note). */
  const swap = useCallback(async (isBuy: boolean, note: ParcelNote, slippageBps = 100) => {
    if (!walletClient || !publicClient || !address) throw new Error('connect wallet');
    setBusy(true); setError(null);
    try {
      const inTree = isBuy
        ? (await publicClient.readContract({ address: pool, abi: poolAbi, functionName: 'r00tNotePool' }))
        : (await publicClient.readContract({ address: pool, abi: poolAbi, functionName: 'parcelPool' }));
      setProgress('Reading the commitment tree…');
      const leaves = await scanLeaves(publicClient, inTree as Address);
      const commitment = BigInt(note.commitment);
      const leafIndex = leaves.findIndex((l) => l === commitment);
      if (leafIndex < 0) throw new Error('note not found on-chain yet — wait a moment');
      const { pathElements, pathIndices } = buildPath(leaves, leafIndex);
      // recompute root defensively + confirm against chain
      let node = commitment;
      for (let d = 0; d < DEPTH; d++) node = pathIndices[d] ? poseidon2([pathElements[d], node]) : poseidon2([node, pathElements[d]]);
      const onchainRoot = await publicClient.readContract({ address: inTree as Address, abi: tpAbi, functionName: 'root' }) as bigint;
      if (node !== onchainRoot) throw new Error('tree out of sync — retry');

      const [rRes, pRes] = await publicClient.readContract({ address: pool, abi: poolAbi, functionName: 'getReserves' }) as [bigint, bigint];
      const inputAmount = BigInt(note.amount);
      const reserveIn = isBuy ? rRes : pRes; const reserveOut = isBuy ? pRes : rRes;
      const out = await publicClient.readContract({ address: pool, abi: poolAbi, functionName: 'getAmountOut', args: [inputAmount, reserveIn, reserveOut] }) as bigint;
      const minOut = out * BigInt(10000 - slippageBps) / 10000n;

      const nullifier = BigInt(note.nullifier); const secret = BigInt(note.secret);
      const nullifierHash = poseidon2([nullifier, BigInt(leafIndex)]);
      const outNullifier = randomFieldElement(); const outSecret = randomFieldElement();
      const outCommit = hashCommitment(outNullifier, outSecret, out);

      setProgress('Generating zero-knowledge proof…');
      const proof = await fullProve({
        inputMerkleRoot: onchainRoot.toString(), inputNullifierHash: nullifierHash.toString(), inputAmount: inputAmount.toString(),
        outputCommitment: outCommit.toString(), minOutputAmount: minOut.toString(), changeCommitment: '0',
        inputNullifier: nullifier.toString(), inputSecret: secret.toString(), inputTotalAmount: inputAmount.toString(),
        inputPathElements: pathElements.map(String), inputPathIndices: pathIndices.map(String),
        outputNullifier: outNullifier.toString(), outputSecret: outSecret.toString(), outputAmount: out.toString(),
        changeNullifier: randomFieldElement().toString(), changeSecret: randomFieldElement().toString(),
      }, WASM('swap'), ZKEY('swap'));
      const pib = BigInt(proof.publicSignals[0]);
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 600);
      const fn = isBuy ? 'buyParcel' : 'sellParcel';
      const args = [packProof(proof.proof), onchainRoot, nullifierHash, inputAmount, outCommit, minOut, 0n, pib, deadline, '0x', '0x'] as const;

      setProgress('Submitting private swap…');
      await publicClient.simulateContract({ address: pool, abi: poolAbi, functionName: fn, args, account: address });
      const hash = await walletClient.writeContract({ address: pool, abi: poolAbi, functionName: fn, args, chain: CHAIN });
      const rc = await publicClient.waitForTransactionReceipt({ hash });
      if (rc.status !== 'success') throw new Error('swap reverted');
      // mark input note spent + record output note (opposite kind)
      const outKind: 'r00t' | 'parcel' = isBuy ? 'parcel' : 'r00t';
      persist([
        ...notesRef.current.map((n) => n.id === note.id ? { ...n, spent: true } : n),
        { id: hash, kind: outKind, commitment: outCommit.toString(), nullifier: outNullifier.toString(), secret: outSecret.toString(), amount: out.toString() },
      ]);
      return { hash, out };
    } catch (e) { setError((e as Error).message); throw e; } finally { setBusy(false); setProgress(''); }
  }, [walletClient, publicClient, address, pool, persist]);

  const getReserves = useCallback(async () => {
    if (!publicClient) return null;
    const [r, p] = await publicClient.readContract({ address: pool, abi: poolAbi, functionName: 'getReserves' }) as [bigint, bigint];
    return { r00tReserve: r, parcelReserve: p };
  }, [publicClient, pool]);

  return {
    pool, busy, progress, error, notes,
    r00tNotes: notes.filter((n) => n.kind === 'r00t' && !n.spent),
    parcelNotes: notes.filter((n) => n.kind === 'parcel' && !n.spent),
    shieldR00T,
    buyParcel: (note: ParcelNote, slippageBps?: number) => swap(true, note, slippageBps),
    sellParcel: (note: ParcelNote, slippageBps?: number) => swap(false, note, slippageBps),
    getReserves,
    indexerUrl: NETWORK.indexerUrl,
    field: FIELD,
  };
}

export default useZkParcelSwap;
