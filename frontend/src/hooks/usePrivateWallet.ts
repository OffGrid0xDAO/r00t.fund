import { useState, useEffect, useCallback, useRef } from 'react';
// Note: wagmi hooks removed - scan uses direct RPC calls for better control
import { Wallet, toUtf8Bytes, keccak256, concat, getBytes } from 'ethers';
import { createCommitment, decryptNote, hashNullifier, hashCommitment } from '@r00t-fund/sdk';
import { NETWORK, EVENTS, CONTRACTS } from '../config';

/**
 * SECURITY WARNING: This hook currently stores secrets in PLAINTEXT localStorage.
 *
 * TODO: Integrate with secureStorage.ts to encrypt sensitive data:
 * - nullifier and secret fields in commitments are sensitive
 * - Should use password-based encryption via secureStorage.encryptData()
 * - Requires UI for password entry and unlock state management
 *
 * Current risk: XSS attacks or malicious browser extensions can steal secrets
 * and drain user funds by generating valid ZK proofs.
 */

// GraphQL queries for Ponder indexer
// NOTE: Ponder's "where: { address: $address }" doesn't work, but "address_in: [$address]" does!
// NOTE: Ponder limit is 1000 max, so we paginate using leafIndex filter
const COMMITMENTS_QUERY_PAGINATED = `
  query GetCommitments($limit: Int, $afterLeafIndex: BigInt, $address: String) {
    commitmentss(limit: $limit, orderBy: "leafIndex", orderDirection: "asc", where: { leafIndex_gte: $afterLeafIndex, address_in: [$address] }) {
      items {
        commitment
        leafIndex
        encryptedNote
        blockNumber
        timestamp
        transactionHash
        address
      }
    }
  }
`;

const TRADES_QUERY = `
  query GetTrades($address: String, $limit: Int) {
    tradess(where: { address_in: [$address] }, limit: $limit, orderBy: "timestamp", orderDirection: "desc") {
      items {
        type
        ethAmount
        tokenAmount
        blockNumber
        transactionHash
      }
    }
  }
`;

// Query for spent nullifiers (to detect already-spent commitments)
// Note: Ponder uses double 's' for plural queries (nullifierss)
// Note: Ponder limit is 1000 max - use address_in filter to reduce results
const NULLIFIERS_QUERY = `
  query GetNullifiers($address: String) {
    nullifierss(limit: 1000, where: { address_in: [$address] }) {
      items {
        id
        transactionHash
        blockNumber
      }
    }
  }
`;

// Query for pre-built Merkle tree state (much faster than rebuilding)
const MERKLE_TREE_STATE_QUERY = `
  query GetMerkleTreeState($address: String) {
    merkleTreeStates(where: { id: $address }, limit: 1) {
      items {
        id
        nextIndex
        currentRoot
        filledSubtrees
        leaves
        updatedAt
      }
    }
  }
`;

// Helper to fetch from Ponder GraphQL
async function queryPonder<T>(query: string, variables?: Record<string, unknown>): Promise<T | null> {
  if (!NETWORK.indexerUrl) return null;
  const url = `${NETWORK.indexerUrl}/graphql`;
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, variables }),
    });
    if (!response.ok) {
      console.error(`[queryPonder] HTTP error! status: ${response.status} for ${url}`);
      const text = await response.text();
      console.error(`[queryPonder] Response body:`, text.slice(0, 200));
      return null;
    }
    const result = await response.json();
    if (result.errors) {
      console.error('[queryPonder] GraphQL errors:', JSON.stringify(result.errors, null, 2));
      return null;
    }
    return result.data as T;
  } catch (err) {
    console.error(`[queryPonder] Fetch error for ${url}:`, err);
    return null;
  }
}

// Full commitment data including secrets (for proof generation)
export interface Commitment {
  commitment: string;
  amount: string;
  leafIndex: number;
  blockNumber: number;
  spent: boolean;
  address: string; // contract address this commitment belongs to
  // Note secrets (needed for proof generation)
  nullifier?: string;
  secret?: string;
}

interface WalletState {
  balance: bigint;
  commitments: Commitment[];
  publicKey: string;
  isScanning: boolean;
  lastScannedBlock: number;
}

// Storage key for wallet state
// IMPORTANT: This key should include the pair address to scope data to specific deployments
// VERSION 3: Force refresh to clear stale commitments from v2 that had corrupted leafIndex data
const WALLET_STORAGE_KEY = 'r00t_wallet_state_v3';

// Quiet debug logging — enable with localStorage.setItem('r00t_debug','1'). Errors/warnings still show.
const dbg = (...a: unknown[]) => { try { if (localStorage.getItem('r00t_debug') === '1') console.log(...a); } catch { /* noop */ } };

// Robinhood Chain: block the current zkAMM pair was deployed. Used as the start for the
// trustless RPC fallback so the full commitment tree can be rebuilt straight from chain
// when the indexer is unavailable. Override with VITE_DEX_DEPLOY_BLOCK.
const DEX_DEPLOY_BLOCK: bigint = (() => {
  const v = import.meta.env.VITE_DEX_DEPLOY_BLOCK as string | undefined;
  try { return v ? BigInt(v) : 7945000n; } catch { return 7945000n; }
})();

/**
 * Hook for managing private wallet state
 * Note: In production, this would use the full SDK with proper note decryption
 */
export function usePrivateWallet(zkAMMAddress: string, pairAddress: string, seedPhrase: string | null) {
  const [state, setState] = useState<WalletState>({
    balance: 0n,
    commitments: [],
    publicKey: '',
    isScanning: false,
    lastScannedBlock: 0,
  });

  // Track if we're still loading to prevent saving empty state
  const isLoadingRef = useRef(true);

  // Generate storage key that includes both user pubKey AND contract address
  // This ensures wallet data is scoped per-deployment (fresh contracts = fresh data)
  const getStorageKey = useCallback((pubKey: string) => {
    // Include first 10 chars of pairAddress to differentiate deployments
    const contractSuffix = pairAddress ? pairAddress.slice(0, 10).toLowerCase() : 'unknown';
    return `${WALLET_STORAGE_KEY}_${pubKey}_${contractSuffix}`;
  }, [pairAddress]);

  // Derive public key from seed and load saved state in ONE atomic operation
  useEffect(() => {
    if (!seedPhrase) {
      isLoadingRef.current = false;
      setState((s) => ({ ...s, publicKey: '', balance: 0n, commitments: [] }));
      return;
    }

    isLoadingRef.current = true;

    try {
      const seedBytes = toUtf8Bytes(seedPhrase);
      const hash = keccak256(seedBytes);
      const viewingKeyHash = keccak256(
        concat([hash, toUtf8Bytes('viewing')])
      );
      const wallet = new Wallet(viewingKeyHash);
      const pubKey = wallet.signingKey.compressedPublicKey;

      // Storage key now includes contract address to scope per-deployment
      const storageKey = getStorageKey(pubKey);
      let saved = localStorage.getItem(storageKey);

      // Migration: If not found, try old keys (v1 without contract scope)
      if (!saved) {
        // Try old v1 key format (just publicKey)
        const oldKeyV1 = `r00t_wallet_state_${pubKey}`;
        const oldKeyV1Alt = `r00t_wallet_state_${wallet.address}`;

        // Don't migrate old data - it's from different contract deployments
        // Just log that we're starting fresh
        if (localStorage.getItem(oldKeyV1) || localStorage.getItem(oldKeyV1Alt)) {
          dbg('[usePrivateWallet] Found old wallet data from previous deployment, starting fresh for new contracts');
        }
      }

      // Parse saved data
      let loadedBalance = 0n;
      let loadedCommitments: Commitment[] = [];
      let loadedLastScannedBlock = 0;

      if (saved) {
        try {
          const parsed = JSON.parse(saved);
          loadedBalance = BigInt(parsed.balance || '0');
          loadedCommitments = parsed.commitments || [];
          loadedLastScannedBlock = parsed.lastScannedBlock || 0;
          dbg(`[usePrivateWallet] Loaded ${loadedCommitments.length} commitments from storage (key: ${storageKey})`);
        } catch (e) {
          console.error('[usePrivateWallet] Failed to parse saved state:', e);
        }
      }

      // Set everything in ONE setState to avoid race conditions
      setState((s) => ({
        ...s,
        publicKey: pubKey,
        balance: loadedBalance,
        commitments: loadedCommitments,
        lastScannedBlock: loadedLastScannedBlock,
      }));

      // Mark loading complete AFTER setState
      setTimeout(() => {
        isLoadingRef.current = false;
      }, 100);
    } catch (err) {
      console.error('Failed to derive keys:', err);
      isLoadingRef.current = false;
    }
  }, [seedPhrase, getStorageKey]);

  // Save state to localStorage - use ref to avoid infinite loops
  const stateRef = useRef(state);
  stateRef.current = state;

  // Helper function to save state immediately
  const saveStateNow = useCallback(() => {
    const currentState = stateRef.current;
    if (!currentState.publicKey || isLoadingRef.current) return;

    const toSave = {
      balance: currentState.balance.toString(),
      commitments: currentState.commitments,
      lastScannedBlock: currentState.lastScannedBlock,
    };
    const storageKey = getStorageKey(currentState.publicKey);
    localStorage.setItem(storageKey, JSON.stringify(toSave));
    dbg(`[usePrivateWallet] Saved ${currentState.commitments.length} commitments to storage (key: ${storageKey})`);
  }, [getStorageKey]);

  // Debounced save to prevent excessive writes
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // Don't save during initial load or without a publicKey
    if (!state.publicKey || isLoadingRef.current) return;

    // Debounce saves to prevent rapid writes
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }

    saveTimeoutRef.current = setTimeout(() => {
      saveStateNow();
    }, 500); // 500ms debounce

    // On unmount: SAVE IMMEDIATELY instead of cancelling!
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
        // Save immediately on unmount to prevent data loss
        saveStateNow();
      }
    };
  }, [state.publicKey, state.balance, state.commitments, state.lastScannedBlock, saveStateNow]);

  // Also save on page unload/refresh
  useEffect(() => {
    const handleBeforeUnload = () => {
      saveStateNow();
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [saveStateNow]);

  // Scan for commitments - correlate with TokensPurchased events to get amounts
  // Tries Ponder indexer first (no rate limits), falls back to RPC
  const scan = useCallback(async () => {
    if (!zkAMMAddress || zkAMMAddress === '0x...' || !seedPhrase) {
      return;
    }

    setState((s) => ({ ...s, isScanning: true }));
    dbg(`[usePrivateWallet] Starting scan using indexer: ${NETWORK.indexerUrl}`);

    try {
      // Types for Ponder responses
      // NOTE: leafIndex comes from Ponder as STRING (GraphQL BigInt), not number!
      interface PonderCommitment {
        commitment: string;
        leafIndex: string; // Ponder returns BigInt as string!
        encryptedNote: string;
        blockNumber: string;
        transactionHash: string;
        address: string;
      }
      interface PonderTrade {
        type: string;
        tokenAmount: string;
        transactionHash: string;
      }
      interface CommitmentsResponse {
        commitmentss: { items: PonderCommitment[] };
      }
      interface TradesResponse {
        tradess: { items: PonderTrade[] };
      }
      interface PonderNullifier {
        id: string; // nullifierHash as string
        transactionHash: string;
        blockNumber: string;
      }
      interface NullifiersResponse {
        nullifierss: { items: PonderNullifier[] };
      }

      // Track the latest block scanned
      let currentBlock = 0n;

      // Try Ponder first (no rate limits, pre-indexed data)
      // Note: Commitments and Nullifiers are indexed from Pair address, Trades from Router address
      // NOTE: We fetch ALL commitments with PAGINATION (Ponder limit is 1000 max)
      // NOTE: We filter client-side due to Ponder address filter bug

      // Fetch commitments with pagination (1000 at a time)
      // Now uses address_in filter so Ponder returns only our pair's commitments
      let allPonderCommitments: PonderCommitment[] = [];
      let afterLeafIndex = 0n;
      let hasMore = true;
      const PAGE_SIZE = 1000;
      const pairAddressLower = pairAddress.toLowerCase();

      dbg(`[usePrivateWallet] Starting paginated fetch for pair: ${pairAddressLower}`);
      while (hasMore) {
        const page = await queryPonder<CommitmentsResponse>(COMMITMENTS_QUERY_PAGINATED, {
          limit: PAGE_SIZE,
          afterLeafIndex: afterLeafIndex.toString(),
          address: pairAddressLower  // Server-side filter with address_in
        });

        if (page?.commitmentss?.items?.length) {
          allPonderCommitments.push(...page.commitmentss.items);
          const lastItem = page.commitmentss.items[page.commitmentss.items.length - 1];
          afterLeafIndex = BigInt(lastItem.leafIndex) + 1n;
          dbg(`[usePrivateWallet] Fetched page: ${page.commitmentss.items.length} items (total: ${allPonderCommitments.length}, next: ${afterLeafIndex})`);

          // Stop if we got less than PAGE_SIZE (no more data)
          if (page.commitmentss.items.length < PAGE_SIZE) {
            hasMore = false;
          }
        } else {
          hasMore = false;
        }
      }
      dbg(`[usePrivateWallet] Pagination complete: ${allPonderCommitments.length} commitments for pair`);

      // Fetch trades and nullifiers (these are typically smaller, single query is fine)
      const [ponderTrades, ponderNullifiers, ponderMeta] = await Promise.all([
        queryPonder<TradesResponse>(TRADES_QUERY, { address: (CONTRACTS.zkAMMRouter || zkAMMAddress).toLowerCase(), limit: 1000 }),
        queryPonder<NullifiersResponse>(NULLIFIERS_QUERY, { address: pairAddressLower }), // Nullifiers are on pair contract
        queryPonder<{ _meta: { status: { [key: string]: { block: { number: number } } } } }>('{ _meta { status } }'),
      ]);

      // Build a Set of spent nullifier hashes for quick lookup
      const spentNullifiers = new Set<string>();
      if (ponderNullifiers?.nullifierss?.items?.length) {
        dbg(`[usePrivateWallet] Loaded ${ponderNullifiers.nullifierss.items.length} spent nullifiers from Ponder`);
        for (const n of ponderNullifiers.nullifierss.items) {
          spentNullifiers.add(n.id); // id is the nullifierHash
          dbg(`[usePrivateWallet] Spent nullifier: ${n.id.slice(0, 30)}...`);
        }
      } else {
        console.warn(`[usePrivateWallet] NO spent nullifiers found! Query result:`, ponderNullifiers);
      }

      // Get current block from Ponder meta if available
      const metaStatus = (ponderMeta as any)?._meta?.status;
      if (metaStatus?.arbitrum?.block?.number) {
        currentBlock = BigInt(metaStatus.arbitrum.block.number);
      } else if (metaStatus?.sepolia?.block?.number) {
        currentBlock = BigInt(metaStatus.sepolia.block.number);
      }

      let commitmentLogs: Array<{ topics: string[]; transactionHash: string; blockNumber: string; data: string; address?: string }> = [];
      let purchaseLogs: Array<{ transactionHash: string; data: string }> = [];

      // If Ponder has data, use it (already filtered server-side by address_in)
      if (allPonderCommitments.length > 0) {
        dbg(`[usePrivateWallet] Using Ponder: ${allPonderCommitments.length} commitments for pair ${pairAddressLower}`);
        commitmentLogs = allPonderCommitments.map(c => ({
          topics: [
            EVENTS.newCommitment,
            '0x' + BigInt(c.commitment).toString(16).padStart(64, '0'),
            // FIX: c.leafIndex is a string from Ponder, must convert to Number BEFORE hex conversion
            // Bug: "10".toString(16) returns "10" (string), not "a" (hex of decimal 10)
            // This caused leafIndex 10,11,12 to become 16,17,18 (0x10, 0x11, 0x12)
            '0x' + Number(c.leafIndex).toString(16).padStart(64, '0'),
          ],
          transactionHash: c.transactionHash,
          blockNumber: '0x' + Number(c.blockNumber).toString(16),
          data: c.encryptedNote || '0x',
          address: c.address, // Include address from Ponder for commitment storage
        }));
      }

      if (ponderTrades?.tradess?.items?.length) {
        dbg(`[usePrivateWallet] Using Ponder: ${ponderTrades.tradess.items.length} trades`);
        // Filter buy AND remove_lp trades - both create token commitments
        // - buy: user buys tokens, gets a new token commitment
        // - remove_lp: user removes liquidity, gets tokens back as a new commitment
        purchaseLogs = ponderTrades.tradess.items
          .filter(t => t.type === 'buy' || t.type === 'remove_lp')
          .map(t => {
            // Ponder stores tokenAmount as formatted decimal string (e.g., "10880603.307...")
            // Convert back to wei by parsing as float and multiplying by 10^18
            const tokenAmountWei = BigInt(Math.floor(parseFloat(t.tokenAmount) * 1e18));
            dbg(`[usePrivateWallet] Trade ${t.type}: tx=${t.transactionHash.slice(0, 10)}, tokens=${t.tokenAmount}`);
            return {
              transactionHash: t.transactionHash,
              // Fake data field with tokenAmount (only tokensOut matters for correlation)
              data: '0x' + '0'.repeat(64) + tokenAmountWei.toString(16).padStart(64, '0'),
            };
          });
      }

      // Fall back to RPC if Ponder has no data
      if (!commitmentLogs.length) {
        dbg('[usePrivateWallet] Ponder empty or failed, falling back to RPC');
        const RPC_URL = NETWORK.rpcUrl;

        // Get current block
        const blockRes = await fetch(RPC_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', method: 'eth_blockNumber', params: [], id: 1 }),
        });
        const blockData = await blockRes.json();
        if (blockData.error) {
          console.error('[usePrivateWallet] RPC error:', blockData.error);
          setState((s) => ({ ...s, isScanning: false }));
          return;
        }
        const currentBlock = BigInt(blockData.result);

        // Use a larger range and chunk size for RPC fallback to minimize requests
        const MAX_SCAN_BLOCKS = 1000n;
        const startBlock = currentBlock > MAX_SCAN_BLOCKS ? currentBlock - MAX_SCAN_BLOCKS : 0n;
        const CHUNK_SIZE = 100n; // Larger chunks to reduce request count

        // Event signatures from config
        const commitmentEventSig = EVENTS.newCommitment;
        const purchaseEventSig = EVENTS.tokensPurchased;

        for (let fromBlock = startBlock; fromBlock < currentBlock; fromBlock += CHUNK_SIZE) {
          const toBlock = fromBlock + CHUNK_SIZE - 1n > currentBlock ? currentBlock : fromBlock + CHUNK_SIZE - 1n;

          // Fetch NewCommitment events
          const commitmentRes = await fetch(RPC_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              jsonrpc: '2.0',
              method: 'eth_getLogs',
              params: [{
                address: pairAddress,
                topics: [commitmentEventSig],
                fromBlock: '0x' + fromBlock.toString(16),
                toBlock: '0x' + toBlock.toString(16),
              }],
              id: 2,
            }),
          });
          const cData = await commitmentRes.json();
          if (cData.result) commitmentLogs.push(...cData.result);

          // Fetch TokensPurchased events
          const purchaseRes = await fetch(RPC_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              jsonrpc: '2.0',
              method: 'eth_getLogs',
              params: [{
                address: zkAMMAddress,
                topics: [purchaseEventSig],
                fromBlock: '0x' + fromBlock.toString(16),
                toBlock: '0x' + toBlock.toString(16),
              }],
              id: 3,
            }),
          });
          const pData = await purchaseRes.json();
          if (pData.result) purchaseLogs.push(...pData.result);

          if (cData.error || pData.error) {
            console.warn('[usePrivateWallet] RPC limit hit during scan fallback');
            break;
          }
        }
      }

      // Create a map of txHash -> tokensOut
      const txAmounts: Record<string, bigint> = {};
      for (const log of purchaseLogs) {
        // Decode: ethIn (uint256), tokensOut (uint256)
        const data = log.data.slice(2);
        const tokensOut = BigInt('0x' + data.slice(64, 128));
        txAmounts[log.transactionHash] = tokensOut;
        dbg(`[usePrivateWallet] Purchase tx ${log.transactionHash.slice(0, 10)}: ${Number(tokensOut) / 1e18} tokens`);
      }
      dbg(`[usePrivateWallet] Found ${Object.keys(txAmounts).length} purchases to correlate`)

      // Get current state for processing (needed for existing secrets lookup)
      // Use stateRef to get latest state without adding to dependencies
      const currentState = stateRef.current;

      // Create a map of existing commitments with secrets AND amounts
      // Key by BOTH decimal string (from storeCommitment) and hex string (from on-chain)
      // CRITICAL: Store amount too! Without this, scan() would lose the correct amount
      const existingSecrets: Record<string, { nullifier?: string; secret?: string; spent?: boolean; amount?: string }> = {};
      for (const c of currentState.commitments) {
        if (c.nullifier && c.secret) {
          const secretData = {
            nullifier: c.nullifier,
            secret: c.secret,
            spent: c.spent,
            amount: c.amount, // CRITICAL: Preserve the amount that was used to create the commitment
          };

          // Store by original format (could be decimal or hex)
          existingSecrets[c.commitment.toLowerCase()] = secretData;

          // If it's a decimal string, also store as hex (padded to 64 chars)
          if (!c.commitment.startsWith('0x')) {
            try {
              const hexValue = '0x' + BigInt(c.commitment).toString(16).padStart(64, '0');
              existingSecrets[hexValue.toLowerCase()] = secretData;
              // Also store decimal string directly for lookup
              existingSecrets[c.commitment] = secretData;
            } catch { /* ignore conversion errors */ }
          } else {
            // If it's hex, also store as decimal
            try {
              const decimalValue = BigInt(c.commitment).toString();
              existingSecrets[decimalValue] = secretData;
            } catch { /* ignore conversion errors */ }
          }

          dbg(`[usePrivateWallet] Indexed commitment secrets for leafIndex ${c.leafIndex}, amount: ${c.amount}`);
        }
      }

      // Convert viewing key (hex string) to bytes for decryption
      // seedPhrase is actually the viewing key hex from wallet signature
      const viewingKeyBytes = seedPhrase.startsWith('0x')
        ? getBytes(seedPhrase)
        : getBytes('0x' + seedPhrase);

      // Process commitments and try to decrypt notes (async)
      const foundCommitments: Commitment[] = [];
      for (const log of commitmentLogs) {
        // topics[1] = commitment, topics[2] = leafIndex
        const commitment = log.topics[1];
        const leafIndex = Number(BigInt(log.topics[2] || '0'));
        const encryptedNote = log.data; // The encrypted note from event
        let amount = txAmounts[log.transactionHash] || 0n;

        // Preserve secrets if we have them stored locally
        // Try multiple lookup formats: hex and decimal
        // IMPORTANT: Do NOT use leafIndex as a fallback! This causes data corruption
        // if an old commitment was stored with wrong leafIndex.
        const commitmentDecimal = BigInt(commitment).toString();
        let existingData = existingSecrets[commitment.toLowerCase()] ||
          existingSecrets[commitmentDecimal];

        // Only use leafIndex fallback if the commitment hash matches
        if (!existingData) {
          const byLeafIndex = currentState.commitments.find(c => c.leafIndex === leafIndex && c.nullifier && c.secret);
          if (byLeafIndex) {
            // Verify the commitment hash matches before using this data
            const storedCommitmentDecimal = byLeafIndex.commitment.startsWith('0x')
              ? BigInt(byLeafIndex.commitment).toString()
              : byLeafIndex.commitment;
            if (storedCommitmentDecimal === commitmentDecimal) {
              existingData = {
                nullifier: byLeafIndex.nullifier,
                secret: byLeafIndex.secret,
                spent: byLeafIndex.spent,
                amount: byLeafIndex.amount,
              };
              dbg(`[usePrivateWallet] Found matching secrets by leafIndex ${leafIndex}`);
            } else {
              console.warn(`[usePrivateWallet] leafIndex ${leafIndex} has different commitment hash, ignoring stored secrets`);
            }
          }
        }

        // CRITICAL: If we have stored amount from existingData, use it!
        // This is the amount that was used to create the commitment hash.
        // Without this, scan() would corrupt the amount and break proof generation.
        if (existingData?.amount) {
          amount = BigInt(existingData.amount);
          dbg(`[usePrivateWallet] Using stored amount for leafIndex ${leafIndex}: ${amount.toString()}`);
        }

        // Always try to decrypt the encrypted note to get/verify the correct amount
        // This fixes issues where stored amount differs from actual on-chain amount
        if (encryptedNote && encryptedNote.length >= 314) {
          // 157 bytes hex = 314 chars (proper ECDH+AES-GCM encrypted note)
          dbg(`[usePrivateWallet] Attempting to decrypt note for leafIndex ${leafIndex}, note length: ${encryptedNote.length}`);
          try {
            const decrypted = await decryptNote(encryptedNote, viewingKeyBytes);
            if (decrypted) {
              // Success! We own this commitment and recovered the secrets
              const amountChanged = existingData?.amount && existingData.amount !== decrypted.amount.toString();

              dbg(`[usePrivateWallet] ✅ DECRYPTION SUCCESS for leafIndex ${leafIndex}!`);
              dbg(`[usePrivateWallet]   Recovered amount: ${decrypted.amount.toString()}`);
              if (amountChanged) {
                dbg(`[usePrivateWallet]   ⚠️ AMOUNT CORRECTED: was ${existingData?.amount}, now ${decrypted.amount.toString()}`);
              }
              dbg(`[usePrivateWallet]   Recovered nullifier: ${decrypted.nullifier.toString().slice(0, 30)}...`);

              // Pre-compute nullifier hash for debugging
              const precomputedHash = hashNullifier(decrypted.nullifier, leafIndex);
              dbg(`[usePrivateWallet]   Precomputed nullifierHash: ${precomputedHash.toString().slice(0, 30)}...`);

              existingData = {
                nullifier: decrypted.nullifier.toString(),
                secret: decrypted.secret.toString(),
                spent: existingData?.spent || false,
                amount: decrypted.amount.toString(), // Always use decrypted amount (authoritative)
              };
              amount = decrypted.amount; // Use amount from decrypted note (authoritative source)
            }
          } catch (decryptError) {
            // Decryption failed - this commitment doesn't belong to us (expected for others' commitments)
            if (!existingData?.nullifier) {
              dbg(`[usePrivateWallet] ❌ Decryption failed for leafIndex ${leafIndex}: ${(decryptError as Error).message}`);
            } else {
              dbg(`[usePrivateWallet] Using existing secrets for leafIndex ${leafIndex} (decrypt failed but have local data)`);
            }
          }
        } else if (existingData?.nullifier) {
          dbg(`[usePrivateWallet] Using existing secrets for leafIndex ${leafIndex} (no encrypted note to verify)`);
        } else {
          dbg(`[usePrivateWallet] No secrets and no/short encrypted note for leafIndex ${leafIndex}, note length: ${encryptedNote?.length || 0}`);
        }

        // SECURITY: Don't log secrets - was revealing private commitment ownership

        // Check if this commitment was already spent on-chain by computing its nullifierHash
        let isSpentOnChain = false;
        if (existingData?.nullifier && spentNullifiers.size > 0) {
          try {
            const nullifierBigInt = BigInt(existingData.nullifier);
            const computedNullifierHash = hashNullifier(nullifierBigInt, leafIndex);
            const hashString = computedNullifierHash.toString();
            isSpentOnChain = spentNullifiers.has(hashString);
            // Debug: Log nullifier check for troubleshooting
            dbg(`[usePrivateWallet] Nullifier check for leafIndex ${leafIndex}: hash=${hashString.slice(0, 20)}... spent=${isSpentOnChain}`);
          } catch (err) {
            console.error(`[usePrivateWallet] Failed to compute nullifier hash for leafIndex ${leafIndex}:`, err);
          }
        }

        // Only add commitments we OWN (have secrets for) AND where secrets are valid
        // This prevents showing other users' commitments in our balance
        // AND filters out corrupted local data where secrets don't match
        if (existingData?.nullifier && existingData?.secret) {
          // CRITICAL: Verify the secrets produce the correct commitment hash
          // This catches corrupted local data before it causes proof failures
          const onChainCommitmentBigInt = BigInt(commitment);
          const computedCommitment = hashCommitment(
            BigInt(existingData.nullifier),
            BigInt(existingData.secret),
            amount
          );

          if (computedCommitment === onChainCommitmentBigInt) {
            foundCommitments.push({
              commitment: commitment,
              amount: amount.toString(),
              leafIndex,
              blockNumber: Number(BigInt(log.blockNumber)),
              spent: existingData?.spent || isSpentOnChain,
              address: (log.address || pairAddress).toLowerCase(),
              nullifier: existingData.nullifier,
              secret: existingData.secret,
            });
          } else {
            console.warn(`[usePrivateWallet] ⚠️ DISCARDING corrupted commitment at leafIndex ${leafIndex}:`);
            console.warn(`[usePrivateWallet]   On-chain: ${onChainCommitmentBigInt.toString().slice(0, 30)}...`);
            console.warn(`[usePrivateWallet]   Computed: ${computedCommitment.toString().slice(0, 30)}...`);
            console.warn(`[usePrivateWallet]   The stored secrets do not produce the correct hash. This commitment will be removed from local storage.`);
          }
        }
      }

      // Build set of valid on-chain commitment hashes for validation
      const onChainCommitmentHashes = new Set<string>();
      for (const log of commitmentLogs) {
        const commitmentDecimal = BigInt(log.topics[1]).toString();
        onChainCommitmentHashes.add(commitmentDecimal);
      }
      const maxOnChainLeafIndex = commitmentLogs.length > 0
        ? Math.max(...commitmentLogs.map(log => Number(BigInt(log.topics[2] || '0'))))
        : -1;
      dbg(`[usePrivateWallet] On-chain validation: ${onChainCommitmentHashes.size} commitments, max leafIndex: ${maxOnChainLeafIndex}`);

      // SAFEGUARD: Don't wipe local data if Ponder/RPC appears to be empty (likely still syncing)
      const localCommitmentsWithSecrets = currentState.commitments.filter(c => c.nullifier && c.secret);
      if (commitmentLogs.length === 0 && localCommitmentsWithSecrets.length > 0) {
        // Before assuming "indexer lagging, keep local data", ask the chain directly: is the
        // tree ACTUALLY empty? If tokenPool.nextIndex()==0 there are provably zero commitments
        // on this pool, so every local note is a PHANTOM (failed buy / retired deployment) —
        // clear them so the wallet doesn't show un-sellable R00T. Only keep-and-wait if we
        // genuinely can't tell (RPC read failed).
        let emptyOnChain = false;
        try {
          const tp = CONTRACTS.tokenPool as string;
          if (tp && tp !== '0x...') {
            const r = await fetch(NETWORK.rpcUrl, {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to: tp, data: '0xfc7e9c6f' /* nextIndex() */ }, 'latest'] }),
            });
            const j = await r.json();
            if (j?.result && j.result !== '0x') emptyOnChain = Number(BigInt(j.result)) === 0;
          }
        } catch { /* unknown */ }

        if (emptyOnChain) {
          console.warn(`[usePrivateWallet] On-chain tree is EMPTY (nextIndex=0) — clearing ${localCommitmentsWithSecrets.length} phantom local note(s) that can never be spent here.`);
          setState((s) => ({ ...s, commitments: [], balance: 0n, isScanning: false }));
          return;
        }
        console.warn(`[usePrivateWallet] ⚠️ Ponder/RPC returned 0 commitments but we have ${localCommitmentsWithSecrets.length} locally and the on-chain tree is non-empty/unknown. Indexer may be syncing - keeping local data.`);
        setState((s) => ({ ...s, isScanning: false }));
        return;
      }

      // CRITICAL: Preserve local commitments with secrets that aren't yet found on-chain.
      // The indexer may lag behind the chain, so a recently-stored commitment from a buy
      // might not appear in the on-chain set yet. Discarding it would cause permanent data loss
      // (especially since encrypted notes on-chain are empty and can't be used for recovery).
      //
      // HOWEVER: If the leaf index is occupied by a DIFFERENT on-chain commitment,
      // the local data is stale (e.g., from a previous deployment) and must be removed.
      const foundCommitmentHashes = new Set(foundCommitments.map(c => BigInt(c.commitment).toString()));

      // Build map: leafIndex -> on-chain commitment hash (to detect stale data)
      const onChainLeafToCommitment = new Map<number, string>();
      for (const log of commitmentLogs) {
        const leafIdx = Number(BigInt(log.topics[2] || '0'));
        const commitHash = BigInt(log.topics[1]).toString();
        onChainLeafToCommitment.set(leafIdx, commitHash);
      }

      // Authoritative on-chain tree size. A REAL note always has leafIndex < nextIndex
      // (the contract assigns the index when it inserts the commitment), so any local note
      // whose leafIndex >= nextIndex provably never landed on-chain — it's a PHANTOM from a
      // failed buy (saved before the receipt-status gate) or a retired deployment. Drop those
      // instead of "preserving" them forever. -1 = couldn't read → fall back to old behavior.
      let onChainNextIndex = -1;
      try {
        const tp = CONTRACTS.tokenPool as string;
        if (tp && tp !== '0x...') {
          const r = await fetch(NETWORK.rpcUrl, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to: tp, data: '0xfc7e9c6f' /* nextIndex() */ }, 'latest'] }),
          });
          const j = await r.json();
          if (j?.result && j.result !== '0x') onChainNextIndex = Number(BigInt(j.result));
        }
      } catch { /* unknown — don't prune */ }

      const preservedLocal: typeof foundCommitments = [];
      for (const c of localCommitmentsWithSecrets) {
        const localHash = c.commitment.startsWith('0x')
          ? BigInt(c.commitment).toString()
          : c.commitment;
        if (!foundCommitmentHashes.has(localHash)) {
          // PHANTOM guard: leaf provably beyond the on-chain tree → the buy never landed.
          if (onChainNextIndex >= 0 && c.leafIndex >= onChainNextIndex) {
            console.warn(`[usePrivateWallet] ⚠️ REMOVING phantom local commitment at leafIndex ${c.leafIndex} — beyond on-chain tree size ${onChainNextIndex} (failed buy or retired deployment)`);
            continue;
          }
          // Check if this leaf index is occupied by a different on-chain commitment
          const onChainHash = onChainLeafToCommitment.get(c.leafIndex);
          if (onChainHash && onChainHash !== localHash) {
            console.warn(`[usePrivateWallet] ⚠️ REMOVING stale local commitment at leafIndex ${c.leafIndex} — leaf is occupied by a different on-chain commitment (deployment changed)`);
            continue; // Don't preserve — this is stale data
          }
          console.warn(`[usePrivateWallet] ⚠️ Preserving local commitment at leafIndex ${c.leafIndex} (not yet found on-chain - indexer may be lagging)`);
          preservedLocal.push(c);
        }
      }
      if (preservedLocal.length > 0) {
        dbg(`[usePrivateWallet] Preserved ${preservedLocal.length} local commitment(s) not yet indexed on-chain`);
      }

      const allCommitments = [...foundCommitments, ...preservedLocal].sort((a, b) => a.leafIndex - b.leafIndex);

      // Log what commitments were removed (existed locally but not found on-chain AND had no secrets)
      const allCommitmentLeafIndices = new Set(allCommitments.map(c => c.leafIndex));
      for (const c of currentState.commitments) {
        if (!allCommitmentLeafIndices.has(c.leafIndex) && !c.nullifier && !c.secret) {
          console.warn(`[usePrivateWallet] Removing stale commitment at leafIndex ${c.leafIndex} (not found on-chain and no secrets)`);
        }
      }

      // Debug: Log what we're saving
      dbg(`[usePrivateWallet] Scan complete. Saving ${allCommitments.length} commitments:`);
      for (const c of allCommitments) {
        dbg(`[usePrivateWallet]   leafIndex ${c.leafIndex}: amount=${BigInt(c.amount) / BigInt(1e18)}M, spent=${c.spent}, hasSecrets=${!!c.nullifier && !!c.secret}`);
      }

      // Calculate total balance from all commitments
      const totalBalance = allCommitments
        .filter((c) => !c.spent)
        .reduce((sum, c) => sum + BigInt(c.amount), 0n);

      // Update state with merged commitments
      setState((s) => ({
        ...s,
        commitments: allCommitments,
        balance: totalBalance,
        lastScannedBlock: Number(currentBlock),
        isScanning: false,
      }));
    } catch (err) {
      console.error('Scan failed:', err);
      setState((s) => ({ ...s, isScanning: false }));
    }
  }, [zkAMMAddress, pairAddress, seedPhrase]);

  // Add commitment (called after buy)
  const addCommitment = useCallback(
    (commitment: string, amount: bigint, leafIndex: number, blockNumber: number) => {
      setState((s) => ({
        ...s,
        balance: s.balance + amount,
        commitments: [
          ...s.commitments,
          {
            commitment,
            amount: amount.toString(),
            leafIndex,
            blockNumber,
            spent: false,
            address: pairAddress.toLowerCase(),
          },
        ],
      }));
    },
    [pairAddress]
  );

  // Mark commitment as spent (called after sell/transfer)
  const spendCommitment = useCallback((commitment: string) => {
    dbg(`[usePrivateWallet] Marking commitment as spent: ${commitment.slice(0, 20)}...`);
    setState((s) => {
      const updated = s.commitments.map((c) =>
        c.commitment === commitment ? { ...c, spent: true } : c
      );
      const newBalance = updated
        .filter((c) => !c.spent)
        .reduce((sum, c) => sum + BigInt(c.amount), 0n);
      return { ...s, commitments: updated, balance: newBalance };
    });
  }, []);

  // Forcefully remove a commitment (used for stale data cleanup)
  // Unlike spendCommitment, this completely removes from storage
  const removeCommitment = useCallback((commitment: string) => {
    dbg(`[usePrivateWallet] REMOVING stale commitment: ${commitment.slice(0, 20)}...`);
    setState((s) => {
      const filtered = s.commitments.filter((c) => c.commitment !== commitment);
      const newBalance = filtered
        .filter((c) => !c.spent)
        .reduce((sum, c) => sum + BigInt(c.amount), 0n);

      // Immediately persist the removal
      if (s.publicKey) {
        const toSave = {
          balance: newBalance.toString(),
          commitments: filtered,
          lastScannedBlock: s.lastScannedBlock,
        };
        const storageKey = getStorageKey(s.publicKey);
        localStorage.setItem(storageKey, JSON.stringify(toSave));
        dbg(`[usePrivateWallet] Persisted removal. Remaining: ${filtered.length} commitments`);
      }

      return { ...s, commitments: filtered, balance: newBalance };
    });
  }, [getStorageKey]);

  // Create a new commitment for buying (generates nullifier/secret and stores them)
  const createBuyCommitment = useCallback(
    (amount: bigint): {
      commitment: bigint;
      nullifier: bigint;
      secret: bigint;
    } => {
      const { commitment, nullifier, secret } = createCommitment(amount);
      return { commitment, nullifier, secret };
    },
    []
  );

  // Store commitment after successful buy - saves IMMEDIATELY to prevent data loss
  const storeCommitment = useCallback(
    (
      commitmentHash: bigint,
      nullifier: bigint,
      secret: bigint,
      amount: bigint,
      leafIndex: number,
      blockNumber: number
    ) => {
      setState((s) => {
        const newState = {
          ...s,
          balance: s.balance + amount,
          commitments: [
            ...s.commitments,
            {
              commitment: commitmentHash.toString(),
              nullifier: nullifier.toString(),
              secret: secret.toString(),
              amount: amount.toString(),
              leafIndex,
              blockNumber,
              spent: false,
              address: pairAddress.toLowerCase(), // Use pair address where commitments are stored
            },
          ],
        };

        // CRITICAL: Save immediately after adding commitment (don't wait for debounce)
        if (newState.publicKey) {
          const toSave = {
            balance: newState.balance.toString(),
            commitments: newState.commitments,
            lastScannedBlock: newState.lastScannedBlock,
          };
          const storageKey = getStorageKey(newState.publicKey);
          localStorage.setItem(storageKey, JSON.stringify(toSave));
          dbg(`[usePrivateWallet] Immediately saved commitment! Total: ${newState.commitments.length} (key: ${storageKey})`);
        }

        return newState;
      });
    },
    [pairAddress, getStorageKey]
  );

  // Get all commitment hashes (for building merkle tree)
  // Note: This returns local commitments only - use fetchAllOnChainCommitments for merkle tree
  const getAllCommitmentHashes = useCallback((): bigint[] => {
    return state.commitments.map((c) => BigInt(c.commitment));
  }, [state.commitments]);

  // Return type for fetchAllOnChainCommitments - includes optional pre-computed tree state
  type CommitmentsResult = {
    commitments: { commitment: bigint; leafIndex: number }[];
    // Pre-computed tree state from indexer (if available) - avoids expensive recomputation
    treeState?: {
      filledSubtrees: bigint[];
      root: bigint;
    };
  };

  // Fetch ALL on-chain commitments for building merkle tree (needed for ZK proofs)
  // OPTIMIZATION: First tries to fetch pre-built tree state from Ponder (instant)
  // Falls back to paginated commitments fetch if tree state unavailable
  const fetchAllOnChainCommitments = useCallback(async (targetAddress?: string): Promise<CommitmentsResult> => {
    // CRITICAL FIX: Always use pairAddress for Ponder/RPC if available, as that's where commitments are.
    // targetAddress might be the Router, which Ponder doesn't index for commitments.
    const addressToUse = pairAddress || targetAddress;
    dbg(`[fetchAllOnChainCommitments] Fetching for ${addressToUse} (pairAddress: ${pairAddress}, targetAddress: ${targetAddress}, indexerUrl: ${NETWORK.indexerUrl})`);

    if (!addressToUse || addressToUse === '0x...') {
      console.error(`[fetchAllOnChainCommitments] No valid address! pairAddress=${pairAddress}, targetAddress=${targetAddress}`);
      return { commitments: [] };
    }

    const addressLower = addressToUse.toLowerCase();
    const ZERO_VALUE = 21663839004416932945382355908790599225266501822907911457504978515578255421292n;

    // Authoritative on-chain leaf count. Used to detect a stale/backfilling indexer so we
    // never build a merkle tree that's missing the newest leaf. -1 = couldn't determine
    // (RPC hiccup) → don't block, trust the indexer as before.
    let onChainNextIndex = -1;
    try {
      const tokenPoolAddr = CONTRACTS.tokenPool as string;
      if (tokenPoolAddr && tokenPoolAddr !== '0x...') {
        const res = await fetch(NETWORK.rpcUrl, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call',
            params: [{ to: tokenPoolAddr, data: '0xfc7e9c6f' /* nextIndex() */ }, 'latest'] }),
        });
        const j = await res.json();
        if (j?.result && j.result !== '0x') onChainNextIndex = Number(BigInt(j.result));
      }
    } catch { /* unknown — proceed without the guard */ }

    // FAST PATH: Try to fetch pre-built Merkle tree state from Ponder
    // This is MUCH faster than rebuilding from individual commitments
    interface MerkleTreeStateResponse {
      merkleTreeStates: {
        items: Array<{
          id: string;
          nextIndex: string;
          currentRoot: string;
          filledSubtrees: string; // JSON array
          leaves: string; // JSON array
          updatedAt: string;
        }>;
      };
    }

    try {
      dbg(`[fetchAllOnChainCommitments] Trying fast path: fetching pre-built tree state for ${addressLower}...`);
      const treeState = await queryPonder<MerkleTreeStateResponse>(MERKLE_TREE_STATE_QUERY, {
        address: addressLower
      });

      dbg(`[fetchAllOnChainCommitments] Fast path response:`, treeState ? `got ${treeState.merkleTreeStates?.items?.length || 0} items` : 'null (queryPonder failed)');

      if (treeState?.merkleTreeStates?.items?.length) {
        const treeData = treeState.merkleTreeStates.items[0];
        const leaves: string[] = JSON.parse(treeData.leaves);
        const filledSubtrees: string[] = JSON.parse(treeData.filledSubtrees);

        // STALENESS GUARD: the indexer may be mid-backfill (cold start) or briefly behind
        // after a crash/restart. A partial tree is WORSE than no tree — it silently omits
        // the newest leaf, so whoever holds the latest commitment builds a wrong merkle
        // proof and their sell reverts. If the indexer's leaf count is behind the
        // authoritative on-chain nextIndex, discard the fast path and rebuild from chain.
        if (onChainNextIndex >= 0 && leaves.length < onChainNextIndex) {
          dbg(`[fetchAllOnChainCommitments] Indexer STALE (${leaves.length} leaves < on-chain ${onChainNextIndex}). Skipping fast path, rebuilding from chain.`);
        } else {
          dbg(`[fetchAllOnChainCommitments] FAST PATH SUCCESS: Got ${leaves.length} leaves + pre-computed tree state (on-chain nextIndex: ${onChainNextIndex})`);
          return {
            commitments: leaves.map((leaf, i) => ({
              commitment: BigInt(leaf),
              leafIndex: i
            })),
            treeState: {
              filledSubtrees: filledSubtrees.map(s => BigInt(s)),
              root: BigInt(treeData.currentRoot)
            }
          };
        }
      } else {
        dbg(`[fetchAllOnChainCommitments] No pre-built tree state found, falling back to paginated fetch...`);
      }
    } catch (treeErr) {
      console.error(`[fetchAllOnChainCommitments] Tree state fetch FAILED:`, treeErr);
    }

    // SLOW PATH: Fetch individual commitments with pagination
    interface PonderCommitmentItem {
      commitment: string;
      leafIndex: string; // Ponder returns BigInt as string!
      address?: string;
    }
    interface CommitmentsQueryResponse {
      commitmentss: { items: PonderCommitmentItem[] };
    }

    try {
      // Fetch commitments with pagination (1000 at a time)
      let allPonderCommitments: PonderCommitmentItem[] = [];
      let afterLeafIndex = 0n;
      let hasMore = true;
      const PAGE_SIZE = 1000;
      const MAX_PAGES = 20; // Safety limit to prevent infinite loops
      let pageCount = 0;

      dbg(`[fetchAllOnChainCommitments] Starting paginated fetch for ${addressLower}...`);
      while (hasMore && pageCount < MAX_PAGES) {
        pageCount++;
        const page = await queryPonder<CommitmentsQueryResponse>(COMMITMENTS_QUERY_PAGINATED, {
          limit: PAGE_SIZE,
          afterLeafIndex: afterLeafIndex.toString(),
          address: addressLower
        });

        if (!page) {
          console.error(`[fetchAllOnChainCommitments] Page ${pageCount}: queryPonder returned null (network/GraphQL error). Check browser console for details.`);
          hasMore = false;
        } else if (page?.commitmentss?.items?.length) {
          allPonderCommitments.push(...page.commitmentss.items);
          const lastItem = page.commitmentss.items[page.commitmentss.items.length - 1];
          afterLeafIndex = BigInt(lastItem.leafIndex) + 1n;
          dbg(`[fetchAllOnChainCommitments] Page ${pageCount}: ${page.commitmentss.items.length} items (total: ${allPonderCommitments.length}, nextLeafIndex: ${afterLeafIndex})`);

          if (page.commitmentss.items.length < PAGE_SIZE) {
            hasMore = false;
          }
        } else {
          dbg(`[fetchAllOnChainCommitments] Page ${pageCount}: empty items array, stopping pagination`);
          hasMore = false;
        }
      }

      if (pageCount >= MAX_PAGES) {
        console.warn(`[fetchAllOnChainCommitments] Hit MAX_PAGES limit (${MAX_PAGES}), may have missed some commitments`);
      }

      // Same staleness guard as the fast path: if the indexer returned fewer leaves than
      // the on-chain tree has, it's mid-backfill — don't trust it, fall through to getLogs.
      const ponderLeafCount = allPonderCommitments.length > 0
        ? allPonderCommitments.reduce((max, c) => Math.max(max, parseInt(c.leafIndex, 10)), 0) + 1
        : 0;
      const ponderStale = onChainNextIndex >= 0 && ponderLeafCount < onChainNextIndex;
      if (ponderStale) {
        dbg(`[fetchAllOnChainCommitments] Slow path indexer STALE (${ponderLeafCount} leaves < on-chain ${onChainNextIndex}). Rebuilding from chain.`);
      }

      if (allPonderCommitments.length > 0 && !ponderStale) {
        dbg(`[fetchAllOnChainCommitments] Using Ponder: ${allPonderCommitments.length} commitments for ${addressLower}`);

        const maxLeafIndex = allPonderCommitments.reduce((max, c) => Math.max(max, parseInt(c.leafIndex, 10)), 0);

        const result: { commitment: bigint; leafIndex: number }[] = [];
        const commitmentMap = new Map<number, string>();
        for (const c of allPonderCommitments) {
          commitmentMap.set(parseInt(c.leafIndex, 10), c.commitment);
        }

        for (let i = 0; i <= maxLeafIndex; i++) {
          const commitment = commitmentMap.get(i);
          result.push({
            commitment: commitment ? BigInt(commitment) : ZERO_VALUE,
            leafIndex: i
          });
        }

        dbg(`[fetchAllOnChainCommitments] Built commitment array: ${result.length} entries (maxLeafIndex: ${maxLeafIndex}, commitments fetched: ${allPonderCommitments.length})`);
        // No pre-computed tree state available in slow path - will need to rebuild
        return { commitments: result };
      } else {
        console.warn(`[fetchAllOnChainCommitments] No commitments found from Ponder for ${addressLower}`);
      }
    } catch (ponderErr) {
      console.error('[fetchAllOnChainCommitments] Ponder commitments query failed:', ponderErr);
    }

    // Fallback to RPC pagination
    const RPC_URL = NETWORK.rpcUrl;
    const commitmentEventSig = EVENTS.newCommitment;

    try {
      // Get current block number first
      const blockRes = await fetch(RPC_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', method: 'eth_blockNumber', params: [], id: 0 }),
      });
      const blockData = await blockRes.json();
      const currentBlock = BigInt(blockData.result);

      let allLogs: Array<{ topics: string[] }> = [];

      // TRUSTLESS FALLBACK: rebuild the FULL tree straight from chain when the indexer is
      // down (localhost unreachable on prod, or crashed). Robinhood Chain (~0.1s blocks) has
      // the commitments ~600k blocks back, so the old "last 10k blocks" window missed them.
      // The RH/Alchemy RPC handles a wide getLogs range in ONE call, so try that first.
      const startBlock = DEX_DEPLOY_BLOCK > 0n ? DEX_DEPLOY_BLOCK : 0n;
      console.warn(`[fetchAllOnChainCommitments] Indexer unavailable for ${addressToUse}. Rebuilding tree from chain (blocks ${startBlock}→latest).`);

      const single = await fetch(RPC_URL, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', method: 'eth_getLogs', id: 1, params: [{
          address: addressToUse, topics: [commitmentEventSig],
          fromBlock: '0x' + startBlock.toString(16), toBlock: 'latest',
        }] }),
      });
      const singleData = await single.json();
      if (!singleData.error && Array.isArray(singleData.result)) {
        allLogs = singleData.result;
      } else {
        // Provider rejected the wide range — fall back to chunked scan.
        console.warn('[fetchAllOnChainCommitments] wide getLogs rejected, chunking:', singleData.error);
        const CHUNK_SIZE = 50000n;
        for (let fromBlock = startBlock; fromBlock < currentBlock; fromBlock += CHUNK_SIZE) {
          const toBlock = fromBlock + CHUNK_SIZE - 1n > currentBlock ? currentBlock : fromBlock + CHUNK_SIZE - 1n;
          const res = await fetch(RPC_URL, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ jsonrpc: '2.0', method: 'eth_getLogs', id: 1, params: [{
              address: addressToUse, topics: [commitmentEventSig],
              fromBlock: '0x' + fromBlock.toString(16), toBlock: '0x' + toBlock.toString(16),
            }] }),
          });
          const data = await res.json();
          if (data.error) { console.error('[fetchAllOnChainCommitments] RPC error:', data.error); break; }
          allLogs.push(...(data.result || []));
        }
      }

      // Parse logs to commitments with indices
      const commitments = allLogs.map((log) => ({
        leafIndex: Number(BigInt(log.topics[2] || '0')),
        commitment: BigInt(log.topics[1]),
      }));

      // Sort by leafIndex to be safe
      commitments.sort((a, b) => a.leafIndex - b.leafIndex);

      dbg(`[fetchAllOnChainCommitments] RPC fallback found ${commitments.length} commitments`);
      // No pre-computed tree state in RPC fallback
      return { commitments };
    } catch (err) {
      console.error('[fetchAllOnChainCommitments] Error:', err);
      throw new Error(`Failed to fetch commitments: ${(err as Error).message}`);
    }
  }, [pairAddress]);

  // Store scan function in ref to prevent effect recreation
  const scanRef = useRef(scan);
  scanRef.current = scan;

  // Auto-scan when viewing key becomes available
  const hasScanedRef = useRef(false);
  useEffect(() => {
    if (seedPhrase && zkAMMAddress && zkAMMAddress !== '0x...' && !hasScanedRef.current) {
      hasScanedRef.current = true;
      dbg('[usePrivateWallet] Auto-scanning for commitments...');
      scanRef.current();
    }
  }, [seedPhrase, zkAMMAddress]); // Removed scan from deps - using ref instead

  // Reset wallet state (clear local storage and rescan)
  const resetWallet = useCallback(() => {
    if (state.publicKey) {
      const storageKey = getStorageKey(state.publicKey);
      dbg(`[usePrivateWallet] === NUCLEAR WALLET RESET ===`);
      dbg(`[usePrivateWallet] Storage key: ${storageKey}`);

      // DEBUG: Log what we're clearing
      const oldData = localStorage.getItem(storageKey);
      if (oldData) {
        try {
          const parsed = JSON.parse(oldData);
          dbg(`[usePrivateWallet] CLEARING ${parsed.commitments?.length || 0} commitments:`);
          parsed.commitments?.forEach((c: any) => {
            dbg(`[usePrivateWallet]   leafIndex ${c.leafIndex}: amount=${c.amount}, spent=${c.spent}, commitment=${c.commitment?.slice(0, 20)}...`);
          });
        } catch { /* ignore */ }
      }

      // Clear ALL r00t-related localStorage keys (also cleans legacy hidemycoin keys)
      const allKeys = Object.keys(localStorage);
      dbg(`[usePrivateWallet] Checking ${allKeys.length} localStorage keys...`);

      allKeys.forEach(k => {
        if (k.includes('r00t_') || k.includes('hidemycoin') || k.includes('wallet_state') || k.includes('lp_positions') || k.includes('shielded_balance')) {
          dbg(`[usePrivateWallet] REMOVING localStorage key: ${k}`);
          localStorage.removeItem(k);
        }
      });

      // Also clear sessionStorage
      const sessionKeys = Object.keys(sessionStorage);
      sessionKeys.forEach(k => {
        if (k.includes('r00t_') || k.includes('hidemycoin') || k.includes('wallet')) {
          dbg(`[usePrivateWallet] REMOVING sessionStorage key: ${k}`);
          sessionStorage.removeItem(k);
        }
      });

      dbg(`[usePrivateWallet] Setting state to empty...`);
      setState(s => ({
        ...s,
        balance: 0n,
        commitments: [],
        lastScannedBlock: 0,
        isScanning: false
      }));

      dbg(`[usePrivateWallet] Reset complete. Will scan in 500ms...`);
      // Longer delay to ensure React state has propagated
      setTimeout(() => {
        dbg(`[usePrivateWallet] Starting post-reset scan...`);
        scan();
      }, 500);
    }
  }, [state.publicKey, scan, getStorageKey]);

  return {
    balance: state.balance,
    commitments: state.commitments.filter((c) => !c.spent),
    allCommitments: state.commitments,
    publicKey: state.publicKey,
    isScanning: state.isScanning,
    scan,
    addCommitment,
    spendCommitment,
    removeCommitment,
    createBuyCommitment,
    storeCommitment,
    getAllCommitmentHashes,
    fetchAllOnChainCommitments,
    resetWallet,
  };
}
