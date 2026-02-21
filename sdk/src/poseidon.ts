import { poseidon2, poseidon3 } from 'poseidon-lite';

/**
 * Generic poseidon hash function
 * Supports 2-3 inputs
 */
export function poseidon(inputs: bigint[]): bigint {
  if (inputs.length === 2) {
    return poseidon2(inputs);
  } else if (inputs.length === 3) {
    return poseidon3(inputs);
  } else {
    throw new Error(`Poseidon only supports 2-3 inputs, got ${inputs.length}`);
  }
}

/**
 * Poseidon hash for 2 inputs (merkle tree nodes)
 */
export function hashPair(left: bigint, right: bigint): bigint {
  return poseidon2([left, right]);
}

/**
 * Poseidon hash for 3 inputs (commitments: nullifier, secret, amount)
 */
export function hashCommitment(nullifier: bigint, secret: bigint, amount: bigint): bigint {
  return poseidon3([nullifier, secret, amount]);
}

/**
 * Compute nullifier hash = Poseidon(nullifier, leafIndex)
 * Including leafIndex prevents nullifier grinding attacks
 */
export function hashNullifier(nullifier: bigint, leafIndex: number): bigint {
  return poseidon2([nullifier, BigInt(leafIndex)]);
}

/**
 * Compute claim nullifier = Poseidon(nullifier, feeEpoch, leafIndex)
 */
export function hashClaimNullifier(nullifier: bigint, feeEpoch: bigint, leafIndex: number): bigint {
  return poseidon3([nullifier, feeEpoch, BigInt(leafIndex)]);
}

/**
 * Generate a random field element (254 bits for BN254 curve)
 */
export function randomFieldElement(): bigint {
  // Generate 32 random bytes
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);

  // Convert to bigint
  let value = 0n;
  for (let i = 0; i < 32; i++) {
    value = (value << 8n) | BigInt(bytes[i]);
  }

  // Reduce modulo the field prime (BN254 scalar field)
  const FIELD_PRIME = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
  return value % FIELD_PRIME;
}

/**
 * Create a new commitment
 */
export function createCommitment(amount: bigint): {
  nullifier: bigint;
  secret: bigint;
  amount: bigint;
  commitment: bigint;
} {
  const nullifier = randomFieldElement();
  const secret = randomFieldElement();
  const commitment = hashCommitment(nullifier, secret, amount);

  return { nullifier, secret, amount, commitment };
}
