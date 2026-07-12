/**
 * usePledge — client-side state for anonymous plot pledging (Phase D).
 *
 * A "private pledge" shields R00T into the pledge vault and records a commitment
 * bound to a parcelId. The spending secrets (nullifier/secret/amount) live ONLY
 * in the browser — the deposit wallet is never linked to the later claim, which
 * pays out to a user-chosen recipient via a fresh ZK proof.
 *
 * This hook:
 *  - persists encrypted pledge notes in localStorage (scoped per viewing key),
 *  - resolves each note's on-chain leafIndex from the Ponder indexer,
 *  - marks notes claimed by matching their nullifierHash against indexed claims,
 *  - exposes the pledge merkle tree so the Portfolio can build claim proofs.
 *
 * Mirrors the queryPonder + localStorage patterns in usePrivateWallet, but the
 * pledge tree is indexed under the pledge vault address (see indexer/src/index.ts
 * handlePledgeCommitment → merkleTreeState keyed by that address).
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { Wallet, toUtf8Bytes, keccak256, concat } from 'ethers';
import { createCommitment, encryptNote, hashNullifier } from '@r00t-fund/sdk';
import { NETWORK, CONTRACTS } from '../config';

// ---- GraphQL (Ponder) -------------------------------------------------------

// Ponder pluralizes the JS export name with a trailing 's' (pledgeCommitments →
// pledgeCommitmentss), same convention as commitmentss / nullifierss.
const PLEDGE_COMMITMENTS_QUERY = `
  query GetPledgeCommitments($limit: Int, $afterLeafIndex: BigInt, $address: String) {
    pledgeCommitmentss(limit: $limit, orderBy: "leafIndex", orderDirection: "asc", where: { leafIndex_gte: $afterLeafIndex, address_in: [$address] }) {
      items { commitment leafIndex parcelId note blockNumber transactionHash address }
    }
  }
`;

const PLEDGE_NULLIFIERS_QUERY = `
  query GetPledgeNullifiers($address: String) {
    pledgeNullifierss(limit: 1000, where: { address_in: [$address] }) {
      items { id transactionHash blockNumber }
    }
  }
`;

const PLEDGE_TREE_STATE_QUERY = `
  query GetPledgeTreeState($address: String) {
    merkleTreeStates(where: { id: $address }, limit: 1) {
      items { id nextIndex currentRoot filledSubtrees leaves updatedAt }
    }
  }
`;

async function queryPonder<T>(query: string, variables?: Record<string, unknown>): Promise<T | null> {
  if (!NETWORK.indexerUrl) return null;
  const url = `${NETWORK.indexerUrl}/graphql`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, variables }),
    });
    if (!res.ok) return null;
    const json = await res.json();
    if (json.errors) {
      console.error('[usePledge] GraphQL errors:', JSON.stringify(json.errors));
      return null;
    }
    return json.data as T;
  } catch (err) {
    console.error('[usePledge] fetch error:', err);
    return null;
  }
}

// ---- Types ------------------------------------------------------------------

export interface PledgeNote {
  id: string;                 // local id
  parcelId: string;           // bytes32 the pledge is bound to
  parcelLabel?: string;       // human label for the plot (display only)
  amount: string;             // R00T wei, as string
  nullifier: string;
  secret: string;
  commitment: string;         // decimal string
  leafIndex: number | null;   // resolved from the indexer once the commitment lands
  createdAt: number;
  pledgeTxHash?: string;
  claimed: boolean;
  claimTxHash?: string;
  claimRecipient?: string;
}

export interface PledgeTreeResult {
  commitments: { commitment: bigint; leafIndex: number }[];
  treeState?: { filledSubtrees: bigint[]; root: bigint };
}

const STORAGE_PREFIX = 'r00t_pledges_v1';

// ---- Hook -------------------------------------------------------------------

export function usePledge(viewingKey: string | null) {
  const pledgeVault = CONTRACTS.pledgeVault;
  const pledgeVaultLower = pledgeVault.toLowerCase();

  const [notes, setNotes] = useState<PledgeNote[]>([]);
  const [publicKey, setPublicKey] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const isReady = pledgeVault !== '0x...' && pledgeVault.length === 42;

  // Derive the viewing public key (for note encryption) + storage scope.
  useEffect(() => {
    if (!viewingKey) {
      setPublicKey('');
      setNotes([]);
      return;
    }
    try {
      const hash = keccak256(toUtf8Bytes(viewingKey));
      const viewingKeyHash = keccak256(concat([hash, toUtf8Bytes('viewing')]));
      const wallet = new Wallet(viewingKeyHash);
      setPublicKey(wallet.signingKey.compressedPublicKey);
    } catch (err) {
      console.error('[usePledge] failed to derive key:', err);
    }
  }, [viewingKey]);

  const storageKey = useCallback(
    (pk: string) => `${STORAGE_PREFIX}_${pk}_${pledgeVaultLower.slice(0, 10)}`,
    [pledgeVaultLower]
  );

  // Load persisted notes when the public key resolves.
  useEffect(() => {
    if (!publicKey) return;
    try {
      const raw = localStorage.getItem(storageKey(publicKey));
      setNotes(raw ? (JSON.parse(raw) as PledgeNote[]) : []);
    } catch (err) {
      console.error('[usePledge] failed to load notes:', err);
      setNotes([]);
    }
  }, [publicKey, storageKey]);

  // Persist notes on change.
  const notesRef = useRef(notes);
  notesRef.current = notes;
  const persist = useCallback(
    (next: PledgeNote[]) => {
      setNotes(next);
      if (publicKey) {
        try {
          localStorage.setItem(storageKey(publicKey), JSON.stringify(next));
        } catch (err) {
          console.error('[usePledge] failed to persist notes:', err);
        }
      }
    },
    [publicKey, storageKey]
  );

  /**
   * Build a fresh pledge commitment for a parcel. Returns the commitment + the
   * encrypted note bytes to pass to pledgePrivate; the caller stores the note
   * (with tx hash) via storePledge once the tx confirms.
   */
  const buildPledge = useCallback(
    async (parcelId: string, amount: bigint, parcelLabel?: string) => {
      const { nullifier, secret, commitment } = createCommitment(amount);
      // Encrypt to our own viewing key so the note is recoverable on-chain.
      const encryptedNote = publicKey
        ? await encryptNote(nullifier, secret, amount, publicKey)
        : '0x';
      const note: PledgeNote = {
        id: `${Date.now()}_${Math.random().toString(16).slice(2, 10)}`,
        parcelId,
        parcelLabel,
        amount: amount.toString(),
        nullifier: nullifier.toString(),
        secret: secret.toString(),
        commitment: commitment.toString(),
        leafIndex: null,
        createdAt: Date.now(),
        claimed: false,
      };
      return { note, commitment, nullifier, secret, encryptedNote };
    },
    [publicKey]
  );

  /** Persist a pledge note (after the pledgePrivate tx confirms). */
  const storePledge = useCallback(
    (note: PledgeNote) => {
      persist([...notesRef.current.filter((n) => n.id !== note.id), note]);
    },
    [persist]
  );

  /** Mark a pledge claimed locally (after the claim tx confirms). */
  const markClaimed = useCallback(
    (id: string, recipient: string, txHash: string) => {
      persist(
        notesRef.current.map((n) =>
          n.id === id ? { ...n, claimed: true, claimRecipient: recipient, claimTxHash: txHash } : n
        )
      );
    },
    [persist]
  );

  /**
   * Refresh: resolve leafIndex for pending notes from the indexer and detect any
   * pledges that were claimed (nullifier spent) out-of-band.
   */
  const refresh = useCallback(async () => {
    if (!isReady || notesRef.current.length === 0) return;
    setIsLoading(true);
    try {
      // Fetch this vault's pledge commitments (paginated) → commitment→leafIndex map.
      const byCommitment = new Map<string, number>();
      let after = 0n;
      const PAGE = 1000;
      for (let i = 0; i < 20; i++) {
        const page = await queryPonder<{ pledgeCommitmentss: { items: { commitment: string; leafIndex: string }[] } }>(
          PLEDGE_COMMITMENTS_QUERY,
          { limit: PAGE, afterLeafIndex: after.toString(), address: pledgeVaultLower }
        );
        const items = page?.pledgeCommitmentss?.items ?? [];
        for (const it of items) byCommitment.set(BigInt(it.commitment).toString(), Number(it.leafIndex));
        if (items.length < PAGE) break;
        after = BigInt(items[items.length - 1].leafIndex) + 1n;
      }

      // Spent pledge nullifiers → claimed detection.
      const spent = new Set<string>();
      const nulls = await queryPonder<{ pledgeNullifierss: { items: { id: string }[] } }>(
        PLEDGE_NULLIFIERS_QUERY,
        { address: pledgeVaultLower }
      );
      for (const n of nulls?.pledgeNullifierss?.items ?? []) spent.add(n.id);

      const updated = notesRef.current.map((n) => {
        let leafIndex = n.leafIndex;
        if (leafIndex == null) {
          const resolved = byCommitment.get(BigInt(n.commitment).toString());
          if (resolved != null) leafIndex = resolved;
        }
        let claimed = n.claimed;
        if (!claimed && leafIndex != null) {
          const nh = hashNullifier(BigInt(n.nullifier), leafIndex).toString();
          if (spent.has(nh)) claimed = true;
        }
        return leafIndex === n.leafIndex && claimed === n.claimed ? n : { ...n, leafIndex, claimed };
      });
      persist(updated);
    } finally {
      setIsLoading(false);
    }
  }, [isReady, pledgeVaultLower, persist]);

  /** Fetch the full pledge tree (fast path via indexer tree-state) for claim proofs. */
  const fetchPledgeTree = useCallback(async (): Promise<PledgeTreeResult> => {
    if (!isReady) return { commitments: [] };
    const ZERO_VALUE = 21663839004416932945382355908790599225266501822907911457504978515578255421292n;

    // Fast path: pre-built tree state.
    const treeStateRes = await queryPonder<{
      merkleTreeStates: { items: Array<{ currentRoot: string; filledSubtrees: string; leaves: string }> };
    }>(PLEDGE_TREE_STATE_QUERY, { address: pledgeVaultLower });
    const treeData = treeStateRes?.merkleTreeStates?.items?.[0];
    if (treeData) {
      const leaves: string[] = JSON.parse(treeData.leaves);
      const filledSubtrees: string[] = JSON.parse(treeData.filledSubtrees);
      return {
        commitments: leaves.map((leaf, i) => ({ commitment: BigInt(leaf), leafIndex: i })),
        treeState: { filledSubtrees: filledSubtrees.map((s) => BigInt(s)), root: BigInt(treeData.currentRoot) },
      };
    }

    // Slow path: rebuild from individual commitments.
    const map = new Map<number, string>();
    let after = 0n;
    const PAGE = 1000;
    for (let i = 0; i < 20; i++) {
      const page = await queryPonder<{ pledgeCommitmentss: { items: { commitment: string; leafIndex: string }[] } }>(
        PLEDGE_COMMITMENTS_QUERY,
        { limit: PAGE, afterLeafIndex: after.toString(), address: pledgeVaultLower }
      );
      const items = page?.pledgeCommitmentss?.items ?? [];
      for (const it of items) map.set(Number(it.leafIndex), it.commitment);
      if (items.length < PAGE) break;
      after = BigInt(items[items.length - 1].leafIndex) + 1n;
    }
    if (map.size === 0) return { commitments: [] };
    const maxLeaf = Math.max(...map.keys());
    const commitments: { commitment: bigint; leafIndex: number }[] = [];
    for (let i = 0; i <= maxLeaf; i++) {
      const c = map.get(i);
      commitments.push({ commitment: c ? BigInt(c) : ZERO_VALUE, leafIndex: i });
    }
    return { commitments };
  }, [isReady, pledgeVaultLower]);

  // Auto-refresh once notes + vault are ready.
  useEffect(() => {
    if (isReady && notes.length > 0) void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isReady, publicKey]);

  return {
    notes,
    pledgeVault,
    isReady,
    isLoading,
    publicKey,
    buildPledge,
    storePledge,
    markClaimed,
    refresh,
    fetchPledgeTree,
  };
}
