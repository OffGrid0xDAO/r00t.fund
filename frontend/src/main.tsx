// IMPORTANT: Import IPFS patch FIRST to intercept all IPFS fetches
import './services/patchIpfs';

import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { WagmiProvider, createConfig, http } from 'wagmi';
import { webSocket, fallback, defineChain } from 'viem';
import { arbitrum, sepolia } from 'wagmi/chains';
import { injected } from 'wagmi/connectors';
import App from './App';
import './index.css';

// Tenderly Virtual TestNet (forked from Sepolia)
const tenderlyVNet = defineChain({
  id: 73571,
  name: 'Tenderly VNet',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: {
    default: {
      http: [import.meta.env.VITE_RPC_URL || 'https://virtual.sepolia.eu.rpc.tenderly.co/39fe020c-836e-4173-8786-5e726d0b3ba1'],
    },
  },
  testnet: true,
});

// Determine which network we're on
const chainId = Number(import.meta.env.VITE_CHAIN_ID) || 73571;
const isSepoliaTestnet = chainId === 11155111;
const isTenderlyVNet = chainId === 73571;

// RPC URLs based on network — set VITE_RPC_URL in .env
const RPC_URL = import.meta.env.VITE_RPC_URL || (isTenderlyVNet
  ? 'https://virtual.sepolia.eu.rpc.tenderly.co/39fe020c-836e-4173-8786-5e726d0b3ba1'
  : isSepoliaTestnet
    ? 'https://eth-sepolia.g.alchemy.com/v2/demo'
    : 'https://arb1.arbitrum.io/rpc');

// WebSocket URL for instant event subscriptions (eth_subscribe)
// Converts https:// to wss:// for Alchemy WebSocket endpoint
const WS_URL = RPC_URL.replace('https://', 'wss://');

// Wagmi config - supports Arbitrum, Sepolia, and Tenderly VNet
// Uses fallback transport: WebSocket for instant event subscriptions, HTTP for regular RPC calls
const config = isTenderlyVNet
  ? createConfig({
      chains: [tenderlyVNet],
      connectors: [injected()],
      transports: {
        [tenderlyVNet.id]: http(RPC_URL),
      },
    })
  : isSepoliaTestnet
    ? createConfig({
        chains: [sepolia],
        connectors: [injected()],
        transports: {
          [sepolia.id]: fallback([
            webSocket(WS_URL),
            http(RPC_URL),
          ]),
        },
      })
    : createConfig({
        chains: [arbitrum],
        connectors: [injected()],
        transports: {
          [arbitrum.id]: fallback([
            webSocket(WS_URL),
            http(RPC_URL),
          ]),
        },
      });

const queryClient = new QueryClient();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </WagmiProvider>
  </React.StrictMode>
);
