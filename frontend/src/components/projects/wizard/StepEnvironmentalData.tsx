import { motion, AnimatePresence } from 'framer-motion';
import { GlowButton } from '../../ui/GlowButton';
import type { WizardFormData, SpeciesEntry } from '../types';
import { SERRA_DA_ESTRELA_SPECIES } from '../constants';

interface StepEnvironmentalDataProps {
  formData: WizardFormData;
  onUpdateEnvironmental: (field: string, value: string) => void;
  onSetSpecies: (species: SpeciesEntry[]) => void;
  onAddSpecies: (species: SpeciesEntry) => void;
  onRemoveSpecies: (index: number) => void;
  onUpdateSpecies: (index: number, field: keyof SpeciesEntry, value: string | number) => void;
  errors: string[];
}

function getNdviColor(value: number): string {
  if (value < 0.2) return 'var(--error)';
  if (value < 0.4) return 'var(--warning)';
  return 'var(--success)';
}

export function StepEnvironmentalData({
  formData,
  onUpdateEnvironmental,
  onSetSpecies,
  onAddSpecies,
  onRemoveSpecies,
  onUpdateSpecies,
  errors,
}: StepEnvironmentalDataProps) {
  const env = formData.environmental;
  const ndviBaseline = parseFloat(env.baselineNdvi) || 0;
  const ndviTarget = parseFloat(env.targetNdvi) || 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-5"
    >
      {errors.length > 0 && (
        <div className="p-3 rounded-lg text-xs space-y-1"
          style={{ background: 'rgba(var(--error-rgb), 0.1)', color: 'var(--error)', border: '1px solid rgba(var(--error-rgb), 0.2)' }}>
          {errors.map((e, i) => <p key={i}>{e}</p>)}
        </div>
      )}

      {/* Location */}
      <div>
        <p className="text-xs font-mono text-[var(--text-muted)] mb-2">
          <span className="text-[var(--accent)] opacity-60">// </span>
          location
        </p>
        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="text-[10px] font-mono text-[var(--text-muted)] mb-1 block">latitude *</label>
            <input
              type="number"
              step="any"
              value={env.latitude}
              onChange={(e) => onUpdateEnvironmental('latitude', e.target.value)}
              placeholder="40.33"
              className="w-full px-3 py-2.5 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--border-focus)] focus:outline-none transition-colors text-sm font-mono"
            />
          </div>
          <div>
            <label className="text-[10px] font-mono text-[var(--text-muted)] mb-1 block">longitude *</label>
            <input
              type="number"
              step="any"
              value={env.longitude}
              onChange={(e) => onUpdateEnvironmental('longitude', e.target.value)}
              placeholder="-7.61"
              className="w-full px-3 py-2.5 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--border-focus)] focus:outline-none transition-colors text-sm font-mono"
            />
          </div>
          <div>
            <label className="text-[10px] font-mono text-[var(--text-muted)] mb-1 block">area (ha) *</label>
            <input
              type="number"
              value={env.landAreaHectares}
              onChange={(e) => onUpdateEnvironmental('landAreaHectares', e.target.value)}
              placeholder="9"
              className="w-full px-3 py-2.5 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--border-focus)] focus:outline-none transition-colors text-sm font-mono"
            />
          </div>
        </div>
      </div>

      {/* Project type */}
      <div>
        <label className="text-[10px] font-mono text-[var(--text-muted)] mb-1 block">project_type</label>
        <select
          value={env.projectType}
          onChange={(e) => onUpdateEnvironmental('projectType', e.target.value)}
          className="w-full px-3 py-2.5 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border)] text-[var(--text-primary)] focus:border-[var(--border-focus)] focus:outline-none transition-colors text-sm font-mono"
        >
          <option value="reforestation">reforestation</option>
          <option value="soil_restoration">soil_restoration</option>
          <option value="carbon_credits">carbon_credits</option>
          <option value="mixed">mixed</option>
        </select>
      </div>

      {/* Species Composition */}
      <div>
        <div className="flex justify-between items-center mb-2">
          <p className="text-xs font-mono text-[var(--text-muted)]">
            <span className="text-[var(--accent)] opacity-60">// </span>
            species_composition *
          </p>
          <div className="flex gap-2">
            <GlowButton
              onClick={() => onSetSpecies(SERRA_DA_ESTRELA_SPECIES)}
              variant="ghost"
              size="sm"
            >
              serra_preset()
            </GlowButton>
            <GlowButton
              onClick={() => onAddSpecies({ name: '', count: 0, co2RateKgYear: 0, survivalRate: 0 })}
              variant="secondary"
              size="sm"
            >
              + add
            </GlowButton>
          </div>
        </div>

        <AnimatePresence>
          {env.species.map((sp, idx) => (
            <motion.div
              key={idx}
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="mb-2"
            >
              <div className="grid grid-cols-12 gap-2 items-center p-2 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border)]">
                <div className="col-span-4">
                  <input
                    type="text"
                    value={sp.name}
                    onChange={(e) => onUpdateSpecies(idx, 'name', e.target.value)}
                    placeholder="Species name"
                    className="w-full px-2 py-1.5 rounded bg-transparent border border-[var(--border)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--border-focus)] focus:outline-none text-xs font-mono"
                  />
                </div>
                <div className="col-span-2">
                  <input
                    type="number"
                    value={sp.count || ''}
                    onChange={(e) => onUpdateSpecies(idx, 'count', Number(e.target.value))}
                    placeholder="count"
                    className="w-full px-2 py-1.5 rounded bg-transparent border border-[var(--border)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--border-focus)] focus:outline-none text-xs font-mono"
                  />
                </div>
                <div className="col-span-2">
                  <input
                    type="number"
                    value={sp.co2RateKgYear || ''}
                    onChange={(e) => onUpdateSpecies(idx, 'co2RateKgYear', Number(e.target.value))}
                    placeholder="CO₂ kg/y"
                    className="w-full px-2 py-1.5 rounded bg-transparent border border-[var(--border)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--border-focus)] focus:outline-none text-xs font-mono"
                  />
                </div>
                <div className="col-span-2">
                  <input
                    type="number"
                    value={sp.survivalRate || ''}
                    onChange={(e) => onUpdateSpecies(idx, 'survivalRate', Number(e.target.value))}
                    placeholder="surv %"
                    max={100}
                    className="w-full px-2 py-1.5 rounded bg-transparent border border-[var(--border)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--border-focus)] focus:outline-none text-xs font-mono"
                  />
                </div>
                <div className="col-span-2 flex justify-end">
                  <button
                    onClick={() => onRemoveSpecies(idx)}
                    className="p-1 rounded hover:bg-[var(--bg-elevated)] text-[var(--text-muted)] hover:text-[var(--error)] transition-colors"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              </div>
            </motion.div>
          ))}
        </AnimatePresence>

        {env.species.length > 0 && (
          <div className="text-[10px] font-mono text-[var(--text-muted)] mt-1 flex gap-4">
            <span>total: {env.species.reduce((s, sp) => s + sp.count, 0)} trees</span>
            <span>est. CO₂: {env.species.reduce((s, sp) => s + sp.count * sp.co2RateKgYear, 0).toLocaleString()} kg/yr</span>
          </div>
        )}
      </div>

      {/* NDVI Targets */}
      <div>
        <p className="text-xs font-mono text-[var(--text-muted)] mb-2">
          <span className="text-[var(--accent)] opacity-60">// </span>
          ndvi_targets
        </p>
        <div className="grid grid-cols-2 gap-3 mb-2">
          <div>
            <label className="text-[10px] font-mono text-[var(--text-muted)] mb-1 block">baseline_ndvi</label>
            <input
              type="number"
              step="0.01"
              min="0"
              max="1"
              value={env.baselineNdvi}
              onChange={(e) => onUpdateEnvironmental('baselineNdvi', e.target.value)}
              className="w-full px-3 py-2.5 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border)] text-[var(--text-primary)] focus:border-[var(--border-focus)] focus:outline-none transition-colors text-sm font-mono"
            />
          </div>
          <div>
            <label className="text-[10px] font-mono text-[var(--text-muted)] mb-1 block">target_ndvi</label>
            <input
              type="number"
              step="0.01"
              min="0"
              max="1"
              value={env.targetNdvi}
              onChange={(e) => onUpdateEnvironmental('targetNdvi', e.target.value)}
              className="w-full px-3 py-2.5 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border)] text-[var(--text-primary)] focus:border-[var(--border-focus)] focus:outline-none transition-colors text-sm font-mono"
            />
          </div>
        </div>
        {/* NDVI color bar */}
        <div className="h-2 rounded-full overflow-hidden bg-[var(--bg-secondary)] relative">
          <div className="absolute inset-0 flex">
            <div className="flex-1" style={{ background: 'linear-gradient(to right, var(--error), var(--warning), var(--success))' }} />
          </div>
          {/* Baseline marker */}
          <div
            className="absolute top-0 bottom-0 w-0.5 bg-white"
            style={{ left: `${ndviBaseline * 100}%` }}
          />
          {/* Target marker */}
          <div
            className="absolute top-0 bottom-0 w-0.5"
            style={{ left: `${ndviTarget * 100}%`, background: getNdviColor(ndviTarget) }}
          />
        </div>
        <div className="flex justify-between text-[10px] font-mono text-[var(--text-muted)] mt-1">
          <span style={{ color: getNdviColor(ndviBaseline) }}>baseline: {env.baselineNdvi}</span>
          <span style={{ color: getNdviColor(ndviTarget) }}>target: {env.targetNdvi}</span>
        </div>
      </div>

      {/* Carbon target */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <p className="text-xs font-mono text-[var(--text-muted)] mb-1.5">
            <span className="text-[var(--accent)] opacity-60">// </span>
            carbon_target (tCO₂/year)
          </p>
          <input
            type="number"
            value={env.carbonTargetTco2Year}
            onChange={(e) => onUpdateEnvironmental('carbonTargetTco2Year', e.target.value)}
            placeholder="e.g., 50"
            className="w-full px-3 py-2.5 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--border-focus)] focus:outline-none transition-colors text-sm font-mono"
          />
        </div>
        <div>
          <p className="text-xs font-mono text-[var(--text-muted)] mb-1.5">
            <span className="text-[var(--accent)] opacity-60">// </span>
            pre_fire_date (optional)
          </p>
          <input
            type="date"
            value={env.preFireDate}
            onChange={(e) => onUpdateEnvironmental('preFireDate', e.target.value)}
            className="w-full px-3 py-2.5 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border)] text-[var(--text-primary)] focus:border-[var(--border-focus)] focus:outline-none transition-colors text-sm font-mono"
          />
        </div>
      </div>
    </motion.div>
  );
}
