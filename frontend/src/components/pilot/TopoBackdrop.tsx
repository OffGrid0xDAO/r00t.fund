/**
 * TopoBackdrop — decorative contour-line backdrop (the "cinematic" topography). Loads the fuzzed
 * /terrain/contours.json and draws the medium+major elevation lines as faint strokes, masked to fade
 * in from the right so it sits behind a hero's copy. Purely ornamental + pointer-events-none.
 */
import { useEffect, useState } from 'react';

export function TopoBackdrop({ className = '', color = '#D6FE51', max = 600 }: { className?: string; color?: string; max?: number }) {
  const [paths, setPaths] = useState<string[]>([]);

  useEffect(() => {
    let alive = true;
    fetch('/terrain/contours.json')
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { contours?: { l: string; p: number[][] }[] } | null) => {
        if (!alive || !d?.contours) return;
        const S = 1000;
        const lines = d.contours
          .filter((c) => c.l !== 'minor') // keep the readable lines; drop the densest for a lighter DOM
          .slice(0, max)
          .map((c) => c.p.map((p, i) => `${i ? 'L' : 'M'}${(p[0] * S).toFixed(1)} ${(p[1] * S).toFixed(1)}`).join(' '));
        setPaths(lines);
      })
      .catch(() => {});
    return () => { alive = false; };
  }, [max]);

  if (!paths.length) return null;
  return (
    <svg viewBox="0 0 1000 1000" preserveAspectRatio="xMidYMid slice" aria-hidden
      className={`pointer-events-none absolute inset-0 w-full h-full ${className}`}
      style={{ WebkitMaskImage: 'linear-gradient(to right, transparent 8%, rgba(0,0,0,0.6) 55%, black 100%)', maskImage: 'linear-gradient(to right, transparent 8%, rgba(0,0,0,0.6) 55%, black 100%)' }}>
      <g fill="none" stroke={color} strokeOpacity={0.16} strokeWidth={0.7} strokeLinejoin="round">
        {paths.map((d, i) => <path key={i} d={d} />)}
      </g>
    </svg>
  );
}

export default TopoBackdrop;
