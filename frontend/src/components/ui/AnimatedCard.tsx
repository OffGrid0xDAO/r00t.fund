import { motion, HTMLMotionProps } from 'framer-motion';
import { ReactNode } from 'react';

type CardVariant = 'default' | 'elevated' | 'glass' | 'glow';

interface AnimatedCardProps extends Omit<HTMLMotionProps<'div'>, 'children'> {
  children: ReactNode;
  variant?: CardVariant;
  hover?: boolean;
  className?: string;
  delay?: number;
}

const variantStyles: Record<CardVariant, string> = {
  default: 'card',
  elevated: 'card-elevated',
  glass: 'card-glass',
  glow: 'card-glow',
};

export function AnimatedCard({
  children,
  variant = 'default',
  hover = true,
  className = '',
  delay = 0,
  ...props
}: AnimatedCardProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      transition={{
        duration: 0.4,
        delay,
        ease: [0.25, 0.46, 0.45, 0.94],
      }}
      whileHover={
        hover
          ? {
              y: -4,
              transition: { duration: 0.2 },
            }
          : undefined
      }
      className={`${variantStyles[variant]} ${className}`}
      {...props}
    >
      {children}
    </motion.div>
  );
}

// Specialized card for token/amount inputs
interface TokenCardProps {
  children: ReactNode;
  className?: string;
  active?: boolean;
}

export function TokenCard({ children, className = '', active = false }: TokenCardProps) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.3 }}
      whileHover={{ scale: 1.01 }}
      whileTap={{ scale: 0.99 }}
      className={`
        relative rounded-lg p-5 transition-all duration-300
        bg-[var(--bg-secondary)] border
        ${active ? 'border-[var(--accent)] shadow-glow-sm' : 'border-transparent'}
        hover:border-[var(--border)]
        ${className}
      `}
    >
      {children}
    </motion.div>
  );
}

// Stats/info card with subtle animation
interface StatCardProps {
  label: string;
  value: string | ReactNode;
  icon?: ReactNode;
  trend?: 'up' | 'down' | 'neutral';
  className?: string;
}

export function StatCard({ label, value, icon, trend, className = '' }: StatCardProps) {
  const trendColors = {
    up: 'text-[var(--success)]',
    down: 'text-[var(--error)]',
    neutral: 'text-[var(--text-muted)]',
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className={`
        rounded-xl p-4 bg-[var(--bg-secondary)] border border-[var(--border)]
        ${className}
      `}
    >
      <div className="flex items-center justify-between mb-2">
        <span className="code-label">{label}</span>
        {icon && <span className="text-[var(--text-muted)]">{icon}</span>}
      </div>
      <div className={`text-xl font-display font-semibold ${trend ? trendColors[trend] : 'text-[var(--text-primary)]'}`}>
        {value}
      </div>
    </motion.div>
  );
}

export default AnimatedCard;
