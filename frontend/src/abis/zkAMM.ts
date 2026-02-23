/**
 * Centralized ABI definitions for zkAMM contract
 * Prevents duplication across components and hooks
 */

export const ZKAMM_ABI = [
  // Buy/Sell functions
  {
    name: 'buyPrivate',
    type: 'function',
    stateMutability: 'payable',
    inputs: [
      { name: 'newCommitment', type: 'uint256' },
      { name: 'minTokensOut', type: 'uint256' },
      { name: 'deadline', type: 'uint256' },
      { name: 'encryptedNote', type: 'bytes' },
    ],
    outputs: [],
  },
  {
    name: 'sellPrivate',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'proof', type: 'uint256[8]' },
      { name: 'merkleRoot', type: 'uint256' },
      { name: 'nullifierHash', type: 'uint256' },
      { name: 'tokenAmount', type: 'uint256' },
      { name: 'minEthOut', type: 'uint256' },
      { name: 'recipient', type: 'address' },
      { name: 'relayer', type: 'address' },
      { name: 'fee', type: 'uint256' },
      { name: 'changeCommitment', type: 'uint256' },
      { name: 'publicInputsBinding', type: 'uint256' },
      { name: 'deadline', type: 'uint256' },
      { name: 'changeNote', type: 'bytes' },
    ],
    outputs: [],
  },
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
      { name: 'recipientBinding', type: 'uint256' },
    ],
    outputs: [],
  },
  // LP functions
  {
    name: 'addLiquidityPrivate',
    type: 'function',
    stateMutability: 'payable',
    inputs: [
      { name: 'proof', type: 'uint256[8]' },
      { name: 'merkleRoot', type: 'uint256' },
      { name: 'nullifierHash', type: 'uint256' },
      { name: 'tokenAmount', type: 'uint256' },
      { name: 'lpCommitment', type: 'uint256' },
      { name: 'changeCommitment', type: 'uint256' },
      { name: 'userLpShares', type: 'uint256' }, // LP shares used in commitment (must be within 1% of calculated)
      { name: 'publicInputsBinding', type: 'uint256' },
      { name: 'deadline', type: 'uint256' },
      { name: 'lpNote', type: 'bytes' },
      { name: 'changeNote', type: 'bytes' },
    ],
    outputs: [],
  },
  {
    name: 'removeLiquidityPrivate',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'proof', type: 'uint256[8]' },
      { name: 'lpMerkleRoot', type: 'uint256' },
      { name: 'nullifierHash', type: 'uint256' },
      { name: 'commitment', type: 'uint256' },
      { name: 'lpShares', type: 'uint256' },
      { name: 'minEthOut', type: 'uint256' },
      { name: 'recipient', type: 'address' },
      { name: 'tokenCommitment', type: 'uint256' },
      { name: 'changeLPCommitment', type: 'uint256' },
      { name: 'publicInputsBinding', type: 'uint256' },
      { name: 'deadline', type: 'uint256' },
      { name: 'tokenNote', type: 'bytes' },
      { name: 'changeNote', type: 'bytes' },
    ],
    outputs: [],
  },
  {
    name: 'claimLPFees',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'proof', type: 'uint256[8]' },
      { name: 'lpMerkleRoot', type: 'uint256' },
      { name: 'claimNullifier', type: 'uint256' },
      { name: 'lpShares', type: 'uint256' },
      { name: 'recipient', type: 'address' },
      { name: 'publicInputsBinding', type: 'uint256' },
    ],
    outputs: [],
  },
  // Emergency LP withdrawal (admin only) - commented out, uncomment if needed for legacy positions
  // {
  //   name: 'emergencyRemoveLiquidityAdmin',
  //   type: 'function',
  //   stateMutability: 'nonpayable',
  //   inputs: [
  //     { name: 'commitment', type: 'uint256' },
  //     { name: 'recipient', type: 'address' },
  //     { name: 'tokenCommitment', type: 'uint256' },
  //     { name: 'tokenNote', type: 'bytes' },
  //   ],
  //   outputs: [],
  // },
  // Router: atomic ETH -> Project Token swap
  {
    name: 'swapETHForProjectToken',
    type: 'function',
    stateMutability: 'payable',
    inputs: [
      { name: 'pool', type: 'address' },
      { name: 'minR00TOut', type: 'uint256' },
      { name: 'minTokensOut', type: 'uint256' },
      { name: 'projectTokenCommitment', type: 'uint256' },
      { name: 'deadline', type: 'uint256' },
      { name: 'encryptedNote', type: 'bytes' },
      { name: 'userEntropy', type: 'bytes32' },
    ],
    outputs: [],
  },
  // View functions
  {
    name: 'getAmountOut',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'amountIn', type: 'uint256' },
      { name: 'reserveIn', type: 'uint256' },
      { name: 'reserveOut', type: 'uint256' },
    ],
    outputs: [{ type: 'uint256' }],
  },
  {
    name: 'ethReserve',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint256' }],
  },
  {
    name: 'tokenReserve',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint256' }],
  },
  {
    name: 'getTokenPrice',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint256' }],
  },
  {
    name: 'tokenPool',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'address' }],
  },
  // Project pool reserve (ROOT/Token pairs use r00tReserve instead of ethReserve)
  {
    name: 'r00tReserve',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint256' }],
  },
  {
    name: 'getReserves',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint256' }, { type: 'uint256' }],
  },
  // Pair validation functions (for pre-flight checks)
  {
    name: 'isKnownRoot',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'root', type: 'uint256' }],
    outputs: [{ type: 'bool' }],
  },
  {
    name: 'isNullifierSpent',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'nullifier', type: 'uint256' }],
    outputs: [{ type: 'bool' }],
  },
] as const;

// Minimal ABI for price fetching (used by usePriceHistory)
export const ZKAMM_PRICE_ABI = [
  {
    type: 'function',
    name: 'ethReserve',
    inputs: [],
    outputs: [{ type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'tokenReserve',
    inputs: [],
    outputs: [{ type: 'uint256' }],
    stateMutability: 'view',
  },
] as const;
