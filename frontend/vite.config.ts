import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { nodePolyfills } from 'vite-plugin-node-polyfills';

export default defineConfig({
  plugins: [
    react(),
    // Polyfill Node.js modules for Railgun SDK browser compatibility
    nodePolyfills({
      include: ['crypto', 'stream', 'buffer', 'util', 'process', 'events', 'path', 'os', 'assert', 'http', 'https', 'url', 'zlib', 'string_decoder'],
      globals: {
        Buffer: true,
        global: true,
        process: true,
      },
    }),
  ],
  define: {
    // Required for snarkjs and Railgun SDK in browser
    'process.env': {},
    'process.browser': true, // Fix for readable-stream browser check
    global: 'globalThis',
  },
  server: {
    // Headers for WASM and SharedArrayBuffer support
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
    // Allow serving files from node_modules (for WASM files)
    fs: {
      allow: ['..'],
    },
    proxy: {
      // Proxy IPFS requests to avoid CORS issues with Railgun artifact downloads
      '/ipfs': {
        target: 'https://cloudflare-ipfs.com',
        changeOrigin: true,
        secure: true,
      },
    },
  },
  optimizeDeps: {
    esbuildOptions: {
      target: 'esnext',
      define: {
        global: 'globalThis',
        'process.browser': 'true', // Fix for readable-stream browser check
      },
    },
    // CRITICAL: Exclude WASM packages from optimization
    // This forces Vite to serve them as-is instead of transforming
    exclude: [
      '@railgun-community/poseidon-hash-wasm',
      '@railgun-community/curve25519-scalarmult-wasm',
      'wasmcurves',
    ],
    // Include Railgun SDK and dependencies in pre-bundling to convert CJS to ESM
    include: [
      'ethers',
      'localforage',
      'level-js',
      '@railgun-community/shared-models',
      '@railgun-community/wallet',
    ],
  },
  build: {
    target: 'esnext',
    commonjsOptions: {
      // Transform CommonJS to ESM for Railgun SDK
      transformMixedEsModules: true,
    },
    // Code splitting for optimized loading
    rollupOptions: {
      output: {
        manualChunks: {
          // React core - small, loads first
          'vendor-react': ['react', 'react-dom'],
          // Web3 stack - moderate size
          'vendor-web3': ['wagmi', 'viem'],
          // Ethers - large but commonly used
          'vendor-ethers': ['ethers'],
          // Animation library - only needed for UI
          'vendor-animation': ['framer-motion'],
          // Note: Railgun SDK removed from manual chunks due to CJS/ESM compatibility
          // issues in production builds. It will be bundled with main code instead.
        },
      },
    },
  },
  // CRITICAL: Ensure .wasm files are treated as assets
  assetsInclude: ['**/*.wasm'],
});
