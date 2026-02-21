import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

// AnimatedValue — slides numbers up/down when values change
export function AnimatedValue({
  value,
  className = '',
  prefix = '',
  suffix = '',
}: {
  value: string;
  className?: string;
  prefix?: string;
  suffix?: string;
}) {
  const [displayValue, setDisplayValue] = useState(value);
  const [direction, setDirection] = useState<'up' | 'down'>('up');
  const prevValue = useRef(value);

  useEffect(() => {
    if (value !== prevValue.current) {
      // Determine direction based on numeric comparison
      const prev = parseFloat(prevValue.current) || 0;
      const next = parseFloat(value) || 0;
      setDirection(next >= prev ? 'up' : 'down');
      prevValue.current = value;
      setDisplayValue(value);
    }
  }, [value]);

  return (
    <span className={`inline-flex items-baseline ${className}`}>
      {prefix && <span>{prefix}</span>}
      <AnimatePresence mode="popLayout">
        <motion.span
          key={displayValue}
          initial={{
            opacity: 0,
            y: direction === 'up' ? 8 : -8,
          }}
          animate={{ opacity: 1, y: 0 }}
          exit={{
            opacity: 0,
            y: direction === 'up' ? -8 : 8,
          }}
          transition={{ duration: 0.25, ease: 'easeOut' }}
          className="tabular-nums"
        >
          {displayValue}
        </motion.span>
      </AnimatePresence>
      {suffix && <span>{suffix}</span>}
    </span>
  );
}

// FlashOnChange — flashes background green/red when value changes
export function FlashOnChange({
  value,
  children,
  className = '',
}: {
  value: string | number;
  children: React.ReactNode;
  className?: string;
}) {
  const [flash, setFlash] = useState<'up' | 'down' | null>(null);
  const prevValue = useRef(value);

  useEffect(() => {
    if (value !== prevValue.current) {
      const prev = typeof prevValue.current === 'string' ? parseFloat(prevValue.current) : prevValue.current;
      const next = typeof value === 'string' ? parseFloat(value) : value;
      if (!isNaN(prev) && !isNaN(next)) {
        setFlash(next >= prev ? 'up' : 'down');
        const timer = setTimeout(() => setFlash(null), 600);
        prevValue.current = value;
        return () => clearTimeout(timer);
      }
      prevValue.current = value;
    }
  }, [value]);

  return (
    <span
      className={`transition-colors duration-300 rounded px-1 -mx-1 ${className}`}
      style={{
        backgroundColor: flash === 'up'
          ? 'rgba(45, 90, 61, 0.12)'
          : flash === 'down'
            ? 'rgba(166, 61, 47, 0.12)'
            : 'transparent',
      }}
    >
      {children}
    </span>
  );
}

// PulseOnSuccess — scale pulse animation on trigger
export function PulseOnSuccess({
  trigger,
  children,
  className = '',
}: {
  trigger: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <motion.div
      animate={trigger ? { scale: [1, 1.03, 1] } : {}}
      transition={{ duration: 0.4, ease: 'easeOut' }}
      className={className}
    >
      {children}
    </motion.div>
  );
}
