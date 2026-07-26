/**
 * StewardIdentity — shows the connected steward's ENS identity (name + avatar) with a graceful
 * fallback to a truncated address. ENS names + avatars are resolved from Ethereum mainnet (L1) via
 * wagmi's useEnsName/useEnsAvatar — the wallet never switches chains for this; it's a read-only lookup.
 */
import { useAccount, useEnsName, useEnsAvatar } from 'wagmi';
import { mainnet } from 'viem/chains';
import { normalize } from 'viem/ens';

const LIME = '#D6FE51';

/** Hook: the connected steward's ENS name/avatar (both may be undefined) + display helpers. */
export function useStewardEns() {
  const { address } = useAccount();
  const { data: ensName } = useEnsName({ address, chainId: mainnet.id });
  const { data: ensAvatar } = useEnsAvatar({
    name: ensName ? normalize(ensName) : undefined,
    chainId: mainnet.id,
  });
  const short = address ? `${address.slice(0, 6)}…${address.slice(-4)}` : '';
  return { address, ensName: ensName ?? null, ensAvatar: ensAvatar ?? null, short, label: ensName ?? short };
}

export function StewardIdentity({ compact = false }: { compact?: boolean }) {
  const { address, ensName, ensAvatar, short, label } = useStewardEns();
  if (!address) return null;

  const size = compact ? 20 : 28;
  return (
    <div className="inline-flex items-center gap-2">
      {ensAvatar ? (
        <img src={ensAvatar} alt={label} width={size} height={size}
          className="rounded-full object-cover border border-[#2a2a2a]" />
      ) : (
        <span className="grid place-items-center rounded-full font-mono text-[10px] text-black"
          style={{ width: size, height: size, background: LIME }}>
          {(ensName?.[0] || address[2]).toUpperCase()}
        </span>
      )}
      <span className="flex flex-col leading-tight text-left">
        <span className={`${compact ? 'text-xs' : 'text-sm'} font-medium`}
          style={{ color: ensName ? LIME : '#e6e6df' }}>{label}</span>
        {ensName && !compact && (
          <span className="text-[10px] font-mono text-[#777]">{short}</span>
        )}
      </span>
      {ensName && (
        <span className="text-[9px] font-mono tracking-widest uppercase px-1.5 py-0.5 rounded-full border"
          style={{ color: LIME, borderColor: `${LIME}44` }}>ENS</span>
      )}
    </div>
  );
}
