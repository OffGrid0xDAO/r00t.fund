import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { WagmiProvider, createConfig, http } from 'wagmi';
import { injected } from 'wagmi/connectors';
import App from './App';
import { CHAIN, NETWORK } from './config';
import './index.css';

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
const config = createConfig({
  chains: [CHAIN],
  connectors: [injected()],
  transports: {
    [CHAIN.id]: http(NETWORK.rpcUrl),
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
