import { motion } from 'framer-motion';

interface SpeciesData {
  name: string;
  count: number;
  survivalRate: number;
}

interface SpeciesBreakdownProps {
  species: SpeciesData[];
}

const COLORS = [
  'var(--accent)',
  'var(--success)',
  'var(--glow-secondary)',
  'var(--warning)',
  '#8b5cf6',
  '#ec4899',
];

export function SpeciesBreakdown({ species }: SpeciesBreakdownProps) {
  if (species.length === 0) return null;

  const total = species.reduce((s, sp) => s + sp.count, 0);

  return (
    <div>
      {/* Stacked bar */}
      <div className="h-3 rounded-full overflow-hidden flex bg-[var(--bg-secondary)]">
        {species.map((sp, idx) => {
          const pct = (sp.count / total) * 100;
          return (
            <motion.div
              key={idx}
              initial={{ width: 0 }}
              animate={{ width: `${pct}%` }}
              transition={{ duration: 0.8, delay: idx * 0.05 }}
              className="h-full"
              style={{
                background: COLORS[idx % COLORS.length],
                opacity: 0.6 + (sp.survivalRate / 100) * 0.4,
              }}
              title={`${sp.name}: ${sp.count} (${sp.survivalRate}% survival)`}
            />
          );
        })}
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2">
        {species.map((sp, idx) => (
          <div key={idx} className="flex items-center gap-1 text-[9px] font-mono text-[var(--text-muted)]">
            <div
              className="w-2 h-2 rounded-sm"
              style={{ background: COLORS[idx % COLORS.length] }}
            />
            <span className="truncate max-w-[80px]">{sp.name}</span>
            <span className="text-[var(--text-primary)]">{sp.survivalRate}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}
