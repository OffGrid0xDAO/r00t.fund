import { motion } from 'framer-motion';
import type { MilestoneNode } from '../types';

interface MilestoneTimelineProps {
  milestones: MilestoneNode[];
  compact?: boolean;
}

function getStatusColor(status: MilestoneNode['status']): string {
  switch (status) {
    case 'completed': return 'var(--success)';
    case 'active': return 'var(--accent)';
    case 'failed': return 'var(--error)';
    default: return 'var(--text-muted)';
  }
}

function getStatusIcon(status: MilestoneNode['status']) {
  switch (status) {
    case 'completed':
      return (
        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
        </svg>
      );
    case 'active':
      return (
        <motion.div
          className="w-2 h-2 rounded-full"
          style={{ background: 'currentColor' }}
          animate={{ scale: [1, 1.3, 1] }}
          transition={{ duration: 1.5, repeat: Infinity }}
        />
      );
    case 'failed':
      return (
        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M6 18L18 6M6 6l12 12" />
        </svg>
      );
    default:
      return <div className="w-1.5 h-1.5 rounded-full bg-current opacity-40" />;
  }
}

export function MilestoneTimeline({ milestones, compact = false }: MilestoneTimelineProps) {
  if (compact) {
    return (
      <div className="flex items-center gap-1">
        {milestones.map((m, idx) => (
          <div key={m.id} className="flex items-center">
            <div
              className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-mono"
              style={{
                color: getStatusColor(m.status),
                background: `color-mix(in srgb, ${getStatusColor(m.status)} 10%, transparent)`,
              }}
            >
              {getStatusIcon(m.status)}
              <span>{m.workflow}</span>
            </div>
            {idx < milestones.length - 1 && (
              <div className="w-2 h-px mx-0.5" style={{ background: 'var(--border)' }} />
            )}
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="relative pl-4">
      {/* Vertical line */}
      <div className="absolute left-[7px] top-2 bottom-2 w-px" style={{ background: 'var(--border)' }} />

      {milestones.map((m, idx) => (
        <motion.div
          key={m.id}
          initial={{ opacity: 0, x: -10 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: idx * 0.1 }}
          className="relative flex items-start gap-3 mb-3 last:mb-0"
        >
          {/* Node circle */}
          <div
            className="relative z-10 w-4 h-4 rounded-full flex items-center justify-center -ml-4 mt-0.5 shrink-0"
            style={{
              background: m.status !== 'pending' ? getStatusColor(m.status) : 'var(--bg-secondary)',
              border: `2px solid ${getStatusColor(m.status)}`,
              color: m.status !== 'pending' ? 'white' : getStatusColor(m.status),
            }}
          >
            {getStatusIcon(m.status)}
          </div>

          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-mono font-bold" style={{ color: getStatusColor(m.status) }}>
                {m.workflow}
              </span>
              <span className="text-xs text-[var(--text-primary)]">{m.label}</span>
            </div>
            <p className="text-[10px] text-[var(--text-muted)] font-mono">{m.description}</p>
          </div>
        </motion.div>
      ))}
    </div>
  );
}
