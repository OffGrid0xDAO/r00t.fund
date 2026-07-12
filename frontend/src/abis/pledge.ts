/**
 * ABI for the anonymous plot-funding pledge vault (Phase C).
 *
 * Frozen surface (docs/REMEDIATION_PLAN.md):
 *   event PledgeCommitment(uint256 indexed commitment, uint256 indexed leafIndex, bytes32 parcelId, bytes note)
 *   event PledgeClaimed(uint256 indexed nullifierHash, address indexed recipient, bytes32 parcelId, uint256 amount)
 *   function claim(proof, pubSignals, recipient)
 *
 * pledgePrivate's exact argument tuple is finalized by Phase C when the vault is
 * implemented; the shape below is the Phase-D scaffold (spend-proof over the
 * shielded R00T note + a fresh pledge commitment bound to parcelId). If Phase C
 * changes it, update here — the write is gated behind a configured vault so it
 * cannot run against a placeholder in the meantime.
 */
export const PLEDGE_VAULT_ABI = [
  {
    name: 'pledgePrivate',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'proof', type: 'uint256[8]' },
      { name: 'merkleRoot', type: 'uint256' },
      { name: 'nullifierHash', type: 'uint256' },
      { name: 'pledgeAmount', type: 'uint256' },
      { name: 'publicInputsBinding', type: 'uint256' },
      { name: 'parcelId', type: 'bytes32' },
      { name: 'pledgeCommitment', type: 'uint256' },
      { name: 'encryptedNote', type: 'bytes' },
    ],
    outputs: [],
  },
  {
    name: 'claim',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'proof', type: 'uint256[8]' },
      { name: 'pubSignals', type: 'uint256[]' },
      { name: 'recipient', type: 'address' },
    ],
    outputs: [],
  },
] as const;
