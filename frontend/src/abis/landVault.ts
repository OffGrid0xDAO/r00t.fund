// LandVault — private ETH/USDC funding of land parcels + dual R00T|parcel claim.
// Pay ETH/USDC (100% to the land treasury) → shielded commitment claimable to ANY
// wallet as either R00T (OTC floor, once the parcel is fully funded) or the parcel
// token (upside). See contracts/src/LandVault.sol.
export const landVaultAbi = [
  // ── funding ──
  {
    type: 'function',
    name: 'otcFundETH',
    stateMutability: 'payable',
    inputs: [
      { name: 'parcelId', type: 'bytes32' },
      { name: 'rootOut', type: 'uint256' },
      { name: 'commitment', type: 'uint256' },
      { name: 'binding', type: 'uint256' },
      { name: 'depositProof', type: 'uint256[8]' },
      { name: 'note', type: 'bytes' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'otcFundUSDC',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'parcelId', type: 'bytes32' },
      { name: 'rootOut', type: 'uint256' },
      { name: 'commitment', type: 'uint256' },
      { name: 'binding', type: 'uint256' },
      { name: 'depositProof', type: 'uint256[8]' },
      { name: 'note', type: 'bytes' },
    ],
    outputs: [],
  },
  // ── claiming (both take the same claim proof; vault decides R00T vs parcel token) ──
  {
    type: 'function',
    name: 'claimR00T',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'proof', type: 'uint256[8]' },
      { name: 'pubSignals', type: 'uint256[6]' },
      { name: 'recipient', type: 'address' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'claimParcelToken',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'proof', type: 'uint256[8]' },
      { name: 'pubSignals', type: 'uint256[6]' },
      { name: 'recipient', type: 'address' },
    ],
    outputs: [],
  },
  // ── views ──
  { type: 'function', name: 'pledgeRoot', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'reserveR00T', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'committedR00T', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'freeReserveR00T', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'raisedR00TByParcel', stateMutability: 'view', inputs: [{ type: 'bytes32' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'parcelTargetR00T', stateMutability: 'view', inputs: [{ type: 'bytes32' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'isParcelFullyFunded', stateMutability: 'view', inputs: [{ type: 'bytes32' }], outputs: [{ type: 'bool' }] },
  // ── steward admin ──
  { type: 'function', name: 'fundReserve', stateMutability: 'nonpayable', inputs: [{ name: 'amount', type: 'uint256' }], outputs: [] },
  { type: 'function', name: 'withdrawReserve', stateMutability: 'nonpayable', inputs: [{ name: 'to', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [] },
  { type: 'function', name: 'setParcelTarget', stateMutability: 'nonpayable', inputs: [{ name: 'parcelId', type: 'bytes32' }, { name: 'targetR00T', type: 'uint256' }], outputs: [] },
  // ── events (indexer) ──
  {
    type: 'event',
    name: 'Funded',
    inputs: [
      { name: 'commitment', type: 'uint256', indexed: true },
      { name: 'leafIndex', type: 'uint256', indexed: true },
      { name: 'parcelId', type: 'bytes32', indexed: false },
      { name: 'rootOut', type: 'uint256', indexed: false },
      { name: 'paid', type: 'uint256', indexed: false },
      { name: 'payToken', type: 'address', indexed: false },
      { name: 'note', type: 'bytes', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'ClaimedR00T',
    inputs: [
      { name: 'nullifierHash', type: 'uint256', indexed: true },
      { name: 'recipient', type: 'address', indexed: true },
      { name: 'parcelId', type: 'bytes32', indexed: false },
      { name: 'amount', type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'ClaimedParcelToken',
    inputs: [
      { name: 'nullifierHash', type: 'uint256', indexed: true },
      { name: 'recipient', type: 'address', indexed: true },
      { name: 'parcelId', type: 'bytes32', indexed: false },
      { name: 'parcelOut', type: 'uint256', indexed: false },
    ],
  },
] as const;
