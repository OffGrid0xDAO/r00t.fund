#!/usr/bin/env node
/**
 * Patch Railgun IPFS Gateway
 *
 * The Railgun SDK uses ipfs-lb.com which often returns HTML error pages.
 * This script patches it to use cloudflare-ipfs.com instead.
 */

const fs = require('fs');
const path = require('path');

const filePath = path.join(
  __dirname,
  '../node_modules/@railgun-community/wallet/dist/services/artifacts/artifact-util.js'
);

const oldGateway = "const IPFS_GATEWAY = 'https://ipfs-lb.com';";
const newGateway = "const IPFS_GATEWAY = 'https://cloudflare-ipfs.com';";

try {
  if (!fs.existsSync(filePath)) {
    console.log('[patch-railgun-gateway] File not found, skipping patch');
    process.exit(0);
  }

  let content = fs.readFileSync(filePath, 'utf8');

  if (content.includes(newGateway)) {
    console.log('[patch-railgun-gateway] Already patched');
    process.exit(0);
  }

  if (content.includes(oldGateway)) {
    content = content.replace(oldGateway, newGateway);
    fs.writeFileSync(filePath, content, 'utf8');
    console.log('[patch-railgun-gateway] Successfully patched IPFS gateway to cloudflare-ipfs.com');
  } else {
    console.log('[patch-railgun-gateway] Gateway string not found, file may have changed');
  }
} catch (err) {
  console.error('[patch-railgun-gateway] Error:', err.message);
  process.exit(1);
}
