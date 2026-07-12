#!/usr/bin/env node
/**
 * End-to-end on-chain validation of the LandVault flow against the LIVE deploy:
 *   1) fund a parcel with ETH + a REAL landdeposit proof  → shielded commitment
 *   2) claim R00T to a CHOSEN wallet with a REAL claim proof (full-funding gate)
 * This is the reference proof-gen the frontend will reuse.
 *
 * Env: PRIVATE_KEY, ROBINHOOD_RPC_URL
 */
import { ethers } from 'ethers';
import { poseidon2, poseidon3, poseidon4 } from 'poseidon-lite';
import * as snarkjs from 'snarkjs';
import { readFileSync } from 'node:fs';

const RPC   = process.env.ROBINHOOD_RPC_URL || 'https://rpc.mainnet.chain.robinhood.com';
const VAULT  = '0x063363b69fDF63632AaF2F4ead8ee02B2939c673';
const LAND   = '0xB1195fd631B090CBe989eF10B243FCc34400aADC';
const PARCEL_TOKEN = '0xa613C10B4a4106fc8CFcF9eAD872C8E301A6E51f';
const CIRC = '/Users/0x0010110/Documents/GitHub/r00t-landvault/circuits';
const CIRC_MAIN = '/Users/0x0010110/Documents/GitHub/R00t.fund/circuits';

const ZERO_VALUE = 21663839004416932945382355908790599225266501822907911457504978515578255421292n;
const FIELD = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
const rand = () => { const b = new Uint8Array(31); crypto.getRandomValues(b); let v = 0n; for (const x of b) v = (v << 8n) | BigInt(x); return v % FIELD; };

const VAULT_ABI = [
  'function otcFundETH(bytes32 parcelId, uint256 rootOut, uint256 commitment, uint256 binding, uint256[8] depositProof, bytes note) payable',
  'function claimR00T(uint256[8] proof, uint256[6] pubSignals, address recipient)',
  'function pledgeRoot() view returns (uint256)',
  'function raisedR00TByParcel(bytes32) view returns (uint256)',
];
const ERC20_ABI = ['function balanceOf(address) view returns (uint256)'];
const ROOT = '0x7d0bfc2145327CF98f882De2CB71f8F1D7b8f022';

// pack a snarkjs groth16 proof into the uint256[8] the Solidity verifier expects (note b-coord swap)
function packProof(p) {
  return [p.pi_a[0], p.pi_a[1], p.pi_b[0][1], p.pi_b[0][0], p.pi_b[1][1], p.pi_b[1][0], p.pi_c[0], p.pi_c[1]].map(BigInt);
}

async function main() {
  const pk = process.env.PRIVATE_KEY; if (!pk) throw new Error('PRIVATE_KEY required');
  const provider = new ethers.JsonRpcProvider(RPC);
  const wallet = new ethers.Wallet(pk, provider);
  const vault = new ethers.Contract(VAULT, VAULT_ABI, wallet);
  const parcelToken = new ethers.Contract(PARCEL_TOKEN, ERC20_ABI, provider);

  const parcelId = 1n;                    // deployed demo parcel
  const rootOut = 100n * 10n ** 18n;       // 100 R00T-equiv → meets the 100 target (unlocks claimR00T)
  const claimWallet = ethers.Wallet.createRandom().address; // an UNLINKED recipient
  console.log('claim recipient (unlinked):', claimWallet);

  // ── 1) FUND: build note + landdeposit proof ──
  const nullifier = rand(), secret = rand();
  const commitment = poseidon4([nullifier, secret, parcelId, rootOut]);
  const binding = poseidon3([parcelId, rootOut, commitment]);
  console.log('generating landdeposit proof…');
  const dep = await snarkjs.groth16.fullProve(
    { parcelId: parcelId.toString(), amount: rootOut.toString(), commitment: commitment.toString(), nullifier: nullifier.toString(), secret: secret.toString() },
    `${CIRC}/build/landdeposit/landdeposit_js/landdeposit.wasm`,
    `${CIRC}/build/landdeposit/landdeposit_final.zkey`
  );
  // sanity: publicSignals = [binding, parcelId, amount, commitment]
  if (BigInt(dep.publicSignals[0]) !== binding || BigInt(dep.publicSignals[3]) !== commitment) throw new Error('deposit pubSignals mismatch');
  const depProof = packProof(dep.proof);

  const rootPriceE6 = 100000n, ethPriceE6 = 3000000000n;
  const ethNeeded = (rootOut * rootPriceE6 + ethPriceE6 - 1n) / ethPriceE6;
  const parcelIdB32 = '0x' + parcelId.toString(16).padStart(64, '0');
  console.log(`funding: ${ethers.formatEther(ethNeeded)} ETH for ${rootOut / 10n**18n} R00T-equiv…`);
  const t1 = await vault.otcFundETH(parcelIdB32, rootOut, commitment, binding, depProof, '0x', { value: ethNeeded });
  const r1 = await t1.wait();
  console.log('  ✅ funded in block', r1.blockNumber, 'tx', r1.hash);
  console.log('  raised:', (await vault.raisedR00TByParcel(parcelIdB32)).toString());

  // ── 2) CLAIM R00T: build merkle path for leaf 0 + claim proof ──
  const zeros = [ZERO_VALUE];
  for (let i = 1; i < 24; i++) zeros.push(poseidon2([zeros[i - 1], zeros[i - 1]]));
  // recompute the tree root locally (single leaf at index 0) and cross-check on-chain
  let node = commitment;
  for (let i = 0; i < 24; i++) node = poseidon2([node, zeros[i]]);
  const onchainRoot = await vault.pledgeRoot();
  if (node !== BigInt(onchainRoot)) throw new Error(`root mismatch: local ${node} vs on-chain ${onchainRoot}`);
  console.log('  merkle root matches on-chain ✓');

  const leafIndex = 0n;
  const nullifierHash = poseidon2([nullifier, leafIndex]);
  const recipientField = BigInt(claimWallet);
  const recipientBinding = poseidon3([parcelId, rootOut, recipientField]);
  console.log('generating claim proof…');
  const clm = await snarkjs.groth16.fullProve(
    {
      merkleRoot: node.toString(), nullifierHash: nullifierHash.toString(),
      parcelId: parcelId.toString(), amount: rootOut.toString(), recipient: recipientField.toString(),
      nullifier: nullifier.toString(), secret: secret.toString(),
      pathElements: zeros.map(z => z.toString()), pathIndices: Array(24).fill('0'),
    },
    `${CIRC_MAIN}/build/claim/claim_js/claim.wasm`,
    `${CIRC_MAIN}/build/claim_final.zkey`
  );
  const clmProof = packProof(clm.proof);
  // pubSignals = [recipientBinding, merkleRoot, nullifierHash, parcelId, amount, recipient]
  const pub = [recipientBinding, node, nullifierHash, parcelId, rootOut, recipientField];

  console.log('claiming R00T to the unlinked wallet…');
  const t2 = await vault.claimR00T(clmProof, pub, claimWallet);
  const r2 = await t2.wait();
  console.log('  ✅ claimed in block', r2.blockNumber, 'tx', r2.hash);

  const rootTok = new ethers.Contract(ROOT, ERC20_ABI, provider);
  const got = await rootTok.balanceOf(claimWallet);
  console.log('  recipient R00T balance:', ethers.formatUnits(got, 18), '(expected 100)');
  if (got !== rootOut) throw new Error('claim payout mismatch');
  console.log('\n🎉 LandVault fund→claim round-trip VALIDATED on-chain.');
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
