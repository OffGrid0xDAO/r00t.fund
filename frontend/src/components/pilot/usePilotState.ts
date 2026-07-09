/**
 * usePilotState — client-side state for the Project 001 pilot map.
 *
 * Holds plots + communal machines and drives the lifecycle
 *   seeking → greening → funded → planted → verified
 * through the PatronageBackend (fund) and AttestationAdapter (verify) interfaces.
 * Swap the mock backends in patronage.ts for contract-backed ones with no other
 * change to this hook or the UI.
 */
import { useCallback, useMemo, useState } from 'react';
import type { Plot, Machine, PlotStatus } from './types';
import { SEED_PLOTS, SEED_MACHINES } from './data';
import {
  mockPatronageBackend, mockAttestationAdapter,
  type PatronageBackend, type AttestationAdapter,
} from './patronage';

function nextStatusAfterFund(p: Plot): PlotStatus {
  if (p.fundedEur >= p.targetEur) {
    // don't regress past planted/verified
    return p.status === 'planted' || p.status === 'verified' ? p.status : 'funded';
  }
  if (p.fundedEur > 0 && p.status === 'seeking') return 'greening';
  return p.status;
}

export function usePilotState(
  initialPlots?: Plot[],
  backend: PatronageBackend = mockPatronageBackend,
  attestation: AttestationAdapter = mockAttestationAdapter,
) {
  const [plots, setPlots] = useState<Plot[]>(() => (initialPlots ?? SEED_PLOTS).map((p) => ({ ...p })));
  const [machines, setMachines] = useState<Machine[]>(() => SEED_MACHINES.map((m) => ({ ...m })));
  const [pending, setPending] = useState<Record<string, boolean>>({});

  const setBusy = (id: string, v: boolean) => setPending((s) => ({ ...s, [id]: v }));

  const fundPlot = useCallback(async (plotId: string, amountEur: number, backer = 'you') => {
    const plot = plots.find((p) => p.id === plotId);
    if (!plot || amountEur <= 0) return;
    setBusy(plotId, true);
    const receipt = await backend.fund(plotId, amountEur, backer, plot.rewards);
    setBusy(plotId, false);
    if (!receipt.ok) return;
    setPlots((prev) => prev.map((p) => {
      if (p.id !== plotId) return p;
      const updated: Plot = {
        ...p,
        fundedEur: p.fundedEur + amountEur,
        contributions: [
          { id: receipt.ref, backer, amountEur, at: receipt.at },
          ...p.contributions,
        ],
      };
      updated.status = nextStatusAfterFund(updated);
      return updated;
    }));
  }, [plots, backend]);

  const chooseCrop = useCallback((plotId: string, cropId: string) => {
    setPlots((prev) => prev.map((p) => (p.id === plotId ? { ...p, chosenCropId: cropId } : p)));
  }, []);

  const plantPlot = useCallback((plotId: string) => {
    setPlots((prev) => prev.map((p) => (p.id === plotId && p.status === 'funded' ? { ...p, status: 'planted' } : p)));
  }, []);

  const verifyPlot = useCallback(async (plotId: string) => {
    setBusy(plotId + ':verify', true);
    const att = await attestation.getAttestation(plotId);
    setBusy(plotId + ':verify', false);
    if (!att.attested) return;
    setPlots((prev) => prev.map((p) => (
      p.id === plotId ? { ...p, status: 'verified', verified: { ...att, attested: true } } : p
    )));
  }, [attestation]);

  const fundMachine = useCallback(async (machineId: string, amountEur: number, backer = 'you') => {
    if (amountEur <= 0) return;
    setBusy(machineId, true);
    const receipt = await backend.fund(machineId, amountEur, backer, ['naming', 'certificate']);
    setBusy(machineId, false);
    if (!receipt.ok) return;
    setMachines((prev) => prev.map((m) => (
      m.id === machineId ? { ...m, fundedEur: Math.min(m.targetEur, m.fundedEur + amountEur) } : m
    )));
  }, [backend]);

  const totals = useMemo(() => {
    const target = plots.reduce((s, p) => s + p.targetEur, 0);
    const funded = plots.reduce((s, p) => s + p.fundedEur, 0);
    const backers = new Set(plots.flatMap((p) => p.contributions.map((c) => c.backer))).size;
    const verified = plots.filter((p) => p.status === 'verified').length;
    return { target, funded, backers, verified, plots: plots.length };
  }, [plots]);

  return { plots, machines, pending, totals, fundPlot, chooseCrop, plantPlot, verifyPlot, fundMachine };
}
