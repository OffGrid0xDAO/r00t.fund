import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { WagmiProvider, createConfig, http } from 'wagmi';
import { injected } from 'wagmi/connectors';
import { defineChain } from 'viem';
import { mainnet } from 'viem/chains';
import App from './App';
import { CHAIN, NETWORK, HACKATHON } from './config';
import './index.css';

// Ethereum Sepolia — the ETHGlobal hackathon stack (Steward Console, launchpad, parcel pools)
// lives here, so wagmi must know it too (reads + wallet switch for the demo).
const SEPOLIA = defineChain({
  id: HACKATHON.chainId,
  name: 'Ethereum Sepolia',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [HACKATHON.rpcUrl] } },
  blockExplorers: { default: { name: 'Etherscan', url: HACKATHON.explorerUrl } },
  testnet: true,
});

// Root error boundary — instead of a silent blank screen, show the actual error.
class RootBoundary extends React.Component<{ children: React.ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error, info: React.ErrorInfo) { console.error('[RootBoundary]', error, info); }
  render() {
    if (this.state.error) {
      return (
        <div style={{ minHeight: '100vh', background: '#0b0d0a', color: '#e6e6e0', padding: 32, fontFamily: 'monospace' }}>
          <h1 style={{ color: '#D6FE51', fontSize: 18, marginBottom: 12 }}>Something threw — here's the error</h1>
          <pre style={{ whiteSpace: 'pre-wrap', color: '#ff8a8a', fontSize: 13 }}>{this.state.error.message}</pre>
          <pre style={{ whiteSpace: 'pre-wrap', color: '#9a9a94', fontSize: 11, marginTop: 12 }}>{this.state.error.stack}</pre>
        </div>
      );
    }
    return this.props.children;
  }
}

// Wagmi config — Robinhood Chain (4663). CHAIN/NETWORK come from config.ts, so
// switchChain can add + switch the wallet to RH, and the RPC honors VITE_RPC_URL.
// Explicit Rabby connector (in addition to EIP-6963 auto-discovery) so "Rabby Wallet" is always
// offered in the picker. Rabby injects at window.rabby (and also announces itself via EIP-6963).
const rabby = injected({
  target() {
    const provider = typeof window !== 'undefined' ? (window as any).rabby : undefined;
    return { id: 'rabby', name: 'Rabby Wallet', provider };
  },
});

const config = createConfig({
  // mainnet is read-only here — it's ONLY for ENS resolution (names + avatars live on L1). wagmi's
  // useEnsName/useEnsAvatar automatically use it; the wallet never switches to it.
  chains: [CHAIN, SEPOLIA, mainnet],
  // EIP-6963 discovery (default true) surfaces every installed wallet — Rabby, MetaMask, … — as its
  // own connector; the explicit ones below guarantee Rabby + a generic browser-wallet fallback.
  multiInjectedProviderDiscovery: true,
  connectors: [rabby, injected()],
  transports: {
    [CHAIN.id]: http(NETWORK.rpcUrl),
    [SEPOLIA.id]: http(HACKATHON.rpcUrl),
    [mainnet.id]: http('https://eth.llamarpc.com'), // public L1 RPC for ENS reads
  },
});

const queryClient = new QueryClient();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <RootBoundary>
      <WagmiProvider config={config}>
        <QueryClientProvider client={queryClient}>
          <App />
        </QueryClientProvider>
      </WagmiProvider>
    </RootBoundary>
  </React.StrictMode>
);
