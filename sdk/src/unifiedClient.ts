import { ethers } from 'ethers';
import type { OwnedCommitment, RelayerFees, SwapProofInputs } from './types';
import { Prover } from './prover';
import { PrivateWallet } from './wallet';
import { hashCommitment, hashNullifier } from './poseidon';
import { randomFieldElement, encryptNote } from './crypto';

// UnifiedAMM contract ABI
const UNIFIED_AMM_ABI = [
  // Root functions
  'function buyRoot(uint256 commitment, uint256 minRootOut, bytes encryptedNote) payable',
  'function sellRoot(uint256[8] proof, uint256 merkleRoot, uint256 nullifierHash, uint256 rootAmount, uint256 minEthOut, address recipient, address relayer, uint256 fee, uint256 changeCommitment, bytes changeNote)',

  // Auto-routing (ETH <-> Token)
  'function swapExactETHForTokens(uint256 tokenId, uint256 minTokensOut, uint256 outputCommitment, bytes outputNote) payable',
  'function swapExactTokensForETH(uint256 tokenId, uint256[8] proof, uint256 merkleRoot, uint256 nullifierHash, uint256 tokenAmount, uint256 minEthOut, address recipient, uint256 changeCommitment, bytes changeNote)',

  // ROOT <-> Token functions
  'function buyToken(uint256 tokenId, uint256[8] proof, uint256 merkleRoot, uint256 nullifierHash, uint256 rootAmount, uint256 minTokensOut, uint256 outputCommitment, uint256 changeCommitment, bytes outputNote, bytes changeNote)',
  'function sellToken(uint256 tokenId, uint256[8] proof, uint256 merkleRoot, uint256 nullifierHash, uint256 tokenAmount, uint256 minRootOut, uint256 outputCommitment, uint256 changeCommitment, bytes outputNote, bytes changeNote)',

  // View functions
  'function getETHToTokenOutput(uint256 tokenId, uint256 ethIn) view returns (uint256)',
  'function getTokenToETHOutput(uint256 tokenId, uint256 tokenIn) view returns (uint256)',
  'function getRootPrice() view returns (uint256)',
  'function getTokenPrice(uint256 tokenId) view returns (uint256)',
  'function getRootReserves() view returns (uint256 ethReserve, uint256 rootReserve)',
  'function getTokenReserves(uint256 tokenId) view returns (uint256 rootReserve, uint256 tokenReserve)',
  'function getTokenInfo(uint256 tokenId) view returns (string name, string symbol, uint256 totalSupply, uint256 rootReserve, uint256 tokenReserve, address pool, bool active)',
  'function getActiveTokens() view returns (uint256[])',
  'function tokenCount() view returns (uint256)',
  'function getRootPool() view returns (address)',

  // Events
  'event NewCommitment(uint256 indexed tokenId, uint256 indexed commitment, uint256 indexed leafIndex, bytes encryptedNote)',
  'event SwapETHForTokens(uint256 indexed tokenId, uint256 ethIn, uint256 tokensOut)',
  'event SwapTokensForETH(uint256 indexed tokenId, uint256 tokensIn, uint256 ethOut)',
  'event RootPurchased(uint256 ethIn, uint256 rootOut)',
  'event RootSold(uint256 rootIn, uint256 ethOut)',
];

export interface UnifiedAMMConfig {
  provider: ethers.Provider;
  chainId: number;
  unifiedAMMAddress: string;
  relayerUrl: string;
}

export interface TokenInfo {
  id: number;
  name: string;
  symbol: string;
  totalSupply: bigint;
  rootReserve: bigint;
  tokenReserve: bigint;
  poolAddress: string;
  active: boolean;
}

/**
 * Client for interacting with the UnifiedAMM
 * Supports:
 * - ETH <-> ROOT swaps
 * - ROOT <-> Token swaps
 * - Atomic ETH <-> Token swaps (auto-routed through ROOT)
 */
export class UnifiedAMMClient {
  private config: UnifiedAMMConfig;
  private contract: ethers.Contract;
  private prover: Prover | null = null;
  private rootWallet: PrivateWallet | null = null;
  private tokenWallets: Map<number, PrivateWallet> = new Map();

  constructor(config: UnifiedAMMConfig) {
    this.config = config;
    this.contract = new ethers.Contract(
      config.unifiedAMMAddress,
      UNIFIED_AMM_ABI,
      config.provider
    );
  }

  /**
   * Initialize with seed phrase
   */
  async initialize(seedPhrase: string): Promise<void> {
    const rootPoolAddress = await this.contract.getRootPool();

    this.rootWallet = new PrivateWallet(
      this.config.provider,
      rootPoolAddress,
      seedPhrase
    );
  }

  /**
   * Initialize wallet for a specific token
   */
  async initializeTokenWallet(tokenId: number, seedPhrase: string): Promise<void> {
    const info = await this.getTokenInfo(tokenId);
    if (!info) throw new Error('Invalid token ID');

    const wallet = new PrivateWallet(
      this.config.provider,
      info.poolAddress,
      seedPhrase + `-token-${tokenId}` // Derive unique key per token
    );

    this.tokenWallets.set(tokenId, wallet);
  }

  /**
   * Load prover with swap circuit
   */
  async loadProver(artifacts: {
    sellWasm: Uint8Array;
    sellZkey: Uint8Array;
    transferWasm: Uint8Array;
    transferZkey: Uint8Array;
    withdrawWasm: Uint8Array;
    withdrawZkey: Uint8Array;
    swapWasm: Uint8Array;
    swapZkey: Uint8Array;
  }): Promise<void> {
    this.prover = new Prover(artifacts);
  }

  // ============ Token Registry ============

  /**
   * Get all active token IDs
   */
  async getActiveTokens(): Promise<number[]> {
    const ids: bigint[] = await this.contract.getActiveTokens();
    return ids.map((id) => Number(id));
  }

  /**
   * Get token info by ID
   */
  async getTokenInfo(tokenId: number): Promise<TokenInfo | null> {
    try {
      const result = await this.contract.getTokenInfo(tokenId);
      return {
        id: tokenId,
        name: result.name,
        symbol: result.symbol,
        totalSupply: result.totalSupply,
        rootReserve: result.rootReserve,
        tokenReserve: result.tokenReserve,
        poolAddress: result.pool,
        active: result.active,
      };
    } catch {
      return null;
    }
  }

  /**
   * Get all active tokens with full info
   */
  async getAllTokensInfo(): Promise<TokenInfo[]> {
    const ids = await this.getActiveTokens();
    const infos: TokenInfo[] = [];

    for (const id of ids) {
      const info = await this.getTokenInfo(id);
      if (info && info.active) {
        infos.push(info);
      }
    }

    return infos;
  }

  // ============ Buy ROOT (ETH -> ROOT) ============

  /**
   * Prepare buy ROOT transaction
   */
  async prepareBuyRoot(
    ethAmount: bigint,
    minRootOut: bigint
  ): Promise<{
    to: string;
    data: string;
    value: bigint;
    commitment: bigint;
    encryptedNote: string;
  }> {
    if (!this.rootWallet) throw new Error('Client not initialized');

    const buyCommitment = await this.rootWallet.createBuyCommitment(minRootOut);

    const data = this.contract.interface.encodeFunctionData('buyRoot', [
      buyCommitment.commitment,
      minRootOut,
      buyCommitment.encryptedNote,
    ]);

    return {
      to: this.config.unifiedAMMAddress,
      data,
      value: ethAmount,
      commitment: buyCommitment.commitment,
      encryptedNote: buyCommitment.encryptedNote,
    };
  }

  /**
   * Execute buy ROOT
   */
  async buyRoot(
    ethAmount: bigint,
    minRootOut: bigint,
    signer: ethers.Signer
  ): Promise<string> {
    const prepared = await this.prepareBuyRoot(ethAmount, minRootOut);

    const tx = await signer.sendTransaction({
      to: prepared.to,
      data: prepared.data,
      value: prepared.value,
    });

    const receipt = await tx.wait();
    return receipt?.hash || tx.hash;
  }

  // ============ Auto-Routed Swaps (ETH <-> Token) ============

  /**
   * Prepare swap ETH for Token (auto-routed: ETH -> ROOT -> Token)
   */
  async prepareSwapETHForTokens(
    tokenId: number,
    ethAmount: bigint,
    minTokensOut: bigint
  ): Promise<{
    to: string;
    data: string;
    value: bigint;
    commitment: bigint;
    encryptedNote: string;
  }> {
    // Initialize token wallet if not already
    let tokenWallet = this.tokenWallets.get(tokenId);
    if (!tokenWallet && this.rootWallet) {
      await this.initializeTokenWallet(tokenId, this.rootWallet.getPublicKey());
      tokenWallet = this.tokenWallets.get(tokenId);
    }
    if (!tokenWallet) throw new Error('Token wallet not initialized');

    const buyCommitment = await tokenWallet.createBuyCommitment(minTokensOut);

    const data = this.contract.interface.encodeFunctionData('swapExactETHForTokens', [
      tokenId,
      minTokensOut,
      buyCommitment.commitment,
      buyCommitment.encryptedNote,
    ]);

    return {
      to: this.config.unifiedAMMAddress,
      data,
      value: ethAmount,
      commitment: buyCommitment.commitment,
      encryptedNote: buyCommitment.encryptedNote,
    };
  }

  /**
   * Swap ETH for Token (atomic, single tx)
   */
  async swapETHForTokens(
    tokenId: number,
    ethAmount: bigint,
    minTokensOut: bigint,
    signer: ethers.Signer
  ): Promise<string> {
    const prepared = await this.prepareSwapETHForTokens(tokenId, ethAmount, minTokensOut);

    const tx = await signer.sendTransaction({
      to: prepared.to,
      data: prepared.data,
      value: prepared.value,
    });

    const receipt = await tx.wait();
    return receipt?.hash || tx.hash;
  }

  /**
   * Prepare swap Token for ETH (auto-routed: Token -> ROOT -> ETH)
   * Requires ZK proof of token ownership
   */
  async prepareSwapTokensForETH(
    tokenId: number,
    tokenAmount: bigint,
    minEthOut: bigint,
    recipient: string
  ): Promise<{
    proof: bigint[];
    merkleRoot: bigint;
    nullifierHash: bigint;
    tokenAmount: bigint;
    minEthOut: bigint;
    recipient: string;
    changeCommitment: bigint;
    changeNote: string;
  }> {
    if (!this.prover) throw new Error('Prover not loaded');

    const tokenWallet = this.tokenWallets.get(tokenId);
    if (!tokenWallet) throw new Error('Token wallet not initialized');

    // Find commitment to spend
    const commitment = tokenWallet.findCommitmentForAmount(tokenAmount);
    if (!commitment) throw new Error('Insufficient balance');

    // Get merkle proof
    const merkleProof = tokenWallet.getMerkleProof(commitment.leafIndex);
    const nullifierHash = hashNullifier(commitment.nullifier, commitment.leafIndex);

    // Calculate change
    const changeAmount = commitment.amount - tokenAmount;
    let changeNullifier = 0n;
    let changeSecret = 0n;
    let changeCommitmentHash = 0n;
    let changeNote = '0x';

    if (changeAmount > 0n) {
      changeNullifier = randomFieldElement();
      changeSecret = randomFieldElement();
      changeCommitmentHash = hashCommitment(changeNullifier, changeSecret, changeAmount);
      changeNote = await encryptNote(
        changeNullifier,
        changeSecret,
        changeAmount,
        tokenWallet.getPublicKey()
      );
    }

    // Generate swap proof
    const proofInputs: SwapProofInputs = {
      inputMerkleRoot: merkleProof.root,
      inputNullifierHash: nullifierHash,
      inputAmount: tokenAmount,
      outputCommitment: 0n, // No output commitment for ETH
      minOutputAmount: minEthOut,
      changeCommitment: changeCommitmentHash,
      inputNullifier: commitment.nullifier,
      inputSecret: commitment.secret,
      inputTotalAmount: commitment.amount,
      inputPathElements: merkleProof.pathElements,
      inputPathIndices: merkleProof.pathIndices,
      outputNullifier: 0n,
      outputSecret: 0n,
      outputAmount: 0n,
      changeNullifier,
      changeSecret,
    };

    const proofResult = await this.prover.proveSwap(proofInputs);
    const proof = Prover.formatProofForSolidity(proofResult.proof);

    return {
      proof,
      merkleRoot: merkleProof.root,
      nullifierHash,
      tokenAmount,
      minEthOut,
      recipient,
      changeCommitment: changeCommitmentHash,
      changeNote,
    };
  }

  // ============ Quotes ============

  /**
   * Get quote for ETH -> Token (auto-routed)
   */
  async getETHToTokenQuote(tokenId: number, ethAmount: bigint): Promise<bigint> {
    return await this.contract.getETHToTokenOutput(tokenId, ethAmount);
  }

  /**
   * Get quote for Token -> ETH (auto-routed)
   */
  async getTokenToETHQuote(tokenId: number, tokenAmount: bigint): Promise<bigint> {
    return await this.contract.getTokenToETHOutput(tokenId, tokenAmount);
  }

  /**
   * Get quote for ETH -> ROOT
   */
  async getETHToRootQuote(ethAmount: bigint): Promise<bigint> {
    const [ethReserve, rootReserve] = await this.contract.getRootReserves();
    return this.calculateAmountOut(ethAmount, ethReserve, rootReserve);
  }

  /**
   * Get quote for ROOT -> Token
   */
  async getRootToTokenQuote(tokenId: number, rootAmount: bigint): Promise<bigint> {
    const [rootReserve, tokenReserve] = await this.contract.getTokenReserves(tokenId);
    return this.calculateAmountOut(rootAmount, rootReserve, tokenReserve);
  }

  /**
   * Calculate amount out with 0.3% fee
   */
  private calculateAmountOut(
    amountIn: bigint,
    reserveIn: bigint,
    reserveOut: bigint
  ): bigint {
    const amountInWithFee = amountIn * 9970n; // 0.3% fee
    const numerator = amountInWithFee * reserveOut;
    const denominator = reserveIn * 10000n + amountInWithFee;
    return numerator / denominator;
  }

  // ============ Balances ============

  /**
   * Get ROOT balance (sum of unspent commitments)
   */
  getRootBalance(): bigint {
    if (!this.rootWallet) throw new Error('Client not initialized');
    return this.rootWallet.getBalance();
  }

  /**
   * Get token balance
   */
  getTokenBalance(tokenId: number): bigint {
    const wallet = this.tokenWallets.get(tokenId);
    if (!wallet) return 0n;
    return wallet.getBalance();
  }

  /**
   * Get all balances
   */
  getAllBalances(): Map<number | 'ROOT', bigint> {
    const balances = new Map<number | 'ROOT', bigint>();

    if (this.rootWallet) {
      balances.set('ROOT', this.rootWallet.getBalance());
    }

    for (const [tokenId, wallet] of this.tokenWallets) {
      balances.set(tokenId, wallet.getBalance());
    }

    return balances;
  }

  // ============ Scanning ============

  /**
   * Scan for ROOT commitments
   */
  async scanRootCommitments(fromBlock?: number): Promise<{
    newCommitments: OwnedCommitment[];
    spentCommitments: OwnedCommitment[];
  }> {
    if (!this.rootWallet) throw new Error('Client not initialized');
    return this.rootWallet.scan(fromBlock);
  }

  /**
   * Scan for token commitments
   */
  async scanTokenCommitments(tokenId: number, fromBlock?: number): Promise<{
    newCommitments: OwnedCommitment[];
    spentCommitments: OwnedCommitment[];
  }> {
    const wallet = this.tokenWallets.get(tokenId);
    if (!wallet) throw new Error('Token wallet not initialized');
    return wallet.scan(fromBlock);
  }

  // ============ Helpers ============

  /**
   * Get relayer fees
   */
  async getRelayerFees(): Promise<RelayerFees> {
    try {
      const response = await fetch(`${this.config.relayerUrl}/fees`);
      const data = (await response.json()) as { baseFee: string; percentFee: string };
      return {
        baseFee: BigInt(data.baseFee),
        percentFee: parseFloat(data.percentFee),
      };
    } catch {
      return {
        baseFee: ethers.parseEther('0.001'),
        percentFee: 0.1,
      };
    }
  }

  /**
   * Get ROOT pool address
   */
  async getRootPoolAddress(): Promise<string> {
    return await this.contract.getRootPool();
  }

  /**
   * Export wallet states for local storage
   */
  exportState(): {
    rootState: string | null;
    tokenStates: { [tokenId: number]: string };
  } {
    const tokenStates: { [tokenId: number]: string } = {};

    for (const [tokenId, wallet] of this.tokenWallets) {
      tokenStates[tokenId] = wallet.exportState();
    }

    return {
      rootState: this.rootWallet?.exportState() || null,
      tokenStates,
    };
  }

  /**
   * Import wallet states from local storage
   */
  importState(state: {
    rootState: string | null;
    tokenStates: { [tokenId: number]: string };
  }): void {
    if (state.rootState && this.rootWallet) {
      this.rootWallet.importState(state.rootState);
    }

    for (const [tokenIdStr, walletState] of Object.entries(state.tokenStates)) {
      const tokenId = parseInt(tokenIdStr);
      const wallet = this.tokenWallets.get(tokenId);
      if (wallet) {
        wallet.importState(walletState);
      }
    }
  }
}
