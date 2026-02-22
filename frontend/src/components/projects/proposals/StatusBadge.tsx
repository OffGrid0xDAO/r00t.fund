import { motion } from 'framer-motion';
import { ProposalStatus } from '../constants';

export function StatusBadge({ status }: { status: number }) {
  const getStatusConfig = () => {
    switch (status) {
      case ProposalStatus.Active:
        return { label: 'active', color: 'var(--glow-secondary)', bg: 'var(--glow-secondary)' };
      case ProposalStatus.Approved:
        return { label: 'approved', color: 'var(--success)', bg: 'var(--success)' };
      case ProposalStatus.Rejected:
        return { label: 'rejected', color: 'var(--error)', bg: 'var(--error)' };
      case ProposalStatus.Cancelled:
        return { label: 'cancelled', color: 'var(--text-muted)', bg: 'var(--text-muted)' };
      case ProposalStatus.Executed:
        return { label: 'live', color: 'var(--success)', bg: 'var(--success)' };
      default:
        return { label: 'unknown', color: 'var(--text-muted)', bg: 'var(--text-muted)' };
    }
  };

  const config = getStatusConfig();

  return (
    <motion.span
      initial={{ opacity: 0, scale: 0.8 }}
      animate={{ opacity: 1, scale: 1 }}
      className="px-2 py-0.5 rounded-full text-[10px] font-mono uppercase tracking-wider"
      style={{
        color: config.color,
        background: `${config.bg}20`,
        border: `1px solid ${config.bg}40`,
      }}
    >
      {config.label}
    </motion.span>
  );
}
