/**
 * Robust switch to Robinhood Chain (4663).
 *
 * wagmi's switchChain frequently fails silently when the wallet doesn't have RH added
 * yet (MetaMask returns 4902 and wagmi's auto-add is flaky across wallet versions). This
 * helper tries the normal switch first, then falls back to an explicit
 * wallet_addEthereumChain that prompts the user to ADD the chain.
 *
 * The add-params use the PUBLIC RH RPC on purpose — wallets ping the RPC to validate the
 * chain, and a domain-locked Alchemy endpoint would be rejected from the wallet's origin.
 */
import { NETWORK } from '../config';

type SwitchChainAsync = (args: { chainId: number }) => Promise<unknown>;

export async function switchToRobinhood(switchChainAsync: SwitchChainAsync): Promise<void> {
  const target = NETWORK.chainId;
  try {
    await switchChainAsync({ chainId: target });
    return;
  } catch (switchErr) {
    const eth = (window as unknown as { ethereum?: { request: (a: unknown) => Promise<unknown> } }).ethereum;
    if (!eth) {
      console.error('[chain-switch] no injected provider', switchErr);
      return;
    }
    try {
      await eth.request({
        method: 'wallet_addEthereumChain',
        params: [{
          chainId: '0x' + target.toString(16),
          chainName: 'Robinhood Chain',
          nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
          rpcUrls: ['https://rpc.mainnet.chain.robinhood.com'],
          blockExplorerUrls: ['https://robinhoodchain.blockscout.com'],
        }],
      });
    } catch (addErr) {
      console.error('[chain-switch] add failed', addErr);
    }
  }
}
