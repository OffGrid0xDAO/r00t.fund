/**
 * Circuit Artifact Integrity Verification
 *
 * SECURITY FIX: Verifies integrity of ZK circuit artifacts before use
 *
 * This prevents attacks where:
 * - CDN/hosting is compromised and serves malicious artifacts
 * - MITM attacker replaces circuit files
 * - Cached artifacts are corrupted
 *
 * Usage:
 * 1. Generate hashes: npx tsx scripts/generateCircuitHashes.ts
 * 2. Import and use verifyCircuitArtifacts() before proof generation
 *
 * CRITICAL SECURITY WARNING:
 * =========================
 * All hashes below are EMPTY! This means integrity verification is DISABLED.
 * Before production deployment, you MUST:
 * 1. Compile all circuits with: npx circom <circuit>.circom --wasm --r1cs
 * 2. Generate zkeys with trusted setup
 * 3. Run: npx tsx scripts/generateCircuitHashes.ts
 * 4. Copy the generated hashes into CIRCUIT_HASHES below
 *
 * Without valid hashes, attackers can serve malicious circuits that
 * exfiltrate user secrets (nullifier, secret) during proof generation.
 */

// Expected SHA-256 hashes for circuit artifacts
// These should be updated whenever circuits are recompiled
// Run: node scripts/generateCircuitHashes.js
// NOTE: Circuits use DEPTH=24 (supports ~16M commitments)
// IMPORTANT: If circuits are modified, regenerate hashes and update below!
export const CIRCUIT_HASHES: Record<string, string> = {
  // Sell circuit
  'sell.wasm': '12596c203a6489f02471ee9a37f1e804dc040cc0c880335d6ea0c376dc6fc7da',
  'sell.zkey': '57eade9f376793bc71a6826692ccad2c90ee5b91e3fb5182e2eb5a99671994fd',

  // Transfer circuit
  'transfer.wasm': 'ff993665e711780f1cc1b56d776db789c1aaa063ab04a25098269bdc7f53f62a',
  'transfer.zkey': '39e5cf9faf990cc8b2af52b84956df4e9a03ccf804329353b5e632317be0cc2e',

  // Withdraw circuit
  'withdraw.wasm': '5153185e751ceeac1bd7eefe23f55e19e45c7ed2c7cab18ed4ef5c354077b19d',
  'withdraw.zkey': '124a20f41a469c3da7f00976b3a8b7e48157c62fdca7ec7e3dab1b083b89d35d',

  // Swap circuit
  'swap.wasm': '4dbd848e04a24d2647e3bf768ed2fe3a0bb67e2c8117db0d42acfb9b9b1ceba7',
  'swap.zkey': 'a94f0ab790e999ffeacaa78bc321d9aed385970d057a52b0fdb4e575d6d9eb73',

  // Vote circuit
  'vote.wasm': 'd1cfe7a745e55af2159342dfed301bef44dca0d28947980a96257dffe0a03ea0',
  'vote.zkey': 'ee30c0d01210b01e7bb91b1567de5c7a8a4a98d6f4c4feecf731c79839e145f7',

  // Add Liquidity circuit
  'addLiquidity.wasm': 'ef3764f5e2b84984bb5dac5248ecb6359be1da12d118542629bc9c5c3b80490f',
  'addLiquidity.zkey': '6a1fdad216a46547bdc67ac07717c7996c3f7456477d009eb35cb68e684750e3',

  // Remove Liquidity circuit
  'removeLiquidity.wasm': 'dbd46c6accd87e955f1fd6d46d66c4843ce1a7c1a93f41d4b2c91f0ef842ca8c',
  'removeLiquidity.zkey': 'a7cf0f06f5a2994d112aef88b419696c93f7adf13e22ce7c1f617d357ae9ef3d',

  // Claim LP Fees circuit
  'claimLPFees.wasm': 'aa6ef74fba1980d886aa6c55da62f6100f665138b1aa4e6b12b02e930b835f2c',
  'claimLPFees.zkey': '9a559d05b854d0b66b646797a9db72191cebdd3f2a4c44a2987f75673e853360',
};

/**
 * Compute SHA-256 hash of an ArrayBuffer
 */
async function sha256(buffer: ArrayBuffer): Promise<string> {
  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Verify integrity of a circuit artifact
 * @param name - Name of the artifact (e.g., 'sell.wasm')
 * @param data - The artifact data as ArrayBuffer
 * @returns true if hash matches, false otherwise
 */
export async function verifyArtifact(name: string, data: ArrayBuffer): Promise<boolean> {
  const expectedHash = CIRCUIT_HASHES[name];

  // If hash not set, skip verification (development mode)
  // SECURITY WARNING: This is a critical vulnerability in production!
  if (!expectedHash) {
    console.warn(
      `[CircuitIntegrity] ⚠️  SECURITY WARNING: No hash set for ${name}!\n` +
      `Integrity verification is DISABLED. In production, this allows attackers\n` +
      `to serve malicious circuits that can steal user funds.\n` +
      `Run: npx tsx scripts/generateCircuitHashes.ts to fix.`
    );
    return true;
  }

  const actualHash = await sha256(data);
  const matches = actualHash === expectedHash;

  if (!matches) {
    console.error(`[CircuitIntegrity] Hash mismatch for ${name}!`);
    console.error(`  Expected: ${expectedHash}`);
    console.error(`  Actual:   ${actualHash}`);
  } else {
    console.log(`[CircuitIntegrity] ✓ ${name} verified`);
  }

  return matches;
}

/**
 * Verify all circuit artifacts for a specific circuit
 * @param circuitName - Base name of the circuit (e.g., 'sell')
 * @param wasmData - WASM artifact data
 * @param zkeyData - ZKey artifact data
 * @throws Error if verification fails
 */
export async function verifyCircuit(
  circuitName: string,
  wasmData: ArrayBuffer,
  zkeyData: ArrayBuffer
): Promise<void> {
  const wasmValid = await verifyArtifact(`${circuitName}.wasm`, wasmData);
  const zkeyValid = await verifyArtifact(`${circuitName}.zkey`, zkeyData);

  if (!wasmValid || !zkeyValid) {
    throw new Error(
      `Circuit integrity check failed for ${circuitName}. ` +
      `Artifacts may be corrupted or tampered with. ` +
      `Please refresh the page or clear cache.`
    );
  }
}

/**
 * Fetch and verify a circuit artifact
 * @param url - URL to fetch the artifact from
 * @param name - Name of the artifact for hash lookup
 * @returns Verified artifact data
 * @throws Error if fetch fails or verification fails
 */
export async function fetchVerifiedArtifact(
  url: string,
  name: string
): Promise<ArrayBuffer> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${name}: ${response.statusText}`);
  }

  const data = await response.arrayBuffer();

  const valid = await verifyArtifact(name, data);
  if (!valid) {
    throw new Error(
      `Integrity check failed for ${name}. ` +
      `The file may have been tampered with.`
    );
  }

  return data;
}

/**
 * Generate hash for a circuit artifact (for development)
 * Call this to generate hashes for new/updated circuits
 */
export async function generateHash(data: ArrayBuffer): Promise<string> {
  return sha256(data);
}

/**
 * Check if integrity verification is enabled
 * (Returns true if any hashes are set)
 */
export function isIntegrityVerificationEnabled(): boolean {
  return Object.values(CIRCUIT_HASHES).some(hash => hash.length > 0);
}
