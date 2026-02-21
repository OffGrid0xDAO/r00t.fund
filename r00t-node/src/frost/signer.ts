import { ed25519 } from '@noble/curves/ed25519';
import { sha512 } from '@noble/hashes/sha512';
import { keccak_256 } from '@noble/hashes/sha3';
import { bytesToHex, hexToBytes, concatBytes, numberToBytesBE, bytesToNumberBE } from '@noble/curves/abstract/utils';
import pino from 'pino';

// SECURITY FIX (Vuln 4): This FROST implementation uses keccak256 for the challenge hash
// to match the on-chain Ed25519 verification in contracts/src/Ed25519.sol
// The on-chain contract uses: h = keccak256(R || A || M) mod L
// We MUST use the same hash function for signatures to verify correctly
import type {
  ParticipantId,
  Scalar,
  Point,
  SecretShare,
  SigningNonces,
  SigningCommitment,
  SignatureShare,
  Signature,
  FrostConfig,
  SigningSession,
  SigningSessionState,
} from './types.js';

const logger = pino({ name: 'frost-signer' });

// Ed25519 curve order
const L = BigInt('0x1000000000000000000000000000000014def9dea2f79cd65812631a5cf5d3ed');

// Scalar operations
function scalarAdd(a: Scalar, b: Scalar): Scalar {
  const aNum = bytesToNumberBE(a);
  const bNum = bytesToNumberBE(b);
  const result = (aNum + bNum) % L;
  return numberToBytesBE(result, 32);
}

function scalarMul(a: Scalar, b: Scalar): Scalar {
  const aNum = bytesToNumberBE(a);
  const bNum = bytesToNumberBE(b);
  const result = (aNum * bNum) % L;
  return numberToBytesBE(result, 32);
}

function scalarSub(a: Scalar, b: Scalar): Scalar {
  const aNum = bytesToNumberBE(a);
  const bNum = bytesToNumberBE(b);
  const result = (aNum - bNum + L) % L;
  return numberToBytesBE(result, 32);
}

function scalarFromHash(hash: Uint8Array): Scalar {
  // Reduce hash mod L
  const num = bytesToNumberBE(hash) % L;
  return numberToBytesBE(num, 32);
}

// Generate random scalar
function randomScalar(): Scalar {
  const bytes = ed25519.utils.randomPrivateKey();
  return scalarFromHash(bytes);
}

// Point operations using @noble/curves
function pointMul(scalar: Scalar): Point {
  const point = ed25519.ExtendedPoint.BASE.multiply(bytesToNumberBE(scalar));
  return point.toRawBytes();
}

function pointAdd(a: Point, b: Point): Point {
  const pointA = ed25519.ExtendedPoint.fromHex(a);
  const pointB = ed25519.ExtendedPoint.fromHex(b);
  return pointA.add(pointB).toRawBytes();
}

function pointNegate(p: Point): Point {
  const point = ed25519.ExtendedPoint.fromHex(p);
  return point.negate().toRawBytes();
}

// Compute Lagrange coefficient for participant i in set S
// λ_i = Π_{j∈S, j≠i} (j / (j - i))
function lagrangeCoefficient(participantId: ParticipantId, participants: ParticipantId[]): Scalar {
  let num = BigInt(1);
  let den = BigInt(1);

  for (const j of participants) {
    if (j !== participantId) {
      num = (num * BigInt(j)) % L;
      // j - i, handle negative
      const diff = (BigInt(j) - BigInt(participantId) + L) % L;
      den = (den * diff) % L;
    }
  }

  // Compute num * den^(-1) mod L
  // Using Fermat's little theorem: den^(-1) = den^(L-2) mod L
  const denInv = modPow(den, L - BigInt(2), L);
  const result = (num * denInv) % L;

  return numberToBytesBE(result, 32);
}

// Modular exponentiation
function modPow(base: bigint, exp: bigint, mod: bigint): bigint {
  let result = BigInt(1);
  base = base % mod;

  while (exp > BigInt(0)) {
    if (exp % BigInt(2) === BigInt(1)) {
      result = (result * base) % mod;
    }
    exp = exp / BigInt(2);
    base = (base * base) % mod;
  }

  return result;
}

// FROST Signer implementation
export class FrostSigner {
  private config: FrostConfig;
  private secretShare: SecretShare;
  private groupPublicKey: Point;
  private publicKeyShares: Map<ParticipantId, Point>;
  private sessions: Map<string, SigningSession>;
  private nonceStore: Map<string, SigningNonces>; // sessionId -> nonces

  constructor(
    config: FrostConfig,
    secretShare: SecretShare,
    groupPublicKey: Point,
    publicKeyShares: Map<ParticipantId, Point>
  ) {
    this.config = config;
    this.secretShare = secretShare;
    this.groupPublicKey = groupPublicKey;
    this.publicKeyShares = publicKeyShares;
    this.sessions = new Map();
    this.nonceStore = new Map();

    logger.info(
      { participantId: config.participantId, threshold: config.threshold },
      'FROST Signer initialized'
    );
  }

  // Generate signing nonces for a session
  generateNonces(sessionId: string): SigningCommitment {
    // Generate random nonce pair
    const hiding = randomScalar();
    const binding = randomScalar();

    // Compute commitments D_i = d_i * G, E_i = e_i * G
    const hidingCommitment = pointMul(hiding);
    const bindingCommitment = pointMul(binding);

    // Store nonces (must be kept secret)
    this.nonceStore.set(sessionId, {
      nonces: { hiding, binding },
      commitments: { hiding: hidingCommitment, binding: bindingCommitment },
    });

    logger.debug({ sessionId, participantId: this.config.participantId }, 'Generated signing nonces');

    return {
      participantId: this.config.participantId,
      hiding: hidingCommitment,
      binding: bindingCommitment,
    };
  }

  // Create or get a signing session
  createSession(sessionId: string, message: Uint8Array, participants: ParticipantId[]): SigningSession {
    if (participants.length < this.config.threshold) {
      throw new Error(`Insufficient participants: ${participants.length} < ${this.config.threshold}`);
    }

    const session: SigningSession = {
      sessionId,
      message,
      state: SigningSessionState.COLLECTING_COMMITMENTS,
      participants: new Set(participants),
      commitments: new Map(),
      shares: new Map(),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    this.sessions.set(sessionId, session);

    logger.info({ sessionId, participants }, 'Created signing session');

    return session;
  }

  // Add a commitment to a session
  addCommitment(sessionId: string, commitment: SigningCommitment): void {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    if (session.state !== SigningSessionState.COLLECTING_COMMITMENTS) {
      throw new Error(`Session ${sessionId} is not collecting commitments`);
    }

    if (!session.participants.has(commitment.participantId)) {
      throw new Error(`Participant ${commitment.participantId} is not in session ${sessionId}`);
    }

    session.commitments.set(commitment.participantId, commitment);
    session.updatedAt = Date.now();

    logger.debug(
      { sessionId, participantId: commitment.participantId, collected: session.commitments.size },
      'Added commitment'
    );

    // Check if we have all commitments
    if (session.commitments.size === session.participants.size) {
      this.transitionToShareCollection(session);
    }
  }

  // Transition to share collection phase
  private transitionToShareCollection(session: SigningSession): void {
    session.state = SigningSessionState.COLLECTING_SHARES;

    // Compute group commitment R
    const participants = Array.from(session.participants);
    const commitments = Array.from(session.commitments.values());

    // Compute binding factors for each participant
    // ρ_i = H(i, message, commitments...)
    const bindingFactors = new Map<ParticipantId, Scalar>();

    for (const pid of participants) {
      const commitment = session.commitments.get(pid)!;
      const hashInput = concatBytes(
        new Uint8Array([pid]),
        session.message,
        ...commitments.flatMap(c => [c.hiding, c.binding])
      );
      bindingFactors.set(pid, scalarFromHash(sha512(hashInput)));
    }

    // Compute R = Σ(D_i + ρ_i * E_i)
    let R: Point | null = null;

    for (const pid of participants) {
      const commitment = session.commitments.get(pid)!;
      const rho = bindingFactors.get(pid)!;

      // D_i + ρ_i * E_i
      const rhoEi = ed25519.ExtendedPoint.fromHex(commitment.binding)
        .multiply(bytesToNumberBE(rho))
        .toRawBytes();
      const term = pointAdd(commitment.hiding, rhoEi);

      if (R === null) {
        R = term;
      } else {
        R = pointAdd(R, term);
      }
    }

    session.groupCommitment = R!;
    session.updatedAt = Date.now();

    logger.info({ sessionId: session.sessionId }, 'Transitioned to share collection');
  }

  // Generate signature share
  generateShare(sessionId: string): SignatureShare {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    if (session.state !== SigningSessionState.COLLECTING_SHARES) {
      throw new Error(`Session ${sessionId} is not collecting shares`);
    }

    const nonces = this.nonceStore.get(sessionId);
    if (!nonces) {
      throw new Error(`Nonces not found for session ${sessionId}`);
    }

    const participants = Array.from(session.participants);
    const commitments = Array.from(session.commitments.values());

    // Compute my binding factor ρ_i
    const hashInput = concatBytes(
      new Uint8Array([this.config.participantId]),
      session.message,
      ...commitments.flatMap(c => [c.hiding, c.binding])
    );
    const rho = scalarFromHash(sha512(hashInput));

    // SECURITY FIX (Vuln 4): Compute challenge c = keccak256(R, Y, message) mod L
    // MUST use keccak256 to match on-chain Ed25519 verification in contracts/src/Ed25519.sol
    // The on-chain contract uses: h = uint256(keccak256(R || publicKey || messageHash)) % L
    const challengeInput = concatBytes(
      session.groupCommitment!,
      this.groupPublicKey,
      session.message
    );
    const c = scalarFromHash(keccak_256(challengeInput));

    // Compute Lagrange coefficient
    const lambda = lagrangeCoefficient(this.config.participantId, participants);

    // z_i = d_i + (e_i * ρ_i) + (λ_i * s_i * c)
    const eRho = scalarMul(nonces.nonces.binding, rho);
    const lambdaSC = scalarMul(scalarMul(lambda, this.secretShare.value), c);
    const zi = scalarAdd(scalarAdd(nonces.nonces.hiding, eRho), lambdaSC);

    // Clear nonces after use (security: nonces must never be reused!)
    this.nonceStore.delete(sessionId);

    logger.debug({ sessionId, participantId: this.config.participantId }, 'Generated signature share');

    return {
      participantId: this.config.participantId,
      share: zi,
    };
  }

  // Add a signature share to a session
  addShare(sessionId: string, share: SignatureShare): void {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    if (session.state !== SigningSessionState.COLLECTING_SHARES) {
      throw new Error(`Session ${sessionId} is not collecting shares`);
    }

    if (!session.participants.has(share.participantId)) {
      throw new Error(`Participant ${share.participantId} is not in session ${sessionId}`);
    }

    // Verify share before adding
    if (!this.verifyShare(session, share)) {
      throw new Error(`Invalid share from participant ${share.participantId}`);
    }

    session.shares.set(share.participantId, share);
    session.updatedAt = Date.now();

    logger.debug(
      { sessionId, participantId: share.participantId, collected: session.shares.size },
      'Added signature share'
    );

    // Check if we have enough shares
    if (session.shares.size >= this.config.threshold) {
      this.aggregateSignature(session);
    }
  }

  // Verify a signature share
  private verifyShare(session: SigningSession, share: SignatureShare): boolean {
    const participants = Array.from(session.participants);
    const commitments = Array.from(session.commitments.values());
    const commitment = session.commitments.get(share.participantId)!;

    // Compute binding factor ρ_i
    const hashInput = concatBytes(
      new Uint8Array([share.participantId]),
      session.message,
      ...commitments.flatMap(c => [c.hiding, c.binding])
    );
    const rho = scalarFromHash(sha512(hashInput));

    // SECURITY FIX (Vuln 4): Compute challenge c using keccak256 for on-chain compatibility
    const challengeInput = concatBytes(
      session.groupCommitment!,
      this.groupPublicKey,
      session.message
    );
    const c = scalarFromHash(keccak_256(challengeInput));

    // Compute Lagrange coefficient
    const lambda = lagrangeCoefficient(share.participantId, participants);

    // Verify: z_i * G == D_i + ρ_i * E_i + c * λ_i * Y_i
    // Left side: z_i * G
    const ziG = pointMul(share.share);

    // Right side: D_i + ρ_i * E_i + c * λ_i * Y_i
    const rhoEi = ed25519.ExtendedPoint.fromHex(commitment.binding)
      .multiply(bytesToNumberBE(rho))
      .toRawBytes();
    const cLambdaYi = ed25519.ExtendedPoint.fromHex(this.publicKeyShares.get(share.participantId)!)
      .multiply(bytesToNumberBE(scalarMul(c, lambda)))
      .toRawBytes();

    const rightSide = pointAdd(pointAdd(commitment.hiding, rhoEi), cLambdaYi);

    return bytesToHex(ziG) === bytesToHex(rightSide);
  }

  // Aggregate signature shares
  private aggregateSignature(session: SigningSession): void {
    // z = Σ z_i
    let z: Scalar | null = null;

    for (const share of session.shares.values()) {
      if (z === null) {
        z = share.share;
      } else {
        z = scalarAdd(z, share.share);
      }
    }

    session.signature = {
      R: session.groupCommitment!,
      z: z!,
    };

    session.state = SigningSessionState.COMPLETE;
    session.updatedAt = Date.now();

    logger.info({ sessionId: session.sessionId }, 'Signature aggregation complete');
  }

  // Get the final signature
  getSignature(sessionId: string): Signature | null {
    const session = this.sessions.get(sessionId);
    if (!session || session.state !== SigningSessionState.COMPLETE) {
      return null;
    }
    return session.signature!;
  }

  // Verify a FROST signature
  verifySignature(message: Uint8Array, signature: Signature): boolean {
    // SECURITY FIX (Vuln 4): Compute challenge c using keccak256 for on-chain compatibility
    // This MUST match the on-chain Ed25519.sol verification
    const challengeInput = concatBytes(signature.R, this.groupPublicKey, message);
    const c = scalarFromHash(keccak_256(challengeInput));

    // Verify: z * G == R + c * Y
    const zG = pointMul(signature.z);
    const cY = ed25519.ExtendedPoint.fromHex(this.groupPublicKey)
      .multiply(bytesToNumberBE(c))
      .toRawBytes();
    const rightSide = pointAdd(signature.R, cY);

    return bytesToHex(zG) === bytesToHex(rightSide);
  }

  // Serialize signature to bytes (for on-chain verification)
  serializeSignature(signature: Signature): Uint8Array {
    return concatBytes(signature.R, signature.z);
  }

  // Get session state
  getSession(sessionId: string): SigningSession | undefined {
    return this.sessions.get(sessionId);
  }

  // Cleanup old sessions
  cleanupOldSessions(maxAge: number): void {
    const now = Date.now();
    for (const [sessionId, session] of this.sessions) {
      if (now - session.updatedAt > maxAge) {
        this.sessions.delete(sessionId);
        this.nonceStore.delete(sessionId);
        logger.debug({ sessionId }, 'Cleaned up old session');
      }
    }
  }

  // Get group public key
  getGroupPublicKey(): Point {
    return this.groupPublicKey;
  }

  // Get participant's public key share
  getPublicKeyShare(participantId: ParticipantId): Point | undefined {
    return this.publicKeyShares.get(participantId);
  }
}
