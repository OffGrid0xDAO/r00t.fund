import type { ethers } from 'ethers';

// ============ Commitment Types ============

export interface Commitment {
  /** Random nullifier for double-spend prevention */
  nullifier: bigint;
  /** Random secret for hiding */
  secret: bigint;
  /** Token amount in this commitment */
  amount: bigint;
  /** Computed commitment hash */
  commitment: bigint;
  /** Leaf index in the merkle tree (set after insertion) */
  leafIndex?: number;
  /** Block number when commitment was created */
  blockNumber?: number;
}

export interface OwnedCommitment extends Commitment {
  leafIndex: number;
  blockNumber: number;
  /** Whether this commitment has been spent */
  spent: boolean;
  /** Nullifier hash (computed when spending) */
  nullifierHash?: bigint;
}

// ============ Proof Types ============

export interface MerkleProof {
  /** Sibling hashes from leaf to root */
  pathElements: bigint[];
  /** Path indices (0 = left, 1 = right) */
  pathIndices: number[];
  /** The merkle root */
  root: bigint;
}

export interface SellProofInputs {
  // Public
  merkleRoot: bigint;
  nullifierHash: bigint;
  tokenAmount: bigint;
  minEthOut: bigint;
  recipient: string;
  relayer: string;
  fee: bigint;
  changeCommitment: bigint;

  // Private
  nullifier: bigint;
  secret: bigint;
  amount: bigint;
  pathElements: bigint[];
  pathIndices: number[];
  changeNullifier: bigint;
  changeSecret: bigint;
}

export interface TransferProofInputs {
  // Public
  merkleRoot: bigint;
  nullifierHash: bigint;
  recipientCommitment: bigint;
  changeCommitment: bigint;

  // Private
  nullifier: bigint;
  secret: bigint;
  amount: bigint;
  pathElements: bigint[];
  pathIndices: number[];
  transferAmount: bigint;
  recipientNullifier: bigint;
  recipientSecret: bigint;
  changeNullifier: bigint;
  changeSecret: bigint;
}

export interface WithdrawProofInputs {
  // Public
  merkleRoot: bigint;
  nullifierHash: bigint;
  amount: bigint;
  recipient: string;

  // Private
  nullifier: bigint;
  secret: bigint;
  pathElements: bigint[];
  pathIndices: number[];
}

export interface VoteProofInputs {
  // Public
  proposalId: bigint;
  merkleRoot: bigint;
  nullifierHash: bigint;
  voteWeight: bigint;
  support: boolean;

  // Private
  nullifier: bigint;
  secret: bigint;
  amount: bigint;
  pathElements: bigint[];
  pathIndices: number[];
}

export interface PledgeProofInputs {
  // Public
  merkleRoot: bigint;
  nullifierHash: bigint;
  pledgeAmount: bigint;
  creator: string; // msg.sender address

  // Private
  nullifier: bigint;
  secret: bigint;
  pathElements: bigint[];
  pathIndices: number[];
}

export interface ClaimProofInputs {
  // Public — matches circuits/claim.circom main component
  merkleRoot: bigint;
  nullifierHash: bigint;
  parcelId: bigint;
  amount: bigint;
  recipient: string; // payout wallet address

  // Private
  nullifier: bigint;
  secret: bigint;
  pathElements: bigint[];
  pathIndices: number[];
}

export interface SwapProofInputs {
  // Public
  inputMerkleRoot: bigint;
  inputNullifierHash: bigint;
  inputAmount: bigint;
  outputCommitment: bigint;
  minOutputAmount: bigint;
  changeCommitment: bigint;

  // Private - Input commitment
  inputNullifier: bigint;
  inputSecret: bigint;
  inputTotalAmount: bigint;
  inputPathElements: bigint[];
  inputPathIndices: number[];

  // Private - Output commitment
  outputNullifier: bigint;
  outputSecret: bigint;
  outputAmount: bigint;

  // Private - Change commitment
  changeNullifier: bigint;
  changeSecret: bigint;
}

export interface AddLiquidityProofInputs {
  // Public
  merkleRoot: bigint;
  nullifierHash: bigint;
  tokenAmount: bigint;
  lpCommitment: bigint;
  changeCommitment: bigint;

  // Private
  nullifier: bigint;
  secret: bigint;
  amount: bigint;
  pathElements: bigint[];
  pathIndices: number[];
  lpNullifier: bigint;
  lpSecret: bigint;
  lpShares: bigint;
  changeNullifier: bigint;
  changeSecret: bigint;
}

export interface RemoveLiquidityProofInputs {
  // Public
  lpMerkleRoot: bigint;
  nullifierHash: bigint;
  commitment: bigint;
  withdrawShares: bigint;
  minEthOut: bigint;
  recipient: string;
  changeCommitment: bigint;

  // Private
  nullifier: bigint;
  secret: bigint;
  totalShares: bigint;
  pathElements: bigint[];
  pathIndices: number[];
  changeNullifier: bigint;
  changeSecret: bigint;
}

export interface ClaimFeesProofInputs {
  // Public
  lpMerkleRoot: bigint;
  claimNullifier: bigint;
  feeEpoch: bigint;
  lpShares: bigint;
  recipient: string;

  // Private
  nullifier: bigint;
  secret: bigint;
  pathElements: bigint[];
  pathIndices: number[];
}

export interface MergeProofInputs {
  // Public
  merkleRoot: bigint;
  nullifierHash1: bigint;
  nullifierHash2: bigint;
  outputCommitment: bigint;

  // Private - Input 1
  nullifier1: bigint;
  secret1: bigint;
  amount1: bigint;
  pathElements1: bigint[];
  pathIndices1: number[];

  // Private - Input 2
  nullifier2: bigint;
  secret2: bigint;
  amount2: bigint;
  pathElements2: bigint[];
  pathIndices2: number[];

  // Private - Output
  outputNullifier: bigint;
  outputSecret: bigint;
}

export interface Groth16Proof {
  pi_a: [string, string];
  pi_b: [[string, string], [string, string]];
  pi_c: [string, string];
  protocol: 'groth16';
}

export interface ProofResult {
  proof: Groth16Proof;
  publicSignals: string[];
}

// ============ Transaction Types ============

export interface BuyParams {
  /** Amount of ETH to spend */
  ethAmount: bigint;
  /** Minimum tokens to receive (slippage protection) */
  minTokensOut: bigint;
}

export interface SellParams {
  /** Amount of tokens to sell */
  tokenAmount: bigint;
  /** Minimum ETH to receive (slippage protection) */
  minEthOut: bigint;
  /** Address to receive ETH */
  recipient: string;
}

export interface TransferParams {
  /** Amount of tokens to transfer */
  amount: bigint;
  /** Recipient's public key (for note encryption) */
  recipientPublicKey: string;
}

// ============ Client Configuration ============

export interface ZkAMMConfig {
  /** Ethereum provider */
  provider: ethers.Provider;
  /** Chain ID (8453 for Base, 84532 for Base Sepolia) */
  chainId: number;
  /** ZkAMM contract address */
  zkAMMAddress: string;
  /** Relayer URL */
  relayerUrl: string;
  /** Path to circuit artifacts (WASM, ZKEY) */
  circuitArtifactsPath?: string;
}

export interface RelayerFees {
  /** Base fee in wei */
  baseFee: bigint;
  /** Percentage fee (e.g., 0.1 for 0.1%) */
  percentFee: number;
}

// ============ Events ============

export interface NewCommitmentEvent {
  commitment: bigint;
  leafIndex: number;
  encryptedNote: string;
  blockNumber: number;
  transactionHash: string;
}

export interface NullifierSpentEvent {
  nullifierHash: bigint;
  blockNumber: number;
  transactionHash: string;
}

// ============ Note Encryption ============

export interface EncryptedNote {
  /** Ephemeral public key for ECDH */
  ephemeralPublicKey: string;
  /** Encrypted data (nullifier, secret, amount) */
  ciphertext: string;
  /** Nonce/IV for encryption */
  nonce: string;
}

export interface DecryptedNote {
  nullifier: bigint;
  secret: bigint;
  amount: bigint;
}

// ============ Wallet Types ============

export interface ZkAMMWallet {
  /** Get total private token balance */
  getBalance(): Promise<bigint>;
  /** Get list of owned (unspent) commitments */
  getCommitments(): OwnedCommitment[];
  /** Scan blockchain for new commitments */
  scan(fromBlock?: number): Promise<void>;
  /** Generate spending key from seed */
  getPublicKey(): string;
}

// ============ UnifiedAMM Types ============

export interface UnifiedAMMConfig {
  /** Ethereum provider */
  provider: ethers.Provider;
  /** Chain ID (8453 for Base, 84532 for Base Sepolia) */
  chainId: number;
  /** UnifiedAMM contract address */
  unifiedAMMAddress: string;
  /** Relayer URL */
  relayerUrl: string;
}

export interface TokenInfo {
  /** Token ID in the registry */
  id: number;
  /** Token name */
  name: string;
  /** Token symbol */
  symbol: string;
  /** Total token supply */
  totalSupply: bigint;
  /** $ROOT reserve in this pair */
  rootReserve: bigint;
  /** Token reserve in the pool */
  tokenReserve: bigint;
  /** Token commitment pool address */
  poolAddress: string;
  /** Whether the token is active */
  active: boolean;
}

export interface SwapRoute {
  /** Token IDs in the route */
  path: ('ETH' | 'ROOT' | number)[];
  /** Expected output amount */
  expectedOutput: bigint;
  /** Minimum output with slippage */
  minOutput: bigint;
  /** Price impact percentage */
  priceImpact: number;
}

export interface SwapQuote {
  /** Input token */
  tokenIn: 'ETH' | 'ROOT' | number;
  /** Output token */
  tokenOut: 'ETH' | 'ROOT' | number;
  /** Input amount */
  amountIn: bigint;
  /** Expected output amount */
  amountOut: bigint;
  /** Route taken */
  route: SwapRoute;
  /** Quote expiry (block number) */
  validUntil: number;
}
