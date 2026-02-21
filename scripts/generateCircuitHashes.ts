/**
 * Circuit Artifact Hash Generator
 *
 * SECURITY CRITICAL: This script generates SHA-256 hashes for circuit artifacts.
 * These hashes are used to verify circuit integrity before proof generation,
 * preventing supply-chain attacks where malicious circuits steal user secrets.
 *
 * Usage:
 *   npx tsx scripts/generateCircuitHashes.ts
 *
 * Output:
 *   - Prints hashes in format ready to copy-paste into frontend/src/utils/circuitIntegrity.ts
 *   - Also writes to circuits/build/circuit-hashes.json for automated use
 */

import { createHash } from 'crypto';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

// Circuit names matching CIRCUIT_HASHES in circuitIntegrity.ts
const CIRCUITS = [
  'sell',
  'transfer',
  'withdraw',
  'swap',
  'vote',
  'addLiquidity',
  'removeLiquidity',
  'claimLPFees',
];

// Base directory for circuit builds
const BUILD_DIR = join(__dirname, '..', 'circuits', 'build');

interface CircuitHashes {
  [key: string]: string;
}

function sha256(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

function generateHashes(): CircuitHashes {
  const hashes: CircuitHashes = {};
  let hasErrors = false;

  console.log('='.repeat(60));
  console.log('CIRCUIT ARTIFACT HASH GENERATOR');
  console.log('='.repeat(60));
  console.log('');

  for (const circuit of CIRCUITS) {
    const wasmPath = join(BUILD_DIR, circuit, `${circuit}_js`, `${circuit}.wasm`);
    const zkeyPath = join(BUILD_DIR, circuit, `${circuit}_final.zkey`);

    // Check WASM
    if (existsSync(wasmPath)) {
      const wasmData = readFileSync(wasmPath);
      const wasmHash = sha256(wasmData);
      hashes[`${circuit}.wasm`] = wasmHash;
      console.log(`✓ ${circuit}.wasm: ${wasmHash.substring(0, 16)}...`);
    } else {
      console.error(`✗ MISSING: ${wasmPath}`);
      hashes[`${circuit}.wasm`] = '';
      hasErrors = true;
    }

    // Check ZKEY
    if (existsSync(zkeyPath)) {
      const zkeyData = readFileSync(zkeyPath);
      const zkeyHash = sha256(zkeyData);
      hashes[`${circuit}.zkey`] = zkeyHash;
      console.log(`✓ ${circuit}.zkey: ${zkeyHash.substring(0, 16)}...`);
    } else {
      console.error(`✗ MISSING: ${zkeyPath}`);
      hashes[`${circuit}.zkey`] = '';
      hasErrors = true;
    }
  }

  console.log('');
  console.log('='.repeat(60));

  if (hasErrors) {
    console.log('⚠️  WARNING: Some circuit artifacts are missing!');
    console.log('   Run: ./scripts/compile-circuits.sh to compile all circuits');
    console.log('');
  }

  return hashes;
}

function printTypeScriptCode(hashes: CircuitHashes): void {
  console.log('COPY THE FOLLOWING INTO frontend/src/utils/circuitIntegrity.ts:');
  console.log('='.repeat(60));
  console.log('');
  console.log('export const CIRCUIT_HASHES: Record<string, string> = {');

  for (const circuit of CIRCUITS) {
    const wasmKey = `${circuit}.wasm`;
    const zkeyKey = `${circuit}.zkey`;

    console.log(`  // ${circuit.charAt(0).toUpperCase() + circuit.slice(1)} circuit`);
    console.log(`  '${wasmKey}': '${hashes[wasmKey] || ''}',`);
    console.log(`  '${zkeyKey}': '${hashes[zkeyKey] || ''}',`);
    console.log('');
  }

  console.log('};');
  console.log('');
  console.log('='.repeat(60));
}

function saveJsonHashes(hashes: CircuitHashes): void {
  const outputPath = join(BUILD_DIR, 'circuit-hashes.json');

  const output = {
    generatedAt: new Date().toISOString(),
    warning: 'DO NOT MODIFY - regenerate with: npx tsx scripts/generateCircuitHashes.ts',
    hashes,
  };

  writeFileSync(outputPath, JSON.stringify(output, null, 2));
  console.log(`JSON hashes saved to: ${outputPath}`);
}

function main(): void {
  try {
    const hashes = generateHashes();
    printTypeScriptCode(hashes);
    saveJsonHashes(hashes);

    // Check if any hashes are empty
    const emptyHashes = Object.entries(hashes).filter(([, hash]) => !hash);
    if (emptyHashes.length > 0) {
      console.log('');
      console.log('⚠️  SECURITY WARNING:');
      console.log('   The following artifacts have no hash (missing files):');
      for (const [name] of emptyHashes) {
        console.log(`   - ${name}`);
      }
      console.log('');
      console.log('   Without valid hashes, circuit integrity verification is DISABLED.');
      console.log('   This allows attackers to serve malicious circuits that steal user funds.');
      process.exit(1);
    }

    console.log('');
    console.log('✓ All circuit hashes generated successfully!');
    console.log('');
    console.log('NEXT STEPS:');
    console.log('1. Copy the TypeScript code above into frontend/src/utils/circuitIntegrity.ts');
    console.log('2. Rebuild the frontend: cd frontend && npm run build');
    console.log('3. Verify hashes are being checked in browser console');

  } catch (error) {
    console.error('Error generating hashes:', error);
    process.exit(1);
  }
}

main();
