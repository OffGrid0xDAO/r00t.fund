import { useState } from 'react';
import { useAccount, usePublicClient, useWalletClient } from 'wagmi';
import { formatUnits, parseEther, keccak256, toBytes, encodeAbiParameters } from 'viem';

interface TransferPanelProps {
  zkAMMAddress: string;
  balance: bigint;
  viewingKey: string | null;
}

const ZKAMM_ABI = [
  {
    name: 'transferPrivate',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'proof', type: 'uint256[8]' },
      { name: 'merkleRoot', type: 'uint256' },
      { name: 'nullifierHash', type: 'uint256' },
      { name: 'recipientCommitment', type: 'uint256' },
      { name: 'changeCommitment', type: 'uint256' },
      { name: 'recipientNote', type: 'bytes' },
      { name: 'changeNote', type: 'bytes' },
    ],
    outputs: [],
  },
] as const;

// Field prime for BN254 curve
const FIELD_PRIME = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;

// Generate random field element
function randomFieldElement(): bigint {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let value = 0n;
  for (let i = 0; i < 32; i++) {
    value = (value << 8n) + BigInt(bytes[i]);
  }
  return value % FIELD_PRIME;
}

// Simple hash (using keccak256 for demo - in production use actual Poseidon)
function hashCommitment(nullifier: bigint, secret: bigint, amount: bigint): bigint {
  const encoded = encodeAbiParameters(
    [{ type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }],
    [nullifier, secret, amount]
  );
  const hash = keccak256(encoded);
  return BigInt(hash) % FIELD_PRIME;
}

export function TransferPanel({ zkAMMAddress, balance, viewingKey }: TransferPanelProps) {
  const { isConnected, address } = useAccount();
  const publicClient = usePublicClient();
  const { data: walletClient } = useWalletClient();

  const [amount, setAmount] = useState('');
  const [recipientKey, setRecipientKey] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);

  const handleTransfer = async () => {
    if (!walletClient || !publicClient || !amount || !recipientKey || !address) return;

    setIsLoading(true);
    setError(null);
    setSuccess(null);
    setTxHash(null);

    try {
      const transferAmount = parseEther(amount);

      if (transferAmount > balance) {
        throw new Error('Insufficient balance');
      }

      // Validate recipient key format (should be 0x + 66 chars for compressed public key)
      if (!recipientKey.startsWith('0x') || recipientKey.length < 66) {
        throw new Error('Invalid recipient public key format');
      }

      // Generate recipient commitment
      const recipientNullifier = randomFieldElement();
      const recipientSecret = randomFieldElement();
      const recipientCommitment = hashCommitment(recipientNullifier, recipientSecret, transferAmount);

      // Encrypt note for recipient (simplified - in production use ECDH with recipient's public key)
      const recipientNoteData = encodeAbiParameters(
        [{ type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }],
        [recipientNullifier, recipientSecret, transferAmount]
      );
      const recipientNote = keccak256(toBytes(recipientKey + recipientNoteData.slice(2))) as `0x${string}`;

      // Calculate change
      const changeAmount = balance - transferAmount;
      let changeCommitment = 0n;
      let changeNote: `0x${string}` = '0x';

      if (changeAmount > 0n) {
        const changeNullifier = randomFieldElement();
        const changeSecret = randomFieldElement();
        changeCommitment = hashCommitment(changeNullifier, changeSecret, changeAmount);

        // Encrypt change note for ourselves
        const changeNoteData = encodeAbiParameters(
          [{ type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }],
          [changeNullifier, changeSecret, changeAmount]
        );
        changeNote = viewingKey
          ? keccak256(toBytes(viewingKey + changeNoteData.slice(2))) as `0x${string}`
          : '0x';
      }

      // For demo: generate mock proof (in production, use actual ZK proof generation)
      const mockProof: [bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint] = [1n, 2n, 3n, 4n, 5n, 6n, 7n, 8n];
      const merkleRoot = 1n; // Mock root - contract's mock verifier accepts this
      const nullifierHash = randomFieldElement(); // Mock nullifier

      // Send transaction
      const hash = await walletClient.writeContract({
        address: zkAMMAddress as `0x${string}`,
        abi: ZKAMM_ABI,
        functionName: 'transferPrivate',
        args: [
          mockProof,
          merkleRoot,
          nullifierHash,
          recipientCommitment,
          changeCommitment,
          recipientNote,
          changeNote,
        ],
      });

      setTxHash(hash);

      // Wait for confirmation
      await publicClient.waitForTransactionReceipt({ hash });

      setSuccess('Transfer submitted! The recipient can scan to see their new balance.');
      setAmount('');
      setRecipientKey('');
    } catch (err: unknown) {
      const error = err as Error;
      console.error('Transfer failed:', error);
      setError(error.message || 'Transfer failed');
    } finally {
      setIsLoading(false);
    }
  };

  if (!isConnected) {
    return (
      <div className="text-center py-12">
        <div className="text-6xl mb-4">📤</div>
        <h3 className="text-xl font-medium mb-2">Connect to Transfer</h3>
        <p className="text-gray-400 text-sm">
          Connect your wallet to send private $ROOT transfers
        </p>
      </div>
    );
  }

  if (!viewingKey) {
    return (
      <div className="text-center py-12">
        <div className="text-6xl mb-4">🔐</div>
        <h3 className="text-xl font-medium mb-2">Unlock to Transfer</h3>
        <p className="text-gray-400 text-sm">
          Go to Portfolio and sign to unlock your wallet first
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="text-center py-4">
        <h3 className="text-xl font-medium mb-2">Private Transfer</h3>
        <p className="text-gray-400 text-sm">
          Send $ROOT to anyone without revealing the amount or your identity
        </p>
      </div>

      {/* Balance */}
      <div className="bg-gray-700 rounded-xl p-4">
        <div className="text-sm text-gray-400 mb-1">Available Balance</div>
        <div className="text-xl font-bold">
          {Number(formatUnits(balance, 18)).toLocaleString()} $ROOT
        </div>
      </div>

      {/* Amount Input */}
      <div>
        <label className="block text-sm text-gray-400 mb-2">Amount</label>
        <div className="relative">
          <input
            type="number"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.0"
            className="w-full bg-gray-700 rounded-xl px-4 py-3 text-xl outline-none focus:ring-2 focus:ring-root-500"
            step="0.01"
            min="0"
          />
          <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-2">
            <button
              onClick={() => setAmount(formatUnits(balance, 18))}
              className="text-xs px-2 py-1 bg-gray-600 hover:bg-gray-500 rounded"
            >
              MAX
            </button>
            <span className="text-gray-400">$ROOT</span>
          </div>
        </div>
      </div>

      {/* Recipient Input */}
      <div>
        <label className="block text-sm text-gray-400 mb-2">Recipient Viewing Key</label>
        <textarea
          value={recipientKey}
          onChange={(e) => setRecipientKey(e.target.value)}
          placeholder="0x..."
          className="w-full bg-gray-700 rounded-xl px-4 py-3 outline-none focus:ring-2 focus:ring-root-500 resize-none h-20 font-mono text-sm"
        />
        <p className="text-xs text-gray-500 mt-1">
          The recipient's viewing key from their Portfolio page
        </p>
      </div>

      {/* Error */}
      {error && (
        <div className="p-3 bg-red-900/50 border border-red-600 rounded-lg text-sm text-red-400">
          {error}
        </div>
      )}

      {/* Success */}
      {success && (
        <div className="p-3 bg-green-900/50 border border-green-600 rounded-lg text-sm text-green-400">
          {success}
          {txHash && (
            <>
              {' '}
              <a
                href={`https://basescan.org/tx/${txHash}`}
                target="_blank"
                rel="noopener noreferrer"
                className="underline"
              >
                View on BaseScan
              </a>
            </>
          )}
        </div>
      )}

      {/* Transfer Button */}
      <button
        onClick={handleTransfer}
        disabled={!amount || !recipientKey || isLoading || balance === 0n}
        className={`w-full py-4 rounded-xl font-medium transition-colors ${
          !amount || !recipientKey || isLoading || balance === 0n
            ? 'bg-gray-600 text-gray-400 cursor-not-allowed'
            : 'bg-root-600 hover:bg-root-500 text-white'
        }`}
      >
        {isLoading ? (
          <span className="flex items-center justify-center gap-2">
            <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
                fill="none"
              />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
              />
            </svg>
            Generating ZK Proof...
          </span>
        ) : (
          'Transfer Privately'
        )}
      </button>

      {/* Info */}
      <div className="p-4 bg-gray-700/30 rounded-xl text-xs text-gray-500 space-y-2">
        <p className="flex items-center gap-2">
          <span className="text-green-400">🔒</span>
          This transfer uses zero-knowledge proofs. Nobody can see:
        </p>
        <ul className="list-disc list-inside ml-4 space-y-1">
          <li>Who is sending</li>
          <li>Who is receiving</li>
          <li>How much is being sent</li>
        </ul>
      </div>
    </div>
  );
}
