import { useMemo, memo } from 'react';
import { motion } from 'framer-motion';

// Color palettes moved outside component to prevent recreation
const COLOR_PALETTES = {
  primary: ['var(--glow-primary)'],
  secondary: ['var(--glow-secondary)'],
  mixed: ['var(--glow-primary)', 'var(--glow-secondary)', 'var(--privacy-amber)'],
} as const;

// Density configs moved outside component
const DENSITY_CONFIGS = {
  sparse: { mainRoots: 4, maxDepth: 4, tendrils: 15 },
  normal: { mainRoots: 6, maxDepth: 5, tendrils: 25 },
  dense: { mainRoots: 9, maxDepth: 6, tendrils: 40 },
} as const;

interface RootNetworkProps {
  className?: string;
  density?: 'sparse' | 'normal' | 'dense';
  animated?: boolean;
  glowIntensity?: number;
  color?: 'primary' | 'secondary' | 'mixed';
}

interface RootPath {
  id: string;
  d: string;
  thickness: number;
  delay: number;
  color: string;
  opacity: number;
}

// Seeded random for consistent patterns
function seededRandom(seed: number) {
  const x = Math.sin(seed++) * 10000;
  return x - Math.floor(x);
}

// Generate a curved path that looks like an organic root
function generateRootPath(
  startX: number,
  startY: number,
  angle: number,
  length: number,
  seed: number
): { endX: number; endY: number; path: string } {
  // Add some curve to the root
  const curve1 = (seededRandom(seed + 1) - 0.5) * length * 0.4;
  const curve2 = (seededRandom(seed + 2) - 0.5) * length * 0.3;

  const midX = startX + Math.cos(angle) * length * 0.5 + Math.cos(angle + Math.PI/2) * curve1;
  const midY = startY + Math.sin(angle) * length * 0.5 + Math.sin(angle + Math.PI/2) * curve1;

  const endX = startX + Math.cos(angle) * length + Math.cos(angle + Math.PI/2) * curve2;
  const endY = startY + Math.sin(angle) * length + Math.sin(angle + Math.PI/2) * curve2;

  // Quadratic bezier curve for organic shape
  const path = `M ${startX} ${startY} Q ${midX} ${midY} ${endX} ${endY}`;

  return { endX, endY, path };
}

// Generate a full root system with branches
function generateRootSystem(
  startX: number,
  startY: number,
  baseAngle: number,
  baseLength: number,
  baseThickness: number,
  maxDepth: number,
  seed: number,
  color: string,
  paths: RootPath[],
  depth: number = 0,
  delay: number = 0
) {
  if (depth > maxDepth || baseLength < 3) return;

  const { endX, endY, path } = generateRootPath(startX, startY, baseAngle, baseLength, seed);

  // Thickness tapers as depth increases
  const thickness = Math.max(0.3, baseThickness * Math.pow(0.65, depth));
  const opacity = Math.max(0.2, 0.9 - depth * 0.12);

  paths.push({
    id: `root-${seed}-${depth}-${paths.length}`,
    d: path,
    thickness,
    delay: delay + depth * 0.08,
    color,
    opacity,
  });

  // Generate child branches
  const numBranches = depth === 0
    ? Math.floor(seededRandom(seed + 10) * 3) + 3  // More branches from main root
    : Math.floor(seededRandom(seed + 10) * 2) + 1;

  for (let i = 0; i < numBranches; i++) {
    // Branch point along the current segment
    const branchT = 0.3 + seededRandom(seed + i * 100 + 20) * 0.6;
    const branchX = startX + (endX - startX) * branchT;
    const branchY = startY + (endY - startY) * branchT;

    // Branch angle spreads out from main direction
    const spread = depth === 0 ? 0.8 : 1.2;
    const branchAngle = baseAngle + (seededRandom(seed + i * 100 + 30) - 0.5) * spread;

    // Branch length gets shorter
    const branchLength = baseLength * (0.4 + seededRandom(seed + i * 100 + 40) * 0.35);

    generateRootSystem(
      branchX,
      branchY,
      branchAngle,
      branchLength,
      baseThickness,
      maxDepth,
      seed + i * 1000 + depth * 100,
      color,
      paths,
      depth + 1,
      delay + i * 0.05
    );
  }

  // Continue the main root
  if (depth < maxDepth - 1 && seededRandom(seed + 50) > 0.3) {
    const continueAngle = baseAngle + (seededRandom(seed + 60) - 0.5) * 0.4;
    const continueLength = baseLength * (0.6 + seededRandom(seed + 70) * 0.25);

    generateRootSystem(
      endX,
      endY,
      continueAngle,
      continueLength,
      baseThickness,
      maxDepth,
      seed + 5000,
      color,
      paths,
      depth + 1,
      delay + 0.1
    );
  }
}

// Fine tendril roots for detail
function generateTendrils(
  centerX: number,
  centerY: number,
  count: number,
  seed: number,
  color: string
): RootPath[] {
  const tendrils: RootPath[] = [];

  for (let i = 0; i < count; i++) {
    const angle = -Math.PI/2 + (seededRandom(seed + i * 10) - 0.5) * 1.5;
    const length = 8 + seededRandom(seed + i * 20) * 20;
    const startX = centerX + (seededRandom(seed + i * 30) - 0.5) * 30;
    const startY = centerY;

    const { path } = generateRootPath(startX, startY, angle, length, seed + i * 100);

    tendrils.push({
      id: `tendril-${seed}-${i}`,
      d: path,
      thickness: 0.3 + seededRandom(seed + i * 40) * 0.4,
      delay: seededRandom(seed + i * 50) * 2,
      color,
      opacity: 0.3 + seededRandom(seed + i * 60) * 0.3,
    });
  }

  return tendrils;
}

// Animated root path component
function RootPathElement({ path, animated }: { path: RootPath; animated: boolean }) {
  return (
    <motion.path
      d={path.d}
      stroke={path.color}
      strokeWidth={path.thickness}
      strokeLinecap="round"
      fill="none"
      opacity={path.opacity}
      initial={animated ? { pathLength: 0, opacity: 0 } : { pathLength: 1 }}
      animate={{ pathLength: 1, opacity: path.opacity }}
      transition={{
        pathLength: { duration: 2, delay: path.delay, ease: 'easeOut' },
        opacity: { duration: 0.8, delay: path.delay },
      }}
      style={{
        filter: `drop-shadow(0 0 ${path.thickness * 3}px ${path.color})`,
      }}
    />
  );
}

// Glowing node/bulb at root intersections
function RootNode({ x, y, size, delay, color }: { x: number; y: number; size: number; delay: number; color: string }) {
  return (
    <motion.circle
      cx={x}
      cy={y}
      r={size}
      fill={color}
      initial={{ scale: 0, opacity: 0 }}
      animate={{ scale: 1, opacity: 0.6 }}
      transition={{
        duration: 0.5,
        delay,
        ease: 'easeOut',
      }}
      style={{
        filter: `blur(${size * 0.5}px) drop-shadow(0 0 ${size * 2}px ${color})`,
      }}
    />
  );
}

// Floating spore/particle
function Spore({ x, y, size, delay, color }: { x: number; y: number; size: number; delay: number; color: string }) {
  return (
    <motion.circle
      cx={x}
      cy={y}
      r={size}
      fill={color}
      initial={{ opacity: 0, y }}
      animate={{
        opacity: [0, 0.8, 0],
        y: [y, y - 15, y - 30],
        x: [x, x + (Math.random() - 0.5) * 10, x + (Math.random() - 0.5) * 20],
      }}
      transition={{
        duration: 6,
        delay,
        repeat: Infinity,
        repeatDelay: 3,
        ease: 'easeOut',
      }}
      style={{
        filter: `blur(${size * 0.3}px)`,
      }}
    />
  );
}

// Memoized RootNetwork component to prevent unnecessary re-renders
export const RootNetwork = memo(function RootNetwork({
  className = '',
  density = 'normal',
  animated = true,
  glowIntensity = 1,
  color = 'primary',
}: RootNetworkProps) {
  // Use external constants - stable references
  const config = DENSITY_CONFIGS[density];
  const colorPalette = COLOR_PALETTES[color];

  // Generate all root paths
  const { rootPaths, nodes, tendrils, spores } = useMemo(() => {
    const paths: RootPath[] = [];
    const nodeList: { x: number; y: number; size: number; delay: number; color: string }[] = [];

    // Main roots from bottom
    const rootOrigins = [
      { x: 10, y: 100 },   // Left
      { x: 25, y: 100 },   // Left-center
      { x: 50, y: 100 },   // Center
      { x: 75, y: 100 },   // Right-center
      { x: 90, y: 100 },   // Right
      { x: 5, y: 95 },     // Far left
      { x: 95, y: 95 },    // Far right
      { x: 35, y: 100 },   // Between
      { x: 65, y: 100 },   // Between
    ];

    for (let i = 0; i < Math.min(config.mainRoots, rootOrigins.length); i++) {
      const origin = rootOrigins[i];
      const rootColor = colorPalette[i % colorPalette.length];

      // Main angle points upward with some variation
      const baseAngle = -Math.PI / 2 + (seededRandom(i * 123) - 0.5) * 0.6;
      const baseLength = 25 + seededRandom(i * 456) * 35;
      const baseThickness = 1.5 + seededRandom(i * 789) * 1.5;

      generateRootSystem(
        origin.x,
        origin.y,
        baseAngle,
        baseLength,
        baseThickness,
        config.maxDepth,
        i * 10000,
        rootColor,
        paths,
        0,
        i * 0.15
      );

      // Add a glowing node at root origin
      nodeList.push({
        x: origin.x,
        y: origin.y,
        size: 1 + seededRandom(i * 111) * 1.5,
        delay: i * 0.1,
        color: rootColor,
      });
    }

    // Generate fine tendrils
    const tendrilPaths = generateTendrils(50, 100, config.tendrils, 99999, colorPalette[0]);

    // Generate floating spores
    const sporeList = Array.from({ length: 20 }, (_, i) => ({
      x: 10 + seededRandom(i * 333) * 80,
      y: 30 + seededRandom(i * 444) * 60,
      size: 0.5 + seededRandom(i * 555) * 1,
      delay: seededRandom(i * 666) * 8,
      color: colorPalette[i % colorPalette.length],
    }));

    return {
      rootPaths: paths,
      nodes: nodeList,
      tendrils: tendrilPaths,
      spores: sporeList,
    };
  }, [config.mainRoots, config.maxDepth, config.tendrils, colorPalette]);

  return (
    <div className={`absolute inset-0 overflow-hidden pointer-events-none ${className}`}>
      <svg
        viewBox="0 0 100 100"
        preserveAspectRatio="xMidYMax slice"
        className="w-full h-full"
        style={{
          opacity: glowIntensity * 0.7,
        }}
      >
        <defs>
          {/* Glow filter */}
          <filter id="rootGlow" x="-100%" y="-100%" width="300%" height="300%">
            <feGaussianBlur stdDeviation="1.5" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>

          {/* Stronger glow for main roots */}
          <filter id="strongGlow" x="-100%" y="-100%" width="300%" height="300%">
            <feGaussianBlur stdDeviation="3" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* Background tendrils (fine detail) */}
        <g filter="url(#rootGlow)" opacity={0.4}>
          {tendrils.map((path) => (
            <RootPathElement key={path.id} path={path} animated={animated} />
          ))}
        </g>

        {/* Main root system */}
        <g filter="url(#strongGlow)">
          {rootPaths.map((path) => (
            <RootPathElement key={path.id} path={path} animated={animated} />
          ))}
        </g>

        {/* Root nodes (glowing bulbs) */}
        {nodes.map((node, i) => (
          <RootNode key={`node-${i}`} {...node} />
        ))}

        {/* Floating spores */}
        {animated &&
          spores.map((spore, i) => (
            <Spore key={`spore-${i}`} {...spore} />
          ))}
      </svg>
    </div>
  );
});

// Simpler accent version for smaller areas
export function RootAccent({ className = '' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 100 30"
      className={`w-full h-auto ${className}`}
      preserveAspectRatio="xMidYMid meet"
    >
      <defs>
        <linearGradient id="rootAccentGradient" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="var(--glow-primary)" stopOpacity="0" />
          <stop offset="30%" stopColor="var(--glow-primary)" stopOpacity="0.8" />
          <stop offset="70%" stopColor="var(--glow-primary)" stopOpacity="0.8" />
          <stop offset="100%" stopColor="var(--glow-primary)" stopOpacity="0" />
        </linearGradient>
        <filter id="accentGlow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="1" />
        </filter>
      </defs>

      {/* Main curved root */}
      <motion.path
        d="M 0 25 Q 15 20, 30 22 T 50 18 T 70 22 T 100 25"
        stroke="url(#rootAccentGradient)"
        strokeWidth="1.5"
        fill="none"
        filter="url(#accentGlow)"
        initial={{ pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{ duration: 2, ease: 'easeOut' }}
      />

      {/* Small branch */}
      <motion.path
        d="M 35 21 Q 40 15, 45 12"
        stroke="var(--glow-primary)"
        strokeWidth="0.8"
        strokeOpacity="0.6"
        fill="none"
        filter="url(#accentGlow)"
        initial={{ pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{ duration: 1.5, delay: 0.5, ease: 'easeOut' }}
      />

      {/* Another small branch */}
      <motion.path
        d="M 65 21 Q 70 14, 68 8"
        stroke="var(--glow-primary)"
        strokeWidth="0.8"
        strokeOpacity="0.6"
        fill="none"
        filter="url(#accentGlow)"
        initial={{ pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{ duration: 1.5, delay: 0.7, ease: 'easeOut' }}
      />
    </svg>
  );
}

export default RootNetwork;
