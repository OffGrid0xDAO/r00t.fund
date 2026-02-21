import { useEffect, useRef } from 'react';
import { motion } from 'framer-motion';

interface WireframeGlobeProps {
  size?: number;
  className?: string;
}

// Reforestation project locations [lat, lng, name]
const PROJECT_MARKERS = [
  { lat: -3.4, lon: -62.2, name: 'Amazon Basin' },
  { lat: 1.3, lon: 103.8, name: 'Southeast Asia' },
  { lat: -19.0, lon: 29.2, name: 'Zimbabwe' },
  { lat: 9.1, lon: 7.5, name: 'Nigeria' },
  { lat: -8.8, lon: 125.7, name: 'Timor-Leste' },
];

export function WireframeGlobe({ size = 400, className = '' }: WireframeGlobeProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rotationRef = useRef(0);
  const animationRef = useRef<number>();

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    ctx.scale(dpr, dpr);

    const cx = size / 2;
    const cy = size / 2;
    const radius = size / 2 - 20;

    // Get theme color
    const getAccentColor = () => {
      const isDark = document.documentElement.classList.contains('dark');
      return isDark ? 'rgba(74, 139, 92, 0.6)' : 'rgba(45, 90, 61, 0.35)';
    };

    const getMarkerColor = () => {
      const isDark = document.documentElement.classList.contains('dark');
      return isDark ? '#D4A84B' : '#2D5A3D';
    };

    // Project 3D point to 2D
    const project = (lat: number, lon: number, rotation: number): { x: number; y: number; visible: boolean } => {
      const latRad = (lat * Math.PI) / 180;
      const lonRad = ((lon + rotation) * Math.PI) / 180;

      const x = Math.cos(latRad) * Math.sin(lonRad);
      const y = Math.sin(latRad);
      const z = Math.cos(latRad) * Math.cos(lonRad);

      return {
        x: cx + x * radius,
        y: cy - y * radius,
        visible: z > 0,
      };
    };

    // Draw a great circle arc (latitude or longitude line)
    const drawArc = (points: { x: number; y: number; visible: boolean }[], color: string) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.beginPath();

      let drawing = false;
      for (let i = 0; i < points.length; i++) {
        const point = points[i];
        if (point.visible) {
          if (!drawing) {
            ctx.moveTo(point.x, point.y);
            drawing = true;
          } else {
            ctx.lineTo(point.x, point.y);
          }
        } else {
          drawing = false;
        }
      }
      ctx.stroke();
    };

    const draw = () => {
      ctx.clearRect(0, 0, size, size);

      const rotation = rotationRef.current;
      const accentColor = getAccentColor();
      const markerColor = getMarkerColor();

      // Draw longitude lines (meridians)
      for (let lon = 0; lon < 360; lon += 30) {
        const points: { x: number; y: number; visible: boolean }[] = [];
        for (let lat = -90; lat <= 90; lat += 3) {
          points.push(project(lat, lon, rotation));
        }
        drawArc(points, accentColor);
      }

      // Draw latitude lines (parallels)
      for (let lat = -60; lat <= 60; lat += 30) {
        const points: { x: number; y: number; visible: boolean }[] = [];
        for (let lon = 0; lon <= 360; lon += 3) {
          points.push(project(lat, lon, rotation));
        }
        drawArc(points, accentColor);
      }

      // Draw equator slightly brighter
      const equatorPoints: { x: number; y: number; visible: boolean }[] = [];
      for (let lon = 0; lon <= 360; lon += 3) {
        equatorPoints.push(project(0, lon, rotation));
      }
      const isDark = document.documentElement.classList.contains('dark');
      drawArc(equatorPoints, isDark ? 'rgba(74, 139, 92, 0.8)' : 'rgba(45, 90, 61, 0.5)');

      // Draw project markers
      PROJECT_MARKERS.forEach((marker) => {
        const point = project(marker.lat, marker.lon, rotation);
        if (point.visible) {
          // Outer glow
          ctx.beginPath();
          ctx.arc(point.x, point.y, 6, 0, Math.PI * 2);
          ctx.fillStyle = isDark ? 'rgba(212, 168, 75, 0.3)' : 'rgba(45, 90, 61, 0.2)';
          ctx.fill();

          // Inner dot
          ctx.beginPath();
          ctx.arc(point.x, point.y, 3, 0, Math.PI * 2);
          ctx.fillStyle = markerColor;
          ctx.fill();
        }
      });

      // Continue rotation
      rotationRef.current += 0.3;
      animationRef.current = requestAnimationFrame(draw);
    };

    draw();

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [size]);

  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 1, delay: 0.5 }}
    >
      <canvas
        ref={canvasRef}
        style={{
          width: size,
          height: size,
          cursor: 'default',
        }}
      />
    </motion.div>
  );
}
