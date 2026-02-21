/**
 * Chart View Toggle Component
 *
 * Toggle switch between Line and Candles chart views.
 * Styled to match r00t.fund aesthetic with animated selection indicator.
 */

import { motion } from 'framer-motion';
import type { ChartToggleProps, ChartViewMode } from './types';

const OPTIONS: { value: ChartViewMode; label: string; icon: string }[] = [
  { value: 'line', label: 'Line', icon: '⌇' },
  { value: 'candles', label: 'Candles', icon: '▮' },
];

export function ChartToggle({ mode, onChange, className = '' }: ChartToggleProps) {
  return (
    <div
      className={`inline-flex p-0.5 rounded-md bg-[var(--bg-secondary)] border border-[var(--border)] ${className}`}
    >
      {OPTIONS.map((option) => (
        <motion.button
          key={option.value}
          onClick={() => onChange(option.value)}
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          className={`relative px-2.5 py-1 text-[10px] font-mono rounded transition-colors ${
            mode === option.value
              ? 'text-[var(--text-primary)]'
              : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
          }`}
        >
          {mode === option.value && (
            <motion.div
              layoutId="chartToggleIndicator"
              className="absolute inset-0 rounded"
              style={{
                background: 'var(--bg-elevated)',
                border: '1px solid var(--accent)',
                boxShadow: '0 0 8px var(--accent)15',
              }}
              transition={{ type: 'spring', stiffness: 400, damping: 30 }}
            />
          )}
          <span className="relative z-10 flex items-center gap-1">
            <span className="opacity-60">{option.icon}</span>
            {option.label}
          </span>
        </motion.button>
      ))}
    </div>
  );
}

export default ChartToggle;
