import pino from 'pino';
import { bytesToHex, hexToBytes } from '@noble/curves/abstract/utils';
import { sha256 } from '@noble/hashes/sha256';
import type { MoneroWallet, Transfer } from '../monero/wallet.js';
import type { FrostCoordinator } from '../frost/coordinator.js';
import type { Config } from '../config.js';

const logger = pino({ name: 'deposit-processor' });

// Deposit intent from database
export interface DepositIntent {
  id: string;
  subaddressIndex: number;
  subaddress: string;
  userNullifier: string;
  userSecretHash: string;
  expectedCommitment: string;
  encryptedNote: string;
  status: 'pending' | 'detected' | 'confirming' | 'attesting' | 'complete' | 'failed' | 'expired';
  createdAt: Date;
  expiresAt: Date;
  xmrTxHash?: string;
  xmrAmount?: bigint;
  xmrBlockHeight?: number;
  r00tAmount?: bigint;
  leafIndex?: number;
  errorMessage?: string;
}

// Detected deposit
export interface DetectedDeposit {
  intentId: string;
  transfer: Transfer;
  confirmations: number;
}

// Deposit attestation data
export interface DepositAttestation {
  intentId: string;
  xmrTxHash: string;
  xmrBlockHeight: number;
  xmrAmount: bigint;
  confirmations: number;
  r00tAmount: bigint;
  timestamp: number;
}

// Database interface (abstract)
export interface DepositDatabase {
  getPendingIntents(): Promise<DepositIntent[]>;
  getDetectingIntents(): Promise<DepositIntent[]>;
  getConfirmingIntents(): Promise<DepositIntent[]>;
  updateIntent(id: string, updates: Partial<DepositIntent>): Promise<void>;
  getIntentBySubaddress(subaddressIndex: number): Promise<DepositIntent | null>;
}

// AMM interface for pricing
export interface AMMPricer {
  getR00TAmountOut(xmrAmount: bigint): Promise<bigint>;
}

// Ethereum interface for submitting attestations
export interface EthereumBridge {
  submitDepositAttestation(
    attestation: DepositAttestation,
    signature: Uint8Array,
    signerIndices: number[]
  ): Promise<{ txHash: string; leafIndex: number }>;
}

// Deposit Processor service
export class DepositProcessor {
  private config: Config;
  private wallet: MoneroWallet;
  private frost: FrostCoordinator;
  private database: DepositDatabase;
  private pricer: AMMPricer;
  private bridge: EthereumBridge;
  private isRunning: boolean = false;
  private scanInterval?: NodeJS.Timeout;

  constructor(
    config: Config,
    wallet: MoneroWallet,
    frost: FrostCoordinator,
    database: DepositDatabase,
    pricer: AMMPricer,
    bridge: EthereumBridge
  ) {
    this.config = config;
    this.wallet = wallet;
    this.frost = frost;
    this.database = database;
    this.pricer = pricer;
    this.bridge = bridge;
  }

  // Start the deposit processor
  async start(): Promise<void> {
    if (this.isRunning) {
      logger.warn('Deposit processor already running');
      return;
    }

    this.isRunning = true;
    logger.info('Starting deposit processor');

    // Initial scan
    await this.scanForDeposits();

    // Set up periodic scanning
    this.scanInterval = setInterval(async () => {
      try {
        await this.scanForDeposits();
        await this.processConfirmingDeposits();
      } catch (error) {
        logger.error({ error }, 'Error in deposit scan cycle');
      }
    }, this.config.operations.depositScanInterval);
  }

  // Stop the deposit processor
  stop(): void {
    if (!this.isRunning) return;

    this.isRunning = false;
    if (this.scanInterval) {
      clearInterval(this.scanInterval);
      this.scanInterval = undefined;
    }

    logger.info('Deposit processor stopped');
  }

  // Scan for new deposits
  private async scanForDeposits(): Promise<void> {
    logger.debug('Scanning for deposits');

    // Refresh wallet
    await this.wallet.refresh();

    // Get all pending intents
    const pendingIntents = await this.database.getPendingIntents();

    if (pendingIntents.length === 0) {
      return;
    }

    // Get subaddress indices to scan
    const subaddressIndices = pendingIntents.map(i => i.subaddressIndex);

    // Get incoming transfers for these subaddresses
    const transfers = await this.wallet.getTransfers({
      subaddressIndices,
      in: true,
      pending: true,
      pool: true,
    });

    // Process each incoming transfer
    const incomingTransfers = [
      ...(transfers.in ?? []),
      ...(transfers.pending ?? []),
      ...(transfers.pool ?? []),
    ];

    for (const transfer of incomingTransfers) {
      await this.processTransfer(transfer, pendingIntents);
    }

    // Check for expired intents
    await this.checkExpiredIntents(pendingIntents);
  }

  // Process a single transfer
  private async processTransfer(transfer: Transfer, intents: DepositIntent[]): Promise<void> {
    const subaddressIndex = transfer.subaddr_index.minor;

    // Find matching intent
    const intent = intents.find(i => i.subaddressIndex === subaddressIndex);
    if (!intent) {
      logger.debug({ subaddressIndex }, 'No intent found for subaddress');
      return;
    }

    // Check if already processing this transfer
    if (intent.xmrTxHash === transfer.txid) {
      logger.debug({ intentId: intent.id, txid: transfer.txid }, 'Transfer already being processed');
      return;
    }

    logger.info(
      { intentId: intent.id, txid: transfer.txid, amount: transfer.amount.toString() },
      'Detected deposit'
    );

    // Update intent with transfer details
    await this.database.updateIntent(intent.id, {
      status: 'detected',
      xmrTxHash: transfer.txid,
      xmrAmount: transfer.amount,
      xmrBlockHeight: transfer.height,
    });
  }

  // Process deposits waiting for confirmations
  private async processConfirmingDeposits(): Promise<void> {
    // Get intents that have been detected but need confirmations
    const detectingIntents = await this.database.getDetectingIntents();

    for (const intent of detectingIntents) {
      if (!intent.xmrTxHash) continue;

      try {
        // Get current transfer state
        const transfer = await this.wallet.getTransferByTxid(intent.xmrTxHash);
        if (!transfer) {
          logger.warn({ intentId: intent.id, txid: intent.xmrTxHash }, 'Transfer not found');
          continue;
        }

        const confirmations = transfer.confirmations ?? 0;

        // Check if we have enough confirmations
        if (confirmations >= this.config.monero.requiredConfirmations) {
          await this.processConfirmedDeposit(intent, transfer);
        } else {
          logger.debug(
            { intentId: intent.id, confirmations, required: this.config.monero.requiredConfirmations },
            'Waiting for confirmations'
          );
        }
      } catch (error) {
        logger.error({ intentId: intent.id, error }, 'Error processing confirming deposit');
      }
    }
  }

  // Process a confirmed deposit
  private async processConfirmedDeposit(intent: DepositIntent, transfer: Transfer): Promise<void> {
    logger.info(
      { intentId: intent.id, txid: transfer.txid, amount: transfer.amount.toString() },
      'Processing confirmed deposit'
    );

    try {
      // Update status to attesting
      await this.database.updateIntent(intent.id, { status: 'attesting' });

      // Calculate R00T amount from AMM
      const r00tAmount = await this.pricer.getR00TAmountOut(transfer.amount);

      // Create attestation
      const attestation: DepositAttestation = {
        intentId: intent.id,
        xmrTxHash: transfer.txid,
        xmrBlockHeight: transfer.height,
        xmrAmount: transfer.amount,
        confirmations: transfer.confirmations ?? this.config.monero.requiredConfirmations,
        r00tAmount,
        timestamp: Date.now(),
      };

      // Create message hash for signing
      const messageHash = this.createAttestationHash(attestation);

      // Request threshold signature
      const signature = await this.frost.requestSignature(messageHash);

      logger.info({ intentId: intent.id }, 'Threshold signature obtained');

      // Submit to Ethereum
      const signerIndices = [1, 2]; // TODO: Get from signing session
      const result = await this.bridge.submitDepositAttestation(
        attestation,
        this.frost.serializeSignature(signature),
        signerIndices
      );

      // Update intent as complete
      await this.database.updateIntent(intent.id, {
        status: 'complete',
        r00tAmount,
        leafIndex: result.leafIndex,
      });

      logger.info(
        { intentId: intent.id, leafIndex: result.leafIndex, ethTxHash: result.txHash },
        'Deposit complete'
      );
    } catch (error) {
      logger.error({ intentId: intent.id, error }, 'Error processing confirmed deposit');

      await this.database.updateIntent(intent.id, {
        status: 'failed',
        errorMessage: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // Create hash of attestation for signing
  private createAttestationHash(attestation: DepositAttestation): Uint8Array {
    // Encode attestation deterministically
    const encoder = new TextEncoder();
    const data = encoder.encode(JSON.stringify({
      intentId: attestation.intentId,
      xmrTxHash: attestation.xmrTxHash,
      xmrBlockHeight: attestation.xmrBlockHeight,
      xmrAmount: attestation.xmrAmount.toString(),
      confirmations: attestation.confirmations,
      r00tAmount: attestation.r00tAmount.toString(),
    }));

    return sha256(data);
  }

  // Check for expired intents
  private async checkExpiredIntents(intents: DepositIntent[]): Promise<void> {
    const now = new Date();

    for (const intent of intents) {
      if (intent.status === 'pending' && intent.expiresAt < now) {
        logger.info({ intentId: intent.id }, 'Intent expired');
        await this.database.updateIntent(intent.id, { status: 'expired' });
      }
    }
  }
}
