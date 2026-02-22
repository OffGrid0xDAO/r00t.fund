import { motion } from 'framer-motion';

interface DataFeedPreviewProps {
  ndvi?: number;
  carbonScore?: number;
  fri?: number;
}

function getMetricColor(label: string, value: number): string {
  if (label === 'NDVI') {
    if (value < 0.2) return 'var(--error)';
    if (value < 0.4) return 'var(--warning)';
    return 'var(--success)';
  }
  if (label === 'FRI') {
    if (value < 30) return 'var(--error)';
    if (value < 60) return 'var(--warning)';
    return 'var(--success)';
  }
  // Carbon
  return 'var(--accent)';
}

export function DataFeedPreview({ ndvi, carbonScore, fri }: DataFeedPreviewProps) {
  const metrics = [
    { label: 'NDVI', value: ndvi, format: (v: number) => v.toFixed(2), unit: '' },
    { label: 'CO₂', value: carbonScore, format: (v: number) => `${v}`, unit: 'kg' },
    { label: 'FRI', value: fri, format: (v: number) => `${v}%`, unit: '' },
  ].filter(m => m.value !== undefined);

  if (metrics.length === 0) return null;

  return (
    <div className="flex gap-2">
      {metrics.map((m, idx) => (
        <motion.div
          key={m.label}
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: idx * 0.05 }}
          className="flex-1 px-2 py-1.5 rounded-md text-center"
          style={{
            background: `color-mix(in srgb, ${getMetricColor(m.label, m.value!)} 8%, transparent)`,
            border: `1px solid color-mix(in srgb, ${getMetricColor(m.label, m.value!)} 20%, transparent)`,
          }}
        >
          <div className="text-[9px] font-mono text-[var(--text-muted)] uppercase">{m.label}</div>
          <div
            className="text-sm font-mono font-bold"
            style={{ color: getMetricColor(m.label, m.value!) }}
          >
            {m.format(m.value!)}
            {m.unit && <span className="text-[9px] opacity-70 ml-0.5">{m.unit}</span>}
          </div>
        </motion.div>
      ))}
    </div>
  );
}
