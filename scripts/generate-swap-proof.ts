/**
 * Generate a valid ZK proof for the swap circuit
 * This is used to test the RealSwapVerifier on-chain
 */

import * as snarkjs from 'snarkjs';
import * as fs from 'fs';
import * as path from 'path';
import { poseidon2, poseidon3 } from 'poseidon-lite';

// Circuit paths
const WASM_PATH = path.join(__dirname, '../circuits/build/swap/swap_js/swap.wasm');
const ZKEY_PATH = path.join(__dirname, '../circuits/build/swap/swap_final.zkey');

// Tree depth
const TREE_DEPTH = 24;

// Precomputed zeros for empty tree
function computeZeros(): bigint[] {
  const zeros: bigint[] = [0n];
  for (let i = 1; i <= TREE_DEPTH; i++) {
    zeros[i] = poseidon2([zeros[i - 1], zeros[i - 1]]);
  }
  return zeros;
}

const ZEROS = computeZeros();

// Simple merkle tree for testing
class SimpleMerkleTree {
  private leaves: bigint[] = [];
  private depth: number;

  constructor(depth: number = TREE_DEPTH) {
    this.depth = depth;
  }

  insert(leaf: bigint): number {
    const index = this.leaves.length;
    this.leaves.push(leaf);
    return index;
  }

  getRoot(): bigint {
    if (this.leaves.length === 0) {
      return ZEROS[this.depth];
    }

    let layer = [...this.leaves];
    const numLevels = this.depth;

    for (let level = 0; level < numLevels; level++) {
      const newLayer: bigint[] = [];
      const levelSize = Math.ceil(layer.length / 2);

      for (let i = 0; i < levelSize; i++) {
        const left = layer[i * 2] ?? ZEROS[level];
        const right = layer[i * 2 + 1] ?? ZEROS[level];
        newLayer.push(poseidon2([left, right]));
      }

      layer = newLayer;
    }

    return layer[0];
  }

  getProof(index: number): { pathElements: bigint[]; pathIndices: number[] } {
    const pathElements: bigint[] = [];
    const pathIndices: number[] = [];

    let currentIndex = index;
    let layer = [...this.leaves];

    for (let level = 0; level < this.depth; level++) {
      const isRight = currentIndex % 2 === 1;
      const siblingIndex = isRight ? currentIndex - 1 : currentIndex + 1;

      pathIndices.push(isRight ? 1 : 0);
      pathElements.push(layer[siblingIndex] ?? ZEROS[level]);

      // Move to next level
      const newLayer: bigint[] = [];
      const levelSize = Math.ceil(layer.length / 2);

      for (let i = 0; i < levelSize; i++) {
        const left = layer[i * 2] ?? ZEROS[level];
        const right = layer[i * 2 + 1] ?? ZEROS[level];
        newLayer.push(poseidon2([left, right]));
      }

      layer = newLayer;
      currentIndex = Math.floor(currentIndex / 2);
    }

    return { pathElements, pathIndices };
  }
}

// Hash commitment
function hashCommitment(nullifier: bigint, secret: bigint, amount: bigint): bigint {
  return poseidon3([nullifier, secret, amount]);
}

// Hash nullifier
function hashNullifier(nullifier: bigint, leafIndex: number): bigint {
  return poseidon2([nullifier, BigInt(leafIndex)]);
}

// Random field element
function randomFieldElement(): bigint {
  const bytes = new Uint8Array(31);
  crypto.getRandomValues(bytes);
  return BigInt('0x' + Buffer.from(bytes).toString('hex'));
}

async function generateSwapProof() {
  console.log('=== Generating Swap Circuit Proof ===\n');

  // 1. Create test input commitment
  const inputNullifier = randomFieldElement();
  const inputSecret = randomFieldElement();
  const inputTotalAmount = 1000n * BigInt(1e18); // 1000 tokens
  const inputAmount = 500n * BigInt(1e18); // Swapping 500 tokens

  const inputCommitment = hashCommitment(inputNullifier, inputSecret, inputTotalAmount);
  console.log('Input commitment:', inputCommitment.toString());

  // 2. Build merkle tree and insert commitment
  const tree = new SimpleMerkleTree(TREE_DEPTH);
  const leafIndex = tree.insert(inputCommitment);
  const merkleRoot = tree.getRoot();
  const proof = tree.getProof(leafIndex);

  console.log('Leaf index:', leafIndex);
  console.log('Merkle root:', merkleRoot.toString());

  // 3. Compute nullifier hash
  const nullifierHash = hashNullifier(inputNullifier, leafIndex);
  console.log('Nullifier hash:', nullifierHash.toString());

  // 4. Create output commitment
  const outputNullifier = randomFieldElement();
  const outputSecret = randomFieldElement();
  const outputAmount = 450n * BigInt(1e18); // Expected output after swap
  const outputCommitment = hashCommitment(outputNullifier, outputSecret, outputAmount);
  console.log('Output commitment:', outputCommitment.toString());

  // 5. Create change commitment (input - swap = change)
  const changeNullifier = randomFieldElement();
  const changeSecret = randomFieldElement();
  const changeAmount = inputTotalAmount - inputAmount; // 500 tokens change
  const changeCommitment = hashCommitment(changeNullifier, changeSecret, changeAmount);
  console.log('Change commitment:', changeCommitment.toString());

  // 6. Min output amount (slippage protection)
  const minOutputAmount = 400n * BigInt(1e18);

  // 7. Prepare circuit inputs
  const circuitInputs = {
    // Public inputs
    inputMerkleRoot: merkleRoot.toString(),
    inputNullifierHash: nullifierHash.toString(),
    inputAmount: inputAmount.toString(),
    outputCommitment: outputCommitment.toString(),
    minOutputAmount: minOutputAmount.toString(),
    changeCommitment: changeCommitment.toString(),

    // Private inputs - Input commitment
    inputNullifier: inputNullifier.toString(),
    inputSecret: inputSecret.toString(),
    inputTotalAmount: inputTotalAmount.toString(),
    inputPathElements: proof.pathElements.map(e => e.toString()),
    inputPathIndices: proof.pathIndices,

    // Private inputs - Output commitment
    outputNullifier: outputNullifier.toString(),
    outputSecret: outputSecret.toString(),
    outputAmount: outputAmount.toString(),

    // Private inputs - Change commitment
    changeNullifier: changeNullifier.toString(),
    changeSecret: changeSecret.toString(),
  };

  console.log('\n=== Circuit Inputs ===');
  console.log(JSON.stringify(circuitInputs, null, 2));

  // 8. Generate the proof
  console.log('\n=== Generating Proof (this may take a moment) ===');

  try {
    const { proof: zkProof, publicSignals } = await snarkjs.groth16.fullProve(
      circuitInputs,
      WASM_PATH,
      ZKEY_PATH
    );

    console.log('\n=== Proof Generated Successfully! ===');
    console.log('\nPublic signals:', publicSignals);

    // 9. Format for Solidity
    const solidityProof = [
      BigInt(zkProof.pi_a[0]),
      BigInt(zkProof.pi_a[1]),
      BigInt(zkProof.pi_b[0][1]),
      BigInt(zkProof.pi_b[0][0]),
      BigInt(zkProof.pi_b[1][1]),
      BigInt(zkProof.pi_b[1][0]),
      BigInt(zkProof.pi_c[0]),
      BigInt(zkProof.pi_c[1]),
    ];

    console.log('\n=== Solidity Calldata ===');
    console.log('\nproof array (uint256[8]):');
    console.log('[');
    solidityProof.forEach((p, i) => {
      console.log(`  ${p.toString()}${i < 7 ? ',' : ''}`);
    });
    console.log(']');

    console.log('\npubSignals array (uint256[6]):');
    console.log('[');
    publicSignals.forEach((s: string, i: number) => {
      console.log(`  ${s}${i < 5 ? ',' : ''}`);
    });
    console.log(']');

    // 10. Verify locally
    console.log('\n=== Verifying Locally ===');
    const vkey = JSON.parse(
      fs.readFileSync(
        path.join(__dirname, '../circuits/build/swap/verification_key.json'),
        'utf8'
      )
    );

    const isValid = await snarkjs.groth16.verify(vkey, publicSignals, zkProof);
    console.log('Local verification:', isValid ? 'VALID' : 'INVALID');

    // 11. Save proof for test file
    const testData = {
      proof: solidityProof.map(p => p.toString()),
      publicSignals,
      isValid,
    };

    fs.writeFileSync(
      path.join(__dirname, '../circuits/build/swap/test_proof.json'),
      JSON.stringify(testData, null, 2)
    );
    console.log('\nProof saved to circuits/build/swap/test_proof.json');

    // 12. Generate Foundry test format
    console.log('\n=== Foundry Test Code ===');
    console.log(`
    // Add this to RealSwapVerifier.t.sol
    function test_RealVerifier_ValidProof_Generated() public view {
        uint256[8] memory proof = [
            ${solidityProof[0].toString()},
            ${solidityProof[1].toString()},
            ${solidityProof[2].toString()},
            ${solidityProof[3].toString()},
            ${solidityProof[4].toString()},
            ${solidityProof[5].toString()},
            ${solidityProof[6].toString()},
            ${solidityProof[7].toString()}
        ];

        uint256[6] memory pubSignals = [
            ${publicSignals[0]},
            ${publicSignals[1]},
            ${publicSignals[2]},
            ${publicSignals[3]},
            ${publicSignals[4]},
            ${publicSignals[5]}
        ];

        bool result = realVerifier.verifyProof(proof, pubSignals);
        assertTrue(result, "Valid proof should be accepted");
    }
    `);

  } catch (error) {
    console.error('Error generating proof:', error);
    throw error;
  }
}

// Run
generateSwapProof().catch(console.error);
