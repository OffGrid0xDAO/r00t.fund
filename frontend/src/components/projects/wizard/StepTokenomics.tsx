import { motion } from 'framer-motion';
import { formatUnits } from 'viem';
import type { WizardFormData } from '../types';

interface StepTokenomicsProps {
  formData: WizardFormData;
  onUpdateField: (field: string, value: string) => void;
  errors: string[];
  viewingKey: string | null;
  hiddenBalance: bigint;
}

export function StepTokenomics({ formData, onUpdateField, errors, viewingKey, hiddenBalance }: StepTokenomicsProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-4"
    >
      {errors.length > 0 && (
        <div className="p-3 rounded-lg text-xs space-y-1"
          style={{ background: 'rgba(var(--error-rgb), 0.1)', color: 'var(--error)', border: '1px solid rgba(var(--error-rgb), 0.2)' }}>
          {errors.map((e, i) => <p key={i}>{e}</p>)}
        </div>
      )}

      {/* Total Supply + Fee */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <p className="text-xs font-mono text-[var(--text-muted)] mb-1.5">
            <span className="text-[var(--accent)] opacity-60">// </span>
            total_supply
          </p>
          <input
            type="number"
            value={formData.totalSupply}
            onChange={(e) => onUpdateField('totalSupply', e.target.value)}
            className="w-full px-4 py-3 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border)] text-[var(--text-primary)] focus:border-[var(--border-focus)] focus:outline-none transition-colors font-mono"
          />
        </div>
        <div>
          <p className="text-xs font-mono text-[var(--text-muted)] mb-1.5">
            <span className="text-[var(--accent)] opacity-60">// </span>
            fee_bps
          </p>
          <input
            type="number"
            value={formData.feeBps}
            onChange={(e) => onUpdateField('feeBps', e.target.value)}
            max={1000}
            className="w-full px-4 py-3 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border)] text-[var(--text-primary)] focus:border-[var(--border-focus)] focus:outline-none transition-colors font-mono"
          />
          <p className="text-xs text-[var(--text-muted)] mt-1 font-mono">
            // {Number(formData.feeBps) / 100}% fee per swap
          </p>
        </div>
      </div>

      {/* Deployer Allocation */}
      <div>
        <p className="text-xs font-mono text-[var(--text-muted)] mb-1.5">
          <span className="text-[var(--accent)] opacity-60">// </span>
          deployer_bps (optional)
        </p>
        <input
          type="number"
          value={formData.deployerBps}
          onChange={(e) => onUpdateField('deployerBps', e.target.value)}
          max={500}
          placeholder="0"
          className="w-full px-4 py-3 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--border-focus)] focus:outline-none transition-colors font-mono"
        />
        <p className="text-xs text-[var(--text-muted)] mt-1 font-mono">
          // {Number(formData.deployerBps) / 100}% to deployer (max 5%)
        </p>
      </div>

      {/* Pledge Amount */}
      <div>
        <p className="text-xs font-mono text-[var(--text-muted)] mb-1.5">
          <span className="text-[var(--accent)] opacity-60">// </span>
          pledge_amount
        </p>
        <input
          type="number"
          value={formData.pledgeAmount}
          onChange={(e) => onUpdateField('pledgeAmount', e.target.value)}
          className="w-full px-4 py-3 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border)] text-[var(--text-primary)] focus:border-[var(--border-focus)] focus:outline-none transition-colors font-mono"
        />
        <p className="text-xs text-[var(--text-muted)] mt-1 font-mono">
          // locked as initial LP — returned minus 0.03% if rejected
        </p>
      </div>

      {/* Balance display */}
      {viewingKey && (
        <div className="p-4 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border)]">
          <p className="text-xs font-mono text-[var(--text-muted)] mb-1">
            <span className="text-[var(--accent)] opacity-60">// </span>
            your_balance
          </p>
          <div className="font-medium text-[var(--text-primary)] font-mono">
            {Number(formatUnits(hiddenBalance, 18)).toLocaleString()} $ROOT
          </div>
        </div>
      )}
    </motion.div>
  );
}
