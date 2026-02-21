import { motion, AnimatePresence } from 'framer-motion';
import { useEffect, useCallback } from 'react';

interface ChartModalProps {
  isOpen: boolean;
  onClose: () => void;
  children: React.ReactNode;
  title?: string;
}

export function ChartModal({ isOpen, onClose, children, title }: ChartModalProps) {
  // Handle escape key
  const handleEscape = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') onClose();
  }, [onClose]);

  useEffect(() => {
    if (isOpen) {
      document.addEventListener('keydown', handleEscape);
      document.body.style.overflow = 'hidden';
    }
    return () => {
      document.removeEventListener('keydown', handleEscape);
      document.body.style.overflow = '';
    };
  }, [isOpen, handleEscape]);

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.3 }}
          className="fixed inset-0 z-[100] flex items-center justify-center"
        >
          {/* Backdrop with blur */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 bg-[var(--bg-primary)]/90 backdrop-blur-xl"
            onClick={onClose}
          />

          {/* Decorative grid pattern */}
          <div
            className="absolute inset-0 opacity-[0.03] pointer-events-none"
            style={{
              backgroundImage: `
                linear-gradient(var(--accent) 1px, transparent 1px),
                linear-gradient(90deg, var(--accent) 1px, transparent 1px)
              `,
              backgroundSize: '60px 60px',
            }}
          />

          {/* Radial glow effects */}
          <div
            className="absolute top-0 left-1/4 w-[600px] h-[600px] rounded-full pointer-events-none"
            style={{
              background: 'radial-gradient(circle, var(--accent) 0%, transparent 70%)',
              opacity: 0.05,
              filter: 'blur(80px)',
            }}
          />
          <div
            className="absolute bottom-0 right-1/4 w-[400px] h-[400px] rounded-full pointer-events-none"
            style={{
              background: 'radial-gradient(circle, var(--accent-secondary) 0%, transparent 70%)',
              opacity: 0.04,
              filter: 'blur(60px)',
            }}
          />

          {/* Modal Content */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            transition={{
              type: 'spring',
              stiffness: 300,
              damping: 30,
              delay: 0.1
            }}
            className="relative w-[95vw] h-[90vh] max-w-[1600px] rounded-2xl overflow-hidden"
            style={{
              background: 'var(--bg-elevated)',
              border: '1px solid var(--border)',
              boxShadow: '0 25px 100px -20px rgba(0, 0, 0, 0.4)',
            }}
          >
            {/* Header */}
            <div
              className="flex items-center justify-between px-6 py-4 border-b border-[var(--border)]"
              style={{ background: 'var(--bg-secondary)' }}
            >
              <div className="flex items-center gap-4">
                {/* Window controls aesthetic */}
                <div className="flex items-center gap-2">
                  <motion.button
                    onClick={onClose}
                    whileHover={{ scale: 1.1 }}
                    whileTap={{ scale: 0.9 }}
                    className="w-3 h-3 rounded-full bg-[var(--error)] hover:brightness-110 transition-all"
                  />
                  <div className="w-3 h-3 rounded-full bg-[var(--warning)] opacity-50" />
                  <div className="w-3 h-3 rounded-full bg-[var(--success)] opacity-50" />
                </div>

                {title && (
                  <motion.h2
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.2 }}
                    className="text-sm font-mono text-[var(--text-muted)]"
                  >
                    <span className="text-[var(--accent)]">// </span>
                    {title}
                  </motion.h2>
                )}
              </div>

              <div className="flex items-center gap-3">
                {/* Keyboard hint */}
                <motion.span
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.3 }}
                  className="text-[10px] font-mono text-[var(--text-muted)] px-2 py-1 rounded border border-[var(--border)]"
                  style={{ background: 'var(--bg-primary)' }}
                >
                  ESC
                </motion.span>

                {/* Close button */}
                <motion.button
                  onClick={onClose}
                  whileHover={{ scale: 1.05, rotate: 90 }}
                  whileTap={{ scale: 0.95 }}
                  className="p-2 rounded-lg border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:border-[var(--accent)] transition-all"
                  style={{ background: 'var(--bg-primary)' }}
                >
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </motion.button>
              </div>
            </div>

            {/* Chart Content Area */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.2 }}
              className="h-[calc(100%-60px)] p-6 overflow-auto"
            >
              {children}
            </motion.div>

            {/* Corner decorations */}
            <div className="absolute top-16 left-0 w-20 h-px bg-gradient-to-r from-[var(--accent)] to-transparent opacity-30" />
            <div className="absolute top-16 left-0 w-px h-20 bg-gradient-to-b from-[var(--accent)] to-transparent opacity-30" />
            <div className="absolute bottom-0 right-0 w-20 h-px bg-gradient-to-l from-[var(--accent)] to-transparent opacity-30" />
            <div className="absolute bottom-0 right-0 w-px h-20 bg-gradient-to-t from-[var(--accent)] to-transparent opacity-30" />
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// Expand button component to be used in PriceChart
export function ExpandChartButton({ onClick }: { onClick: () => void }) {
  return (
    <motion.button
      onClick={onClick}
      whileHover={{ scale: 1.05 }}
      whileTap={{ scale: 0.95 }}
      className="p-2 rounded-lg border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--accent)] hover:border-[var(--accent)] transition-all group"
      style={{ background: 'var(--bg-secondary)' }}
      title="Expand chart"
    >
      <svg
        className="w-4 h-4 transition-transform group-hover:scale-110"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4"
        />
      </svg>
    </motion.button>
  );
}
