/**
 * Wallet Manager - Derives and manages multiple agent wallets
 *
 * Wallets are deterministically derived from a master private key,
 * so they can be recovered if needed.
 */

import { ethers, Wallet, JsonRpcProvider } from 'ethers';
import { CONFIG } from '../../config.js';
import type { Agent, AgentBalance, TokenNote } from '../types.js';

export class WalletManager {
  private provider: JsonRpcProvider;
  private funderWallet: Wallet;
  private agentWallets: Map<number, Wallet> = new Map();
  private agentNotes: Map<number, TokenNote[]> = new Map();

  constructor(privateKey: string) {
    this.provider = new JsonRpcProvider(CONFIG.RPC_URL);
    this.funderWallet = new Wallet(privateKey, this.provider);
  }

  /**
   * Derive agent wallets from the funder's private key
   */
  async initialize(numAgents: number = CONFIG.NUM_AGENTS): Promise<Agent[]> {
    const agents: Agent[] = [];

    for (let i = 0; i < numAgents; i++) {
      // Deterministic derivation: keccak256(privateKey + index)
      const derivedKey = ethers.keccak256(
        ethers.solidityPacked(
          ['bytes32', 'uint256'],
          [this.funderWallet.privateKey, i + 1]
        )
      );
      const wallet = new Wallet(derivedKey, this.provider);
      this.agentWallets.set(i + 1, wallet);
      this.agentNotes.set(i + 1, []);

      agents.push({
        id: i + 1,
        address: wallet.address,
        strategyName: '', // Set later by strategy assignment
      });
    }

    return agents;
  }

  /**
   * Get wallet for a specific agent
   */
  getWallet(agentId: number): Wallet {
    const wallet = this.agentWallets.get(agentId);
    if (!wallet) throw new Error(`Agent ${agentId} not found`);
    return wallet;
  }

  /**
   * Get funder wallet
   */
  getFunder(): Wallet {
    return this.funderWallet;
  }

  /**
   * Get balance for an agent
   */
  async getBalance(agentId: number): Promise<AgentBalance> {
    const wallet = this.getWallet(agentId);
    const eth = await this.provider.getBalance(wallet.address);
    const notes = this.agentNotes.get(agentId) || [];
    const tokens = notes
      .filter(n => !n.spent)
      .reduce((sum, n) => sum + n.amount, 0n);

    return { eth, tokens, tokenNotes: notes.filter(n => !n.spent) };
  }

  /**
   * Get all agent balances
   */
  async getAllBalances(): Promise<Map<number, AgentBalance>> {
    const balances = new Map<number, AgentBalance>();

    for (const [id] of this.agentWallets) {
      balances.set(id, await this.getBalance(id));
    }

    return balances;
  }

  /**
   * Fund agents that are below minimum balance
   */
  async fundAgents(minBalance: bigint = CONFIG.GAS_BUFFER + CONFIG.MIN_TRADE_ETH): Promise<void> {
    const funderBalance = await this.provider.getBalance(this.funderWallet.address);
    console.log(`Funder balance: ${ethers.formatEther(funderBalance)} ETH`);

    let totalNeeded = 0n;
    const needsFunding: { id: number; balance: bigint }[] = [];

    for (const [id, wallet] of this.agentWallets) {
      const balance = await this.provider.getBalance(wallet.address);
      if (balance < minBalance) {
        const needed = CONFIG.FUND_AMOUNT;
        totalNeeded += needed;
        needsFunding.push({ id, balance });
      }
    }

    if (needsFunding.length === 0) {
      console.log('All agents have sufficient balance');
      return;
    }

    if (funderBalance < totalNeeded) {
      console.error(`Insufficient funder balance. Need ${ethers.formatEther(totalNeeded)} ETH`);
      return;
    }

    console.log(`Funding ${needsFunding.length} agents...`);

    for (const { id, balance } of needsFunding) {
      const wallet = this.getWallet(id);
      console.log(`  Agent ${id}: ${ethers.formatEther(balance)} -> +${ethers.formatEther(CONFIG.FUND_AMOUNT)} ETH`);

      const tx = await this.funderWallet.sendTransaction({
        to: wallet.address,
        value: CONFIG.FUND_AMOUNT,
      });
      await tx.wait();
    }

    console.log('Funding complete!');
  }

  /**
   * Store a token note for an agent (after buy)
   */
  storeNote(agentId: number, note: TokenNote): void {
    const notes = this.agentNotes.get(agentId) || [];
    notes.push(note);
    this.agentNotes.set(agentId, notes);
  }

  /**
   * Mark a note as spent (after sell)
   */
  markNoteSpent(agentId: number, commitment: string): void {
    const notes = this.agentNotes.get(agentId) || [];
    const note = notes.find(n => n.commitment === commitment);
    if (note) note.spent = true;
  }

  /**
   * Get unspent notes for an agent
   */
  getUnspentNotes(agentId: number): TokenNote[] {
    const notes = this.agentNotes.get(agentId) || [];
    return notes.filter(n => !n.spent);
  }

  /**
   * Save notes to file (for persistence)
   */
  saveNotes(filepath: string): void {
    const fs = require('fs');
    const data: Record<number, TokenNote[]> = {};

    for (const [id, notes] of this.agentNotes) {
      data[id] = notes;
    }

    fs.writeFileSync(filepath, JSON.stringify(data, null, 2));
  }

  /**
   * Load notes from file
   */
  loadNotes(filepath: string): void {
    const fs = require('fs');
    if (!fs.existsSync(filepath)) return;

    const data = JSON.parse(fs.readFileSync(filepath, 'utf-8'));

    for (const [id, notes] of Object.entries(data)) {
      this.agentNotes.set(
        Number(id),
        (notes as any[]).map(n => ({
          ...n,
          amount: BigInt(n.amount),
        }))
      );
    }
  }
}
