import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { WagmiProvider, createConfig, http } from 'wagmi';
import { defineChain } from 'viem';
import { injected } from 'wagmi/connectors';
import App from './App';
import './index.css';

// Tenderly Virtual TestNet (forked from Sepolia)
const RPC_URL = 'https://virtual.sepolia.eu.rpc.tenderly.co/39fe020c-836e-4173-8786-5e726d0b3ba1';

const tenderlyVNet = defineChain({
  id: 73571,
  name: 'Tenderly VNet',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: {
    default: {
      http: [RPC_URL],
    },
  },
  testnet: true,
});

// Wagmi config — hardcoded to Tenderly VNet. Change when deploying to mainnet.
const config = createConfig({
  chains: [tenderlyVNet],
  connectors: [injected()],
  transports: {
    [tenderlyVNet.id]: http(RPC_URL),
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
