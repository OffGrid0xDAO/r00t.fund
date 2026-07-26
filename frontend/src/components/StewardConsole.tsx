/**
 * StewardConsole — the steward's control room + entry point. A 3-step funnel (Create land → Launch
 * parcels → Trade & regenerate) with LIVE status, the primary "Create your land" CTA, the live CCA
 * raises, and the double-pool / rebalancing chart. Dark OLED + lime accent, SVG icons, smooth motion.
 */
import { useMemo } from 'react';
import { motion } from 'framer-motion';
import { useAccount } from 'wagmi';
import { HACKATHON } from '../config';
import { CCAPanel } from './CCAPanel';
import { TopoBackdrop } from './pilot/TopoBackdrop';
import { useCCAAuctions } from '../hooks/useCCAAuctions';

const LIME = '#D6FE51';
const GREEN = '#7CFFB2';
const glow = { textShadow: `0 0 12px ${LIME}66` };

// ── inline SVG icons (Lucide-style, 24×24) — no emoji ──
const Icon = {
  map: (p: any) => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M9 20 3 17V4l6 3m0 13 6-3m-6 3V7m6 10 6 3V7l-6-3m0 13V4" /></svg>),
  layers: (p: any) => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" {...p}><path d="m12 2 9 5-9 5-9-5 9-5Z" /><path d="m3 12 9 5 9-5" /><path d="m3 17 9 5 9-5" /></svg>),
  trend: (p: any) => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M22 7 13.5 15.5 8.5 10.5 2 17" /><path d="M16 7h6v6" /></svg>),
  check: (p: any) => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M20 6 9 17l-5-5" /></svg>),
  plus: (p: any) => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M5 12h14M12 5v14" /></svg>),
  arrow: (p: any) => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M5 12h14M13 6l6 6-6 6" /></svg>),
  sprout: (p: any) => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M7 20h10M12 20v-9M12 11a5 5 0 0 0-5-5H5v1a5 5 0 0 0 5 5h2M12 11a5 5 0 0 1 5-5h2v1a5 5 0 0 1-5 5h-2" /></svg>),
};

interface StewardConsoleProps {
  landName?: string | null;
  landAddress?: string | null;
  onOpenLand?: () => void;
  onStartLand?: () => void;
}

export function StewardConsole({ landName, landAddress, onOpenLand, onStartLand }: StewardConsoleProps = {}) {
  const { address } = useAccount();
  const { auctions } = useCCAAuctions(address);

  const hasLand = !!landName || !!landAddress;
  const liveCount = auctions.filter((a) => a.phase === 2).length;
  const raisingCount = auctions.filter((a) => a.phase === 1).length;

  // funnel state: 0 create land · 1 launch parcels · 2 trade
  const stage = liveCount > 0 ? 2 : (hasLand || raisingCount > 0) ? 1 : 0;

  const steps = useMemo(() => ([
    { n: 1, icon: Icon.map, title: 'Create your land', desc: 'Upload your boundary + topography, commit $R00T. Your terrain renders on the map.', done: stage > 0, active: stage === 0 },
    { n: 2, icon: Icon.layers, title: 'Launch parcels', desc: 'Name each parcel and open a Continuous Clearing Auction — it seeds a private zkAMM + public Uniswap v4 pool.', done: stage > 1, active: stage === 1 },
    { n: 3, icon: Icon.trend, title: 'Trade & regenerate', desc: 'Every swap back-runs a cross-pool arb; the captured spread funds the land’s regen treasury.', done: false, active: stage === 2 },
  ]), [stage]);

  return (
    <div className="max-w-4xl mx-auto w-full px-4 py-6">
      {/* ── HERO ── */}
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}
        className="relative overflow-hidden rounded-2xl border border-[#222] p-6 md:p-8 mb-6"
        style={{ background: 'radial-gradient(120% 140% at 100% 0%, rgba(214,254,81,0.10) 0%, transparent 55%), #0a0b09' }}>
        <TopoBackdrop color={LIME} />
        <div className="relative z-10 flex items-start justify-between gap-4 flex-wrap">
          <div className="max-w-xl">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-[10px] font-mono tracking-[0.22em] uppercase text-[#7a7a72]">// Steward Console</span>
              <span className="inline-flex items-center gap-1.5 text-[10px] px-2 py-0.5 rounded-full border" style={{ color: LIME, borderColor: `${LIME}55` }}>
                <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: LIME }} />LIVE · Sepolia
              </span>
            </div>
            {hasLand ? (
              <>
                <h1 className="text-2xl md:text-[28px] font-semibold leading-tight text-[#f3f3ec]">
                  {landName ? <>Steward <span style={{ color: LIME, ...glow }}>{landName}</span>.</> : <>Your land is <span style={{ color: LIME, ...glow }}>live</span>.</>}
                </h1>
                <p className="text-sm text-[#9a9a90] mt-2 leading-relaxed">
                  Open your map to launch each parcel token — a private zkAMM + a public Uniswap v4 pool, wired to one
                  arb hook that turns every trade into regeneration. Track your raises below.
                </p>
              </>
            ) : (
              <>
                <h1 className="text-2xl md:text-[28px] font-semibold leading-tight text-[#f3f3ec]">
                  Fair-launch your land’s <span style={{ color: LIME, ...glow }}>parcel tokens</span>.
                </h1>
                <p className="text-sm text-[#9a9a90] mt-2 leading-relaxed">
                  Set up your land, name your parcels, and open them — each becomes a token on a private zkAMM + a
                  public Uniswap v4 pool, wired to one arb hook that turns every trade into regeneration.
                </p>
              </>
            )}
          </div>
          <button onClick={hasLand ? onOpenLand : onStartLand}
            className="group inline-flex items-center gap-2 px-5 py-3 rounded-xl text-black font-semibold text-sm shrink-0 cursor-pointer transition-transform duration-200 hover:-translate-y-0.5"
            style={{ background: LIME, boxShadow: `0 0 30px ${LIME}40` }}>
            {hasLand ? <><Icon.map className="w-4 h-4" /> Launch a parcel</> : <><Icon.plus className="w-4 h-4" /> Create your land</>}
          </button>
        </div>

        {/* your land pill */}
        {hasLand && (
          <button onClick={onOpenLand}
            className="relative z-10 mt-5 inline-flex items-center gap-2.5 rounded-xl border border-[#2a2a2a] bg-black/40 pl-3 pr-4 py-2 hover:border-[#444] transition-colors cursor-pointer text-left">
            <Icon.map className="w-4 h-4" style={{ color: LIME }} />
            <div>
              <div className="text-xs text-[#ddd] leading-tight">Stewarding{landName ? ` ${landName}` : ' your land'}</div>
              <div className="text-[10px] text-[#777] font-mono">{landAddress ? `${landAddress.slice(0, 8)}…${landAddress.slice(-6)}` : 'connected steward'}</div>
            </div>
            <Icon.arrow className="w-3.5 h-3.5 text-[#666] group-hover:text-white" />
          </button>
        )}
      </motion.div>

      {/* ── FUNNEL: 3 steps ── */}
      <div className="grid sm:grid-cols-3 gap-3 mb-6">
        {steps.map((s, i) => (
          <motion.div key={s.n} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, delay: 0.05 * i }}
            className="relative rounded-xl border p-4 transition-colors"
            style={{ borderColor: s.active ? `${LIME}55` : '#222', background: s.active ? 'rgba(214,254,81,0.05)' : '#0a0b09' }}>
            <div className="flex items-center gap-2 mb-2">
              <span className="grid place-items-center w-8 h-8 rounded-lg"
                style={{ background: s.done ? `${GREEN}18` : s.active ? `${LIME}18` : '#151515', color: s.done ? GREEN : s.active ? LIME : '#666' }}>
                {s.done ? <Icon.check className="w-4 h-4" /> : <s.icon className="w-4 h-4" />}
              </span>
              <span className="text-[10px] font-mono tracking-widest uppercase" style={{ color: s.done ? GREEN : s.active ? LIME : '#666' }}>
                {s.done ? 'done' : s.active ? 'now' : `step ${s.n}`}
              </span>
            </div>
            <div className="text-sm font-medium text-[#e6e6df]">{s.title}</div>
            <div className="text-[11px] text-[#8a8a80] mt-1 leading-relaxed">{s.desc}</div>
          </motion.div>
        ))}
      </div>

      {/* ── LIVE RAISES ── */}
      <SectionHeader icon={<Icon.sprout className="w-4 h-4" />} title="Your raises" sub={`${raisingCount} raising · ${liveCount} live`} />
      {/* no land yet → "Launch a parcel" starts the land wizard; with a land → jump to the map to click a plot */}
      <div className="mb-6"><CCAPanel onOpenMap={hasLand ? onOpenLand : onStartLand} /></div>

      {/* Markets / rebalancing viz moved off the console (lives with the swap chart). Re-enable here if
          a compact steward-facing rebalancing card is wanted:
          <SectionHeader icon={<Icon.trend className="w-4 h-4" />} title="Markets — live trades & rebalancing" sub="public v4 ⇄ private zkAMM" />
          <div className="mb-6"><MarketsChart /></div> */}

      {/* contracts */}
      <div className="flex items-center gap-4 text-[11px] text-[#666]">
        <a className="hover:text-[#aaa] transition-colors" href={`${HACKATHON.explorerUrl}/address/${HACKATHON.launchpad}`} target="_blank" rel="noreferrer">launchpad ↗</a>
        <a className="hover:text-[#aaa] transition-colors" href={`${HACKATHON.explorerUrl}/address/${HACKATHON.hook}`} target="_blank" rel="noreferrer">shared arb hook ↗</a>
      </div>
    </div>
  );
}

function SectionHeader({ icon, title, sub }: { icon: React.ReactNode; title: string; sub?: string }) {
  return (
    <div className="flex items-center gap-2.5 mb-3">
      <span className="text-[#666]">{icon}</span>
      <span className="text-sm font-medium text-[#e6e6df]">{title}</span>
      {sub && <span className="text-[11px] text-[#666] font-mono">· {sub}</span>}
    </div>
  );
}
