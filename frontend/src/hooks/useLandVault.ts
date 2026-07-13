/**
 * useLandVault — private ETH/USDC funding of land parcels + dual claim.
 *
 * Ports the ON-CHAIN-VALIDATED proof-gen from scripts/test-landvault-flow.mjs:
 *   fund:  commitment = Poseidon4(nullifier, secret, parcelId, rootOut)
 *          binding    = Poseidon3(parcelId, rootOut, commitment)
 *          landdeposit proof → otcFundETH / otcFundUSDC (100% to the land treasury)
 *   claim: build the merkle path from the Ponder tree, prove membership,
 *          claim R00T OR the parcel token to ANY wallet. ONE irreversible choice —
 *          both spend the SAME nullifier, so the contract makes double-claim impossible.
 *
 * Encrypted notes persist in localStorage (scoped per viewing key); the deposit wallet
 * is never linked to the claim wallet.
 */
import { useCallback, useMemo, useRef, useState, useEffect } from 'react';
import { useWalletClient, usePublicClient } from 'wagmi';
import { poseidon2, poseidon3, poseidon4 } from 'poseidon-lite';
import { CONTRACTS, NETWORK } from '../config';
import { landVaultAbi } from '../abis/landVault';

const ZERO_VALUE = 21663839004416932945382355908790599225266501822907911457504978515578255421292n;
const FIELD = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
const DEPTH = 24;
const STORAGE_PREFIX = 'r00t_landvault_v1';

function randField(): bigint {
  const b = new Uint8Array(31);
  crypto.getRandomValues(b);
  let v = 0n;
  for (const x of b) v = (v << 8n) | BigInt(x);
  return v % FIELD;
}

// pack a snarkjs groth16 proof into the uint256[8] the Solidity verifier expects (b-coord swap)
function packProof(p: any): bigint[] {
  return [p.pi_a[0], p.pi_a[1], p.pi_b[0][1], p.pi_b[0][0], p.pi_b[1][1], p.pi_b[1][0], p.pi_c[0], p.pi_c[1]].map(BigInt);
}

// zero-hashes of empty subtrees (must match TokenPool)
function zeroHashes(): bigint[] {
  const z = [ZERO_VALUE];
  for (let i = 1; i < DEPTH; i++) z.push(poseidon2([z[i - 1], z[i - 1]]));
  return z;
}

// build (pathElements, pathIndices) for `leafIndex` given the ordered leaves
function buildMerklePath(leaves: bigint[], leafIndex: number) {
  const zeros = zeroHashes();
  const pathElements: bigint[] = [];
  const pathIndices: number[] = [];
  let idx = leafIndex;
  let level = leaves.slice();
  for (let d = 0; d < DEPTH; d++) {
    const isRight = idx & 1;
    const sibIdx = isRight ? idx - 1 : idx + 1;
    const sibling = sibIdx < level.length ? level[sibIdx] : zeros[d];
    pathElements.push(sibling);
    pathIndices.push(isRight);
    // build next level
    const next: bigint[] = [];
    for (let i = 0; i < level.length; i += 2) {
      const l = level[i];
      const r = i + 1 < level.length ? level[i + 1] : zeros[d];
      next.push(poseidon2([l, r]));
    }
    level = next.length ? next : [zeros[d + 1] ?? 0n];
    idx = idx >> 1;
  }
  return { pathElements, pathIndices };
}

async function queryPonder<T>(query: string, variables?: Record<string, unknown>): Promise<T | null> {
  if (!NETWORK.indexerUrl) return null;
  try {
    const res = await fetch(`${NETWORK.indexerUrl}/graphql`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query, variables }),
    });
    const json = await res.json();
    return (json?.data as T) ?? null;
  } catch {
    return null;
  }
}

// lazy snarkjs (browser). Served from public/circuits/*
async function fullProve(input: Record<string, unknown>, wasmUrl: string, zkeyUrl: string) {
  const snarkjs: any = await import('snarkjs');
  return snarkjs.groth16.fullProve(input, wasmUrl, zkeyUrl);
}

export interface LandNote {
  id: string;
  parcelId: string;      // bytes32 hex
  rootOut: string;       // R00T-equiv (18dp) bound in the commitment
  nullifier: string;
  secret: string;
  commitment: string;
  leafIndex: number | null;
  createdAt: number;
  claimed: boolean;
  claimKind?: 'root' | 'parcel';
  claimRecipient?: string;
}

export function useLandVault(viewingKey: string | null) {
  const vault = (CONTRACTS.landVault || CONTRACTS.pledgeVault) as `0x${string}`;
  const vaultLower = vault.toLowerCase();
  const isReady = !!vault && vault !== '0x...' && vault.length === 42;
  const { data: walletClient } = useWalletClient();
  const publicClient = usePublicClient();
  const [notes, setNotes] = useState<LandNote[]>([]);
  const notesRef = useRef<LandNote[]>([]);

  const storageKey = useMemo(() => `${STORAGE_PREFIX}_${viewingKey || 'anon'}_${vaultLower.slice(0, 10)}`, [viewingKey, vaultLower]);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      const arr = raw ? (JSON.parse(raw) as LandNote[]) : [];
      notesRef.current = arr;
      setNotes(arr);
    } catch { /* ignore */ }
  }, [storageKey]);
  const persist = useCallback((arr: LandNote[]) => {
    notesRef.current = arr;
    setNotes(arr);
    try { localStorage.setItem(storageKey, JSON.stringify(arr)); } catch { /* ignore */ }
  }, [storageKey]);

  const WASM = (c: string) => `/circuits/${c}/${c === 'landdeposit' ? 'landdeposit' : c}.wasm`;
  const ZKEY = (c: string) => `/circuits/${c}/${c}_final.zkey`;

  /** Fund a parcel with ETH. Generates the note + landdeposit proof + calls otcFundETH. */
  const fundETH = useCallback(async (parcelIdHex: string, rootOut: bigint, ethNeeded: bigint) => {
    if (!isReady || !walletClient) throw new Error('wallet/vault not ready');
    const parcelId = BigInt(parcelIdHex);
    const nullifier = randField(), secret = randField();
    const commitment = poseidon4([nullifier, secret, parcelId, rootOut]);
    const binding = poseidon3([parcelId, rootOut, commitment]);
    const dep = await fullProve(
      { parcelId: parcelId.toString(), amount: rootOut.toString(), commitment: commitment.toString(), nullifier: nullifier.toString(), secret: secret.toString() },
      WASM('landdeposit'), ZKEY('landdeposit')
    );
    const proof = packProof(dep.proof);
    const hash = await walletClient.writeContract({
      address: vault, abi: landVaultAbi, functionName: 'otcFundETH',
      args: [parcelIdHex as `0x${string}`, rootOut, commitment, binding, proof as any, '0x'],
      value: ethNeeded,
    });
    const note: LandNote = {
      id: `${Date.now()}_${Math.random().toString(16).slice(2, 10)}`,
      parcelId: parcelIdHex, rootOut: rootOut.toString(),
      nullifier: nullifier.toString(), secret: secret.toString(), commitment: commitment.toString(),
      leafIndex: null, createdAt: Date.now(), claimed: false,
    };
    persist([...notesRef.current, note]);
    return { hash, note };
  }, [isReady, walletClient, vault, persist]);

  /** Fund a parcel with USDC/USDG (6dp). Approves the vault, then calls otcFundUSDC. */
  const fundUSDC = useCallback(async (parcelIdHex: string, rootOut: bigint, usdcNeeded: bigint, usdc: string) => {
    if (!isReady || !walletClient || !publicClient) throw new Error('wallet/vault not ready');
    const parcelId = BigInt(parcelIdHex);
    const nullifier = randField(), secret = randField();
    const commitment = poseidon4([nullifier, secret, parcelId, rootOut]);
    const binding = poseidon3([parcelId, rootOut, commitment]);
    // approve USDC to the vault (it pulls via safeTransferFrom to the land treasury)
    const erc20 = [{ name: 'approve', type: 'function', stateMutability: 'nonpayable', inputs: [{ type: 'address' }, { type: 'uint256' }], outputs: [{ type: 'bool' }] }] as const;
    const ah = await walletClient.writeContract({ address: usdc as `0x${string}`, abi: erc20, functionName: 'approve', args: [vault, usdcNeeded] });
    await publicClient.waitForTransactionReceipt({ hash: ah });
    const dep = await fullProve(
      { parcelId: parcelId.toString(), amount: rootOut.toString(), commitment: commitment.toString(), nullifier: nullifier.toString(), secret: secret.toString() },
      WASM('landdeposit'), ZKEY('landdeposit')
    );
    const proof = packProof(dep.proof);
    const hash = await walletClient.writeContract({
      address: vault, abi: landVaultAbi, functionName: 'otcFundUSDC',
      args: [parcelIdHex as `0x${string}`, rootOut, commitment, binding, proof as any, '0x'],
    });
    const note: LandNote = {
      id: `${Date.now()}_${Math.random().toString(16).slice(2, 10)}`,
      parcelId: parcelIdHex, rootOut: rootOut.toString(),
      nullifier: nullifier.toString(), secret: secret.toString(), commitment: commitment.toString(),
      leafIndex: null, createdAt: Date.now(), claimed: false,
    };
    persist([...notesRef.current, note]);
    return { hash, note };
  }, [isReady, walletClient, publicClient, vault, persist]);

  /** Claim a note to ANY wallet as R00T or the parcel token. One irreversible choice. */
  const claim = useCallback(async (note: LandNote, recipient: string, kind: 'root' | 'parcel') => {
    if (!isReady || !walletClient) throw new Error('wallet/vault not ready');

    // Build the ordered leaf list. PRIMARY: the Ponder cache. FALLBACK (if servers are
    // down): rebuild straight from on-chain Funded events via getLogs — the chain is the
    // source of truth, so claims never depend on our infra. Only your note secret matters.
    let leaves: bigint[] | null = null;
    const data = await queryPonder<{ merkleTreeStates: { items: { leaves: string }[] } }>(
      `query($a: String!){ merkleTreeStates(where: { id: $a }, limit: 1){ items { leaves } } }`,
      { a: vaultLower }
    );
    const leavesRaw = data?.merkleTreeStates?.items?.[0]?.leaves;
    if (leavesRaw) {
      leaves = (JSON.parse(leavesRaw) as string[]).map((s) => BigInt(s));
    } else if (publicClient) {
      // trustless fallback: read Funded(commitment, leafIndex, …) logs and order by leafIndex
      const logs = await publicClient.getLogs({
        address: vault,
        event: { type: 'event', name: 'Funded', inputs: [
          { name: 'commitment', type: 'uint256', indexed: true },
          { name: 'leafIndex', type: 'uint256', indexed: true },
          { name: 'parcelId', type: 'bytes32' }, { name: 'rootOut', type: 'uint256' },
          { name: 'paid', type: 'uint256' }, { name: 'payToken', type: 'address' }, { name: 'note', type: 'bytes' },
        ] } as const,
        fromBlock: 0n, toBlock: 'latest',
      });
      const byIndex = new Map<number, bigint>();
      for (const l of logs as any[]) byIndex.set(Number(l.args.leafIndex), BigInt(l.args.commitment));
      const max = Math.max(-1, ...byIndex.keys());
      leaves = Array.from({ length: max + 1 }, (_, i) => byIndex.get(i) ?? 0n);
    }
    if (!leaves) throw new Error('could not load the commitment tree (no indexer, no RPC)');
    const leafIndex = leaves.findIndex((l) => l === BigInt(note.commitment));
    if (leafIndex < 0) throw new Error('commitment not on-chain yet — wait a moment and retry');

    const { pathElements, pathIndices } = buildMerklePath(leaves, leafIndex);
    // recompute root locally (defensive)
    let node = BigInt(note.commitment);
    for (let d = 0; d < DEPTH; d++) node = pathIndices[d] ? poseidon2([pathElements[d], node]) : poseidon2([node, pathElements[d]]);
    const merkleRoot = node;

    const parcelId = BigInt(note.parcelId);
    const amount = BigInt(note.rootOut);
    const nullifier = BigInt(note.nullifier);
    const nullifierHash = poseidon2([nullifier, BigInt(leafIndex)]);
    const recipientField = BigInt(recipient);
    const recipientBinding = poseidon3([parcelId, amount, recipientField]);

    const clm = await fullProve(
      {
        merkleRoot: merkleRoot.toString(), nullifierHash: nullifierHash.toString(),
        parcelId: parcelId.toString(), amount: amount.toString(), recipient: recipientField.toString(),
        nullifier: nullifier.toString(), secret: BigInt(note.secret).toString(),
        pathElements: pathElements.map((e) => e.toString()), pathIndices: pathIndices.map((i) => i.toString()),
      },
      WASM('claim'), ZKEY('claim')
    );
    const proof = packProof(clm.proof);
    const pub = [recipientBinding, merkleRoot, nullifierHash, parcelId, amount, recipientField] as const;
    const fn = kind === 'root' ? 'claimR00T' : 'claimParcelToken';
    const hash = await walletClient.writeContract({
      address: vault, abi: landVaultAbi, functionName: fn,
      args: [proof as any, pub as any, recipient as `0x${string}`],
    });
    persist(notesRef.current.map((n) => n.id === note.id ? { ...n, claimed: true, claimKind: kind, claimRecipient: recipient } : n));
    return hash;
  }, [isReady, walletClient, vault, vaultLower, persist, publicClient]);

  /** Withdraw the linearly-unlocked portion of an anti-arb R00T vest (from a prior claimR00T). */
  const withdrawVested = useCallback(async () => {
    if (!isReady || !walletClient) throw new Error('wallet/vault not ready');
    const abi = [{ name: 'withdrawVestedR00T', type: 'function', stateMutability: 'nonpayable', inputs: [], outputs: [{ type: 'uint256' }] }] as const;
    return walletClient.writeContract({ address: vault, abi, functionName: 'withdrawVestedR00T' });
  }, [isReady, walletClient, vault]);

  return { isReady, vault, notes, fundETH, fundUSDC, claim, withdrawVested };
}
