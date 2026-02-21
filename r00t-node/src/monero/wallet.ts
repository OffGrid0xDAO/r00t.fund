import { z } from 'zod';
import pino from 'pino';

const logger = pino({ name: 'monero-wallet' });

// Type definitions for Monero wallet RPC responses
const TransferDestinationSchema = z.object({
  amount: z.bigint(),
  address: z.string(),
});

const TransferSchema = z.object({
  amount: z.bigint(),
  height: z.number(),
  timestamp: z.number(),
  txid: z.string(),
  payment_id: z.string().optional(),
  subaddr_index: z.object({
    major: z.number(),
    minor: z.number(),
  }),
  destinations: z.array(TransferDestinationSchema).optional(),
  type: z.string(),
  unlock_time: z.number(),
  locked: z.boolean(),
  fee: z.bigint().optional(),
  confirmations: z.number().optional(),
});

const SubaddressSchema = z.object({
  address: z.string(),
  address_index: z.number(),
  label: z.string(),
  balance: z.bigint(),
  unlocked_balance: z.bigint(),
  num_unspent_outputs: z.number(),
  blocks_to_unlock: z.number(),
  time_to_unlock: z.number(),
});

export type Transfer = z.infer<typeof TransferSchema>;
export type Subaddress = z.infer<typeof SubaddressSchema>;

// Monero wallet RPC client
export class MoneroWallet {
  private rpcUrl: string;
  private auth?: { username: string; password: string };

  constructor(config: {
    rpcUrl: string;
    username?: string;
    password?: string;
  }) {
    this.rpcUrl = config.rpcUrl;
    if (config.username && config.password) {
      this.auth = { username: config.username, password: config.password };
    }
  }

  // Generic RPC call
  private async rpcCall<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (this.auth) {
      const credentials = Buffer.from(`${this.auth.username}:${this.auth.password}`).toString('base64');
      headers['Authorization'] = `Basic ${credentials}`;
    }

    const response = await fetch(`${this.rpcUrl}/json_rpc`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: '0',
        method,
        params,
      }),
    });

    if (!response.ok) {
      throw new Error(`RPC request failed: ${response.status} ${response.statusText}`);
    }

    const data = await response.json() as { result?: T; error?: { code: number; message: string } };

    if (data.error) {
      throw new Error(`RPC error: ${data.error.code} - ${data.error.message}`);
    }

    return data.result as T;
  }

  // Open or create a wallet
  async openWallet(filename: string, password: string): Promise<void> {
    await this.rpcCall('open_wallet', { filename, password });
    logger.info({ filename }, 'Wallet opened');
  }

  // Close the current wallet
  async closeWallet(): Promise<void> {
    await this.rpcCall('close_wallet');
    logger.info('Wallet closed');
  }

  // Create a new wallet
  async createWallet(filename: string, password: string, language: string = 'English'): Promise<void> {
    await this.rpcCall('create_wallet', { filename, password, language });
    logger.info({ filename }, 'Wallet created');
  }

  // Get wallet balance
  async getBalance(accountIndex: number = 0): Promise<{
    balance: bigint;
    unlockedBalance: bigint;
    multisigImportNeeded: boolean;
  }> {
    const result = await this.rpcCall<{
      balance: number;
      unlocked_balance: number;
      multisig_import_needed: boolean;
    }>('get_balance', { account_index: accountIndex });

    return {
      balance: BigInt(result.balance),
      unlockedBalance: BigInt(result.unlocked_balance),
      multisigImportNeeded: result.multisig_import_needed,
    };
  }

  // Get wallet address
  async getAddress(accountIndex: number = 0, addressIndex: number = 0): Promise<{
    address: string;
    addresses: Array<{ address: string; addressIndex: number; label: string; used: boolean }>;
  }> {
    const result = await this.rpcCall<{
      address: string;
      addresses: Array<{ address: string; address_index: number; label: string; used: boolean }>;
    }>('get_address', { account_index: accountIndex, address_index: [addressIndex] });

    return {
      address: result.address,
      addresses: result.addresses.map(a => ({
        address: a.address,
        addressIndex: a.address_index,
        label: a.label,
        used: a.used,
      })),
    };
  }

  // Create a new subaddress for deposits
  async createSubaddress(accountIndex: number = 0, label: string = ''): Promise<{
    address: string;
    addressIndex: number;
  }> {
    const result = await this.rpcCall<{
      address: string;
      address_index: number;
    }>('create_address', { account_index: accountIndex, label });

    logger.info({ address: result.address, addressIndex: result.address_index }, 'Created subaddress');

    return {
      address: result.address,
      addressIndex: result.address_index,
    };
  }

  // Get all subaddresses
  async getSubaddresses(accountIndex: number = 0): Promise<Subaddress[]> {
    const result = await this.rpcCall<{
      addresses: Array<{
        address: string;
        address_index: number;
        label: string;
        balance: number;
        unlocked_balance: number;
        num_unspent_outputs: number;
        blocks_to_unlock: number;
        time_to_unlock: number;
      }>;
    }>('get_address', { account_index: accountIndex });

    return result.addresses.map(a => ({
      address: a.address,
      address_index: a.address_index,
      label: a.label,
      balance: BigInt(a.balance),
      unlocked_balance: BigInt(a.unlocked_balance),
      num_unspent_outputs: a.num_unspent_outputs,
      blocks_to_unlock: a.blocks_to_unlock,
      time_to_unlock: a.time_to_unlock,
    }));
  }

  // Get incoming transfers for a specific subaddress
  async getTransfers(options: {
    accountIndex?: number;
    subaddressIndices?: number[];
    in?: boolean;
    out?: boolean;
    pending?: boolean;
    failed?: boolean;
    pool?: boolean;
    minHeight?: number;
    maxHeight?: number;
    filterByHeight?: boolean;
  } = {}): Promise<{
    in?: Transfer[];
    out?: Transfer[];
    pending?: Transfer[];
    failed?: Transfer[];
    pool?: Transfer[];
  }> {
    const params: Record<string, unknown> = {
      account_index: options.accountIndex ?? 0,
      in: options.in ?? true,
      out: options.out ?? false,
      pending: options.pending ?? true,
      failed: options.failed ?? false,
      pool: options.pool ?? true,
    };

    if (options.subaddressIndices) {
      params['subaddr_indices'] = options.subaddressIndices;
    }

    if (options.filterByHeight) {
      params['filter_by_height'] = true;
      if (options.minHeight !== undefined) params['min_height'] = options.minHeight;
      if (options.maxHeight !== undefined) params['max_height'] = options.maxHeight;
    }

    const result = await this.rpcCall<{
      in?: Array<Record<string, unknown>>;
      out?: Array<Record<string, unknown>>;
      pending?: Array<Record<string, unknown>>;
      failed?: Array<Record<string, unknown>>;
      pool?: Array<Record<string, unknown>>;
    }>('get_transfers', params);

    const parseTransfers = (transfers?: Array<Record<string, unknown>>): Transfer[] | undefined => {
      if (!transfers) return undefined;
      return transfers.map(t => ({
        amount: BigInt(t['amount'] as number),
        height: t['height'] as number,
        timestamp: t['timestamp'] as number,
        txid: t['txid'] as string,
        payment_id: t['payment_id'] as string | undefined,
        subaddr_index: t['subaddr_index'] as { major: number; minor: number },
        type: t['type'] as string,
        unlock_time: t['unlock_time'] as number,
        locked: t['locked'] as boolean,
        fee: t['fee'] !== undefined ? BigInt(t['fee'] as number) : undefined,
        confirmations: t['confirmations'] as number | undefined,
      }));
    };

    return {
      in: parseTransfers(result.in),
      out: parseTransfers(result.out),
      pending: parseTransfers(result.pending),
      failed: parseTransfers(result.failed),
      pool: parseTransfers(result.pool),
    };
  }

  // Get transaction by ID
  async getTransferByTxid(txid: string, accountIndex: number = 0): Promise<Transfer | null> {
    try {
      const result = await this.rpcCall<{
        transfer: Record<string, unknown>;
      }>('get_transfer_by_txid', { txid, account_index: accountIndex });

      const t = result.transfer;
      return {
        amount: BigInt(t['amount'] as number),
        height: t['height'] as number,
        timestamp: t['timestamp'] as number,
        txid: t['txid'] as string,
        payment_id: t['payment_id'] as string | undefined,
        subaddr_index: t['subaddr_index'] as { major: number; minor: number },
        type: t['type'] as string,
        unlock_time: t['unlock_time'] as number,
        locked: t['locked'] as boolean,
        fee: t['fee'] !== undefined ? BigInt(t['fee'] as number) : undefined,
        confirmations: t['confirmations'] as number | undefined,
      };
    } catch {
      return null;
    }
  }

  // Send XMR to an address
  async transfer(options: {
    destinations: Array<{ address: string; amount: bigint }>;
    accountIndex?: number;
    subaddrIndices?: number[];
    priority?: number;
    ringSize?: number;
    unlockTime?: number;
  }): Promise<{
    txHash: string;
    txKey: string;
    amount: bigint;
    fee: bigint;
    txBlob: string;
    txMetadata: string;
    multisigTxset: string;
    unsignedTxset: string;
  }> {
    const result = await this.rpcCall<{
      tx_hash: string;
      tx_key: string;
      amount: number;
      fee: number;
      tx_blob: string;
      tx_metadata: string;
      multisig_txset: string;
      unsigned_txset: string;
    }>('transfer', {
      destinations: options.destinations.map(d => ({
        address: d.address,
        amount: Number(d.amount),
      })),
      account_index: options.accountIndex ?? 0,
      subaddr_indices: options.subaddrIndices ?? [0],
      priority: options.priority ?? 1,
      ring_size: options.ringSize ?? 16,
      unlock_time: options.unlockTime ?? 0,
      get_tx_key: true,
      get_tx_hex: true,
      get_tx_metadata: true,
    });

    logger.info(
      { txHash: result.tx_hash, amount: result.amount, fee: result.fee },
      'Transfer sent'
    );

    return {
      txHash: result.tx_hash,
      txKey: result.tx_key,
      amount: BigInt(result.amount),
      fee: BigInt(result.fee),
      txBlob: result.tx_blob,
      txMetadata: result.tx_metadata,
      multisigTxset: result.multisig_txset,
      unsignedTxset: result.unsigned_txset,
    };
  }

  // Get current blockchain height
  async getHeight(): Promise<number> {
    const result = await this.rpcCall<{ height: number }>('get_height');
    return result.height;
  }

  // Refresh wallet (sync with daemon)
  async refresh(startHeight?: number): Promise<{ blocksReceived: number; receivedMoney: boolean }> {
    const result = await this.rpcCall<{
      blocks_fetched: number;
      received_money: boolean;
    }>('refresh', startHeight !== undefined ? { start_height: startHeight } : {});

    return {
      blocksReceived: result.blocks_fetched,
      receivedMoney: result.received_money,
    };
  }

  // Auto-refresh control
  async setAutoRefresh(enable: boolean, period?: number): Promise<void> {
    await this.rpcCall('auto_refresh', { enable, period });
  }

  // Validate an address
  async validateAddress(address: string): Promise<{
    valid: boolean;
    integrated: boolean;
    subaddress: boolean;
    nettype: string;
    openalias_address?: string;
  }> {
    const result = await this.rpcCall<{
      valid: boolean;
      integrated: boolean;
      subaddress: boolean;
      nettype: string;
      openalias_address?: string;
    }>('validate_address', { address });

    return result;
  }

  // Export outputs for offline signing
  async exportOutputs(all?: boolean): Promise<string> {
    const result = await this.rpcCall<{ outputs_data_hex: string }>('export_outputs', { all });
    return result.outputs_data_hex;
  }

  // Import outputs for offline signing
  async importOutputs(outputsDataHex: string): Promise<number> {
    const result = await this.rpcCall<{ num_imported: number }>('import_outputs', {
      outputs_data_hex: outputsDataHex,
    });
    return result.num_imported;
  }

  // Get transaction proof (for verifying payment)
  async getProof(txid: string, address: string, message?: string): Promise<string> {
    const result = await this.rpcCall<{ signature: string }>('get_tx_proof', {
      txid,
      address,
      message,
    });
    return result.signature;
  }

  // Verify a payment proof
  async checkProof(txid: string, address: string, signature: string, message?: string): Promise<{
    good: boolean;
    received: bigint;
    inPool: boolean;
    confirmations: number;
  }> {
    const result = await this.rpcCall<{
      good: boolean;
      received: number;
      in_pool: boolean;
      confirmations: number;
    }>('check_tx_proof', {
      txid,
      address,
      signature,
      message,
    });

    return {
      good: result.good,
      received: BigInt(result.received),
      inPool: result.in_pool,
      confirmations: result.confirmations,
    };
  }
}

// Singleton wallet instance
let walletInstance: MoneroWallet | null = null;

export function getMoneroWallet(config?: {
  rpcUrl: string;
  username?: string;
  password?: string;
}): MoneroWallet {
  if (!walletInstance && config) {
    walletInstance = new MoneroWallet(config);
  }
  if (!walletInstance) {
    throw new Error('Monero wallet not initialized');
  }
  return walletInstance;
}
