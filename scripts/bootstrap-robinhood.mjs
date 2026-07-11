#!/usr/bin/env node
/**
 * Bootstrap the $R00T private DEX on Robinhood Chain (chainId 4663).
 *  1) transfer some $R00T into the pair (backs the bonding-curve reserve)
 *  2) router.bootstrapLiquidity{value: ETH}  — sets the opening price + owner LP position
 *
 * The owner LP commitment preimage (nullifier/secret/shares) is saved to
 * scripts/.bootstrap-lp.json so the position can be recovered/removed later.
 *
 * Env: ROBINHOOD_RPC_URL (or PRIVATE RPC), PRIVATE_KEY (must be admin.owner()).
 * Optional: BOOTSTRAP_ETH (default 0.01), SEED_R00T (default 10000000).
 */
import { ethers } from 'ethers';
import { poseidon3 } from 'poseidon-lite';
import { writeFileSync } from 'node:fs';

const ROOT   = '0x7d0bfc2145327CF98f882De2CB71f8F1D7b8f022';
const PAIR   = '0xbd34EF73b3Cb1b8Bb0fFba47a42AFdbA90Ccf511';
const ROUTER = '0x2EaFE93d9ecf8B8E2Dd0C5f0B5c86a374206C6B0';

const FIELD = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
const rand = () => { const b = new Uint8Array(32); crypto.getRandomValues(b); let v = 0n; for (const x of b) v = (v << 8n) | BigInt(x); return v % FIELD; };

const ROOT_ABI = ['function transfer(address,uint256) returns (bool)', 'function balanceOf(address) view returns (uint256)'];
const ROUTER_ABI = ['function bootstrapLiquidity(uint256 lpCommitment, uint256 minLPShares, uint256 deadline, bytes lpNote) payable'];
const PAIR_ABI = ['function bootstrapped() view returns (bool)', 'function ethReserve() view returns (uint256)', 'function tokenReserve() view returns (uint256)'];

async function main() {
  const rpc = process.env.ROBINHOOD_RPC_URL || 'https://rpc.mainnet.chain.robinhood.com';
  const pk = process.env.PRIVATE_KEY;
  if (!pk) throw new Error('PRIVATE_KEY required');
  const ethAmt = ethers.parseEther(process.env.BOOTSTRAP_ETH || '0.01');
  const seedR00t = ethers.parseUnits(process.env.SEED_R00T || '10000000', 18);

  const provider = new ethers.JsonRpcProvider(rpc);
  const wallet = new ethers.Wallet(pk, provider);
  const root = new ethers.Contract(ROOT, ROOT_ABI, wallet);
  const router = new ethers.Contract(ROUTER, ROUTER_ABI, wallet);
  const pair = new ethers.Contract(PAIR, PAIR_ABI, provider);

  console.log('deployer:', wallet.address);
  if (await pair.bootstrapped()) throw new Error('pair already bootstrapped');

  // 1) seed R00T backing
  console.log(`transferring ${ethers.formatUnits(seedR00t, 18)} R00T -> pair ...`);
  await (await root.transfer(PAIR, seedR00t)).wait();
  console.log('  pair R00T balance:', ethers.formatUnits(await root.balanceOf(PAIR), 18));

  // 2) bootstrap: shares == ETH deposited; 10% burned, 90% owner
  const burned = ethAmt / 10n;
  const ownerShares = ethAmt - burned;
  const nullifier = rand(), secret = rand();
  const lpCommitment = poseidon3([nullifier, secret, ownerShares]);

  const preimage = { nullifier: nullifier.toString(), secret: secret.toString(), ownerShares: ownerShares.toString(), lpCommitment: lpCommitment.toString(), pair: PAIR, router: ROUTER };
  writeFileSync(new URL('./.bootstrap-lp.json', import.meta.url), JSON.stringify(preimage, null, 2));
  console.log('saved LP preimage -> scripts/.bootstrap-lp.json (KEEP THIS — needed to remove liquidity)');

  const deadline = Math.floor(Date.now() / 1000) + 3600;
  console.log(`bootstrapping with ${ethers.formatEther(ethAmt)} ETH (opening price = ETH/tokenReserve) ...`);
  const tx = await router.bootstrapLiquidity(lpCommitment, 0, deadline, '0x', { value: ethAmt });
  const rc = await tx.wait();
  console.log('  bootstrapped in block', rc.blockNumber, 'tx', rc.hash);
  console.log('  ethReserve:', ethers.formatEther(await pair.ethReserve()), ' tokenReserve:', ethers.formatUnits(await pair.tokenReserve(), 18));
  const price = Number(ethAmt) / Number(await pair.tokenReserve());
  console.log('  opening R00T price ~', price, 'ETH each');
}
main().catch((e) => { console.error(e); process.exit(1); });
