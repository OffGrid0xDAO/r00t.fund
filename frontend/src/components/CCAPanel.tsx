/**
 * CCAPanel — live Continuous Clearing Auctions from the RegenLaunchpad. Backers see each ongoing
 * raise (raised, floor, implied clearing price, time left) and BID R00T; anyone can clearAndLaunch
 * once the window ends, which seeds a REAL Uniswap v4 pool at the cleared price + wires the arb hook.
 * Uses test R00T (public mint) so the flow is demoable end-to-end on Sepolia.
 */
import { useState } from 'react';
import { useAccount, useChainId, useWalletClient, useSwitchChain, usePublicClient } from 'wagmi';
import { parseEther, stringToHex, padHex } from 'viem';
import { HACKATHON } from '../config';
import { useCCAAuctions, Auction } from '../hooks/useCCAAuctions';
import { TEST_TOKEN_ABI, TEST_TOKEN_BYTECODE } from '../lib/testToken';

const LIME = '#D6FE51', GREEN = '#7CFFB2', MUTE = '#888';
const erc20 = [
  { type: 'function', name: 'approve', stateMutability: 'nonpayable', inputs: [{ type: 'address' }, { type: 'uint256' }], outputs: [{ type: 'bool' }] },
  { type: 'function', name: 'mint', stateMutability: 'nonpayable', inputs: [{ type: 'address' }, { type: 'uint256' }], outputs: [] },
  { type: 'function', name: 'balanceOf', stateMutability: 'view', inputs: [{ type: 'address' }], outputs: [{ type: 'uint256' }] },
] as const;
const lpWrite = [
  { type: 'function', name: 'bid', stateMutability: 'nonpayable', inputs: [{ type: 'bytes32' }, { type: 'uint256' }], outputs: [] },
  { type: 'function', name: 'clearAndLaunch', stateMutability: 'nonpayable', inputs: [{ type: 'bytes32' }], outputs: [] },
  { type: 'function', name: 'claim', stateMutability: 'nonpayable', inputs: [{ type: 'bytes32' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'createParcel', stateMutability: 'nonpayable', inputs: [
    { type: 'bytes32' }, { type: 'address' }, { type: 'address' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'uint64' },
  ], outputs: [] },
] as const;

function fmtLeft(end: number): string {
  const s = end - Math.floor(Date.now() / 1000);
  if (s <= 0) return 'ended';
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}h ${m}m left` : `${m}m left`;
}

export function CCAPanel() {
  const { address } = useAccount();
  const chainId = useChainId();
  const { data: walletClient } = useWalletClient();
  const publicClient = usePublicClient();
  const { switchChainAsync } = useSwitchChain();
  const { auctions, loading, refetch } = useCCAAuctions(address);
  const [busy, setBusy] = useState<string>('');
  const [amt, setAmt] = useState<Record<string, string>>({});
  const onSepolia = chainId === HACKATHON.chainId;

  // "Start a raise" form
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ ticker: 'CACTUS', sale: '100000', pool: '100000', floor: '0.01', hours: '1' });
  const [steps, setSteps] = useState<string[]>([]);
  const step = (s: string) => setSteps((p) => [...p, s]);

  async function ensureChain() {
    if (!onSepolia) await switchChainAsync({ chainId: HACKATHON.chainId });
  }
  async function tx(hash: `0x${string}`) { await publicClient!.waitForTransactionReceipt({ hash }); }

  // Full create flow: deploy a parcel token → mint supply → approve → createParcel (opens the CCA).
  async function createRaise() {
    if (!walletClient || !address) return;
    setBusy('create'); setSteps([]);
    try {
      await ensureChain();
      const sale = parseEther(form.sale), pool = parseEther(form.pool);
      const supply = sale + pool + parseEther('10000'); // + slack

      step(`deploying $${form.ticker} token…`);
      const deployHash = await walletClient.deployContract({ abi: TEST_TOKEN_ABI as any, bytecode: TEST_TOKEN_BYTECODE, args: [`${form.ticker} Parcel`, form.ticker] });
      const rc = await publicClient!.waitForTransactionReceipt({ hash: deployHash });
      const token = rc.contractAddress as `0x${string}`;
      step(`token ${token.slice(0, 8)}… deployed`);

      step('minting parcel supply…');
      await tx(await walletClient.writeContract({ address: token, abi: TEST_TOKEN_ABI as any, functionName: 'mint', args: [address, supply] }));
      step('approving launchpad…');
      await tx(await walletClient.writeContract({ address: token, abi: TEST_TOKEN_ABI as any, functionName: 'approve', args: [HACKATHON.launchpad, supply] }));

      const parcelId = padHex(stringToHex(`${form.ticker}-RAISE`), { size: 32, dir: 'right' });
      const treasury = ('0x' + '00'.repeat(19) + '01') as `0x${string}`; // demo treasury sentinel
      step('opening the CCA (createParcel)…');
      await tx(await walletClient.writeContract({ address: HACKATHON.launchpad as `0x${string}`, abi: lpWrite, functionName: 'createParcel',
        args: [parcelId, token, treasury, sale, pool, parseEther(form.floor), BigInt(Math.round(Number(form.hours) * 3600))] }));
      step(`✓ $${form.ticker} raise is LIVE — bid below, then launch`);
      setShowCreate(false); refetch();
    } catch (e: any) { step('✗ ' + (e?.shortMessage || e?.message || 'failed').slice(0, 80)); }
    finally { setBusy(''); }
  }

  async function getTestR00T() {
    if (!walletClient || !address) return;
    setBusy('mint');
    try {
      await ensureChain();
      const h = await walletClient.writeContract({ address: HACKATHON.root as `0x${string}`, abi: erc20, functionName: 'mint', args: [address, parseEther('10000')] });
      await tx(h);
    } catch (e) { console.error(e); } finally { setBusy(''); }
  }

  async function bid(a: Auction) {
    if (!walletClient || !address) return;
    const v = amt[a.parcelId]; if (!v) return;
    setBusy(a.parcelId + ':bid');
    try {
      await ensureChain();
      const amount = parseEther(v);
      const ah = await walletClient.writeContract({ address: HACKATHON.root as `0x${string}`, abi: erc20, functionName: 'approve', args: [HACKATHON.launchpad as `0x${string}`, amount] });
      await tx(ah);
      const bh = await walletClient.writeContract({ address: HACKATHON.launchpad as `0x${string}`, abi: lpWrite, functionName: 'bid', args: [a.parcelId as `0x${string}`, amount] });
      await tx(bh);
      setAmt((p) => ({ ...p, [a.parcelId]: '' })); refetch();
    } catch (e) { console.error(e); } finally { setBusy(''); }
  }

  async function launch(a: Auction) {
    if (!walletClient) return;
    setBusy(a.parcelId + ':launch');
    try {
      await ensureChain();
      const h = await walletClient.writeContract({ address: HACKATHON.launchpad as `0x${string}`, abi: lpWrite, functionName: 'clearAndLaunch', args: [a.parcelId as `0x${string}`] });
      await tx(h); refetch();
    } catch (e) { console.error(e); } finally { setBusy(''); }
  }

  async function claim(a: Auction) {
    if (!walletClient) return;
    setBusy(a.parcelId + ':claim');
    try {
      await ensureChain();
      const h = await walletClient.writeContract({ address: HACKATHON.launchpad as `0x${string}`, abi: lpWrite, functionName: 'claim', args: [a.parcelId as `0x${string}`] });
      await tx(h); refetch();
    } catch (e) { console.error(e); } finally { setBusy(''); }
  }

  return (
    <div className="bg-[#0a0a0a] border border-[#333] rounded-xl p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="text-sm font-semibold text-[#ddd]">Continuous Clearing Auctions — fair-launch a parcel</div>
        <div className="flex items-center gap-2">
          {!onSepolia && address && <button onClick={ensureChain} className="text-[10px] px-2 py-1 rounded border border-[var(--warning)] text-[var(--warning)]">switch to Sepolia</button>}
          <button onClick={getTestR00T} disabled={!address || busy === 'mint'}
            className="text-[10px] px-2 py-1 rounded border border-[#444] text-[#aaa] hover:border-[#666] disabled:opacity-40">
            {busy === 'mint' ? 'minting…' : 'get test R00T'}
          </button>
          <button onClick={() => setShowCreate((v) => !v)} disabled={!address}
            className="text-[10px] px-2 py-1 rounded text-black font-medium disabled:opacity-40" style={{ background: LIME }}>
            + Start a raise
          </button>
        </div>
      </div>

      {/* CREATE a raise — deploy a parcel token + open the CCA, all from the browser */}
      {showCreate && (
        <div className="mb-4 rounded-lg border border-[#2a2a2a] bg-[#111] p-3">
          <div className="text-[11px] text-[#aaa] mb-2">Launch a parcel: deploy its token → open a Continuous Clearing Auction (floor ≥ R00T OTC).</div>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 mb-2">
            {([['ticker', 'ticker'], ['sale', 'sale supply'], ['pool', 'pool supply'], ['floor', 'floor R00T'], ['hours', 'window (h)']] as const).map(([k, label]) => (
              <label key={k} className="text-[10px] text-[#777]">{label}
                <input value={(form as any)[k]} onChange={(e) => setForm((f) => ({ ...f, [k]: e.target.value }))}
                  className="w-full mt-0.5 bg-[#0a0a0a] border border-[#333] rounded px-2 py-1 text-xs font-mono outline-none focus:border-[var(--accent)]" />
              </label>
            ))}
          </div>
          <button onClick={createRaise} disabled={busy === 'create'}
            className="w-full px-3 py-1.5 rounded text-sm font-medium text-black disabled:opacity-40" style={{ background: LIME }}>
            {busy === 'create' ? 'launching raise…' : `Deploy $${form.ticker} + open CCA`}
          </button>
          {steps.length > 0 && (
            <div className="mt-2 flex flex-col gap-0.5">
              {steps.map((s, i) => <div key={i} className="text-[10px] font-mono" style={{ color: s.startsWith('✓') ? GREEN : s.startsWith('✗') ? '#e05555' : '#888' }}>{s}</div>)}
            </div>
          )}
        </div>
      )}

      {loading && <div className="text-xs text-[#666] py-8 text-center">loading raises…</div>}
      {!loading && auctions.length === 0 && <div className="text-xs text-[#666] py-8 text-center">no raises yet</div>}

      <div className="flex flex-col gap-3">
        {auctions.map((a) => {
          const ended = a.auctionEnd <= Math.floor(Date.now() / 1000);
          const live = a.phase === 1 && !ended;
          const price = a.phase === 2 ? a.clearedPrice : Math.max(a.impliedPrice, a.reservePrice);
          return (
            <div key={a.parcelId} className="rounded-lg border border-[#2a2a2a] bg-[#111] p-3">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <span className="text-lg">🌱</span>
                  <div>
                    <div className="font-semibold">${a.ticker}</div>
                    <div className="text-[10px] text-[#888]">
                      {a.phase === 2 ? <span style={{ color: GREEN }}>● LAUNCHED</span>
                        : live ? <span style={{ color: LIME }}>● RAISING · {fmtLeft(a.auctionEnd)}</span>
                        : <span style={{ color: '#e0b055' }}>● ready to launch</span>}
                    </div>
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-sm font-mono" style={{ color: LIME }}>{price ? price.toFixed(4) : '…'}</div>
                  <div className="text-[9px] text-[#666]">R00T / {a.ticker} {a.phase === 2 ? 'cleared' : 'implied'}</div>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2 text-[11px] mb-2">
                <div><span className="text-[#666]">raised</span> <span className="font-mono text-[#ccc]">{a.raised.toLocaleString(undefined, { maximumFractionDigits: 0 })} R00T</span></div>
                <div><span className="text-[#666]">floor</span> <span className="font-mono text-[#ccc]">{a.reservePrice.toFixed(3)}</span></div>
                <div><span className="text-[#666]">your bid</span> <span className="font-mono" style={{ color: a.myBid > 0 ? GREEN : '#ccc' }}>{a.myBid.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span></div>
              </div>

              {live && (
                <div className="flex gap-2">
                  <input value={amt[a.parcelId] || ''} onChange={(e) => setAmt((p) => ({ ...p, [a.parcelId]: e.target.value }))}
                    placeholder="R00T to bid" inputMode="decimal"
                    className="flex-1 bg-[#0a0a0a] border border-[#333] rounded px-2 py-1.5 text-sm font-mono focus:border-[var(--accent)] outline-none" />
                  <button onClick={() => bid(a)} disabled={!address || busy.startsWith(a.parcelId)}
                    className="px-3 py-1.5 rounded text-sm font-medium text-black disabled:opacity-40" style={{ background: LIME }}>
                    {busy === a.parcelId + ':bid' ? '…' : 'Back it'}
                  </button>
                </div>
              )}
              {a.phase === 1 && ended && (
                <button onClick={() => launch(a)} disabled={busy.startsWith(a.parcelId)}
                  className="w-full px-3 py-1.5 rounded text-sm font-medium text-black" style={{ background: '#e0b055' }}>
                  {busy === a.parcelId + ':launch' ? 'launching…' : 'clearAndLaunch() → seed Uniswap v4 pool'}
                </button>
              )}
              {a.phase === 2 && (
                <div className="flex gap-2 items-center">
                  <a href={`${HACKATHON.explorerUrl}/address/${a.token}`} target="_blank" rel="noreferrer" className="text-[11px] underline text-[#8C9EFF]">${a.ticker} token ↗</a>
                  {a.myBid > 0 && <button onClick={() => claim(a)} disabled={busy.startsWith(a.parcelId)}
                    className="ml-auto text-[11px] px-2 py-1 rounded border border-[#444] text-[#aaa] hover:border-[#666]">
                    {busy === a.parcelId + ':claim' ? '…' : `claim ${a.ticker}`}</button>}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div className="mt-3 text-[10px]" style={{ color: MUTE }}>
        Uniform-price CCA (never below the R00T OTC floor). On launch it seeds a real Uniswap v4 pool at the
        cleared price + wires the RegenArbHook — the raise becomes a live, self-rebalancing v4 market.
      </div>
    </div>
  );
}
