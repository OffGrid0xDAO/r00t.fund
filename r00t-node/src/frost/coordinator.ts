import { bytesToHex, hexToBytes } from '@noble/curves/abstract/utils';
import pino from 'pino';
import type {
  ParticipantId,
  SigningSession,
  SigningSessionState,
  SigningCommitment,
  SignatureShare,
  Signature,
  FrostConfig,
  FrostMessage,
  FrostMessageType,
  SigningRequestPayload,
} from './types.js';
import { FrostSigner } from './signer.js';

const logger = pino({ name: 'frost-coordinator' });

// Event types for external communication
export interface FrostCoordinatorEvents {
  onSessionCreated: (sessionId: string, message: Uint8Array, participants: ParticipantId[]) => void;
  onSignatureComplete: (sessionId: string, signature: Signature) => void;
  onSessionFailed: (sessionId: string, error: string) => void;
  onMessageToSend: (message: FrostMessage, recipients: ParticipantId[]) => void;
}

// Pending signing request
interface PendingRequest {
  sessionId: string;
  message: Uint8Array;
  participants: ParticipantId[];
  resolve: (signature: Signature) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
}

// FROST Coordinator manages signing sessions
export class FrostCoordinator {
  private config: FrostConfig;
  private signer: FrostSigner;
  private events: FrostCoordinatorEvents;
  private pendingRequests: Map<string, PendingRequest>;
  private isCoordinator: boolean;

  constructor(
    config: FrostConfig,
    signer: FrostSigner,
    events: FrostCoordinatorEvents,
    isCoordinator: boolean = false
  ) {
    this.config = config;
    this.signer = signer;
    this.events = events;
    this.pendingRequests = new Map();
    this.isCoordinator = isCoordinator;

    logger.info(
      { participantId: config.participantId, isCoordinator },
      'FROST Coordinator initialized'
    );
  }

  // Initiate a signing request
  async requestSignature(
    message: Uint8Array,
    participants?: ParticipantId[]
  ): Promise<Signature> {
    // Default to all participants if not specified
    const signers = participants ?? Array.from(
      { length: this.config.totalParticipants },
      (_, i) => i + 1
    );

    if (signers.length < this.config.threshold) {
      throw new Error(
        `Insufficient participants: ${signers.length} < ${this.config.threshold}`
      );
    }

    // Generate unique session ID
    const sessionId = this.generateSessionId();

    logger.info({ sessionId, message: bytesToHex(message), participants: signers }, 'Initiating signing request');

    return new Promise((resolve, reject) => {
      // Set up timeout
      const timeout = setTimeout(() => {
        this.handleSessionTimeout(sessionId);
      }, this.config.signingTimeout);

      // Store pending request
      this.pendingRequests.set(sessionId, {
        sessionId,
        message,
        participants: signers,
        resolve,
        reject,
        timeout,
      });

      // Create local session
      this.signer.createSession(sessionId, message, signers);

      // Generate and add our commitment
      const commitment = this.signer.generateNonces(sessionId);
      this.signer.addCommitment(sessionId, commitment);

      // Broadcast signing request to other participants
      const requestMessage: FrostMessage = {
        type: FrostMessageType.SIGNING_REQUEST,
        sessionId,
        fromParticipant: this.config.participantId,
        timestamp: Date.now(),
        payload: {
          message: Array.from(message),
          participants: signers,
        } as SigningRequestPayload,
      };

      this.events.onMessageToSend(
        requestMessage,
        signers.filter(p => p !== this.config.participantId)
      );

      // Broadcast our commitment
      const commitmentMessage: FrostMessage = {
        type: FrostMessageType.SIGNING_COMMITMENT,
        sessionId,
        fromParticipant: this.config.participantId,
        timestamp: Date.now(),
        payload: {
          participantId: commitment.participantId,
          hiding: Array.from(commitment.hiding),
          binding: Array.from(commitment.binding),
        },
      };

      this.events.onMessageToSend(
        commitmentMessage,
        signers.filter(p => p !== this.config.participantId)
      );
    });
  }

  // Handle incoming FROST message
  handleMessage(message: FrostMessage): void {
    logger.debug(
      { type: message.type, sessionId: message.sessionId, from: message.fromParticipant },
      'Handling FROST message'
    );

    switch (message.type) {
      case FrostMessageType.SIGNING_REQUEST:
        this.handleSigningRequest(message);
        break;
      case FrostMessageType.SIGNING_COMMITMENT:
        this.handleSigningCommitment(message);
        break;
      case FrostMessageType.SIGNING_SHARE:
        this.handleSigningShare(message);
        break;
      case FrostMessageType.SIGNING_COMPLETE:
        this.handleSigningComplete(message);
        break;
      case FrostMessageType.SIGNING_ABORT:
        this.handleSigningAbort(message);
        break;
      default:
        logger.warn({ type: message.type }, 'Unknown message type');
    }
  }

  // Handle signing request
  private handleSigningRequest(message: FrostMessage): void {
    const payload = message.payload as SigningRequestPayload;
    const messageBytes = new Uint8Array(payload.message);

    // Check if we're a participant
    if (!payload.participants.includes(this.config.participantId)) {
      logger.debug({ sessionId: message.sessionId }, 'Not a participant in this session');
      return;
    }

    // Create local session
    try {
      this.signer.createSession(message.sessionId, messageBytes, payload.participants);
    } catch (error) {
      // Session might already exist
      logger.debug({ sessionId: message.sessionId }, 'Session already exists');
    }

    // Generate and broadcast our commitment
    const commitment = this.signer.generateNonces(message.sessionId);
    this.signer.addCommitment(message.sessionId, commitment);

    const commitmentMessage: FrostMessage = {
      type: FrostMessageType.SIGNING_COMMITMENT,
      sessionId: message.sessionId,
      fromParticipant: this.config.participantId,
      timestamp: Date.now(),
      payload: {
        participantId: commitment.participantId,
        hiding: Array.from(commitment.hiding),
        binding: Array.from(commitment.binding),
      },
    };

    this.events.onMessageToSend(
      commitmentMessage,
      payload.participants.filter(p => p !== this.config.participantId)
    );
  }

  // Handle signing commitment
  private handleSigningCommitment(message: FrostMessage): void {
    const payload = message.payload as {
      participantId: ParticipantId;
      hiding: number[];
      binding: number[];
    };

    const commitment: SigningCommitment = {
      participantId: payload.participantId,
      hiding: new Uint8Array(payload.hiding),
      binding: new Uint8Array(payload.binding),
    };

    const session = this.signer.getSession(message.sessionId);
    if (!session) {
      logger.warn({ sessionId: message.sessionId }, 'Session not found for commitment');
      return;
    }

    try {
      this.signer.addCommitment(message.sessionId, commitment);
    } catch (error) {
      logger.warn({ sessionId: message.sessionId, error }, 'Failed to add commitment');
      return;
    }

    // Check if we should generate our share
    const updatedSession = this.signer.getSession(message.sessionId);
    if (updatedSession?.state === SigningSessionState.COLLECTING_SHARES) {
      this.generateAndBroadcastShare(message.sessionId, updatedSession);
    }
  }

  // Generate and broadcast signature share
  private generateAndBroadcastShare(sessionId: string, session: SigningSession): void {
    try {
      const share = this.signer.generateShare(sessionId);
      this.signer.addShare(sessionId, share);

      const shareMessage: FrostMessage = {
        type: FrostMessageType.SIGNING_SHARE,
        sessionId,
        fromParticipant: this.config.participantId,
        timestamp: Date.now(),
        payload: {
          participantId: share.participantId,
          share: Array.from(share.share),
        },
      };

      this.events.onMessageToSend(
        shareMessage,
        Array.from(session.participants).filter(p => p !== this.config.participantId)
      );

      // Check if signature is complete
      this.checkSignatureComplete(sessionId);
    } catch (error) {
      logger.error({ sessionId, error }, 'Failed to generate share');
    }
  }

  // Handle signing share
  private handleSigningShare(message: FrostMessage): void {
    const payload = message.payload as {
      participantId: ParticipantId;
      share: number[];
    };

    const share: SignatureShare = {
      participantId: payload.participantId,
      share: new Uint8Array(payload.share),
    };

    try {
      this.signer.addShare(message.sessionId, share);
      this.checkSignatureComplete(message.sessionId);
    } catch (error) {
      logger.warn({ sessionId: message.sessionId, error }, 'Failed to add share');
    }
  }

  // Check if signature is complete and resolve pending request
  private checkSignatureComplete(sessionId: string): void {
    const session = this.signer.getSession(sessionId);
    if (!session || session.state !== SigningSessionState.COMPLETE) {
      return;
    }

    const signature = this.signer.getSignature(sessionId);
    if (!signature) {
      return;
    }

    logger.info({ sessionId }, 'Signature complete');

    // Broadcast completion
    const completeMessage: FrostMessage = {
      type: FrostMessageType.SIGNING_COMPLETE,
      sessionId,
      fromParticipant: this.config.participantId,
      timestamp: Date.now(),
      payload: {
        R: Array.from(signature.R),
        z: Array.from(signature.z),
      },
    };

    this.events.onMessageToSend(
      completeMessage,
      Array.from(session.participants).filter(p => p !== this.config.participantId)
    );

    // Resolve pending request if we initiated it
    const pending = this.pendingRequests.get(sessionId);
    if (pending) {
      clearTimeout(pending.timeout);
      this.pendingRequests.delete(sessionId);
      pending.resolve(signature);
    }

    this.events.onSignatureComplete(sessionId, signature);
  }

  // Handle signing complete
  private handleSigningComplete(message: FrostMessage): void {
    const payload = message.payload as {
      R: number[];
      z: number[];
    };

    const signature: Signature = {
      R: new Uint8Array(payload.R),
      z: new Uint8Array(payload.z),
    };

    // Verify signature
    const session = this.signer.getSession(message.sessionId);
    if (!session) {
      logger.warn({ sessionId: message.sessionId }, 'Session not found for completion');
      return;
    }

    if (!this.signer.verifySignature(session.message, signature)) {
      logger.error({ sessionId: message.sessionId }, 'Invalid signature received');
      return;
    }

    logger.info({ sessionId: message.sessionId }, 'Received valid signature');

    // Resolve pending request
    const pending = this.pendingRequests.get(message.sessionId);
    if (pending) {
      clearTimeout(pending.timeout);
      this.pendingRequests.delete(message.sessionId);
      pending.resolve(signature);
    }

    this.events.onSignatureComplete(message.sessionId, signature);
  }

  // Handle signing abort
  private handleSigningAbort(message: FrostMessage): void {
    const payload = message.payload as { reason: string };

    logger.warn({ sessionId: message.sessionId, reason: payload.reason }, 'Signing aborted');

    const pending = this.pendingRequests.get(message.sessionId);
    if (pending) {
      clearTimeout(pending.timeout);
      this.pendingRequests.delete(message.sessionId);
      pending.reject(new Error(`Signing aborted: ${payload.reason}`));
    }

    this.events.onSessionFailed(message.sessionId, payload.reason);
  }

  // Handle session timeout
  private handleSessionTimeout(sessionId: string): void {
    logger.error({ sessionId }, 'Signing session timed out');

    const pending = this.pendingRequests.get(sessionId);
    if (pending) {
      this.pendingRequests.delete(sessionId);
      pending.reject(new Error('Signing session timed out'));
    }

    // Broadcast abort
    const session = this.signer.getSession(sessionId);
    if (session) {
      const abortMessage: FrostMessage = {
        type: FrostMessageType.SIGNING_ABORT,
        sessionId,
        fromParticipant: this.config.participantId,
        timestamp: Date.now(),
        payload: { reason: 'Timeout' },
      };

      this.events.onMessageToSend(
        abortMessage,
        Array.from(session.participants).filter(p => p !== this.config.participantId)
      );
    }

    this.events.onSessionFailed(sessionId, 'Timeout');
  }

  // Generate unique session ID
  private generateSessionId(): string {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substring(2, 8);
    return `${this.config.participantId}-${timestamp}-${random}`;
  }

  // Get signer instance
  getSigner(): FrostSigner {
    return this.signer;
  }

  // Serialize signature for on-chain submission
  serializeSignature(signature: Signature): Uint8Array {
    return this.signer.serializeSignature(signature);
  }

  // Cleanup old sessions
  cleanup(): void {
    this.signer.cleanupOldSessions(this.config.signingTimeout * 2);
  }
}
