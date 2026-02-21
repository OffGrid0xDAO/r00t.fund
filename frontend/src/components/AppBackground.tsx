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

      {/* Root network SVG - primary color (green) - flipped vertically */}
      <div
        className="absolute inset-0 root-layer-green"
        style={{
          backgroundImage: 'url(/roots.svg)',
          backgroundPosition: 'center top',
          backgroundRepeat: 'no-repeat',
          backgroundSize: '100vw auto',
          transform: 'scaleY(-1)',
        }}
      />

      {/* Root network SVG - secondary color (gold) - flipped vertically */}
      <div
        className="absolute inset-0 root-layer-gold"
        style={{
          backgroundImage: 'url(/roots.svg)',
          backgroundPosition: 'center top',
          backgroundRepeat: 'no-repeat',
          backgroundSize: '100vw auto',
          transform: 'scaleY(-1)',
        }}
      />

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
        .root-layer-green {
          opacity: 0.10;
          filter: brightness(0) saturate(100%) invert(28%) sepia(46%) saturate(545%) hue-rotate(95deg) brightness(96%) contrast(89%);
          animation: pulse-green 9s ease-in-out infinite;
        }

        .root-layer-gold {
          opacity: 0;
          filter: brightness(0) saturate(100%) invert(63%) sepia(35%) saturate(639%) hue-rotate(11deg) brightness(101%) contrast(89%);
          animation: pulse-gold 9s ease-in-out infinite;
        }

        .dark .root-layer-green {
          opacity: 0.08;
          filter: brightness(0) saturate(100%) invert(53%) sepia(36%) saturate(456%) hue-rotate(95deg) brightness(97%) contrast(89%);
        }

        .dark .root-layer-gold {
          filter: brightness(0) saturate(100%) invert(72%) sepia(50%) saturate(400%) hue-rotate(11deg) brightness(100%) contrast(90%);
        }

        /* Subtle breathing effect for roots */
        @keyframes pulse-green {
          0%, 100% { opacity: 0.10; }
          50% { opacity: 0.14; }
        }

        @keyframes pulse-gold {
          0%, 100% { opacity: 0; }
          50% { opacity: 0.04; }
        }

        .dark .root-layer-green {
          animation: pulse-green-dark 9s ease-in-out infinite;
        }

        .dark .root-layer-gold {
          animation: pulse-gold-dark 9s ease-in-out infinite;
        }

        @keyframes pulse-green-dark {
          0%, 100% { opacity: 0.08; }
          50% { opacity: 0.12; }
        }

        @keyframes pulse-gold-dark {
          0%, 100% { opacity: 0; }
          50% { opacity: 0.03; }
        }

        /* Moving gradient shimmer */
        .gradient-shimmer {
          background: linear-gradient(
            120deg,
            transparent 0%,
            transparent 40%,
            rgba(45, 90, 61, 0.04) 50%,
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
            rgba(74, 139, 92, 0.05) 50%,
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
