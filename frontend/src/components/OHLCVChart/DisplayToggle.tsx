/**
 * Display Mode Toggle Component
 *
 * Toggle switch between Price and Market Cap display.
 * Styled to match r00t.fund aesthetic with animated selection indicator.
 */

import { motion } from 'framer-motion';

export type DisplayMode = 'price' | 'mcap';

export interface DisplayToggleProps {
  /** Current display mode */
  mode: DisplayMode;
  /** Callback when mode changes */
  onChange: (mode: DisplayMode) => void;
  /** Additional CSS classes */
  className?: string;
}

const OPTIONS: { value: DisplayMode; label: string }[] = [
  { value: 'price', label: 'Price' },
  { value: 'mcap', label: 'MCap' },
];

export function DisplayToggle({ mode, onChange, className = '' }: DisplayToggleProps) {
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
              layoutId="displayToggleIndicator"
              className="absolute inset-0 rounded"
              style={{
                background: 'var(--bg-elevated)',
                border: '1px solid var(--accent)',
                boxShadow: '0 0 8px var(--accent)15',
              }}
              transition={{ type: 'spring', stiffness: 400, damping: 30 }}
            />
          )}
          <span className="relative z-10">{option.label}</span>
        </motion.button>
      ))}
    </div>
  );
}

export default DisplayToggle;
