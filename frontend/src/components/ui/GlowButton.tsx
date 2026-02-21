import { motion, HTMLMotionProps } from 'framer-motion';
import { ReactNode } from 'react';

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'privacy' | 'danger';
type ButtonSize = 'sm' | 'md' | 'lg';

interface GlowButtonProps extends Omit<HTMLMotionProps<'button'>, 'children'> {
  children: ReactNode;
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  disabled?: boolean;
  icon?: ReactNode;
  iconPosition?: 'left' | 'right';
  fullWidth?: boolean;
  className?: string;
}

const variantStyles: Record<ButtonVariant, string> = {
  primary: `
    bg-[var(--accent)] text-white
    hover:opacity-90
    hover:shadow-[0_0_24px_rgba(45,90,61,0.35)]
    dark:hover:shadow-[0_0_24px_rgba(93,168,112,0.35)]
  `,
  secondary: `
    bg-[var(--bg-secondary)] text-[var(--text-primary)]
    border border-[var(--border)]
    hover:border-[var(--accent)] hover:bg-[var(--bg-elevated)]
    hover:shadow-[0_0_16px_rgba(45,90,61,0.12)]
    dark:hover:shadow-[0_0_16px_rgba(93,168,112,0.15)]
  `,
  ghost: `
    bg-transparent text-[var(--text-secondary)]
    hover:text-[var(--text-primary)] hover:bg-[var(--bg-secondary)]
  `,
  privacy: `
    bg-[var(--accent-secondary)] text-white
    hover:opacity-90
    hover:shadow-[0_0_24px_rgba(184,134,11,0.3)]
    dark:hover:shadow-[0_0_24px_rgba(212,168,75,0.3)]
  `,
  danger: `
    bg-[var(--error)] text-white
    hover:opacity-90
    hover:shadow-[0_0_24px_rgba(166,61,47,0.3)]
  `,
};

const sizeStyles: Record<ButtonSize, string> = {
  sm: 'px-3 py-1.5 text-xs gap-1.5',
  md: 'px-5 py-2.5 text-sm gap-2',
  lg: 'px-7 py-3.5 text-base gap-2.5',
};

export function GlowButton({
  children,
  variant = 'primary',
  size = 'md',
  loading = false,
  disabled = false,
  icon,
  iconPosition = 'left',
  fullWidth = false,
  className = '',
  ...props
}: GlowButtonProps) {
  const isDisabled = disabled || loading;

  return (
    <motion.button
      whileHover={isDisabled ? undefined : { scale: 1.02, y: -2 }}
      whileTap={isDisabled ? undefined : { scale: 0.98 }}
      transition={{ duration: 0.15 }}
      disabled={isDisabled}
      className={`
        relative inline-flex items-center justify-center
        font-mono font-medium rounded-md
        transition-all duration-200
        overflow-hidden
        ${variantStyles[variant]}
        ${sizeStyles[size]}
        ${fullWidth ? 'w-full' : ''}
        ${isDisabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'}
        ${className}
      `}
      {...props}
    >
      {/* Shine sweep effect */}
      <span className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent opacity-0 hover:opacity-100 transition-opacity duration-500 -skew-x-12 translate-x-[-100%] hover:translate-x-[100%]" style={{ transition: 'opacity 0.3s, transform 0.6s ease-out' }} />

      {/* Loading spinner */}
      {loading && (
        <motion.span
          animate={{ rotate: 360 }}
          transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
          className="absolute inset-0 flex items-center justify-center"
        >
          <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none">
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="3"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
            />
          </svg>
        </motion.span>
      )}

      {/* Content */}
      <span className={`relative z-10 flex items-center ${loading ? 'opacity-0' : ''}`}>
        {icon && iconPosition === 'left' && <span>{icon}</span>}
        <span>{children}</span>
        {icon && iconPosition === 'right' && <span>{icon}</span>}
      </span>
    </motion.button>
  );
}

// Icon-only button variant
interface IconButtonProps extends Omit<HTMLMotionProps<'button'>, 'children'> {
  icon: ReactNode;
  variant?: 'default' | 'ghost' | 'glow';
  size?: 'sm' | 'md' | 'lg';
  disabled?: boolean;
  className?: string;
  'aria-label': string;
}

const iconButtonSizes: Record<'sm' | 'md' | 'lg', string> = {
  sm: 'w-8 h-8',
  md: 'w-10 h-10',
  lg: 'w-12 h-12',
};

export function IconButton({
  icon,
  variant = 'default',
  size = 'md',
  disabled = false,
  className = '',
  ...props
}: IconButtonProps) {
  const variantClass = {
    default: 'bg-[var(--bg-secondary)] hover:bg-[var(--bg-elevated)]',
    ghost: 'bg-transparent hover:bg-[var(--bg-secondary)]',
    glow: 'bg-[var(--bg-secondary)] hover:border-[var(--accent)]',
  };

  return (
    <motion.button
      whileHover={disabled ? undefined : { scale: 1.05 }}
      whileTap={disabled ? undefined : { scale: 0.95 }}
      disabled={disabled}
      className={`
        inline-flex items-center justify-center rounded-md
        text-[var(--text-secondary)] hover:text-[var(--text-primary)]
        transition-all duration-200 border border-[var(--border)]
        ${iconButtonSizes[size]}
        ${variantClass[variant]}
        ${disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'}
        ${className}
      `}
      {...props}
    >
      {icon}
    </motion.button>
  );
}

export default GlowButton;
