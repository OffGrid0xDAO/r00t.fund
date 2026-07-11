import { motion } from 'framer-motion';
import { ReactNode, useRef, useState, useEffect } from 'react';

interface Tab {
  id?: string;
  key?: string;
  label: string;
  icon?: ReactNode;
}

interface AnimatedTabsProps {
  tabs: Tab[];
  activeTab: string;
  onChange?: (key: string) => void;
  onTabChange?: (key: string) => void;
  variant?: 'default' | 'pills' | 'underline';
  size?: 'sm' | 'md' | 'lg';
  fullWidth?: boolean;
  className?: string;
}

const sizeStyles = {
  sm: 'text-xs py-1.5 px-3',
  md: 'text-sm py-2.5 px-4',
  lg: 'text-base py-3 px-5',
};

// Helper to get tab key (supports both id and key properties)
const getTabKey = (tab: Tab): string => tab.id || tab.key || '';

export function AnimatedTabs({
  tabs,
  activeTab,
  onChange,
  onTabChange,
  variant = 'default',
  size = 'md',
  fullWidth = true,
  className = '',
}: AnimatedTabsProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [indicatorStyle, setIndicatorStyle] = useState({ left: 0, width: 0 });

  // Support both onChange and onTabChange
  const handleChange = (key: string) => {
    onChange?.(key);
    onTabChange?.(key);
  };

  // Update indicator position when active tab changes
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const activeButton = container.querySelector(`[data-tab-key="${activeTab}"]`) as HTMLElement;
    if (!activeButton) return;

    const containerRect = container.getBoundingClientRect();
    const buttonRect = activeButton.getBoundingClientRect();

    setIndicatorStyle({
      left: buttonRect.left - containerRect.left,
      width: buttonRect.width,
    });
  }, [activeTab, tabs]);

  if (variant === 'underline') {
    return (
      <div ref={containerRef} className={`relative flex border-b border-[var(--border)] ${className}`}>
        {tabs.map((tab) => (
          <button
            key={getTabKey(tab)}
            data-tab-key={getTabKey(tab)}
            onClick={() => handleChange(getTabKey(tab))}
            className={`
              relative font-mono ${sizeStyles[size]}
              transition-colors duration-200
              ${fullWidth ? 'flex-1' : ''}
              ${activeTab === getTabKey(tab) ? 'text-[var(--text-primary)]' : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'}
            `}
          >
            <span className="flex items-center justify-center gap-2">
              {tab.icon}
              {tab.label}
            </span>
          </button>
        ))}

        {/* Animated underline indicator */}
        <motion.div
          className="absolute bottom-0 h-0.5 bg-[var(--accent)]"
          initial={false}
          animate={{
            left: indicatorStyle.left,
            width: indicatorStyle.width,
          }}
          transition={{
            type: 'spring',
            stiffness: 500,
            damping: 35,
          }}
          style={{
            boxShadow: '0 0 10px var(--accent)',
          }}
        />
      </div>
    );
  }

  if (variant === 'pills') {
    return (
      <div ref={containerRef} className={`relative flex gap-2 ${className}`}>
        {tabs.map((tab) => (
          <motion.button
            key={getTabKey(tab)}
            data-tab-key={getTabKey(tab)}
            onClick={() => handleChange(getTabKey(tab))}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            className={`
              relative font-mono ${sizeStyles[size]} rounded-xl
              transition-all duration-200
              ${fullWidth ? 'flex-1' : ''}
              ${
                activeTab === getTabKey(tab)
                  ? 'bg-[var(--accent)] text-[var(--accent-ink)] shadow-glow-sm'
                  : 'bg-[var(--bg-secondary)] text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
              }
            `}
          >
            <span className="flex items-center justify-center gap-2">
              {tab.icon}
              {tab.label}
            </span>
          </motion.button>
        ))}
      </div>
    );
  }

  // Default variant with sliding background
  return (
    <div
      ref={containerRef}
      className={`relative flex gap-1 p-1.5 rounded-xl bg-[var(--bg-secondary)] ${className}`}
    >
      {/* Animated background indicator */}
      <motion.div
        className="absolute top-1.5 bottom-1.5 rounded-lg bg-[var(--bg-elevated)]"
        initial={false}
        animate={{
          left: indicatorStyle.left,
          width: indicatorStyle.width,
        }}
        transition={{
          type: 'spring',
          stiffness: 500,
          damping: 35,
        }}
        style={{
          boxShadow: '0 2px 8px -2px var(--shadow-color)',
        }}
      />

      {tabs.map((tab) => (
        <button
          key={getTabKey(tab)}
          data-tab-key={getTabKey(tab)}
          onClick={() => handleChange(getTabKey(tab))}
          className={`
            relative z-10 font-mono ${sizeStyles[size]} rounded-lg
            transition-colors duration-200
            ${fullWidth ? 'flex-1' : ''}
            ${activeTab === getTabKey(tab) ? 'text-[var(--text-primary)]' : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'}
          `}
        >
          <span className="flex items-center justify-center gap-2">
            {tab.icon}
            {tab.label}
          </span>
        </button>
      ))}
    </div>
  );
}

// Sub-tabs for nested navigation
interface SubTabsProps {
  tabs: Tab[];
  activeTab: string;
  onChange: (key: string) => void;
  className?: string;
}

export function SubTabs({ tabs, activeTab, onChange, className = '' }: SubTabsProps) {
  return (
    <div className={`flex gap-1 ${className}`}>
      {tabs.map((tab) => (
        <motion.button
          key={getTabKey(tab)}
          onClick={() => onChange(getTabKey(tab))}
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          className={`
            font-mono text-xs py-1.5 px-3 rounded-lg
            transition-all duration-200
            ${
              activeTab === getTabKey(tab)
                ? 'bg-[var(--border)] text-[var(--text-primary)]'
                : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
            }
          `}
        >
          {tab.label}
        </motion.button>
      ))}
    </div>
  );
}

export default AnimatedTabs;
