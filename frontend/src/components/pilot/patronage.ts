/**
 * Patronage funding interface + verification adapter for Pilot Project.
 *
 * Two integration points live behind interfaces so the UI never talks to a chain
 * directly:
 *
 *   1. PatronageBackend (Workstream F) — a fund() call. Mock/local now; the real
 *      implementation calls the patronage/funding contract. PATRONAGE ONLY:
 *      fund() records a contribution and returns a receipt. It NEVER mints a
 *      revenue/profit/resale claim — backers receive produce, stays, naming,
 *      choose-what-grows, and a certificate badge, nothing financial.
 *
 *   2. AttestationAdapter (Workstream G) — per-plot verified status read from a
 *      bridged CCIP attestation. Mock now; the real adapter reads the attestation
 *      that CCIP relays from the CRE-capable chain. CRE/ZK verification stays on
 *      the CRE chain and is NOT ported to the consumer chain.
 */
import type { PatronageReward } from './types';

export interface FundReceipt {
  ok: boolean;
  target: string;          // plot or machine id
  amountEur: number;
  backer: string;
  at: number;
  // patronage entitlement granted by this contribution — never a financial claim
  rewards: PatronageReward[];
  ref: string;             // mock tx/receipt ref
}

export interface PatronageBackend {
  fund(targetId: string, amountEur: number, backer: string, rewards: PatronageReward[]): Promise<FundReceipt>;
}

/** Local, no-chain implementation used for the demo/dev flow. */
export const mockPatronageBackend: PatronageBackend = {
  async fund(targetId, amountEur, backer, rewards) {
    // simulate a short settlement delay
    await new Promise((r) => setTimeout(r, 450));
    return {
      ok: true,
      target: targetId,
      amountEur,
      backer,
      at: Date.now(),
      rewards,
      ref: 'mock:' + Math.random().toString(16).slice(2, 10),
    };
  },
};

/*
 * REAL INTEGRATION POINT (Workstream F) — swap mockPatronageBackend for a
 * contract-backed implementation. Sketch:
 *
 *   export function makeContractPatronageBackend(client, patronageAddress): PatronageBackend {
 *     return {
 *       async fund(targetId, amountEur, backer, rewards) {
 *         // writeContract({ address: patronageAddress, functionName: 'contribute',
 *         //   args: [keccak256(targetId), parseUnits(String(amountEur), 6)] })
 *         // The contract records patronage only — no shares, no yield, no resale.
 *       }
 *     };
 *   }
 *
 * Wire to the existing ZkProjectPool / funding contract if it exposes a
 * patronage-style contribute(); otherwise scaffold a minimal Patronage contract
 * with contribute(bytes32 plot, uint256 amount) and NO transfer-of-value-back.
 */

// ── Verification (Workstream G) ─────────────────────────────────────────────

export interface Attestation {
  attested: boolean;
  ndvi?: number;
  source: string;
  at?: number;
}

export interface AttestationAdapter {
  getAttestation(plotId: string): Promise<Attestation>;
}

/**
 * Mock bridged-attestation adapter. Returns a "verified" attestation so the UI
 * can exercise the fund→plant→verify loop. The real adapter reads a CCIP message
 * carrying the CRE/ZK verdict from the CRE-capable chain.
 */
export const mockAttestationAdapter: AttestationAdapter = {
  async getAttestation(plotId) {
    await new Promise((r) => setTimeout(r, 600));
    // deterministic-ish greenness so repeated calls look stable
    const ndvi = 0.42 + ((plotId.charCodeAt(1) || 0) % 7) * 0.01;
    return { attested: true, ndvi, source: 'CCIP attestation (mock)', at: Date.now() };
  },
};

/*
 * REAL INTEGRATION POINT (Workstream G) — replace mockAttestationAdapter with a
 * reader over the bridged CCIP attestation:
 *
 *   export function makeCcipAttestationAdapter(client, receiverAddress): AttestationAdapter {
 *     return {
 *       async getAttestation(plotId) {
 *         // readContract({ address: receiverAddress, functionName: 'latestAttestation',
 *         //   args: [keccak256(plotId)] }) → { attested, ndvi, ccipMessageId, at }
 *       }
 *     };
 *   }
 *
 * Do NOT couple this to CRE on the consumer chain — the consumer chain only ever
 * sees the bridged attestation, never the CRE workflow itself.
 */
