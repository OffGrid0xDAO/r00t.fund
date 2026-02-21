/**
 * RootBackground - Animated SVG root/mycelium pattern
 *
 * Features subtle CSS animations:
 * - Root growth animation on page load
 * - Pulsing glow nodes
 * - Ambient drift for organic feel
 */

interface RootBackgroundProps {
  className?: string;
  opacity?: number;
}

export function RootBackground({ className = '', opacity = 0.15 }: RootBackgroundProps) {
  return (
    <div className={`absolute inset-0 pointer-events-none ${className}`}>
      {/* Animated SVG root pattern - bottom section */}
      <svg
        viewBox="0 0 1200 400"
        className="absolute bottom-0 left-0 w-full h-auto animate-ambient-drift"
        style={{ opacity, maxHeight: '50vh' }}
        preserveAspectRatio="xMidYMax slice"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          <linearGradient id="rootGradient1" x1="0%" y1="100%" x2="0%" y2="0%">
            <stop offset="0%" stopColor="var(--glow-primary)" stopOpacity="0.6" />
            <stop offset="100%" stopColor="var(--glow-primary)" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="rootGradient2" x1="0%" y1="100%" x2="0%" y2="0%">
            <stop offset="0%" stopColor="var(--glow-secondary)" stopOpacity="0.4" />
            <stop offset="100%" stopColor="var(--glow-secondary)" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="rootGradient3" x1="0%" y1="100%" x2="0%" y2="0%">
            <stop offset="0%" stopColor="var(--privacy-amber)" stopOpacity="0.3" />
            <stop offset="100%" stopColor="var(--privacy-amber)" stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* Main root systems - organic curves rising from bottom */}
        <g stroke="url(#rootGradient1)" strokeLinecap="round" className="stagger-children">
          {/* Left root cluster */}
          <path d="M 50 400 Q 60 350, 80 300 Q 100 250, 90 180" strokeWidth="3" className="animate-root-grow" style={{ animationDelay: '0s' }} />
          <path d="M 50 400 Q 70 360, 100 320 Q 130 280, 120 220 Q 110 160, 140 100" strokeWidth="2.5" className="animate-root-grow" style={{ animationDelay: '0.1s' }} />
          <path d="M 80 400 Q 90 350, 120 310 Q 150 270, 160 200" strokeWidth="2" className="animate-root-grow" style={{ animationDelay: '0.2s' }} />
          <path d="M 100 400 Q 130 340, 150 280 Q 170 220, 200 180 Q 230 140, 220 80" strokeWidth="2" className="animate-root-grow" style={{ animationDelay: '0.3s' }} />
          <path d="M 120 400 Q 140 360, 180 330 Q 220 300, 240 240" strokeWidth="1.5" className="animate-root-grow" style={{ animationDelay: '0.4s' }} />

          {/* Left-center roots */}
          <path d="M 250 400 Q 260 340, 280 280 Q 300 220, 290 140" strokeWidth="2.5" className="animate-root-grow" style={{ animationDelay: '0.15s' }} />
          <path d="M 280 400 Q 300 350, 320 290 Q 340 230, 360 180 Q 380 130, 370 60" strokeWidth="2" className="animate-root-grow" style={{ animationDelay: '0.25s' }} />
          <path d="M 320 400 Q 350 330, 380 270 Q 410 210, 420 130" strokeWidth="1.8" className="animate-root-grow" style={{ animationDelay: '0.35s' }} />
        </g>

        <g stroke="url(#rootGradient2)" strokeLinecap="round">
          {/* Center root cluster */}
          <path d="M 500 400 Q 510 330, 520 260 Q 530 190, 510 100" strokeWidth="3" className="animate-root-grow" style={{ animationDelay: '0.05s' }} />
          <path d="M 540 400 Q 560 340, 580 280 Q 600 220, 620 160 Q 640 100, 620 30" strokeWidth="2.5" className="animate-root-grow" style={{ animationDelay: '0.15s' }} />
          <path d="M 580 400 Q 600 350, 630 300 Q 660 250, 680 180" strokeWidth="2" className="animate-root-grow" style={{ animationDelay: '0.25s' }} />
          <path d="M 620 400 Q 650 340, 680 290 Q 710 240, 700 160 Q 690 80, 720 20" strokeWidth="2" className="animate-root-grow" style={{ animationDelay: '0.35s' }} />
          <path d="M 660 400 Q 680 360, 720 330 Q 760 300, 780 220" strokeWidth="1.5" className="animate-root-grow" style={{ animationDelay: '0.45s' }} />
        </g>

        <g stroke="url(#rootGradient1)" strokeLinecap="round">
          {/* Right-center roots */}
          <path d="M 800 400 Q 810 340, 830 280 Q 850 220, 840 140" strokeWidth="2.5" className="animate-root-grow" style={{ animationDelay: '0.1s' }} />
          <path d="M 840 400 Q 870 330, 900 270 Q 930 210, 920 130 Q 910 50, 940 0" strokeWidth="2" className="animate-root-grow" style={{ animationDelay: '0.2s' }} />
          <path d="M 880 400 Q 910 350, 940 300 Q 970 250, 1000 180" strokeWidth="1.8" className="animate-root-grow" style={{ animationDelay: '0.3s' }} />
        </g>

        <g stroke="url(#rootGradient3)" strokeLinecap="round">
          {/* Right root cluster */}
          <path d="M 1000 400 Q 1020 340, 1040 280 Q 1060 220, 1050 140" strokeWidth="2.5" className="animate-root-grow" style={{ animationDelay: '0.12s' }} />
          <path d="M 1040 400 Q 1060 350, 1080 290 Q 1100 230, 1120 180 Q 1140 130, 1130 60" strokeWidth="2" className="animate-root-grow" style={{ animationDelay: '0.22s' }} />
          <path d="M 1080 400 Q 1100 360, 1130 320 Q 1160 280, 1180 200" strokeWidth="1.8" className="animate-root-grow" style={{ animationDelay: '0.32s' }} />
          <path d="M 1120 400 Q 1140 350, 1160 300 Q 1180 250, 1200 200" strokeWidth="1.5" className="animate-root-grow" style={{ animationDelay: '0.42s' }} />
        </g>

        {/* Fine tendrils for detail */}
        <g stroke="var(--glow-primary)" strokeOpacity="0.3" strokeLinecap="round">
          <path d="M 70 400 Q 75 380, 65 360" strokeWidth="0.8" />
          <path d="M 130 350 Q 150 330, 145 300" strokeWidth="0.8" />
          <path d="M 200 320 Q 220 300, 210 270" strokeWidth="0.8" />
          <path d="M 350 290 Q 370 260, 360 230" strokeWidth="0.8" />
          <path d="M 550 280 Q 540 250, 560 220" strokeWidth="0.8" />
          <path d="M 700 250 Q 720 220, 710 190" strokeWidth="0.8" />
          <path d="M 900 260 Q 920 230, 910 200" strokeWidth="0.8" />
          <path d="M 1050 280 Q 1070 250, 1060 220" strokeWidth="0.8" />
        </g>

        {/* Glowing nodes at root intersections - pulsing */}
        <g fill="var(--glow-primary)">
          <circle cx="90" cy="300" r="3" className="animate-node-pulse" style={{ animationDelay: '0s' }} />
          <circle cx="150" cy="280" r="2.5" className="animate-node-pulse" style={{ animationDelay: '0.5s' }} />
          <circle cx="290" cy="280" r="3" className="animate-node-pulse" style={{ animationDelay: '1s' }} />
          <circle cx="520" cy="260" r="3.5" className="animate-node-pulse" style={{ animationDelay: '0.3s' }} />
          <circle cx="620" cy="280" r="2.5" className="animate-node-pulse" style={{ animationDelay: '0.8s' }} />
          <circle cx="840" cy="280" r="3" className="animate-node-pulse" style={{ animationDelay: '1.5s' }} />
          <circle cx="1040" cy="280" r="3" className="animate-node-pulse" style={{ animationDelay: '2s' }} />
        </g>
      </svg>

      {/* Gradient glow at bottom */}
      <div
        className="absolute bottom-0 left-0 right-0 h-48"
        style={{
          background: 'linear-gradient(to top, var(--glow-primary)08 0%, transparent 100%)',
        }}
      />
    </div>
  );
}

export default RootBackground;
