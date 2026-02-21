import { useEffect, useRef } from 'react';
import { motion } from 'framer-motion';

interface ValueFlowProps {
  width?: number;
  height?: number;
  className?: string;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  phase: 'dark' | 'transition' | 'light';
}

export function ValueFlow({ width = 400, height = 400, className = '' }: ValueFlowProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const particlesRef = useRef<Particle[]>([]);
  const animationRef = useRef<number>();

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.scale(dpr, dpr);

    const centerY = height / 2;

    // Create initial particles
    const createParticle = (): Particle => {
      // Start from left side (dark/extraction zone)
      const startX = -20 + Math.random() * 60;
      const startY = centerY + (Math.random() - 0.5) * height * 0.6;

      return {
        x: startX,
        y: startY,
        vx: 0.8 + Math.random() * 0.6,
        vy: (Math.random() - 0.5) * 0.3,
        life: 0,
        maxLife: 200 + Math.random() * 100,
        size: 2 + Math.random() * 2,
        phase: 'dark',
      };
    };

    // Initialize particles
    for (let i = 0; i < 60; i++) {
      const p = createParticle();
      p.x = Math.random() * width;
      p.life = Math.random() * p.maxLife;
      particlesRef.current.push(p);
    }

    const getColors = () => {
      const isDark = document.documentElement.classList.contains('dark');
      return {
        dark: isDark ? 'rgba(108, 108, 104, 0.8)' : 'rgba(92, 92, 88, 0.6)',
        transition: isDark ? 'rgba(212, 168, 75, 0.7)' : 'rgba(184, 134, 11, 0.6)',
        light: isDark ? 'rgba(74, 139, 92, 0.8)' : 'rgba(45, 90, 61, 0.7)',
        glow: isDark ? 'rgba(74, 139, 92, 0.15)' : 'rgba(45, 90, 61, 0.1)',
      };
    };

    const draw = () => {
      ctx.clearRect(0, 0, width, height);

      const colors = getColors();
      const particles = particlesRef.current;

      // Draw flow paths (subtle curves)
      ctx.strokeStyle = colors.glow;
      ctx.lineWidth = 40;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(0, centerY);
      ctx.bezierCurveTo(
        width * 0.3, centerY - 50,
        width * 0.7, centerY + 50,
        width, centerY
      );
      ctx.stroke();

      // Update and draw particles
      particles.forEach((p, index) => {
        // Update position with slight wave motion
        p.x += p.vx;
        p.y += p.vy + Math.sin(p.life * 0.02) * 0.3;
        p.life++;

        // Determine phase based on x position
        const progress = p.x / width;
        if (progress < 0.35) {
          p.phase = 'dark';
        } else if (progress < 0.65) {
          p.phase = 'transition';
        } else {
          p.phase = 'light';
        }

        // Get color based on phase with smooth transition
        let color: string;
        let size = p.size;

        if (progress < 0.35) {
          // Dark phase - angular, sharp
          color = colors.dark;
        } else if (progress < 0.5) {
          // Transition to gold
          const t = (progress - 0.35) / 0.15;
          color = colors.transition;
          size = p.size * (1 + t * 0.5);
        } else if (progress < 0.65) {
          // Gold to green transition
          color = colors.transition;
          size = p.size * 1.5;
        } else {
          // Light phase - organic, growing
          color = colors.light;
          size = p.size * (1.5 + (progress - 0.65) * 2);
        }

        // Draw particle
        ctx.beginPath();

        if (p.phase === 'dark') {
          // Angular shape for dark phase
          ctx.rect(p.x - size/2, p.y - size/2, size, size);
        } else if (p.phase === 'light') {
          // Organic blob for light phase
          ctx.ellipse(p.x, p.y, size * 1.2, size * 0.8, Math.sin(p.life * 0.05), 0, Math.PI * 2);
        } else {
          // Circle for transition
          ctx.arc(p.x, p.y, size, 0, Math.PI * 2);
        }

        ctx.fillStyle = color;
        ctx.fill();

        // Add glow in light phase
        if (p.phase === 'light' && Math.random() > 0.95) {
          ctx.beginPath();
          ctx.arc(p.x, p.y, size * 3, 0, Math.PI * 2);
          ctx.fillStyle = colors.glow;
          ctx.fill();
        }

        // Reset particle if it goes off screen or dies
        if (p.x > width + 20 || p.life > p.maxLife) {
          particles[index] = createParticle();
        }
      });

      // Draw subtle connection lines between nearby particles in transition zone
      ctx.strokeStyle = colors.glow;
      ctx.lineWidth = 0.5;

      for (let i = 0; i < particles.length; i++) {
        for (let j = i + 1; j < particles.length; j++) {
          const p1 = particles[i];
          const p2 = particles[j];

          // Only connect particles in the middle transition zone
          if (p1.x > width * 0.3 && p1.x < width * 0.7 &&
              p2.x > width * 0.3 && p2.x < width * 0.7) {
            const dx = p1.x - p2.x;
            const dy = p1.y - p2.y;
            const dist = Math.sqrt(dx * dx + dy * dy);

            if (dist < 50) {
              ctx.beginPath();
              ctx.moveTo(p1.x, p1.y);
              ctx.lineTo(p2.x, p2.y);
              ctx.globalAlpha = (1 - dist / 50) * 0.3;
              ctx.stroke();
              ctx.globalAlpha = 1;
            }
          }
        }
      }

      animationRef.current = requestAnimationFrame(draw);
    };

    draw();

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [width, height]);

  return (
    <motion.div
      className={className}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 1.5, delay: 0.5 }}
    >
      <canvas
        ref={canvasRef}
        style={{
          width,
          height,
        }}
      />
    </motion.div>
  );
}
