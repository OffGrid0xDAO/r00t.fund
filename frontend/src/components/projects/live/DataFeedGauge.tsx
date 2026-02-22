import { motion } from 'framer-motion';

interface DataFeedGaugeProps {
  label: string;
  value: number;
  max: number;
  unit?: string;
  color?: string;
  size?: number;
}

export function DataFeedGauge({ label, value, max, unit = '', color, size = 72 }: DataFeedGaugeProps) {
  const pct = Math.min(value / max, 1);
  const radius = (size - 8) / 2;
  const circumference = 2 * Math.PI * radius;
  // 270 deg arc
  const arcLength = circumference * 0.75;
  const strokeDashoffset = arcLength * (1 - pct);

  const autoColor = color || (pct < 0.3 ? 'var(--error)' : pct < 0.6 ? 'var(--warning)' : 'var(--success)');

  return (
    <div className="flex flex-col items-center">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        {/* Background arc */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="var(--border)"
          strokeWidth={4}
          strokeDasharray={`${arcLength} ${circumference - arcLength}`}
          strokeDashoffset={0}
          strokeLinecap="round"
          transform={`rotate(135 ${size / 2} ${size / 2})`}
        />
        {/* Value arc */}
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={autoColor}
          strokeWidth={4}
          strokeDasharray={`${arcLength} ${circumference - arcLength}`}
          initial={{ strokeDashoffset: arcLength }}
          animate={{ strokeDashoffset }}
          transition={{ duration: 1, ease: 'easeOut' }}
          strokeLinecap="round"
          transform={`rotate(135 ${size / 2} ${size / 2})`}
        />
        {/* Value text */}
        <text
          x={size / 2}
          y={size / 2 - 2}
          textAnchor="middle"
          dominantBaseline="middle"
          className="font-mono font-bold"
          style={{ fill: autoColor, fontSize: size * 0.2 }}
        >
          {typeof value === 'number' ? (value < 1 ? value.toFixed(2) : value.toLocaleString()) : value}
        </text>
        <text
          x={size / 2}
          y={size / 2 + size * 0.14}
          textAnchor="middle"
          dominantBaseline="middle"
          style={{ fill: 'var(--text-muted)', fontSize: size * 0.11 }}
          className="font-mono"
        >
          {unit}
        </text>
      </svg>
      <span className="text-[9px] font-mono text-[var(--text-muted)] mt-0.5 uppercase">{label}</span>
    </div>
  );
}
