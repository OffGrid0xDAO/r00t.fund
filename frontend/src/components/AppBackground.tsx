/**
 * AppBackground - Root network SVG with animated color
 * Uses the detailed roots.svg with color-shifting animation and moving gradient
 */

export function AppBackground() {
  return (
    <div className="fixed inset-0 pointer-events-none overflow-hidden">
      {/* Subtle gradient base */}
      <div
        className="absolute inset-0"
        style={{
          background: 'linear-gradient(180deg, var(--bg-primary) 0%, var(--bg-secondary) 100%)',
        }}
      />

      {/* Root network SVG — masked so it takes the exact accent (lime) color */}
      <div className="absolute inset-0 root-layer-green" style={{ transform: 'scaleY(-1)' }} />

      {/* Second root layer — warm secondary tint for depth */}
      <div className="absolute inset-0 root-layer-gold" style={{ transform: 'scaleY(-1)' }} />

      {/* Moving gradient overlay for subtle shimmer effect */}
      <div className="absolute inset-0 gradient-shimmer" />

      {/* Center fade for hero text readability */}
      <div
        className="absolute inset-0"
        style={{
          background: 'radial-gradient(ellipse 75% 50% at 50% 35%, var(--bg-primary) 0%, transparent 70%)',
        }}
      />

      {/* CSS for subtle pulsating root animation */}
      <style>{`
        /* roots.svg used as a mask so the fill is the EXACT accent (lime) */
        .root-layer-green {
          background-color: var(--accent-on-bg);
          -webkit-mask: url(/roots.svg) center top / 100vw auto no-repeat;
          mask: url(/roots.svg) center top / 100vw auto no-repeat;
          opacity: 0.16;
          animation: pulse-green 9s ease-in-out infinite;
        }

        .root-layer-gold {
          background-color: var(--accent-secondary);
          -webkit-mask: url(/roots.svg) center top / 100vw auto no-repeat;
          mask: url(/roots.svg) center top / 100vw auto no-repeat;
          opacity: 0.05;
          animation: pulse-gold 9s ease-in-out infinite;
        }

        .dark .root-layer-green { opacity: 0.16; animation: pulse-green-dark 9s ease-in-out infinite; }
        .dark .root-layer-gold  { opacity: 0.05; }

        @keyframes pulse-green { 0%, 100% { opacity: 0.12; } 50% { opacity: 0.18; } }
        @keyframes pulse-gold  { 0%, 100% { opacity: 0.03; } 50% { opacity: 0.07; } }
        @keyframes pulse-green-dark { 0%, 100% { opacity: 0.14; } 50% { opacity: 0.22; } }

        /* Moving gradient shimmer */
        .gradient-shimmer {
          background: linear-gradient(
            120deg,
            transparent 0%,
            transparent 40%,
            rgba(214, 254, 81, 0.05) 50%,
            transparent 60%,
            transparent 100%
          );
          background-size: 200% 200%;
          animation: shimmer-move 10s ease-in-out infinite;
          mix-blend-mode: overlay;
        }

        .dark .gradient-shimmer {
          background: linear-gradient(
            120deg,
            transparent 0%,
            transparent 40%,
            rgba(214, 254, 81, 0.06) 50%,
            transparent 60%,
            transparent 100%
          );
          background-size: 200% 200%;
        }

        @keyframes shimmer-move {
          0% {
            background-position: 200% 0%;
          }
          50% {
            background-position: 0% 100%;
          }
          100% {
            background-position: 200% 0%;
          }
        }
      `}</style>

      {/* Top fade where roots emerge from */}
      <div
        className="absolute top-0 left-0 right-0 h-32"
        style={{
          background: 'linear-gradient(to bottom, var(--bg-primary) 0%, transparent 100%)',
        }}
      />

      {/* Bottom fade for content visibility */}
      <div
        className="absolute bottom-0 left-0 right-0 h-48"
        style={{
          background: 'linear-gradient(to top, var(--bg-primary) 0%, transparent 100%)',
        }}
      />
    </div>
  );
}

export default AppBackground;
