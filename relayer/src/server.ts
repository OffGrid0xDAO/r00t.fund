import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import { z } from 'zod';
import { ethers } from 'ethers';
import { TransactionQueue } from './queue';

// Request validation schemas
const RelayRequestSchema = z.object({
  action: z.enum(['sell', 'transfer']),
  proof: z.array(z.string()).length(8),
  publicSignals: z.array(z.string()),
  merkleRoot: z.string(),
  nullifierHash: z.string(),
  encryptedNotes: z.array(z.string()).optional(),

  // Sell-specific
  tokenAmount: z.string().optional(),
  minEthOut: z.string().optional(),
  recipient: z.string().optional(),
  changeCommitment: z.string().optional(),
  changeNote: z.string().optional(),

  // Transfer-specific
  recipientCommitment: z.string().optional(),
  recipientNote: z.string().optional(),
});

type RelayRequest = z.infer<typeof RelayRequestSchema>;

// ZkAMM ABI
const ZKAMM_ABI = [
  'function sellPrivate(uint256[8] proof, uint256 merkleRoot, uint256 nullifierHash, uint256 tokenAmount, uint256 minEthOut, address recipient, address relayer, uint256 fee, uint256 changeCommitment, bytes changeNote)',
  'function transferPrivate(uint256[8] proof, uint256 merkleRoot, uint256 nullifierHash, uint256 recipientCommitment, uint256 changeCommitment, bytes recipientNote, bytes changeNote)',
];

export interface RelayerConfig {
  port: number;
  rpcUrl: string;
  zkAMMAddress: string;
  privateKey: string;
  baseFee: string; // in wei
  percentFee: string; // e.g., "0.1" for 0.1%
  redisUrl?: string;
}

export function createServer(config: RelayerConfig) {
  const app = express();

  // Middleware
  app.use(cors());
  app.use(express.json());

  // Initialize provider and wallet
  const provider = new ethers.JsonRpcProvider(config.rpcUrl);
  const wallet = new ethers.Wallet(config.privateKey, provider);
  const zkAMM = new ethers.Contract(config.zkAMMAddress, ZKAMM_ABI, wallet);

  // Initialize queue
  const queue = new TransactionQueue({
    redisUrl: config.redisUrl,
    wallet,
    zkAMM,
  });

  // Health check
  app.get('/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok', address: wallet.address });
  });

  // Get relayer address
  app.get('/address', (_req: Request, res: Response) => {
    res.json({ address: wallet.address });
  });

  // Get fees
  app.get('/fees', (_req: Request, res: Response) => {
    res.json({
      baseFee: config.baseFee,
      percentFee: config.percentFee,
    });
  });

  // Submit relay request
  app.post('/relay', async (req: Request, res: Response, next: NextFunction) => {
    try {
      // Validate request
      const parseResult = RelayRequestSchema.safeParse(req.body);
      if (!parseResult.success) {
        res.status(400).json({
          error: 'Invalid request',
          details: parseResult.error.issues,
        });
        return;
      }

      const request = parseResult.data;

      // Basic validation
      if (request.action === 'sell') {
        if (!request.tokenAmount || !request.minEthOut || !request.recipient) {
          res.status(400).json({ error: 'Missing required fields for sell' });
          return;
        }
      } else if (request.action === 'transfer') {
        if (!request.recipientCommitment) {
          res.status(400).json({ error: 'Missing required fields for transfer' });
          return;
        }
      }

      // Queue the transaction
      const jobId = await queue.addTransaction(request);

      res.json({
        jobId,
        status: 'queued',
        message: 'Transaction queued for processing',
      });
    } catch (error) {
      next(error);
    }
  });

  // Get transaction status
  app.get('/status/:jobId', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { jobId } = req.params;
      const status = await queue.getStatus(jobId);

      if (!status) {
        res.status(404).json({ error: 'Job not found' });
        return;
      }

      res.json(status);
    } catch (error) {
      next(error);
    }
  });

  // Error handler
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    console.error('Error:', err);
    res.status(500).json({
      error: 'Internal server error',
      message: err.message,
    });
  });

  return {
    app,
    start: () => {
      app.listen(config.port, () => {
        console.log(`Relayer listening on port ${config.port}`);
        console.log(`Address: ${wallet.address}`);
      });
    },
    queue,
  };
}
