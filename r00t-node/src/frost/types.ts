// FROST Threshold Signature Types

// Participant identifier (1-indexed)
export type ParticipantId = number;

// Scalar in the Ed25519 field
export type Scalar = Uint8Array;

// Point on the Ed25519 curve (compressed)
export type Point = Uint8Array;

// Secret share held by a participant
export interface SecretShare {
  participantId: ParticipantId;
  value: Scalar;
}

// Public key share for a participant
export interface PublicKeyShare {
  participantId: ParticipantId;
  value: Point;
}

// Polynomial commitment (for verifiable secret sharing)
export interface PolynomialCommitment {
  coefficients: Point[];
}

// Key generation output
export interface KeyGenOutput {
  // The participant's secret share
  secretShare: SecretShare;
  // The group's public key (aggregated)
  groupPublicKey: Point;
  // Public key shares for all participants
  publicKeyShares: Map<ParticipantId, Point>;
  // Polynomial commitment for verification
  commitment: PolynomialCommitment;
}

// Nonce pair for signing round 1
export interface NoncePair {
  hiding: Scalar;      // d_i
  binding: Scalar;     // e_i
}

// Nonce commitment (public)
export interface NonceCommitment {
  hiding: Point;       // D_i = d_i * G
  binding: Point;      // E_i = e_i * G
}

// Signing commitment sent to coordinator
export interface SigningCommitment {
  participantId: ParticipantId;
  hiding: Point;
  binding: Point;
}

// Signing nonces stored by participant
export interface SigningNonces {
  nonces: NoncePair;
  commitments: NonceCommitment;
}

// Signature share from a participant
export interface SignatureShare {
  participantId: ParticipantId;
  share: Scalar;       // z_i
}

// Final aggregated signature
export interface Signature {
  R: Point;            // Group commitment
  z: Scalar;           // Aggregated signature scalar
}

// Signing session state
export enum SigningSessionState {
  COLLECTING_COMMITMENTS = 'COLLECTING_COMMITMENTS',
  COLLECTING_SHARES = 'COLLECTING_SHARES',
  COMPLETE = 'COMPLETE',
  FAILED = 'FAILED',
}

// Signing session
export interface SigningSession {
  sessionId: string;
  message: Uint8Array;
  state: SigningSessionState;
  participants: Set<ParticipantId>;
  commitments: Map<ParticipantId, SigningCommitment>;
  shares: Map<ParticipantId, SignatureShare>;
  groupCommitment?: Point;
  signature?: Signature;
  createdAt: number;
  updatedAt: number;
  error?: string;
}

// DKG round 1 message
export interface DKGRound1Message {
  participantId: ParticipantId;
  commitment: PolynomialCommitment;
}

// DKG round 2 message (encrypted share for each participant)
export interface DKGRound2Message {
  fromParticipant: ParticipantId;
  toParticipant: ParticipantId;
  encryptedShare: Uint8Array;
}

// DKG session state
export enum DKGState {
  ROUND1 = 'ROUND1',
  ROUND2 = 'ROUND2',
  COMPLETE = 'COMPLETE',
  FAILED = 'FAILED',
}

// DKG session
export interface DKGSession {
  sessionId: string;
  state: DKGState;
  threshold: number;
  totalParticipants: number;
  round1Messages: Map<ParticipantId, DKGRound1Message>;
  round2Messages: Map<string, DKGRound2Message>; // key: `${from}-${to}`
  result?: KeyGenOutput;
  createdAt: number;
  updatedAt: number;
  error?: string;
}

// Protocol messages for P2P communication
export enum FrostMessageType {
  // DKG
  DKG_ROUND1 = 'DKG_ROUND1',
  DKG_ROUND2 = 'DKG_ROUND2',
  DKG_COMPLETE = 'DKG_COMPLETE',
  DKG_ABORT = 'DKG_ABORT',

  // Signing
  SIGNING_REQUEST = 'SIGNING_REQUEST',
  SIGNING_COMMITMENT = 'SIGNING_COMMITMENT',
  SIGNING_SHARE = 'SIGNING_SHARE',
  SIGNING_COMPLETE = 'SIGNING_COMPLETE',
  SIGNING_ABORT = 'SIGNING_ABORT',
}

export interface FrostMessage {
  type: FrostMessageType;
  sessionId: string;
  fromParticipant: ParticipantId;
  timestamp: number;
  payload: unknown;
}

// Signing request payload
export interface SigningRequestPayload {
  message: Uint8Array;
  participants: ParticipantId[];
}

// Configuration
export interface FrostConfig {
  threshold: number;      // t (minimum signers required)
  totalParticipants: number;  // n (total participants)
  participantId: ParticipantId;
  signingTimeout: number; // milliseconds
}
