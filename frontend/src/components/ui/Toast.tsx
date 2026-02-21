import { useState, useEffect, useCallback, createContext, useContext } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

type ToastType = 'success' | 'error' | 'info';

interface Toast {
  id: string;
  type: ToastType;
  message: string;
  link?: { url: string; label: string };
  duration?: number;
}

interface ToastContextType {
  addToast: (toast: Omit<Toast, 'id'>) => void;
  removeToast: (id: string) => void;
}

const ToastContext = createContext<ToastContextType | null>(null);

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    // Return no-op if used outside provider (graceful degradation)
    return {
      addToast: () => {},
      removeToast: () => {},
      success: (_msg: string, _link?: { url: string; label: string }) => {},
      error: (_msg: string) => {},
      info: (_msg: string) => {},
    };
  }
  return {
    ...context,
    success: (message: string, link?: { url: string; label: string }) =>
      context.addToast({ type: 'success', message, link }),
    error: (message: string) =>
      context.addToast({ type: 'error', message }),
    info: (message: string) =>
      context.addToast({ type: 'info', message }),
  };
}

const typeConfig: Record<ToastType, { accent: string; icon: string; bgOpacity: string }> = {
  success: {
    accent: 'var(--success)',
    icon: 'M5 13l4 4L19 7',
    bgOpacity: 'rgba(45, 90, 61, 0.08)',
  },
  error: {
    accent: 'var(--error)',
    icon: 'M6 18L18 6M6 6l12 12',
    bgOpacity: 'rgba(166, 61, 47, 0.08)',
  },
  info: {
    accent: 'var(--text-muted)',
    icon: 'M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z',
    bgOpacity: 'rgba(156, 156, 150, 0.08)',
  },
};

function ToastItem({ toast, onRemove }: { toast: Toast; onRemove: () => void }) {
  const config = typeConfig[toast.type];
  const duration = toast.duration ?? 5000;

  useEffect(() => {
    const timer = setTimeout(onRemove, duration);
    return () => clearTimeout(timer);
  }, [duration, onRemove]);

  return (
    <motion.div
      layout
      initial={{ opacity: 0, x: 60, scale: 0.95 }}
      animate={{ opacity: 1, x: 0, scale: 1 }}
      exit={{ opacity: 0, x: 60, scale: 0.95 }}
      transition={{ type: 'spring', stiffness: 400, damping: 30 }}
      className="relative overflow-hidden rounded-lg border shadow-lg max-w-sm backdrop-blur-md"
      style={{
        background: 'var(--bg-elevated)',
        borderColor: 'var(--border)',
        borderLeft: `3px solid ${config.accent}`,
      }}
    >
      <div className="flex items-start gap-3 p-4">
        <svg
          className="w-4 h-4 mt-0.5 flex-shrink-0"
          style={{ color: config.accent }}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d={config.icon} />
        </svg>

        <div className="flex-1 min-w-0">
          <p className="text-sm text-[var(--text-primary)] leading-snug">
            {toast.message}
          </p>
          {toast.link && (
            <a
              href={toast.link.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs font-mono mt-1 inline-flex items-center gap-1 hover:underline"
              style={{ color: config.accent }}
            >
              {toast.link.label}
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
              </svg>
            </a>
          )}
        </div>

        <button
          onClick={onRemove}
          className="flex-shrink-0 p-0.5 rounded hover:bg-[var(--bg-secondary)] transition-colors"
        >
          <svg className="w-3.5 h-3.5 text-[var(--text-muted)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Auto-dismiss progress bar */}
      <motion.div
        initial={{ scaleX: 1 }}
        animate={{ scaleX: 0 }}
        transition={{ duration: duration / 1000, ease: 'linear' }}
        className="h-0.5 origin-left"
        style={{ background: config.accent, opacity: 0.4 }}
      />
    </motion.div>
  );
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const addToast = useCallback((toast: Omit<Toast, 'id'>) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    setToasts(prev => [...prev.slice(-4), { ...toast, id }]); // Keep max 5
  }, []);

  const removeToast = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  return (
    <ToastContext.Provider value={{ addToast, removeToast }}>
      {children}

      {/* Toast container — bottom right */}
      <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 items-end">
        <AnimatePresence mode="popLayout">
          {toasts.map(toast => (
            <ToastItem
              key={toast.id}
              toast={toast}
              onRemove={() => removeToast(toast.id)}
            />
          ))}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
}
