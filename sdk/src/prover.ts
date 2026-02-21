import * as snarkjs from 'snarkjs';
import type { ProofResult, SellProofInputs, TransferProofInputs, WithdrawProofInputs, VoteProofInputs, PledgeProofInputs, SwapProofInputs, MergeProofInputs, Groth16Proof } from './types';

/**
 * ZK Proof Generator
 * Generates Groth16 proofs for all circuit types:
 * - sell: Sell tokens for ETH (ZkAMM)
 * - transfer: Private token transfer
 * - withdraw: Exit privacy pool to public wallet
 * - vote: Governance voting (LaunchpadGovernance)
 * - swap: Token swap (ZkAMMPair - project tokens <-> $HIDDEN)
 */
export class Prover {
  private sellWasm: string | Uint8Array;
  private sellZkey: string | Uint8Array;
  private transferWasm: string | Uint8Array;
  private transferZkey: string | Uint8Array;
  private withdrawWasm: string | Uint8Array;
  private withdrawZkey: string | Uint8Array;
  private voteWasm?: string | Uint8Array;
  private voteZkey?: string | Uint8Array;
  private pledgeWasm?: string | Uint8Array;
  private pledgeZkey?: string | Uint8Array;
  private swapWasm?: string | Uint8Array;
  private swapZkey?: string | Uint8Array;
  private addLiquidityWasm?: string | Uint8Array;
  private addLiquidityZkey?: string | Uint8Array;
  private removeLiquidityWasm?: string | Uint8Array;
  private removeLiquidityZkey?: string | Uint8Array;
  private claimFeesWasm?: string | Uint8Array;
  private claimFeesZkey?: string | Uint8Array;
  private mergeWasm?: string | Uint8Array;
  private mergeZkey?: string | Uint8Array;

  constructor(config: {
    sellWasm: string | Uint8Array;
    sellZkey: string | Uint8Array;
    transferWasm: string | Uint8Array;
    transferZkey: string | Uint8Array;
    withdrawWasm: string | Uint8Array;
    withdrawZkey: string | Uint8Array;
    voteWasm?: string | Uint8Array;
    voteZkey?: string | Uint8Array;
    pledgeWasm?: string | Uint8Array;
    pledgeZkey?: string | Uint8Array;
    swapWasm?: string | Uint8Array;
    swapZkey?: string | Uint8Array;
    addLiquidityWasm?: string | Uint8Array;
    addLiquidityZkey?: string | Uint8Array;
    removeLiquidityWasm?: string | Uint8Array;
    removeLiquidityZkey?: string | Uint8Array;
    claimFeesWasm?: string | Uint8Array;
    claimFeesZkey?: string | Uint8Array;
    mergeWasm?: string | Uint8Array;
    mergeZkey?: string | Uint8Array;
  }) {
    this.sellWasm = config.sellWasm;
    this.sellZkey = config.sellZkey;
    this.transferWasm = config.transferWasm;
    this.transferZkey = config.transferZkey;
    this.withdrawWasm = config.withdrawWasm;
    this.withdrawZkey = config.withdrawZkey;
    this.voteWasm = config.voteWasm;
    this.voteZkey = config.voteZkey;
    this.pledgeWasm = config.pledgeWasm;
    this.pledgeZkey = config.pledgeZkey;
    this.swapWasm = config.swapWasm;
    this.swapZkey = config.swapZkey;
    this.addLiquidityWasm = config.addLiquidityWasm;
    this.addLiquidityZkey = config.addLiquidityZkey;
    this.removeLiquidityWasm = config.removeLiquidityWasm;
    this.removeLiquidityZkey = config.removeLiquidityZkey;
    this.claimFeesWasm = config.claimFeesWasm;
    this.claimFeesZkey = config.claimFeesZkey;
    this.mergeWasm = config.mergeWasm;
    this.mergeZkey = config.mergeZkey;
  }

  /**
   * Generate proof for selling tokens
   */
  async proveSell(inputs: SellProofInputs): Promise<ProofResult> {
    const circuitInputs = {
      // Public inputs
      merkleRoot: inputs.merkleRoot.toString(),
      nullifierHash: inputs.nullifierHash.toString(),
      tokenAmount: inputs.tokenAmount.toString(),
      minEthOut: inputs.minEthOut.toString(),
      recipient: BigInt(inputs.recipient).toString(),
      relayer: BigInt(inputs.relayer).toString(),
      fee: inputs.fee.toString(),
      changeCommitment: inputs.changeCommitment.toString(),

      // Private inputs
      nullifier: inputs.nullifier.toString(),
      secret: inputs.secret.toString(),
      amount: inputs.amount.toString(),
      pathElements: inputs.pathElements.map((e) => e.toString()),
      pathIndices: inputs.pathIndices,
      changeNullifier: inputs.changeNullifier.toString(),
      changeSecret: inputs.changeSecret.toString(),
    };

    const { proof, publicSignals } = await snarkjs.groth16.fullProve(
      circuitInputs,
      this.sellWasm,
      this.sellZkey
    );

    return {
      proof: proof as unknown as Groth16Proof,
      publicSignals,
    };
  }

  /**
   * Generate proof for transferring tokens
   */
  async proveTransfer(inputs: TransferProofInputs): Promise<ProofResult> {
    const circuitInputs = {
      // Public inputs
      merkleRoot: inputs.merkleRoot.toString(),
      nullifierHash: inputs.nullifierHash.toString(),
      recipientCommitment: inputs.recipientCommitment.toString(),
      changeCommitment: inputs.changeCommitment.toString(),

      // Private inputs
      nullifier: inputs.nullifier.toString(),
      secret: inputs.secret.toString(),
      amount: inputs.amount.toString(),
      pathElements: inputs.pathElements.map((e) => e.toString()),
      pathIndices: inputs.pathIndices,
      transferAmount: inputs.transferAmount.toString(),
      recipientNullifier: inputs.recipientNullifier.toString(),
      recipientSecret: inputs.recipientSecret.toString(),
      changeNullifier: inputs.changeNullifier.toString(),
      changeSecret: inputs.changeSecret.toString(),
    };

    const { proof, publicSignals } = await snarkjs.groth16.fullProve(
      circuitInputs,
      this.transferWasm,
      this.transferZkey
    );

    return {
      proof: proof as unknown as Groth16Proof,
      publicSignals,
    };
  }

  /**
   * Generate proof for withdrawing tokens to a public wallet
   * Exits the privacy pool - reveals recipient and amount on-chain
   */
  async proveWithdraw(inputs: WithdrawProofInputs): Promise<ProofResult> {
    const circuitInputs = {
      // Public inputs
      merkleRoot: inputs.merkleRoot.toString(),
      nullifierHash: inputs.nullifierHash.toString(),
      amount: inputs.amount.toString(),
      recipient: BigInt(inputs.recipient).toString(),

      // Private inputs
      nullifier: inputs.nullifier.toString(),
      secret: inputs.secret.toString(),
      pathElements: inputs.pathElements.map((e) => e.toString()),
      pathIndices: inputs.pathIndices,
    };

    const { proof, publicSignals } = await snarkjs.groth16.fullProve(
      circuitInputs,
      this.withdrawWasm,
      this.withdrawZkey
    );

    return {
      proof: proof as unknown as Groth16Proof,
      publicSignals,
    };
  }

  /**
   * Generate proof for governance voting
   * Proves ownership of $HIDDEN tokens for weighted voting
   */
  async proveVote(inputs: VoteProofInputs): Promise<ProofResult> {
    if (!this.voteWasm || !this.voteZkey) {
      throw new Error('Vote circuit not loaded');
    }

    const circuitInputs = {
      // Public inputs
      proposalId: inputs.proposalId.toString(),
      merkleRoot: inputs.merkleRoot.toString(),
      nullifierHash: inputs.nullifierHash.toString(),
      voteWeight: inputs.voteWeight.toString(),
      support: inputs.support ? '1' : '0',

      // Private inputs
      nullifier: inputs.nullifier.toString(),
      secret: inputs.secret.toString(),
      amount: inputs.amount.toString(),
      pathElements: inputs.pathElements.map((e) => e.toString()),
      pathIndices: inputs.pathIndices,
    };

    const { proof, publicSignals } = await snarkjs.groth16.fullProve(
      circuitInputs,
      this.voteWasm,
      this.voteZkey
    );

    return {
      proof: proof as unknown as Groth16Proof,
      publicSignals,
    };
  }

  /**
   * Generate proof for proposal pledge
   * Proves ownership of $R00T tokens for pledging as initial liquidity
   */
  async provePledge(inputs: PledgeProofInputs): Promise<ProofResult> {
    if (!this.pledgeWasm || !this.pledgeZkey) {
      throw new Error('Pledge circuit not loaded');
    }

    const circuitInputs = {
      // Public inputs
      merkleRoot: inputs.merkleRoot.toString(),
      nullifierHash: inputs.nullifierHash.toString(),
      pledgeAmount: inputs.pledgeAmount.toString(),
      creator: BigInt(inputs.creator).toString(),
      // Note: pledge circuit does not have publicInputsBinding for TestPledgeVerifier compatibility

      // Private inputs
      nullifier: inputs.nullifier.toString(),
      secret: inputs.secret.toString(),
      pathElements: inputs.pathElements.map((e) => e.toString()),
      pathIndices: inputs.pathIndices,
    };

    const { proof, publicSignals } = await snarkjs.groth16.fullProve(
      circuitInputs,
      this.pledgeWasm,
      this.pledgeZkey
    );

    return {
      proof: proof as unknown as Groth16Proof,
      publicSignals,
    };
  }

  /**
   * Generate proof for ZkAMMPair swap
   * Swaps between $HIDDEN and project tokens
   */
  async proveSwap(inputs: SwapProofInputs): Promise<ProofResult> {
    if (!this.swapWasm || !this.swapZkey) {
      throw new Error('Swap circuit not loaded');
    }

    const circuitInputs = {
      // Public inputs
      inputMerkleRoot: inputs.inputMerkleRoot.toString(),
      inputNullifierHash: inputs.inputNullifierHash.toString(),
      inputAmount: inputs.inputAmount.toString(),
      outputCommitment: inputs.outputCommitment.toString(),
      minOutputAmount: inputs.minOutputAmount.toString(),
      changeCommitment: inputs.changeCommitment.toString(),

      // Private inputs - Input
      inputNullifier: inputs.inputNullifier.toString(),
      inputSecret: inputs.inputSecret.toString(),
      inputTotalAmount: inputs.inputTotalAmount.toString(),
      inputPathElements: inputs.inputPathElements.map((e) => e.toString()),
      inputPathIndices: inputs.inputPathIndices,

      // Private inputs - Output
      outputNullifier: inputs.outputNullifier.toString(),
      outputSecret: inputs.outputSecret.toString(),
      outputAmount: inputs.outputAmount.toString(),

      // Private inputs - Change
      changeNullifier: inputs.changeNullifier.toString(),
      changeSecret: inputs.changeSecret.toString(),
    };

    const { proof, publicSignals } = await snarkjs.groth16.fullProve(
      circuitInputs,
      this.swapWasm,
      this.swapZkey
    );

    return {
      proof: proof as unknown as Groth16Proof,
      publicSignals,
    };
  }

  /**
   * Generate proof for adding liquidity
   */
  async proveAddLiquidity(inputs: any): Promise<ProofResult> {
    if (!this.addLiquidityWasm || !this.addLiquidityZkey) {
      throw new Error('AddLiquidity circuit not loaded');
    }

    const circuitInputs = {
      // Public inputs
      merkleRoot: inputs.merkleRoot.toString(),
      nullifierHash: inputs.nullifierHash.toString(),
      tokenAmount: inputs.tokenAmount.toString(),
      lpCommitment: inputs.lpCommitment.toString(),
      changeCommitment: inputs.changeCommitment.toString(),

      // Private inputs
      nullifier: inputs.nullifier.toString(),
      secret: inputs.secret.toString(),
      amount: inputs.amount.toString(),
      pathElements: inputs.pathElements.map((e: any) => e.toString()),
      pathIndices: inputs.pathIndices,
      lpNullifier: inputs.lpNullifier.toString(),
      lpSecret: inputs.lpSecret.toString(),
      lpShares: inputs.lpShares.toString(),
      changeNullifier: inputs.changeNullifier.toString(),
      changeSecret: inputs.changeSecret.toString(),
    };

    const { proof, publicSignals } = await snarkjs.groth16.fullProve(
      circuitInputs,
      this.addLiquidityWasm,
      this.addLiquidityZkey
    );

    return {
      proof: proof as unknown as Groth16Proof,
      publicSignals,
    };
  }

  /**
   * Generate proof for removing liquidity
   * SECURITY FIX: Now includes tokenCommitment and tokensOut to make returned tokens spendable
   */
  async proveRemoveLiquidity(inputs: any): Promise<ProofResult> {
    if (!this.removeLiquidityWasm || !this.removeLiquidityZkey) {
      throw new Error('RemoveLiquidity circuit not loaded');
    }

    const circuitInputs = {
      // Public inputs
      lpMerkleRoot: inputs.lpMerkleRoot.toString(),
      nullifierHash: inputs.nullifierHash.toString(),
      commitment: inputs.commitment.toString(),
      withdrawShares: inputs.withdrawShares.toString(),
      minEthOut: inputs.minEthOut.toString(),
      recipient: BigInt(inputs.recipient).toString(),
      changeCommitment: inputs.changeCommitment.toString(),
      tokenCommitment: inputs.tokenCommitment.toString(),  // SECURITY FIX: Token commitment (verified in circuit)
      tokensOut: inputs.tokensOut.toString(),              // SECURITY FIX: Tokens to return

      // Private inputs
      nullifier: inputs.nullifier.toString(),
      secret: inputs.secret.toString(),
      totalShares: inputs.totalShares.toString(),
      pathElements: inputs.pathElements.map((e: any) => e.toString()),
      pathIndices: inputs.pathIndices,
      changeNullifier: inputs.changeNullifier.toString(),
      changeSecret: inputs.changeSecret.toString(),
      tokenNullifier: inputs.tokenNullifier.toString(),    // SECURITY FIX: Nullifier for token commitment
      tokenSecret: inputs.tokenSecret.toString(),          // SECURITY FIX: Secret for token commitment
    };

    const { proof, publicSignals } = await snarkjs.groth16.fullProve(
      circuitInputs,
      this.removeLiquidityWasm,
      this.removeLiquidityZkey
    );

    return {
      proof: proof as unknown as Groth16Proof,
      publicSignals,
    };
  }

  /**
   * Generate proof for claiming LP fees
   */
  async proveClaimFees(inputs: any): Promise<ProofResult> {
    if (!this.claimFeesWasm || !this.claimFeesZkey) {
      throw new Error('ClaimFees circuit not loaded');
    }

    const circuitInputs = {
      // Public inputs
      lpMerkleRoot: inputs.lpMerkleRoot.toString(),
      claimNullifier: inputs.claimNullifier.toString(),
      feeEpoch: inputs.feeEpoch.toString(),
      lpShares: inputs.lpShares.toString(),
      recipient: BigInt(inputs.recipient).toString(),

      // Private inputs
      nullifier: inputs.nullifier.toString(),
      secret: inputs.secret.toString(),
      pathElements: inputs.pathElements.map((e: any) => e.toString()),
      pathIndices: inputs.pathIndices,
    };

    const { proof, publicSignals } = await snarkjs.groth16.fullProve(
      circuitInputs,
      this.claimFeesWasm,
      this.claimFeesZkey
    );

    return {
      proof: proof as unknown as Groth16Proof,
      publicSignals,
    };
  }

  /**
   * Generate proof for merging two commitments into one
   */
  async proveMerge(inputs: MergeProofInputs): Promise<ProofResult> {
    if (!this.mergeWasm || !this.mergeZkey) {
      throw new Error('Merge circuit not loaded');
    }

    const circuitInputs = {
      // Public inputs
      merkleRoot: inputs.merkleRoot.toString(),
      nullifierHash1: inputs.nullifierHash1.toString(),
      nullifierHash2: inputs.nullifierHash2.toString(),
      outputCommitment: inputs.outputCommitment.toString(),

      // Private inputs - Input 1
      nullifier1: inputs.nullifier1.toString(),
      secret1: inputs.secret1.toString(),
      amount1: inputs.amount1.toString(),
      pathElements1: inputs.pathElements1.map((e) => e.toString()),
      pathIndices1: inputs.pathIndices1,

      // Private inputs - Input 2
      nullifier2: inputs.nullifier2.toString(),
      secret2: inputs.secret2.toString(),
      amount2: inputs.amount2.toString(),
      pathElements2: inputs.pathElements2.map((e) => e.toString()),
      pathIndices2: inputs.pathIndices2,

      // Private inputs - Output
      outputNullifier: inputs.outputNullifier.toString(),
      outputSecret: inputs.outputSecret.toString(),
    };

    const { proof, publicSignals } = await snarkjs.groth16.fullProve(
      circuitInputs,
      this.mergeWasm,
      this.mergeZkey
    );

    return {
      proof: proof as unknown as Groth16Proof,
      publicSignals,
    };
  }

  /**
   * Verify a proof locally (for testing)
   */
  async verify(
    proof: Groth16Proof,
    publicSignals: string[],
    verificationKey: object
  ): Promise<boolean> {
    return await snarkjs.groth16.verify(
      verificationKey,
      publicSignals,
      proof as unknown as snarkjs.Groth16Proof
    );
  }

  /**
   * Format proof for Solidity verifier
   * Converts snarkjs proof format to uint256[8] array
   */
  static formatProofForSolidity(proof: Groth16Proof): bigint[] {
    return [
      BigInt(proof.pi_a[0]),
      BigInt(proof.pi_a[1]),
      BigInt(proof.pi_b[0][1]), // Note: pi_b coordinates are swapped
      BigInt(proof.pi_b[0][0]),
      BigInt(proof.pi_b[1][1]),
      BigInt(proof.pi_b[1][0]),
      BigInt(proof.pi_c[0]),
      BigInt(proof.pi_c[1]),
    ];
  }

  /**
   * Format public signals for Solidity
   */
  static formatSignalsForSolidity(publicSignals: string[]): bigint[] {
    return publicSignals.map((s) => BigInt(s));
  }
}

/**
 * Load circuit artifacts from files (Node.js)
 */
export async function loadCircuitArtifacts(basePath: string): Promise<{
  sellWasm: Uint8Array;
  sellZkey: Uint8Array;
  transferWasm: Uint8Array;
  transferZkey: Uint8Array;
  withdrawWasm: Uint8Array;
  withdrawZkey: Uint8Array;
  addLiquidityWasm: Uint8Array;
  addLiquidityZkey: Uint8Array;
  removeLiquidityWasm: Uint8Array;
  removeLiquidityZkey: Uint8Array;
  claimFeesWasm: Uint8Array;
  claimFeesZkey: Uint8Array;
}> {
  const fs = await import('fs/promises');
  const path = await import('path');

  const [
    sellWasm, sellZkey,
    transferWasm, transferZkey,
    withdrawWasm, withdrawZkey,
    addLiquidityWasm, addLiquidityZkey,
    removeLiquidityWasm, removeLiquidityZkey,
    claimFeesWasm, claimFeesZkey
  ] = await Promise.all([
    fs.readFile(path.join(basePath, 'sell/sell_js/sell.wasm')),
    fs.readFile(path.join(basePath, 'sell/sell_final.zkey')),
    fs.readFile(path.join(basePath, 'transfer/transfer_js/transfer.wasm')),
    fs.readFile(path.join(basePath, 'transfer/transfer_final.zkey')),
    fs.readFile(path.join(basePath, 'withdraw/withdraw_js/withdraw.wasm')),
    fs.readFile(path.join(basePath, 'withdraw/withdraw_final.zkey')),
    fs.readFile(path.join(basePath, 'addLiquidity/addLiquidity_js/addLiquidity.wasm')),
    fs.readFile(path.join(basePath, 'addLiquidity/addLiquidity_final.zkey')),
    fs.readFile(path.join(basePath, 'removeLiquidity/removeLiquidity_js/removeLiquidity.wasm')),
    fs.readFile(path.join(basePath, 'removeLiquidity/removeLiquidity_final.zkey')),
    fs.readFile(path.join(basePath, 'claimLPFees/claimLPFees_js/claimLPFees.wasm')),
    fs.readFile(path.join(basePath, 'claimLPFees/claimLPFees_final.zkey')),
  ]);

  return {
    sellWasm: new Uint8Array(sellWasm),
    sellZkey: new Uint8Array(sellZkey),
    transferWasm: new Uint8Array(transferWasm),
    transferZkey: new Uint8Array(transferZkey),
    withdrawWasm: new Uint8Array(withdrawWasm),
    withdrawZkey: new Uint8Array(withdrawZkey),
    addLiquidityWasm: new Uint8Array(addLiquidityWasm),
    addLiquidityZkey: new Uint8Array(addLiquidityZkey),
    removeLiquidityWasm: new Uint8Array(removeLiquidityWasm),
    removeLiquidityZkey: new Uint8Array(removeLiquidityZkey),
    claimFeesWasm: new Uint8Array(claimFeesWasm),
    claimFeesZkey: new Uint8Array(claimFeesZkey),
  };
}

/**
 * Load circuit artifacts from URLs (Browser)
 */
export async function loadCircuitArtifactsFromUrls(baseUrl: string): Promise<{
  sellWasm: Uint8Array;
  sellZkey: Uint8Array;
  transferWasm: Uint8Array;
  transferZkey: Uint8Array;
  withdrawWasm: Uint8Array;
  withdrawZkey: Uint8Array;
  addLiquidityWasm: Uint8Array;
  addLiquidityZkey: Uint8Array;
  removeLiquidityWasm: Uint8Array;
  removeLiquidityZkey: Uint8Array;
  claimFeesWasm: Uint8Array;
  claimFeesZkey: Uint8Array;
  voteWasm: Uint8Array;
  voteZkey: Uint8Array;
  pledgeWasm: Uint8Array;
  pledgeZkey: Uint8Array;
  mergeWasm: Uint8Array;
  mergeZkey: Uint8Array;
}> {
  const fetchArtifact = async (url: string): Promise<Uint8Array> => {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch ${url}: ${response.statusText}`);
    }
    const buffer = await response.arrayBuffer();
    return new Uint8Array(buffer);
  };

  const [
    sellWasm, sellZkey,
    transferWasm, transferZkey,
    withdrawWasm, withdrawZkey,
    addLiquidityWasm, addLiquidityZkey,
    removeLiquidityWasm, removeLiquidityZkey,
    claimFeesWasm, claimFeesZkey,
    voteWasm, voteZkey,
    pledgeWasm, pledgeZkey,
    mergeWasm, mergeZkey
  ] = await Promise.all([
    fetchArtifact(`${baseUrl}/sell/sell_js/sell.wasm`),
    fetchArtifact(`${baseUrl}/sell/sell_final.zkey`),
    fetchArtifact(`${baseUrl}/transfer/transfer_js/transfer.wasm`),
    fetchArtifact(`${baseUrl}/transfer/transfer_final.zkey`),
    fetchArtifact(`${baseUrl}/withdraw/withdraw_js/withdraw.wasm`),
    fetchArtifact(`${baseUrl}/withdraw/withdraw_final.zkey`),
    fetchArtifact(`${baseUrl}/addLiquidity/addLiquidity_js/addLiquidity.wasm`),
    fetchArtifact(`${baseUrl}/addLiquidity/addLiquidity_final.zkey`),
    fetchArtifact(`${baseUrl}/removeLiquidity/removeLiquidity_js/removeLiquidity.wasm`),
    fetchArtifact(`${baseUrl}/removeLiquidity/removeLiquidity_final.zkey`),
    fetchArtifact(`${baseUrl}/claimLPFees/claimLPFees_js/claimLPFees.wasm`),
    fetchArtifact(`${baseUrl}/claimLPFees/claimLPFees_final.zkey`),
    fetchArtifact(`${baseUrl}/vote/vote_js/vote.wasm`),
    fetchArtifact(`${baseUrl}/vote/vote_final.zkey`),
    fetchArtifact(`${baseUrl}/pledge/pledge_js/pledge.wasm`),
    fetchArtifact(`${baseUrl}/pledge/pledge_final.zkey`),
    fetchArtifact(`${baseUrl}/merge/merge.wasm`),
    fetchArtifact(`${baseUrl}/merge/merge_final.zkey`),
  ]);

  return {
    sellWasm, sellZkey,
    transferWasm, transferZkey,
    withdrawWasm, withdrawZkey,
    addLiquidityWasm, addLiquidityZkey,
    removeLiquidityWasm, removeLiquidityZkey,
    claimFeesWasm, claimFeesZkey,
    voteWasm, voteZkey,
    pledgeWasm, pledgeZkey,
    mergeWasm, mergeZkey
  };
}
