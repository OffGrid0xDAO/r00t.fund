import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { GlowButton } from '../../ui/GlowButton';

interface VoteModalProps {
  proposalId: number;
  support: boolean;
  isLoading: boolean;
  onVote: (proposalId: number, support: boolean, amount: string) => void;
  onClose: () => void;
}

export function VoteModal({ proposalId, support, isLoading, onVote, onClose }: VoteModalProps) {
  const [voteAmount, setVoteAmount] = useState('');

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50"
        onClick={onClose}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.9, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.9, y: 20 }}
          transition={{ type: 'spring', damping: 20 }}
          onClick={(e) => e.stopPropagation()}
          className="max-w-md w-full mx-4 rounded-lg p-6 bg-[var(--bg-elevated)] border border-[var(--border-default)]"
        >
          <p className="text-xs font-mono text-[var(--text-muted)] mb-2">
            <span className="text-[var(--accent)] opacity-60">// </span>
            vote
          </p>
          <h3 className="text-xl font-semibold mb-4 text-[var(--text-primary)]">
            {support ? 'vote_for()' : 'vote_against()'}
          </h3>

          <div className="mb-4">
            <p className="text-xs font-mono text-[var(--text-muted)] mb-1.5">
              <span className="text-[var(--accent)] opacity-60">// </span>
              weight
            </p>
            <input
              type="number"
              value={voteAmount}
              onChange={(e) => setVoteAmount(e.target.value)}
              placeholder="Amount of $ROOT to vote with"
              className="w-full px-4 py-3 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--border-focus)] focus:outline-none transition-colors"
            />
            <p className="text-xs text-[var(--text-muted)] mt-2 font-mono">
              // your vote is private — nobody can see who voted or how much
            </p>
          </div>

          <div className="flex gap-3">
            <GlowButton onClick={onClose} variant="ghost" className="flex-1">
              cancel()
            </GlowButton>
            <GlowButton
              onClick={() => onVote(proposalId, support, voteAmount)}
              disabled={isLoading || !voteAmount}
              loading={isLoading}
              variant={support ? 'primary' : 'danger'}
              className="flex-1"
            >
              confirm()
            </GlowButton>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
