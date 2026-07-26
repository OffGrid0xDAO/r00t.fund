/**
 * WorldIdGate — proof-of-humanity gate for the create-land flow. Real people steward real land, so
 * before a steward launches, they verify a unique human with World ID (orb / device). Uses the
 * official IDKitWidget (QR + World App) with the project's app_id + action. On success it reports the
 * ZK proof up to the wizard, which can also relay it to the on-chain StewardGatekeeper. Zero-knowledge:
 * nobody learns the steward's real identity.
 */
import { useState } from 'react';
import { motion } from 'framer-motion';
import { IDKitWidget, VerificationLevel, type ISuccessResult } from '@worldcoin/idkit';
import { WORLD_ID_APP_ID, WORLD_ID_ACTION } from '../projects/constants';

const LIME = '#D6FE51';
const WORLD_BLUE = '#4940E0';

/** The Worldcoin "orb" mark. */
function WorldMark({ size = 22, color = 'currentColor' }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="28 28 73 73" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M98.5041 64.5063C98.5041 77.3777 91.4026 88.5857 80.9069 94.4079C76.023 97.1212 70.4044 98.662 64.4254 98.662C58.4463 98.662 52.8277 97.1144 47.9438 94.4079C37.4413 88.5925 30.3398 77.3777 30.3398 64.5063C30.3398 45.6422 45.5902 30.3438 64.4254 30.3438C83.2605 30.3438 98.5109 45.6354 98.5109 64.5063H98.5041Z" stroke={color} strokeMiterlimit="10" strokeWidth="2"/>
      <path d="M80.9065 51.7681V94.4116C76.0226 97.125 70.404 98.6658 64.4249 98.6658C58.4459 98.6658 52.8273 97.1182 47.9434 94.4116V51.7681C47.9434 49.0888 50.1132 46.9141 52.7865 46.9141H76.0634C78.7366 46.9141 80.9065 49.0888 80.9065 51.7681Z" stroke={color} strokeMiterlimit="10" strokeWidth="2"/>
      <path d="M64.4181 71.7635C68.419 71.7635 71.6624 68.5128 71.6624 64.5028C71.6624 60.4929 68.419 57.2422 64.4181 57.2422C60.4172 57.2422 57.1738 60.4929 57.1738 64.5028C57.1738 68.5128 60.4172 71.7635 64.4181 71.7635Z" stroke={color} strokeMiterlimit="10" strokeWidth="2"/>
    </svg>
  );
}

interface WorldIdGateProps {
  verified: boolean;
  signal?: string; // bind the proof to the steward wallet
  onVerified: (result: ISuccessResult) => void;
}

export function WorldIdGate({ verified, signal, onVerified }: WorldIdGateProps) {
  const [error, setError] = useState<string | null>(null);

  if (verified) {
    return (
      <motion.div initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }}
        className="flex items-center gap-3 rounded-xl border p-3.5"
        style={{ borderColor: `${LIME}44`, background: `${LIME}0d` }}>
        {/* pulsing verified orb */}
        <div className="relative w-10 h-10 shrink-0">
          <motion.span className="absolute inset-0 rounded-full" style={{ border: `1.5px solid ${LIME}` }}
            animate={{ scale: [1, 1.35, 1.35], opacity: [0.5, 0, 0] }} transition={{ duration: 2, repeat: Infinity }} />
          <span className="absolute inset-1.5 rounded-full grid place-items-center" style={{ background: LIME }}>
            <WorldMark size={18} color="#0a0b09" />
          </span>
        </div>
        <div>
          <div className="text-sm font-medium" style={{ color: LIME }}>Verified human · World ID</div>
          <div className="text-[10px] font-mono text-[#8a8a80]">zero-knowledge proof — a unique person stewards this land</div>
        </div>
      </motion.div>
    );
  }

  return (
    <div className="rounded-xl border border-[#242424] p-4" style={{ background: '#0a0b09' }}>
      <div className="flex items-start gap-3">
        <span className="grid place-items-center w-10 h-10 rounded-lg shrink-0"
          style={{ background: `${WORLD_BLUE}22`, color: '#fff' }}>
          <WorldMark size={22} />
        </span>
        <div className="flex-1">
          <div className="text-sm font-medium text-[#e6e6df]">Verify you're a real human</div>
          <p className="text-[11px] text-[#8a8a80] mt-0.5 leading-relaxed">
            Land is stewarded by people, not bots. Prove a unique human with World ID — scan the QR with
            your World App. Nothing about your identity is revealed.
          </p>
        </div>
      </div>

      {error && <div className="mt-2 text-[11px] text-[#ff8a8a]">{error}</div>}

      <IDKitWidget
        app_id={WORLD_ID_APP_ID as `app_${string}`}
        action={WORLD_ID_ACTION}
        signal={signal || ''}
        verification_level={VerificationLevel.Device}
        handleVerify={(r: ISuccessResult) => { setError(null); onVerified(r); }}
        onSuccess={() => {}}
      >
        {({ open }: { open: () => void }) => (
          <button onClick={open}
            className="mt-3 w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl font-semibold text-sm text-white cursor-pointer transition-transform duration-200 hover:-translate-y-0.5"
            style={{ background: WORLD_BLUE, boxShadow: `0 0 24px ${WORLD_BLUE}55` }}>
            <WorldMark size={18} /> Verify with World ID
          </button>
        )}
      </IDKitWidget>

      <div className="mt-2 flex items-center justify-center gap-1.5">
        <span className="w-1.5 h-1.5 rounded-full" style={{ background: WORLD_BLUE }} />
        <span className="text-[10px] font-mono text-[#666]">powered by World ID · orb / device</span>
      </div>
    </div>
  );
}
