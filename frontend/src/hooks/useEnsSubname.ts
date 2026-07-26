/**
 * useEnsSubname — issue an ENS subname per parcel: <ticker>.<parent> (e.g. hay.r00tfund.eth), minted on
 * Sepolia via the ENS Name Wrapper's setSubnodeRecord, owned by the steward and pointed at a resolver.
 * Best-effort: if ENS isn't configured or the caller doesn't own the parent, it skips cleanly (the UI
 * still shows the intended name). This is a real ENS *write* — each land token gets a human name.
 */
import { useCallback } from 'react';
import { useWalletClient, usePublicClient, useSwitchChain, useChainId } from 'wagmi';
import { namehash } from 'viem/ens';
import { ENS_CFG } from '../config';

const wrapperAbi = [
  { type: 'function', name: 'setSubnodeRecord', stateMutability: 'nonpayable', inputs: [
    { name: 'parentNode', type: 'bytes32' }, { name: 'label', type: 'string' }, { name: 'owner', type: 'address' },
    { name: 'resolver', type: 'address' }, { name: 'ttl', type: 'uint64' }, { name: 'fuses', type: 'uint32' }, { name: 'expiry', type: 'uint64' },
  ], outputs: [{ type: 'bytes32' }] },
] as const;

export function useEnsSubname() {
  const { data: walletClient } = useWalletClient();
  const publicClient = usePublicClient({ chainId: ENS_CFG.chainId });
  const { switchChainAsync } = useSwitchChain();
  const chainId = useChainId();

  const configured = !!ENS_CFG.nameWrapper && !!ENS_CFG.parentName;
  const nameFor = (label: string) => `${label.toLowerCase()}.${ENS_CFG.parentName}`;

  /** Mint <label>.<parent> → owner. Returns the full name on success, null if it wasn't written. */
  const issueSubname = useCallback(async (label: string, owner: string): Promise<string | null> => {
    if (!configured || !walletClient || !label) return null;
    try {
      if (chainId !== ENS_CFG.chainId) await switchChainAsync({ chainId: ENS_CFG.chainId });
      const parentNode = namehash(ENS_CFG.parentName);
      const hash = await walletClient.writeContract({
        address: ENS_CFG.nameWrapper as `0x${string}`, abi: wrapperAbi, functionName: 'setSubnodeRecord',
        args: [parentNode, label.toLowerCase(), owner as `0x${string}`, ENS_CFG.resolver as `0x${string}`, 0n, 0, 0n],
      });
      await publicClient?.waitForTransactionReceipt({ hash });
      return nameFor(label);
    } catch {
      return null; // caller doesn't own the parent / ENS not set up → skip, the UI still shows the name
    }
  }, [configured, walletClient, publicClient, chainId, switchChainAsync]);

  return { issueSubname, nameFor, configured };
}
