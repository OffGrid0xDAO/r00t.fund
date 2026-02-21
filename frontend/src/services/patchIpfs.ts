/**
 * IPFS Gateway Patch
 *
 * Patches the global fetch to use alternative IPFS gateways since ipfs-lb.com
 * often returns HTML error pages in browsers.
 *
 * This must be imported BEFORE any Railgun SDK code.
 */

const IPFS_GATEWAYS = [
  'https://cloudflare-ipfs.com',
  'https://dweb.link',
  'https://gateway.pinata.cloud',
  'https://ipfs.io',
];

// Store original fetch
const originalFetch = globalThis.fetch;

// Patched fetch that rewrites IPFS URLs
const patchedFetch: typeof fetch = async (input, init) => {
  let url = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url;

  // Check if this is an IPFS request to the problematic gateway
  if (url.includes('ipfs-lb.com/ipfs/') || url.includes('ipfs-lb.com:5001')) {
    const ipfsPath = url.split('/ipfs/')[1];
    if (ipfsPath) {
      // Try each gateway in order
      for (let i = 0; i < IPFS_GATEWAYS.length; i++) {
        const gateway = IPFS_GATEWAYS[i];
        const newUrl = `${gateway}/ipfs/${ipfsPath}`;
        console.log(`[IPFS] Trying gateway ${i + 1}/${IPFS_GATEWAYS.length}: ${newUrl}`);

        try {
          const response = await originalFetch(newUrl, init);

          // Check if we got HTML (error page) instead of binary data
          const contentType = response.headers.get('content-type');
          if (contentType?.includes('text/html')) {
            console.warn(`[IPFS] Gateway ${gateway} returned HTML, trying next...`);
            continue;
          }

          // Clone response to check first bytes
          const cloned = response.clone();
          const buffer = await cloned.arrayBuffer();
          const firstBytes = new Uint8Array(buffer.slice(0, 4));

          // Check for HTML: '<' '!' (0x3c 0x21)
          if (firstBytes[0] === 0x3c && firstBytes[1] === 0x21) {
            console.warn(`[IPFS] Gateway ${gateway} returned HTML content, trying next...`);
            continue;
          }

          console.log(`[IPFS] Successfully fetched from ${gateway}`);
          // Return a new response with the buffer since we already consumed the clone
          return new Response(buffer, {
            status: response.status,
            statusText: response.statusText,
            headers: response.headers,
          });
        } catch (err) {
          console.warn(`[IPFS] Gateway ${gateway} failed:`, err);
          continue;
        }
      }

      // All gateways failed, fall back to original request
      console.error('[IPFS] All gateways failed, falling back to original');
    }
  }

  // For non-IPFS requests or if IPFS path extraction failed, use original
  return originalFetch(input, init);
};

// Replace global fetch
globalThis.fetch = patchedFetch;

console.log('[IPFS] Fetch patch installed - will redirect ipfs-lb.com to alternative gateways');

export {};
