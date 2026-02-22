import { motion } from 'framer-motion';
import type { WizardFormData } from '../types';
import { CRE_MILESTONES } from '../constants';
import { MilestoneTimeline } from '../proposals/MilestoneTimeline';

interface StepReviewProps {
  formData: WizardFormData;
}

export function StepReview({ formData }: StepReviewProps) {
  const env = formData.environmental;
  const totalTrees = env.species.reduce((s, sp) => s + sp.count, 0);
  const estCo2 = env.species.reduce((s, sp) => s + sp.count * sp.co2RateKgYear, 0);

  // Build milestone nodes in preview mode
  const milestones = CRE_MILESTONES.map(m => ({
    ...m,
    status: 'pending' as const,
  }));

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-5"
    >
      {/* Project Summary Card */}
      <div className="p-4 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border)]">
        <div className="flex items-start justify-between mb-3">
          <div>
            <h3 className="font-semibold text-lg text-[var(--text-primary)]">{formData.name || 'Untitled'}</h3>
            <span className="text-sm font-mono text-[var(--text-muted)]">${formData.symbol || '???'}</span>
          </div>
          {formData.coverImageUrl && (
            <div className="w-16 h-16 rounded-lg overflow-hidden border border-[var(--border)]">
              <img src={formData.coverImageUrl} alt="" className="w-full h-full object-cover" />
            </div>
          )}
        </div>
        <p className="text-sm text-[var(--text-secondary)] mb-3">{formData.description || 'No description'}</p>
        <div className="flex gap-3 text-xs font-mono text-[var(--text-muted)]">
          {formData.docsUrl && <span>docs ✓</span>}
          {formData.twitterUrl && <span>twitter ✓</span>}
        </div>
      </div>

      {/* Environmental Summary */}
      <div className="p-4 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border)]">
        <p className="text-xs font-mono text-[var(--text-muted)] mb-3">
          <span className="text-[var(--accent)] opacity-60">// </span>
          environmental_data
        </p>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <span className="text-[10px] font-mono text-[var(--text-muted)] block">location</span>
            <span className="text-[var(--text-primary)] font-mono">{env.latitude || '—'}, {env.longitude || '—'}</span>
          </div>
          <div>
            <span className="text-[10px] font-mono text-[var(--text-muted)] block">area</span>
            <span className="text-[var(--text-primary)] font-mono">{env.landAreaHectares || '—'} ha</span>
          </div>
          <div>
            <span className="text-[10px] font-mono text-[var(--text-muted)] block">type</span>
            <span className="text-[var(--text-primary)] font-mono">{env.projectType}</span>
          </div>
          <div>
            <span className="text-[10px] font-mono text-[var(--text-muted)] block">species</span>
            <span className="text-[var(--text-primary)] font-mono">{env.species.length} types, {totalTrees} total</span>
          </div>
          <div>
            <span className="text-[10px] font-mono text-[var(--text-muted)] block">NDVI</span>
            <span className="text-[var(--text-primary)] font-mono">{env.baselineNdvi} → {env.targetNdvi}</span>
          </div>
          <div>
            <span className="text-[10px] font-mono text-[var(--text-muted)] block">est. CO₂</span>
            <span className="text-[var(--text-primary)] font-mono">{(estCo2 / 1000).toFixed(1)} tCO₂/yr</span>
          </div>
        </div>
      </div>

      {/* Tokenomics Summary */}
      <div className="p-4 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border)]">
        <p className="text-xs font-mono text-[var(--text-muted)] mb-3">
          <span className="text-[var(--accent)] opacity-60">// </span>
          tokenomics
        </p>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <span className="text-[10px] font-mono text-[var(--text-muted)] block">supply</span>
            <span className="text-[var(--text-primary)] font-mono">{Number(formData.totalSupply).toLocaleString()}</span>
          </div>
          <div>
            <span className="text-[10px] font-mono text-[var(--text-muted)] block">fee</span>
            <span className="text-[var(--text-primary)] font-mono">{Number(formData.feeBps) / 100}%</span>
          </div>
          <div>
            <span className="text-[10px] font-mono text-[var(--text-muted)] block">deployer</span>
            <span className="text-[var(--text-primary)] font-mono">{Number(formData.deployerBps) / 100}%</span>
          </div>
          <div>
            <span className="text-[10px] font-mono text-[var(--text-muted)] block">pledge</span>
            <span className="text-[var(--text-primary)] font-mono">{Number(formData.pledgeAmount).toLocaleString()} $ROOT</span>
          </div>
        </div>
      </div>

      {/* CRE Workflow Preview */}
      <div className="p-4 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border)]">
        <p className="text-xs font-mono text-[var(--text-muted)] mb-3">
          <span className="text-[var(--accent)] opacity-60">// </span>
          cre_workflow_monitoring
        </p>
        <MilestoneTimeline milestones={milestones} compact />
      </div>

      <p className="text-xs font-mono text-[var(--text-muted)] text-center">
        // 7-day voting period • 1M $ROOT quorum • private votes
      </p>
    </motion.div>
  );
}
