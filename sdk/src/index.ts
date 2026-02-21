// Main client
export { ZkAMMClient } from './client';

// Unified AMM client (supports multi-token routing)
export { UnifiedAMMClient } from './unifiedClient';

// Private wallet
export { PrivateWallet } from './wallet';

// Railgun integration for anonymous buys
export {
  RailgunService,
  deriveRailgunKey,
  BASE_RAILGUN_CONTRACTS,
} from './railgun';
export type { RailgunConfig, RailgunBalance, UnshieldResult } from './railgun';

// Prover
export { Prover, loadCircuitArtifacts, loadCircuitArtifactsFromUrls } from './prover';

// Merkle tree
export { MerkleTree, ZERO_VALUE, ZEROS } from './merkle';

// Poseidon utilities
export {
  poseidon,
  hashPair,
  hashCommitment,
  hashNullifier,
  hashClaimNullifier,
  randomFieldElement,
  createCommitment,
} from './poseidon';

// Crypto utilities
export {
  deriveKeys,
  encryptNote,
  decryptNote,
  generateEphemeralKeypair,
  deriveSharedSecret,
  bigintToBytes32,
  bytes32ToBigint,
  FIELD_PRIME,
} from './crypto';

// Types
export type {
  // Commitment types
  Commitment,
  OwnedCommitment,

  // Proof types
  MerkleProof,
  SellProofInputs,
  TransferProofInputs,
  MergeProofInputs,
  Groth16Proof,
  ProofResult,

  // Transaction types
  BuyParams,
  SellParams,
  TransferParams,

  // Configuration
  ZkAMMConfig,
  RelayerFees,

  // Events
  NewCommitmentEvent,
  NullifierSpentEvent,

  // Note encryption
  EncryptedNote,
  DecryptedNote,

  // Wallet
  ZkAMMWallet,

  // UnifiedAMM types
  UnifiedAMMConfig,
  TokenInfo,
  SwapRoute,
  SwapQuote,
} from './types';
