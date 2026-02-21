import { ethers } from 'ethers';
import type {
  ZkAMMConfig,
  BuyParams,
  SellParams,
  TransferParams,
  OwnedCommitment,
  RelayerFees,
  SellProofInputs,
  TransferProofInputs,
  WithdrawProofInputs,
} from './types';
import { Prover } from './prover';
import { PrivateWallet } from './wallet';
import { RailgunService, deriveRailgunKey, type RailgunConfig } from './railgun';
import { hashCommitment, hashNullifier } from './poseidon';
import { randomFieldElement, encryptNote } from './crypto';

// ZkAMM contract ABI (UnifiedAMM)
const ZKAMM_ABI = [
  // Buy functions
  'function buyRoot(uint256 commitment, uint256 minRootOut, bytes encryptedNote) payable',

  // Sell functions
  'function sellRoot(uint256[8] proof, uint256 merkleRoot, uint256 nullifierHash, uint256 rootAmount, uint256 minEthOut, address recipient, address relayer, uint256 fee, uint256 changeCommitment, bytes changeNote)',
  'function sellRootToRailgun(uint256[8] proof, uint256 merkleRoot, uint256 nullifierHash, uint256 rootAmount, uint256 minEthOut, bytes32 railgunNpk, bytes encryptedRandom, uint256 changeCommitment, bytes changeNote)',

  // Transfer & Withdraw
  'function transferPrivate(uint256[8] proof, uint256 merkleRoot, uint256 nullifierHash, uint256 recipientCommitment, uint256 changeCommitment, bytes recipientNote, bytes changeNote)',
  'function withdrawPublic(uint256[8] proof, uint256 merkleRoot, uint256 nullifierHash, uint256 amount, address recipient)',

  // View functions
  'function getAmountOut(uint256 amountIn, uint256 reserveIn, uint256 reserveOut) view returns (uint256)',
  'function ethReserve() view returns (uint256)',
  'function rootReserve() view returns (uint256)',
  'function getRootPrice() view returns (uint256)',
  'function getRootPool() view returns (address)',
  'function railgunProxy() view returns (address)',

  // Events
  'event NewCommitment(uint256 indexed tokenId, uint256 indexed commitment, uint256 indexed leafIndex, bytes encryptedNote)',
  'event NullifierSpent(uint256 indexed nullifierHash)',
  'event RootPurchased(uint256 ethIn, uint256 rootOut)',
  'event RootSold(uint256 rootIn, uint256 ethOut)',
  'event RootSoldToRailgun(uint256 rootIn, uint256 ethOut, bytes32 railgunNpk)',
];

/**
 * Main client for interacting with the ZkAMM
 */
export class ZkAMMClient {
  private config: ZkAMMConfig;
  private contract: ethers.Contract;
  private prover: Prover | null = null;
  private wallet: PrivateWallet | null = null;
  private railgun: RailgunService | null = null;

  constructor(config: ZkAMMConfig) {
    this.config = config;
    this.contract = new ethers.Contract(config.zkAMMAddress, ZKAMM_ABI, config.provider);
  }

  /**
   * Initialize the client with user's seed phrase
   */
  async initialize(seedPhrase: string): Promise<void> {
    this.wallet = new PrivateWallet(
      this.config.provider,
      this.config.zkAMMAddress,
      seedPhrase
    );
  }

  /**
   * Load circuit artifacts and initialize prover
   */
  async loadProver(artifacts: {
    sellWasm: Uint8Array;
    sellZkey: Uint8Array;
    transferWasm: Uint8Array;
    transferZkey: Uint8Array;
    withdrawWasm: Uint8Array;
    withdrawZkey: Uint8Array;
  }): Promise<void> {
    this.prover = new Prover(artifacts);
  }

  /**
   * Get the wallet's public key (for receiving transfers)
   */
  getPublicKey(): string {
    if (!this.wallet) throw new Error('Client not initialized');
    return this.wallet.getPublicKey();
  }

  /**
   * Get total private token balance
   */
  getBalance(): bigint {
    if (!this.wallet) throw new Error('Client not initialized');
    return this.wallet.getBalance();
  }

  /**
   * Get all unspent commitments
   */
  getCommitments(): OwnedCommitment[] {
    if (!this.wallet) throw new Error('Client not initialized');
    return this.wallet.getUnspentCommitments();
  }

  /**
   * Scan blockchain for owned commitments
   */
  async scan(fromBlock?: number): Promise<{
    newCommitments: OwnedCommitment[];
    spentCommitments: OwnedCommitment[];
  }> {
    if (!this.wallet) throw new Error('Client not initialized');
    return this.wallet.scan(fromBlock);
  }

  // ============ Buy Functions ============

  /**
   * Prepare a buy transaction
   * Returns tx data to be signed and sent
   */
  async prepareBuy(params: BuyParams): Promise<{
    to: string;
    data: string;
    value: bigint;
    commitment: bigint;
    encryptedNote: string;
  }> {
    if (!this.wallet) throw new Error('Client not initialized');

    const buyCommitment = await this.wallet.createBuyCommitment(params.minTokensOut);

    const data = this.contract.interface.encodeFunctionData('buyRoot', [
      buyCommitment.commitment,
      params.minTokensOut,
      buyCommitment.encryptedNote,
    ]);

    return {
      to: this.config.zkAMMAddress,
      data,
      value: params.ethAmount,
      commitment: buyCommitment.commitment,
      encryptedNote: buyCommitment.encryptedNote,
    };
  }

  /**
   * Execute a buy transaction directly
   */
  async buy(params: BuyParams, signer: ethers.Signer): Promise<string> {
    const prepared = await this.prepareBuy(params);

    const tx = await signer.sendTransaction({
      to: prepared.to,
      data: prepared.data,
      value: prepared.value,
    });

    const receipt = await tx.wait();
    return receipt?.hash || tx.hash;
  }

  // ============ Railgun Anonymous Buy Functions ============

  /**
   * Initialize Railgun service for anonymous buys
   * @param railgunConfig - Railgun contract configuration
   * @param seedPhrase - User's seed phrase (same as wallet)
   */
  async initializeRailgun(railgunConfig: RailgunConfig, seedPhrase: string): Promise<void> {
    this.railgun = new RailgunService(railgunConfig);
    const encryptionKey = deriveRailgunKey(seedPhrase);
    await this.railgun.initialize(encryptionKey);
  }

  /**
   * Get Railgun shielded ETH balance
   */
  async getRailgunBalance(): Promise<{ ethBalance: bigint; pendingBalance: bigint }> {
    if (!this.railgun) throw new Error('Railgun not initialized');
    const balance = await this.railgun.getBalance();
    return {
      ethBalance: balance.ethBalance,
      pendingBalance: balance.pendingBalance,
    };
  }

  /**
   * Shield ETH into Railgun for future anonymous buys
   *
   * This is a one-time setup step. After shielding, wait ~256 blocks
   * for funds to become part of the anonymity set.
   *
   * @param amount - Amount of ETH to shield
   * @param signer - Signer to send the shield transaction
   */
  async shieldEthForBuying(amount: bigint, signer: ethers.Signer): Promise<string> {
    if (!this.railgun) throw new Error('Railgun not initialized');
    return this.railgun.shieldEth(amount, signer);
  }

  /**
   * Execute an anonymous buy using Railgun shielded ETH
   *
   * Flow:
   * 1. Generate fresh stealth address
   * 2. Unshield ETH to stealth address via Railgun
   * 3. Use stealth address to call buyPrivate
   *
   * The stealth address is unlinkable to your original wallet.
   *
   * @param params - Buy parameters
   * @returns Transaction hash
   */
  async buyAnonymously(params: BuyParams): Promise<string> {
    if (!this.railgun) throw new Error('Railgun not initialized');
    if (!this.wallet) throw new Error('Client not initialized');

    // Prepare anonymous buy via Railgun
    const { stealthWallet, fundingTxHash } = await this.railgun.prepareAnonymousBuy(params.ethAmount);

    console.log(`Funded stealth address via Railgun tx: ${fundingTxHash}`);

    // Wait for funding to confirm
    await this.config.provider.waitForTransaction(fundingTxHash);

    // Now execute buy from stealth address
    const prepared = await this.prepareBuy(params);

    const tx = await stealthWallet.sendTransaction({
      to: prepared.to,
      data: prepared.data,
      value: prepared.value,
    });

    const receipt = await tx.wait();
    return receipt?.hash || tx.hash;
  }

  /**
   * Check if Railgun is initialized
   */
  isRailgunInitialized(): boolean {
    return this.railgun !== null;
  }

  /**
   * Sync Railgun state with blockchain
   */
  async syncRailgun(): Promise<void> {
    if (!this.railgun) throw new Error('Railgun not initialized');
    await this.railgun.sync();
  }

  // ============ Anonymous Sell Functions ============

  /**
   * Prepare an anonymous sell transaction that shields ETH directly to Railgun
   *
   * This provides full anonymity:
   * - Your $ROOT commitment is spent with ZK proof (no link to identity)
   * - The ETH output goes directly to Railgun's privacy pool
   * - No one can see who received the ETH
   *
   * @param params - Sell parameters (tokenAmount, minEthOut)
   * @param railgunNpk - Note public key for Railgun (from your Railgun wallet)
   * @param encryptedRandom - Encrypted random for the Railgun note
   */
  async prepareSellAnonymously(params: SellParams, railgunNpk: string, encryptedRandom: string): Promise<{
    proof: bigint[];
    merkleRoot: bigint;
    nullifierHash: bigint;
    rootAmount: bigint;
    minEthOut: bigint;
    railgunNpk: string;
    encryptedRandom: string;
    changeCommitment: bigint;
    changeNote: string;
  }> {
    if (!this.wallet) throw new Error('Client not initialized');
    if (!this.prover) throw new Error('Prover not loaded');

    // Find a commitment to spend
    const commitment = this.wallet.findCommitmentForAmount(params.tokenAmount);
    if (!commitment) {
      throw new Error('Insufficient balance');
    }

    // Get merkle proof
    const merkleProof = this.wallet.getMerkleProof(commitment.leafIndex);

    // Compute nullifier hash
    const nullifierHash = hashNullifier(commitment.nullifier, commitment.leafIndex);

    // Calculate change
    const changeAmount = commitment.amount - params.tokenAmount;
    let changeNullifier = 0n;
    let changeSecret = 0n;
    let changeCommitmentHash = 0n;
    let changeNote = '0x';

    if (changeAmount > 0n) {
      changeNullifier = randomFieldElement();
      changeSecret = randomFieldElement();
      changeCommitmentHash = hashCommitment(changeNullifier, changeSecret, changeAmount);

      // Encrypt change note for ourselves
      changeNote = await encryptNote(
        changeNullifier,
        changeSecret,
        changeAmount,
        this.wallet.getPublicKey()
      );
    }

    // Generate ZK proof
    // Note: For Railgun sell, we use address(0) for recipient/relayer/fee
    const proofInputs: SellProofInputs = {
      merkleRoot: merkleProof.root,
      nullifierHash,
      tokenAmount: params.tokenAmount,
      minEthOut: params.minEthOut,
      recipient: ethers.ZeroAddress,  // ETH goes to Railgun
      relayer: ethers.ZeroAddress,    // No relayer
      fee: 0n,                         // No fee
      changeCommitment: changeCommitmentHash,
      nullifier: commitment.nullifier,
      secret: commitment.secret,
      amount: commitment.amount,
      pathElements: merkleProof.pathElements,
      pathIndices: merkleProof.pathIndices,
      changeNullifier,
      changeSecret,
    };

    const proofResult = await this.prover.proveSell(proofInputs);
    const proof = Prover.formatProofForSolidity(proofResult.proof);

    return {
      proof,
      merkleRoot: merkleProof.root,
      nullifierHash,
      rootAmount: params.tokenAmount,
      minEthOut: params.minEthOut,
      railgunNpk,
      encryptedRandom,
      changeCommitment: changeCommitmentHash,
      changeNote,
    };
  }

  /**
   * Execute an anonymous sell - sells $ROOT and shields ETH to Railgun
   *
   * Full privacy flow:
   * 1. Generate ZK proof of $ROOT ownership
   * 2. Call sellRootToRailgun on the contract
   * 3. ETH is shielded directly to your Railgun wallet
   *
   * No one can see:
   * - Who owned the $ROOT
   * - Who received the ETH
   *
   * @param params - Sell parameters
   * @param signer - Signer to submit the transaction (can be any address with gas)
   */
  async sellAnonymously(params: SellParams, signer: ethers.Signer): Promise<string> {
    if (!this.railgun) throw new Error('Railgun not initialized');
    if (!this.wallet) throw new Error('Client not initialized');
    if (!this.prover) throw new Error('Prover not loaded');

    // Generate Railgun note parameters
    const railgunNpk = ethers.hexlify(ethers.randomBytes(32));
    const encryptedRandom = ethers.hexlify(ethers.randomBytes(64));

    // Prepare the anonymous sell
    const prepared = await this.prepareSellAnonymously(params, railgunNpk, encryptedRandom);

    // Encode the transaction
    const data = this.contract.interface.encodeFunctionData('sellRootToRailgun', [
      prepared.proof,
      prepared.merkleRoot,
      prepared.nullifierHash,
      prepared.rootAmount,
      prepared.minEthOut,
      prepared.railgunNpk,
      prepared.encryptedRandom,
      prepared.changeCommitment,
      prepared.changeNote,
    ]);

    // Submit the transaction
    const tx = await signer.sendTransaction({
      to: this.config.zkAMMAddress,
      data,
    });

    const receipt = await tx.wait();

    console.log(`Sold ${ethers.formatEther(params.tokenAmount)} $ROOT anonymously`);
    console.log(`ETH shielded to Railgun with npk: ${railgunNpk.slice(0, 10)}...`);

    return receipt?.hash || tx.hash;
  }

  /**
   * Submit anonymous sell via relayer for full gas privacy
   *
   * This is the most private option:
   * - ZK proof hides $ROOT ownership
   * - ETH goes to Railgun (hidden recipient)
   * - Gas paid by relayer (hidden sender)
   */
  async sellAnonymouslyViaRelayer(params: SellParams): Promise<string> {
    if (!this.railgun) throw new Error('Railgun not initialized');

    // Generate Railgun note parameters
    const railgunNpk = ethers.hexlify(ethers.randomBytes(32));
    const encryptedRandom = ethers.hexlify(ethers.randomBytes(64));

    // Prepare the anonymous sell
    const prepared = await this.prepareSellAnonymously(params, railgunNpk, encryptedRandom);

    // Submit to relayer
    const response = await fetch(`${this.config.relayerUrl}/relay`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'sellToRailgun',
        proof: prepared.proof.map(p => p.toString()),
        merkleRoot: prepared.merkleRoot.toString(),
        nullifierHash: prepared.nullifierHash.toString(),
        rootAmount: prepared.rootAmount.toString(),
        minEthOut: prepared.minEthOut.toString(),
        railgunNpk: prepared.railgunNpk,
        encryptedRandom: prepared.encryptedRandom,
        changeCommitment: prepared.changeCommitment.toString(),
        changeNote: prepared.changeNote,
      }),
    });

    const result = await response.json() as { jobId?: string; error?: string };

    if (!response.ok) {
      throw new Error(result.error || 'Relayer error');
    }

    return result.jobId as string;
  }

  // ============ Sell Functions ============

  /**
   * Prepare a sell transaction with ZK proof
   */
  async prepareSell(params: SellParams): Promise<{
    proof: bigint[];
    merkleRoot: bigint;
    nullifierHash: bigint;
    tokenAmount: bigint;
    minEthOut: bigint;
    recipient: string;
    relayer: string;
    fee: bigint;
    changeCommitment: bigint;
    changeNote: string;
  }> {
    if (!this.wallet) throw new Error('Client not initialized');
    if (!this.prover) throw new Error('Prover not loaded');

    // Find a commitment to spend
    const commitment = this.wallet.findCommitmentForAmount(params.tokenAmount);
    if (!commitment) {
      throw new Error('Insufficient balance');
    }

    // Get merkle proof
    const merkleProof = this.wallet.getMerkleProof(commitment.leafIndex);

    // Compute nullifier hash
    const nullifierHash = hashNullifier(commitment.nullifier, commitment.leafIndex);

    // Calculate change
    const changeAmount = commitment.amount - params.tokenAmount;
    let changeNullifier = 0n;
    let changeSecret = 0n;
    let changeCommitmentHash = 0n;
    let changeNote = '0x';

    if (changeAmount > 0n) {
      changeNullifier = randomFieldElement();
      changeSecret = randomFieldElement();
      changeCommitmentHash = hashCommitment(changeNullifier, changeSecret, changeAmount);

      // Encrypt change note for ourselves
      changeNote = await encryptNote(
        changeNullifier,
        changeSecret,
        changeAmount,
        this.wallet.getPublicKey()
      );
    }

    // Get relayer info
    const fees = await this.getRelayerFees();
    const relayerAddress = await this.getRelayerAddress();

    // Generate ZK proof
    const proofInputs: SellProofInputs = {
      merkleRoot: merkleProof.root,
      nullifierHash,
      tokenAmount: params.tokenAmount,
      minEthOut: params.minEthOut,
      recipient: params.recipient,
      relayer: relayerAddress,
      fee: fees.baseFee,
      changeCommitment: changeCommitmentHash,
      nullifier: commitment.nullifier,
      secret: commitment.secret,
      amount: commitment.amount,
      pathElements: merkleProof.pathElements,
      pathIndices: merkleProof.pathIndices,
      changeNullifier,
      changeSecret,
    };

    const proofResult = await this.prover.proveSell(proofInputs);
    const proof = Prover.formatProofForSolidity(proofResult.proof);

    return {
      proof,
      merkleRoot: merkleProof.root,
      nullifierHash,
      tokenAmount: params.tokenAmount,
      minEthOut: params.minEthOut,
      recipient: params.recipient,
      relayer: relayerAddress,
      fee: fees.baseFee,
      changeCommitment: changeCommitmentHash,
      changeNote,
    };
  }

  /**
   * Submit sell transaction via relayer
   */
  async sell(params: SellParams): Promise<string> {
    const prepared = await this.prepareSell(params);

    const response = await fetch(`${this.config.relayerUrl}/relay`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'sell',
        proof: prepared.proof.map(p => p.toString()),
        merkleRoot: prepared.merkleRoot.toString(),
        nullifierHash: prepared.nullifierHash.toString(),
        tokenAmount: prepared.tokenAmount.toString(),
        minEthOut: prepared.minEthOut.toString(),
        recipient: prepared.recipient,
        changeCommitment: prepared.changeCommitment.toString(),
        changeNote: prepared.changeNote,
      }),
    });

    const result = await response.json() as { jobId?: string; error?: string };

    if (!response.ok) {
      throw new Error(result.error || 'Relayer error');
    }

    return result.jobId as string;
  }

  // ============ Transfer Functions ============

  /**
   * Prepare a private transfer with ZK proof
   */
  async prepareTransfer(params: TransferParams): Promise<{
    proof: bigint[];
    merkleRoot: bigint;
    nullifierHash: bigint;
    recipientCommitment: bigint;
    changeCommitment: bigint;
    recipientNote: string;
    changeNote: string;
  }> {
    if (!this.wallet) throw new Error('Client not initialized');
    if (!this.prover) throw new Error('Prover not loaded');

    // Find a commitment to spend
    const commitment = this.wallet.findCommitmentForAmount(params.amount);
    if (!commitment) {
      throw new Error('Insufficient balance');
    }

    // Get merkle proof
    const merkleProof = this.wallet.getMerkleProof(commitment.leafIndex);

    // Compute nullifier hash
    const nullifierHash = hashNullifier(commitment.nullifier, commitment.leafIndex);

    // Create recipient commitment
    const recipientNullifier = randomFieldElement();
    const recipientSecret = randomFieldElement();
    const recipientCommitmentHash = hashCommitment(
      recipientNullifier,
      recipientSecret,
      params.amount
    );

    // Encrypt note for recipient
    const recipientNote = await encryptNote(
      recipientNullifier,
      recipientSecret,
      params.amount,
      params.recipientPublicKey
    );

    // Calculate change
    const changeAmount = commitment.amount - params.amount;
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
        this.wallet.getPublicKey()
      );
    }

    // Generate ZK proof
    const proofInputs: TransferProofInputs = {
      merkleRoot: merkleProof.root,
      nullifierHash,
      recipientCommitment: recipientCommitmentHash,
      changeCommitment: changeCommitmentHash,
      nullifier: commitment.nullifier,
      secret: commitment.secret,
      amount: commitment.amount,
      pathElements: merkleProof.pathElements,
      pathIndices: merkleProof.pathIndices,
      transferAmount: params.amount,
      recipientNullifier,
      recipientSecret,
      changeNullifier,
      changeSecret,
    };

    const proofResult = await this.prover.proveTransfer(proofInputs);
    const proof = Prover.formatProofForSolidity(proofResult.proof);

    return {
      proof,
      merkleRoot: merkleProof.root,
      nullifierHash,
      recipientCommitment: recipientCommitmentHash,
      changeCommitment: changeCommitmentHash,
      recipientNote,
      changeNote,
    };
  }

  /**
   * Submit transfer via relayer
   */
  async transfer(params: TransferParams): Promise<string> {
    const prepared = await this.prepareTransfer(params);

    const response = await fetch(`${this.config.relayerUrl}/relay`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'transfer',
        proof: prepared.proof.map(p => p.toString()),
        merkleRoot: prepared.merkleRoot.toString(),
        nullifierHash: prepared.nullifierHash.toString(),
        recipientCommitment: prepared.recipientCommitment.toString(),
        changeCommitment: prepared.changeCommitment.toString(),
        recipientNote: prepared.recipientNote,
        changeNote: prepared.changeNote,
      }),
    });

    const result = await response.json() as { jobId?: string; error?: string };

    if (!response.ok) {
      throw new Error(result.error || 'Relayer error');
    }

    return result.jobId as string;
  }

  // ============ Withdraw Functions ============

  /**
   * Prepare a public withdrawal with ZK proof
   * Exits the privacy pool - reveals recipient and amount on-chain
   */
  async prepareWithdraw(params: { amount: bigint; recipient: string }): Promise<{
    proof: bigint[];
    merkleRoot: bigint;
    nullifierHash: bigint;
    amount: bigint;
    recipient: string;
  }> {
    if (!this.wallet) throw new Error('Client not initialized');
    if (!this.prover) throw new Error('Prover not loaded');

    // Find a commitment to spend (must match exact amount for withdraw)
    const commitment = this.wallet.findCommitmentForAmount(params.amount);
    if (!commitment) {
      throw new Error('Insufficient balance');
    }

    // Get merkle proof
    const merkleProof = this.wallet.getMerkleProof(commitment.leafIndex);

    // Compute nullifier hash
    const nullifierHash = hashNullifier(commitment.nullifier, commitment.leafIndex);

    // Generate ZK proof
    const proofInputs: WithdrawProofInputs = {
      merkleRoot: merkleProof.root,
      nullifierHash,
      amount: params.amount,
      recipient: params.recipient,
      nullifier: commitment.nullifier,
      secret: commitment.secret,
      pathElements: merkleProof.pathElements,
      pathIndices: merkleProof.pathIndices,
    };

    const proofResult = await this.prover.proveWithdraw(proofInputs);
    const proof = Prover.formatProofForSolidity(proofResult.proof);

    return {
      proof,
      merkleRoot: merkleProof.root,
      nullifierHash,
      amount: params.amount,
      recipient: params.recipient,
    };
  }

  /**
   * Execute a public withdrawal transaction directly
   * Exits the privacy pool - reveals recipient and amount on-chain
   */
  async withdraw(params: { amount: bigint; recipient: string }, signer: ethers.Signer): Promise<string> {
    const prepared = await this.prepareWithdraw(params);

    const data = this.contract.interface.encodeFunctionData('withdrawPublic', [
      prepared.proof,
      prepared.merkleRoot,
      prepared.nullifierHash,
      prepared.amount,
      prepared.recipient,
    ]);

    const tx = await signer.sendTransaction({
      to: this.config.zkAMMAddress,
      data,
    });

    const receipt = await tx.wait();
    return receipt?.hash || tx.hash;
  }

  /**
   * Submit withdrawal via relayer
   */
  async withdrawViaRelayer(params: { amount: bigint; recipient: string }): Promise<string> {
    const prepared = await this.prepareWithdraw(params);

    const response = await fetch(`${this.config.relayerUrl}/relay`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'withdraw',
        proof: prepared.proof.map(p => p.toString()),
        merkleRoot: prepared.merkleRoot.toString(),
        nullifierHash: prepared.nullifierHash.toString(),
        amount: prepared.amount.toString(),
        recipient: prepared.recipient,
      }),
    });

    const result = await response.json() as { jobId?: string; error?: string };

    if (!response.ok) {
      throw new Error(result.error || 'Relayer error');
    }

    return result.jobId as string;
  }

  // ============ Quote Functions ============

  /**
   * Get estimated $ROOT out for a given ETH amount
   */
  async getBuyQuote(ethAmount: bigint): Promise<bigint> {
    const ethReserve = await this.contract.ethReserve();
    const rootReserve = await this.contract.rootReserve();
    return await this.contract.getAmountOut(ethAmount, ethReserve, rootReserve);
  }

  /**
   * Get estimated ETH out for a given $ROOT amount
   */
  async getSellQuote(rootAmount: bigint): Promise<bigint> {
    const ethReserve = await this.contract.ethReserve();
    const rootReserve = await this.contract.rootReserve();
    return await this.contract.getAmountOut(rootAmount, rootReserve, ethReserve);
  }

  /**
   * Get pool reserves
   */
  async getReserves(): Promise<{ ethReserve: bigint; rootReserve: bigint }> {
    const [ethReserve, rootReserve] = await Promise.all([
      this.contract.ethReserve(),
      this.contract.rootReserve(),
    ]);
    return { ethReserve, rootReserve };
  }

  /**
   * Get current $ROOT price (ROOT per 1 ETH)
   */
  async getRootPrice(): Promise<bigint> {
    return await this.contract.getRootPrice();
  }

  // ============ Helper Functions ============

  /**
   * Get relayer fees
   */
  async getRelayerFees(): Promise<RelayerFees> {
    try {
      const response = await fetch(`${this.config.relayerUrl}/fees`);
      const data = await response.json() as { baseFee: string; percentFee: string };
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
   * Get relayer address
   */
  async getRelayerAddress(): Promise<string> {
    try {
      const response = await fetch(`${this.config.relayerUrl}/address`);
      const data = await response.json() as { address: string };
      return data.address;
    } catch {
      return ethers.ZeroAddress;
    }
  }

  /**
   * Get transaction status from relayer
   */
  async getTransactionStatus(jobId: string): Promise<{
    status: 'queued' | 'processing' | 'completed' | 'failed';
    txHash?: string;
    error?: string;
  }> {
    const response = await fetch(`${this.config.relayerUrl}/status/${jobId}`);
    return response.json() as Promise<{
      status: 'queued' | 'processing' | 'completed' | 'failed';
      txHash?: string;
      error?: string;
    }>;
  }

  /**
   * Export wallet state for local storage
   */
  exportWalletState(): string {
    if (!this.wallet) throw new Error('Client not initialized');
    return this.wallet.exportState();
  }

  /**
   * Import wallet state from local storage
   */
  importWalletState(state: string): void {
    if (!this.wallet) throw new Error('Client not initialized');
    this.wallet.importState(state);
  }
}
