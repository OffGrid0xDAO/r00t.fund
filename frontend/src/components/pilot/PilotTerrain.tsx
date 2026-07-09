/**
 * PilotTerrain — contour-relief render of the Project 001 pilot site.
 *
 * Ported from the landing-repo terrain animation and rebuilt in the r00t design
 * system: the crystal/cream palette is replaced with r00t tokens read from CSS
 * variables (theme-aware), and the dev-only tooling (manual camera, river
 * drawing) is removed.
 *
 * Data source: /terrain/*.json — FUZZED, non-cadastral geometry only (see
 * scripts/fuzz-terrain.mjs). No real coordinates ever reach this component.
 *
 * SWAP SLOT: to use production terrain, re-run scripts/fuzz-terrain.mjs against
 * the real geodata in secret/ — the output drops straight into /terrain/.
 */
import { useRef, useMemo, useState, useEffect, Suspense } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';

interface HeightmapData {
  resolution: number;
  minElevation: number;
  maxElevation: number;
  extentMeters: { width: number; height: number };
  data: number[];
  propertyMask?: number[];
  propertyBoundary?: number[][];
}
interface ContourLine { e: number; l: string; p: number[][] }
interface ContoursData { contours: ContourLine[]; elevRange: [number, number] }
interface RiverData { type: string; points: number[][]; centerline: number[][] }

// Read a CSS custom property from :root, with a hard fallback for SSR/first paint.
function cssVar(name: string, fallback: string): string {
  if (typeof window === 'undefined') return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

interface Palette {
  bg: THREE.Color;
  grid: THREE.Color;
  major: THREE.Color; medium: THREE.Color; minor: THREE.Color;
  accent: THREE.Color; accentSoft: THREE.Color;
  river: THREE.Color;
}
function readPalette(): Palette {
  const accent = cssVar('--accent', '#4A8B5C');
  return {
    bg: new THREE.Color(cssVar('--bg-primary', '#F5F1E8')),
    grid: new THREE.Color(cssVar('--text-muted', '#9C9C96')),
    major: new THREE.Color(cssVar('--text-primary', '#2A2A28')),
    medium: new THREE.Color(cssVar('--text-secondary', '#5C5C58')),
    minor: new THREE.Color(cssVar('--text-muted', '#9C9C96')),
    accent: new THREE.Color(accent),
    accentSoft: new THREE.Color(accent).lerp(new THREE.Color('#ffffff'), 0.4),
    river: new THREE.Color('#5BA8B5'),
  };
}

function blurPass(src: Float32Array, res: number, radius: number): Float32Array {
  const dst = new Float32Array(src.length);
  for (let y = 0; y < res; y++) {
    for (let x = 0; x < res; x++) {
      let sum = 0, cnt = 0;
      for (let sy = -radius; sy <= radius; sy++) {
        for (let sx = -radius; sx <= radius; sx++) {
          const ny = y + sy, nx = x + sx;
          if (ny >= 0 && ny < res && nx >= 0 && nx < res) { sum += src[ny * res + nx]; cnt++; }
        }
      }
      dst[y * res + x] = sum / cnt;
    }
  }
  return dst;
}
function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}
function sampleElevation(s: Float32Array, res: number, nx: number, ny: number, scale: number): number {
  const gxf = Math.max(0, Math.min(res - 1.01, nx * (res - 1)));
  const gyf = Math.max(0, Math.min(res - 1.01, ny * (res - 1)));
  const gx0 = Math.floor(gxf), gy0 = Math.floor(gyf);
  const gx1 = Math.min(gx0 + 1, res - 1), gy1 = Math.min(gy0 + 1, res - 1);
  const fx = gxf - gx0, fy = gyf - gy0;
  const h00 = s[gy0 * res + gx0] ?? 0, h10 = s[gy0 * res + gx1] ?? 0;
  const h01 = s[gy1 * res + gx0] ?? 0, h11 = s[gy1 * res + gx1] ?? 0;
  return (h00 * (1 - fx) * (1 - fy) + h10 * fx * (1 - fy) + h01 * (1 - fx) * fy + h11 * fx * fy) * scale;
}

function Terrain({ heightmap, contours, river, palette }: {
  heightmap: HeightmapData; contours: ContoursData; river: RiverData | null; palette: Palette;
}) {
  const propRef = useRef<THREE.Mesh>(null);
  const rimRef = useRef<THREE.LineLoop>(null);

  const result = useMemo(() => {
    const res = heightmap.resolution;
    const aspect = heightmap.extentMeters.width / heightmap.extentMeters.height;
    const sizeY = 8, sizeX = sizeY * aspect, elevScale = 2.2;
    const halfX = sizeX / 2, halfY = sizeY / 2;
    const camLocal = [-6.772, -3.879, 5.759];

    let smoothed: Float32Array<ArrayBufferLike> = new Float32Array(heightmap.data);
    smoothed = blurPass(smoothed, res, 2);
    smoothed = blurPass(smoothed, res, 2);

    const pb = { xMin: 0, xMax: 1, yMin: 0, yMax: 1 };
    if (heightmap.propertyBoundary && heightmap.propertyBoundary.length >= 3) {
      pb.xMin = Math.min(...heightmap.propertyBoundary.map(p => p[0])) - 0.01;
      pb.xMax = Math.max(...heightmap.propertyBoundary.map(p => p[0])) + 0.01;
      pb.yMin = Math.min(...heightmap.propertyBoundary.map(p => p[1])) - 0.01;
      pb.yMax = Math.max(...heightmap.propertyBoundary.map(p => p[1])) + 0.01;
    }
    const inProp = (nx: number, ny: number): boolean => {
      if (!heightmap.propertyMask) return false;
      if (nx < pb.xMin || nx > pb.xMax || ny < pb.yMin || ny > pb.yMax) return false;
      const gx = Math.round(nx * (res - 1)), gy = Math.round(ny * (res - 1));
      if (gx < 0 || gx >= res || gy < 0 || gy >= res) return false;
      return heightmap.propertyMask[gy * res + gx] === 1;
    };
    const edgeFade = (px: number, py: number): number => {
      const dx = Math.abs(px) / halfX, dy = Math.abs(py) / halfY;
      return (1 - smoothstep(0.80, 1.0, dx)) * (1 - smoothstep(0.80, 1.0, dy));
    };
    const elevAt = (nx: number, ny: number): number => {
      const h = sampleElevation(smoothed, res, nx, ny, elevScale);
      return h * edgeFade((nx - 0.5) * sizeX, (ny - 0.5) * sizeY);
    };
    const worldPos = (ix: number, iy: number): [number, number, number] => {
      const nx = ix / (res - 1), ny = iy / (res - 1);
      const px = (nx - 0.5) * sizeX, py = (ny - 0.5) * sizeY;
      const h = (smoothed[iy * res + ix] ?? 0) * elevScale;
      return [px, py, h * edgeFade(px, py)];
    };
    const facing = (nx: number, ny: number): boolean => {
      const d = 0.003;
      const z0 = elevAt(nx, ny), zx = elevAt(Math.min(nx + d, 1), ny), zy = elevAt(nx, Math.min(ny + d, 1));
      const nX = 0 * (zy - z0) - (zx - z0) * (d * sizeY);
      const nY = (zx - z0) * 0 - (d * sizeX) * (zy - z0);
      const nZ = (d * sizeX) * (d * sizeY);
      const px = (nx - 0.5) * sizeX, py = (ny - 0.5) * sizeY;
      return (nX * (camLocal[0] - px) + nY * (camLocal[1] - py) + nZ * (camLocal[2] - z0)) > 0;
    };
    const vColor = (px: number, py: number, base: THREE.Color): THREE.Color => {
      const dx = Math.abs(px) / halfX, dy = Math.abs(py) / halfY;
      const fade = (1 - smoothstep(0.5, 0.88, dx)) * (1 - smoothstep(0.5, 0.88, dy));
      return new THREE.Color().copy(base).lerp(palette.bg, 1 - fade);
    };

    // grid (front-facing only)
    const gStep = 12, iStep = 2;
    const gPos: number[] = [], gCol: number[] = [];
    const pushGrid = (rows: boolean) => {
      for (let a = 0; a < res; a += gStep) {
        for (let b = 0; b < res - iStep; b += iStep) {
          const ix = rows ? b : a, iy = rows ? a : b;
          const midNx = rows ? (b + iStep / 2) / (res - 1) : a / (res - 1);
          const midNy = rows ? a / (res - 1) : (b + iStep / 2) / (res - 1);
          if (!facing(midNx, midNy)) continue;
          const nb = Math.min(b + iStep, res - 1);
          const [x0, y0, z0] = worldPos(rows ? b : a, rows ? a : b);
          const [x1, y1, z1] = worldPos(rows ? nb : a, rows ? a : nb);
          void ix; void iy;
          gPos.push(x0, y0, z0, x1, y1, z1);
          const c0 = vColor(x0, y0, palette.grid), c1 = vColor(x1, y1, palette.grid);
          gCol.push(c0.r, c0.g, c0.b, c1.r, c1.g, c1.b);
        }
      }
    };
    pushGrid(true); pushGrid(false);
    const gridGeo = new THREE.BufferGeometry();
    gridGeo.setAttribute('position', new THREE.Float32BufferAttribute(gPos, 3));
    gridGeo.setAttribute('color', new THREE.Float32BufferAttribute(gCol, 3));

    // contours
    const buckets: Record<string, { pos: number[]; col: number[] }> = {
      major: { pos: [], col: [] }, medium: { pos: [], col: [] }, minor: { pos: [], col: [] }, prop: { pos: [], col: [] },
    };
    const colOf: Record<string, THREE.Color> = { major: palette.major, medium: palette.medium, minor: palette.minor };
    for (const cl of contours.contours) {
      const pts = cl.p;
      for (let i = 0; i < pts.length - 1; i++) {
        const [nx0, ny0] = pts[i], [nx1, ny1] = pts[i + 1];
        const midNx = (nx0 + nx1) / 2, midNy = (ny0 + ny1) / 2;
        if (!facing(midNx, midNy)) continue;
        const px0 = (nx0 - 0.5) * sizeX, py0 = (ny0 - 0.5) * sizeY, pz0 = elevAt(nx0, ny0) + 0.006;
        const px1 = (nx1 - 0.5) * sizeX, py1 = (ny1 - 0.5) * sizeY, pz1 = elevAt(nx1, ny1) + 0.006;
        if (edgeFade(px0, py0) < 0.02 && edgeFade(px1, py1) < 0.02) continue;
        if (inProp(midNx, midNy)) {
          const b = buckets.prop;
          b.pos.push(px0, py0, pz0 + 0.004, px1, py1, pz1 + 0.004);
          const c0 = vColor(px0, py0, palette.accent), c1 = vColor(px1, py1, palette.accent);
          b.col.push(c0.r, c0.g, c0.b, c1.r, c1.g, c1.b);
        } else {
          const b = buckets[cl.l] ?? buckets.minor;
          b.pos.push(px0, py0, pz0, px1, py1, pz1);
          const base = colOf[cl.l] ?? palette.minor;
          const c0 = vColor(px0, py0, base), c1 = vColor(px1, py1, base);
          b.col.push(c0.r, c0.g, c0.b, c1.r, c1.g, c1.b);
        }
      }
    }
    const mkGeo = (b: { pos: number[]; col: number[] }) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(b.pos, 3));
      g.setAttribute('color', new THREE.Float32BufferAttribute(b.col, 3));
      return g;
    };

    // property fill + rim
    let shapeGeo: THREE.ShapeGeometry | null = null;
    let boundaryGeo: THREE.BufferGeometry | null = null;
    if (heightmap.propertyBoundary && heightmap.propertyBoundary.length >= 3) {
      const pts = heightmap.propertyBoundary;
      const shape = new THREE.Shape();
      shape.moveTo((pts[0][0] - 0.5) * sizeX, (pts[0][1] - 0.5) * sizeY);
      for (let p = 1; p < pts.length; p++) shape.lineTo((pts[p][0] - 0.5) * sizeX, (pts[p][1] - 0.5) * sizeY);
      shape.closePath();
      shapeGeo = new THREE.ShapeGeometry(shape);
      const sp = shapeGeo.attributes.position;
      for (let i = 0; i < sp.count; i++) {
        const sx = sp.getX(i), sy = sp.getY(i);
        const h = sampleElevation(smoothed, res, sx / sizeX + 0.5, sy / sizeY + 0.5, elevScale);
        sp.setZ(i, h * edgeFade(sx, sy) + 0.015);
      }
      shapeGeo.computeVertexNormals();

      const rim: number[] = [];
      for (let p = 0; p < pts.length; p++) {
        const [ax, ay] = pts[p], [bx, by] = pts[(p + 1) % pts.length];
        for (let s = 0; s < 8; s++) {
          const nx = ax + ((bx - ax) * s) / 8, ny = ay + ((by - ay) * s) / 8;
          rim.push((nx - 0.5) * sizeX, (ny - 0.5) * sizeY, elevAt(nx, ny) + 0.022);
        }
      }
      boundaryGeo = new THREE.BufferGeometry();
      boundaryGeo.setAttribute('position', new THREE.Float32BufferAttribute(rim, 3));
    }

    // river
    let riverGeo: THREE.TubeGeometry | null = null;
    if (river?.centerline && river.centerline.length >= 3) {
      const rp: THREE.Vector3[] = [];
      for (const [nx, ny] of river.centerline) {
        const px = (nx - 0.5) * sizeX, py = (ny - 0.5) * sizeY;
        if (edgeFade(px, py) < 0.05) continue;
        rp.push(new THREE.Vector3(px, py, elevAt(nx, ny) + 0.008));
      }
      if (rp.length >= 3) riverGeo = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(rp), rp.length * 4, 0.05, 6, false);
    }

    return {
      gridGeo,
      majorGeo: mkGeo(buckets.major), mediumGeo: mkGeo(buckets.medium),
      minorGeo: mkGeo(buckets.minor), propGeo: mkGeo(buckets.prop),
      shapeGeo, boundaryGeo, riverGeo,
    };
  }, [heightmap, contours, river, palette]);

  // breathing property fill + shimmering rim, in the accent hue
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    const pulse = 0.5 + 0.5 * Math.sin(t * 0.8);
    if (propRef.current) {
      const m = propRef.current.material as THREE.MeshBasicMaterial;
      m.color.copy(palette.accentSoft).lerp(palette.accent, pulse * 0.7);
      m.opacity = 0.28 + 0.16 * pulse;
    }
    if (rimRef.current) {
      const m = rimRef.current.material as THREE.LineBasicMaterial;
      m.opacity = 0.5 + 0.4 * pulse;
    }
  });

  return (
    <group rotation={[-Math.PI / 2, 0, 0]}>
      <lineSegments geometry={result.gridGeo}><lineBasicMaterial vertexColors transparent opacity={0.22} /></lineSegments>
      <lineSegments geometry={result.minorGeo}><lineBasicMaterial vertexColors transparent opacity={0.32} /></lineSegments>
      <lineSegments geometry={result.mediumGeo}><lineBasicMaterial vertexColors transparent opacity={0.55} /></lineSegments>
      <lineSegments geometry={result.majorGeo}><lineBasicMaterial vertexColors /></lineSegments>
      {result.shapeGeo && (
        <mesh ref={propRef} geometry={result.shapeGeo}>
          <meshBasicMaterial color={palette.accent} side={THREE.DoubleSide} transparent opacity={0.32} depthWrite={false} />
        </mesh>
      )}
      {result.boundaryGeo && (
        <lineLoop ref={rimRef} geometry={result.boundaryGeo}>
          <lineBasicMaterial color={palette.accent} transparent opacity={0.8} depthWrite={false} />
        </lineLoop>
      )}
      <lineSegments geometry={result.propGeo}><lineBasicMaterial vertexColors transparent opacity={1} /></lineSegments>
      {result.riverGeo && (
        <mesh geometry={result.riverGeo}><meshBasicMaterial color={palette.river} transparent opacity={0.4} /></mesh>
      )}
    </group>
  );
}

function LockedCamera() {
  const { camera } = useThree();
  useEffect(() => {
    camera.position.set(-6.772, 5.759, 3.879);
    camera.lookAt(-3.15, 0.3, -1.0);
  }, [camera]);
  return null;
}

export function PilotTerrain({ className = '' }: { className?: string }) {
  const [heightmap, setHeightmap] = useState<HeightmapData | null>(null);
  const [contours, setContours] = useState<ContoursData | null>(null);
  const [river, setRiver] = useState<RiverData | null>(null);
  const [palette, setPalette] = useState<Palette | null>(null);

  useEffect(() => {
    setPalette(readPalette());
    fetch('/terrain/heightmap.json').then(r => r.json()).then(setHeightmap).catch(() => {});
    fetch('/terrain/contours.json').then(r => r.json()).then(setContours).catch(() => {});
    fetch('/terrain/river.json').then(r => r.json()).then(setRiver).catch(() => {});
  }, []);

  // re-read palette when the theme class flips
  useEffect(() => {
    const obs = new MutationObserver(() => setPalette(readPalette()));
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => obs.disconnect();
  }, []);

  return (
    <div className={`absolute inset-0 w-full h-full ${className}`}>
      <Canvas
        camera={{ position: [-6.772, 5.759, 3.879], fov: 35, near: 0.1, far: 50 }}
        dpr={[1, 2]}
        gl={{ antialias: true, alpha: true }}
        style={{ background: 'transparent' }}
      >
        <Suspense fallback={null}>
          {heightmap && contours && palette && (
            <Terrain heightmap={heightmap} contours={contours} river={river} palette={palette} />
          )}
          <LockedCamera />
        </Suspense>
      </Canvas>
    </div>
  );
}

export default PilotTerrain;
