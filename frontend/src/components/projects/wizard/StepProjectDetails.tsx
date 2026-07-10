import { motion } from 'framer-motion';
import type { WizardFormData } from '../types';

interface StepProjectDetailsProps {
  formData: WizardFormData;
  onUpdateField: (field: string, value: string) => void;
  errors: string[];
}

export function StepProjectDetails({ formData, onUpdateField, errors }: StepProjectDetailsProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-4"
    >
      {errors.length > 0 && (
        <div className="p-3 rounded-lg text-xs space-y-1"
          style={{ background: 'rgba(var(--error-rgb), 0.1)', color: 'var(--error)', border: '1px solid rgba(var(--error-rgb), 0.2)' }}>
          {errors.map((e, i) => <p key={i}>{e}</p>)}
        </div>
      )}

      {/* Name */}
      <div>
        <p className="text-xs font-mono text-[var(--text-muted)] mb-1.5">
          <span className="text-[var(--accent)] opacity-60">// </span>
          project_name *
        </p>
        <input
          type="text"
          value={formData.name}
          onChange={(e) => onUpdateField('name', e.target.value)}
          placeholder="e.g., Native Forest Restoration"
          className="w-full px-4 py-3 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--border-focus)] focus:outline-none transition-colors"
        />
      </div>

      {/* Symbol */}
      <div>
        <p className="text-xs font-mono text-[var(--text-muted)] mb-1.5">
          <span className="text-[var(--accent)] opacity-60">// </span>
          symbol *
        </p>
        <input
          type="text"
          value={formData.symbol}
          onChange={(e) => onUpdateField('symbol', e.target.value.toUpperCase())}
          placeholder="e.g., ROOT"
          maxLength={10}
          className="w-full px-4 py-3 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--border-focus)] focus:outline-none transition-colors font-mono"
        />
      </div>

      {/* Description */}
      <div>
        <p className="text-xs font-mono text-[var(--text-muted)] mb-1.5">
          <span className="text-[var(--accent)] opacity-60">// </span>
          description *
        </p>
        <textarea
          value={formData.description}
          onChange={(e) => onUpdateField('description', e.target.value)}
          placeholder="Describe your ReFi/RWA regeneration project..."
          rows={3}
          className="w-full px-4 py-3 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--border-focus)] focus:outline-none transition-colors resize-none"
        />
      </div>

      {/* URLs */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <p className="text-xs font-mono text-[var(--text-muted)] mb-1.5">
            <span className="text-[var(--accent)] opacity-60">// </span>
            docs_url
          </p>
          <input
            type="url"
            value={formData.docsUrl}
            onChange={(e) => onUpdateField('docsUrl', e.target.value)}
            placeholder="https://docs.example.com"
            className="w-full px-4 py-3 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--border-focus)] focus:outline-none transition-colors text-sm"
          />
        </div>
        <div>
          <p className="text-xs font-mono text-[var(--text-muted)] mb-1.5">
            <span className="text-[var(--accent)] opacity-60">// </span>
            twitter_url
          </p>
          <input
            type="url"
            value={formData.twitterUrl}
            onChange={(e) => onUpdateField('twitterUrl', e.target.value)}
            placeholder="https://x.com/project"
            className="w-full px-4 py-3 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--border-focus)] focus:outline-none transition-colors text-sm"
          />
        </div>
      </div>

      {/* Cover Image URL */}
      <div>
        <p className="text-xs font-mono text-[var(--text-muted)] mb-1.5">
          <span className="text-[var(--accent)] opacity-60">// </span>
          cover_image_url
        </p>
        <input
          type="url"
          value={formData.coverImageUrl}
          onChange={(e) => onUpdateField('coverImageUrl', e.target.value)}
          placeholder="https://example.com/cover.jpg"
          className="w-full px-4 py-3 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--border-focus)] focus:outline-none transition-colors text-sm"
        />
        {formData.coverImageUrl && (
          <div className="mt-2 rounded-lg overflow-hidden border border-[var(--border)] h-32">
            <img
              src={formData.coverImageUrl}
              alt="Cover preview"
              className="w-full h-full object-cover"
              onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
            />
          </div>
        )}
      </div>
    </motion.div>
  );
}
