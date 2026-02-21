import { useState } from 'react';
import { useAccount, usePublicClient, useWalletClient } from 'wagmi';
import { formatUnits, parseEther, isAddress } from 'viem';

interface WithdrawPanelProps {
  zkAMMAddress: string;
  balance: bigint;
  viewingKey: string | null;
}

const ZKAMM_ABI = [
  {
    name: 'withdrawPublic',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'proof', type: 'uint256[8]' },
      { name: 'merkleRoot', type: 'uint256' },
      { name: 'nullifierHash', type: 'uint256' },
      { name: 'amount', type: 'uint256' },
      { name: 'recipient', type: 'address' },
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

export function WithdrawPanel({ zkAMMAddress, balance, viewingKey }: WithdrawPanelProps) {
  const { isConnected, address } = useAccount();
  const publicClient = usePublicClient();
  const { data: walletClient } = useWalletClient();

  const [amount, setAmount] = useState('');
  const [recipient, setRecipient] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);

  const handleWithdraw = async () => {
    if (!walletClient || !publicClient || !amount || !recipient || !address) return;

    setIsLoading(true);
    setError(null);
    setSuccess(null);
    setTxHash(null);

    try {
      const withdrawAmount = parseEther(amount);

      if (withdrawAmount > balance) {
        throw new Error('Insufficient balance');
      }

      if (!isAddress(recipient)) {
        throw new Error('Invalid recipient address');
      }

      // For demo: generate mock proof (in production, use actual ZK proof generation)
      const mockProof: [bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint] = [1n, 2n, 3n, 4n, 5n, 6n, 7n, 8n];
      const merkleRoot = 1n; // Mock root - contract's mock verifier accepts this
      const nullifierHash = randomFieldElement(); // Mock nullifier

      // Send transaction
      const hash = await walletClient.writeContract({
        address: zkAMMAddress as `0x${string}`,
        abi: ZKAMM_ABI,
        functionName: 'withdrawPublic',
        args: [
          mockProof,
          merkleRoot,
          nullifierHash,
          withdrawAmount,
          recipient as `0x${string}`,
        ],
      });

      setTxHash(hash);

      // Wait for confirmation
      await publicClient.waitForTransactionReceipt({ hash });

      setSuccess(`Successfully withdrawn ${amount} $ROOT to ${recipient.slice(0, 6)}...${recipient.slice(-4)}`);
      setAmount('');
      setRecipient('');
    } catch (err: unknown) {
      const error = err as Error;
      console.error('Withdraw failed:', error);
      setError(error.message || 'Withdraw failed');
    } finally {
      setIsLoading(false);
    }
  };

  const handleUseConnectedWallet = () => {
    if (address) {
      setRecipient(address);
    }
  };

  if (!isConnected) {
    return (
      <div className="text-center py-12">
        <div className="text-6xl mb-4">🏦</div>
        <h3 className="text-xl font-medium mb-2">Connect to Withdraw</h3>
        <p className="text-gray-400 text-sm">
          Connect your wallet to withdraw $ROOT to a public address
        </p>
      </div>
    );
  }

  if (!viewingKey) {
    return (
      <div className="text-center py-12">
        <div className="text-6xl mb-4">🔐</div>
        <h3 className="text-xl font-medium mb-2">Unlock to Withdraw</h3>
        <p className="text-gray-400 text-sm">
          Go to Portfolio and sign to unlock your wallet first
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="text-center py-4">
        <h3 className="text-xl font-medium mb-2">Withdraw to Public Wallet</h3>
        <p className="text-gray-400 text-sm">
          Exit the privacy pool and receive ERC20 $ROOT tokens
        </p>
      </div>

      {/* Balance */}
      <div className="bg-gray-700 rounded-xl p-4">
        <div className="text-sm text-gray-400 mb-1">Private Balance</div>
        <div className="text-xl font-bold">
          {Number(formatUnits(balance, 18)).toLocaleString()} $ROOT
        </div>
      </div>

      {/* Amount Input */}
      <div>
        <label className="block text-sm text-gray-400 mb-2">Amount to Withdraw</label>
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
        <label className="block text-sm text-gray-400 mb-2">Recipient Address</label>
        <div className="relative">
          <input
            type="text"
            value={recipient}
            onChange={(e) => setRecipient(e.target.value)}
            placeholder="0x..."
            className="w-full bg-gray-700 rounded-xl px-4 py-3 outline-none focus:ring-2 focus:ring-root-500 font-mono text-sm pr-24"
          />
          <button
            onClick={handleUseConnectedWallet}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-xs px-2 py-1 bg-gray-600 hover:bg-gray-500 rounded"
          >
            Use My Wallet
          </button>
        </div>
        <p className="text-xs text-gray-500 mt-1">
          Use a fresh wallet for maximum privacy
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

      {/* Withdraw Button */}
      <button
        onClick={handleWithdraw}
        disabled={!amount || !recipient || isLoading || balance === 0n}
        className={`w-full py-4 rounded-xl font-medium transition-colors ${
          !amount || !recipient || isLoading || balance === 0n
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
          'Withdraw to Public Wallet'
        )}
      </button>

      {/* Info */}
      <div className="p-4 bg-yellow-900/30 border border-yellow-700/50 rounded-xl text-xs text-yellow-200/80 space-y-2">
        <p className="flex items-center gap-2 font-medium">
          <span>&#9888;</span>
          Privacy Notice
        </p>
        <p>
          This action will reveal the <strong>recipient address</strong> and <strong>amount</strong> on-chain.
          However, it does NOT reveal:
        </p>
        <ul className="list-disc list-inside ml-4 space-y-1">
          <li>Who originally bought the tokens</li>
          <li>Your transaction history</li>
          <li>Your remaining private balance</li>
        </ul>
        <p className="mt-2 text-green-400/80">
          For maximum privacy, withdraw to a fresh wallet that has no connection to your identity.
        </p>
      </div>

      {/* Use Cases */}
      <div className="p-4 bg-gray-700/30 rounded-xl text-xs text-gray-500 space-y-2">
        <p className="font-medium text-gray-400">Common use cases:</p>
        <ul className="list-disc list-inside space-y-1">
          <li>Trade on Uniswap or Aerodrome</li>
          <li>Deposit to a CEX when listed</li>
          <li>Transfer to another wallet publicly</li>
        </ul>
      </div>
    </div>
  );
}
