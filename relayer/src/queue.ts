import { Queue, Worker, Job } from 'bullmq';
import { ethers } from 'ethers';
import IORedis from 'ioredis';

export interface TransactionJob {
  id: string;
  action: 'sell' | 'transfer';
  proof: string[];
  publicSignals: string[];
  merkleRoot: string;
  nullifierHash: string;

  // Sell-specific
  tokenAmount?: string;
  minEthOut?: string;
  recipient?: string;
  changeCommitment?: string;
  changeNote?: string;

  // Transfer-specific
  recipientCommitment?: string;
  recipientNote?: string;

  // Status
  status: 'queued' | 'processing' | 'completed' | 'failed';
  txHash?: string;
  error?: string;
  createdAt: number;
  completedAt?: number;
}

export interface TransactionQueueConfig {
  redisUrl?: string;
  wallet: ethers.Wallet;
  zkAMM: ethers.Contract;
}

export class TransactionQueue {
  private queue: Queue | null = null;
  private worker: Worker | null = null;
  private jobs: Map<string, TransactionJob> = new Map();
  private wallet: ethers.Wallet;
  private zkAMM: ethers.Contract;
  private connection: IORedis | null = null;

  constructor(config: TransactionQueueConfig) {
    this.wallet = config.wallet;
    this.zkAMM = config.zkAMM;

    if (config.redisUrl) {
      this.connection = new IORedis(config.redisUrl, {
        maxRetriesPerRequest: null,
      });
      this.initializeQueue();
    }
  }

  private initializeQueue() {
    if (!this.connection) return;

    this.queue = new Queue('relay-transactions', {
      connection: this.connection,
    });

    this.worker = new Worker(
      'relay-transactions',
      async (job: Job) => {
        return this.processTransaction(job.data);
      },
      {
        connection: this.connection,
        concurrency: 1, // Process one at a time for nonce management
      }
    );

    this.worker.on('completed', (job, result) => {
      console.log(`Job ${job.id} completed:`, result);
    });

    this.worker.on('failed', (job, err) => {
      console.error(`Job ${job?.id} failed:`, err);
    });
  }

  async addTransaction(request: Omit<TransactionJob, 'id' | 'status' | 'createdAt'>): Promise<string> {
    const id = this.generateId();
    const job: TransactionJob = {
      ...request,
      id,
      status: 'queued',
      createdAt: Date.now(),
    };

    this.jobs.set(id, job);

    if (this.queue) {
      await this.queue.add('relay', job, { jobId: id });
    } else {
      // Process immediately if no Redis
      this.processTransaction(job).catch(console.error);
    }

    return id;
  }

  async getStatus(jobId: string): Promise<TransactionJob | null> {
    return this.jobs.get(jobId) || null;
  }

  private async processTransaction(job: TransactionJob): Promise<{ txHash: string }> {
    console.log(`Processing ${job.action} transaction ${job.id}`);

    const storedJob = this.jobs.get(job.id);
    if (storedJob) {
      storedJob.status = 'processing';
    }

    try {
      let tx: ethers.TransactionResponse;

      const proof = job.proof.map((p) => BigInt(p));

      if (job.action === 'sell') {
        tx = await this.zkAMM.sellPrivate(
          proof,
          BigInt(job.merkleRoot),
          BigInt(job.nullifierHash),
          BigInt(job.tokenAmount!),
          BigInt(job.minEthOut!),
          job.recipient!,
          this.wallet.address, // relayer
          0n, // TODO: Calculate fee
          job.changeCommitment ? BigInt(job.changeCommitment) : 0n,
          job.changeNote || '0x'
        );
      } else {
        tx = await this.zkAMM.transferPrivate(
          proof,
          BigInt(job.merkleRoot),
          BigInt(job.nullifierHash),
          BigInt(job.recipientCommitment!),
          job.changeCommitment ? BigInt(job.changeCommitment) : 0n,
          job.recipientNote || '0x',
          job.changeNote || '0x'
        );
      }

      console.log(`Transaction submitted: ${tx.hash}`);

      // Wait for confirmation
      const receipt = await tx.wait();

      if (storedJob) {
        storedJob.status = 'completed';
        storedJob.txHash = tx.hash;
        storedJob.completedAt = Date.now();
      }

      console.log(`Transaction confirmed in block ${receipt?.blockNumber}`);

      return { txHash: tx.hash };
    } catch (error) {
      console.error(`Transaction failed:`, error);

      if (storedJob) {
        storedJob.status = 'failed';
        storedJob.error = error instanceof Error ? error.message : 'Unknown error';
      }

      throw error;
    }
  }

  private generateId(): string {
    return `relay-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  }

  async close() {
    if (this.worker) {
      await this.worker.close();
    }
    if (this.queue) {
      await this.queue.close();
    }
    if (this.connection) {
      await this.connection.quit();
    }
  }
}
