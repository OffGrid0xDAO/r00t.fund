import { motion } from 'framer-motion';

interface NdviMiniChartProps {
  values: number[];
  width?: number;
  height?: number;
}

export function NdviMiniChart({ values, width = 140, height = 40 }: NdviMiniChartProps) {
  if (values.length < 2) return null;

  const minVal = Math.min(...values);
  const maxVal = Math.max(...values);
  const range = maxVal - minVal || 1;
  const padding = 2;

  const points = values.map((v, i) => {
    const x = padding + (i / (values.length - 1)) * (width - padding * 2);
    const y = height - padding - ((v - minVal) / range) * (height - padding * 2);
    return `${x},${y}`;
  }).join(' ');

  // Fill area
  const firstX = padding;
  const lastX = padding + ((values.length - 1) / (values.length - 1)) * (width - padding * 2);
  const fillPath = `M${firstX},${height} L${points.split(' ').map(p => p).join(' L')} L${lastX},${height} Z`;

  // Determine color from trend
  const lastVal = values[values.length - 1];
  const firstVal = values[0];
  const trending = lastVal >= firstVal;
  const color = trending ? 'var(--success)' : 'var(--error)';

  return (
    <div className="relative">
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
        {/* Gradient fill */}
        <defs>
          <linearGradient id="ndvi-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.2" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        <motion.path
          d={fillPath}
          fill="url(#ndvi-fill)"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.5 }}
        />
        <motion.polyline
          points={points}
          fill="none"
          stroke={color}
          strokeWidth={1.5}
          strokeLinecap="round"
          strokeLinejoin="round"
          initial={{ pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ duration: 1, ease: 'easeOut' }}
        />
        {/* Latest value dot */}
        <motion.circle
          cx={lastX}
          cy={height - padding - ((lastVal - minVal) / range) * (height - padding * 2)}
          r={2.5}
          fill={color}
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ delay: 0.8 }}
        />
      </svg>
      <div className="flex justify-between text-[8px] font-mono text-[var(--text-muted)] mt-0.5">
        <span>{firstVal.toFixed(2)}</span>
        <span style={{ color }}>{lastVal.toFixed(2)}</span>
      </div>
    </div>
  );
}
