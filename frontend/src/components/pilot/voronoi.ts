/**
 * Clipped Voronoi — partition a land boundary into one investment polygon per
 * seed point (a plot). Pure JS, no deps. Sutherland–Hodgman clipping of the
 * boundary polygon by the perpendicular-bisector half-planes between seeds.
 */
export type Pt = [number, number];

// Clip polygon by half-plane { p : a*x + b*y - c <= 0 } (keep the <= 0 side).
function clipHalfPlane(poly: Pt[], a: number, b: number, c: number): Pt[] {
  const out: Pt[] = [];
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const cur = poly[i];
    const prev = poly[(i + n - 1) % n];
    const fCur = a * cur[0] + b * cur[1] - c;
    const fPrev = a * prev[0] + b * prev[1] - c;
    const curIn = fCur <= 0;
    const prevIn = fPrev <= 0;
    if (curIn) {
      if (!prevIn) {
        const t = fPrev / (fPrev - fCur);
        out.push([prev[0] + t * (cur[0] - prev[0]), prev[1] + t * (cur[1] - prev[1])]);
      }
      out.push(cur);
    } else if (prevIn) {
      const t = fPrev / (fPrev - fCur);
      out.push([prev[0] + t * (cur[0] - prev[0]), prev[1] + t * (cur[1] - prev[1])]);
    }
  }
  return out;
}

/** One clipped-Voronoi cell polygon per seed, in the same coord space. */
export function clippedVoronoi(seeds: Pt[], boundary: Pt[]): Pt[][] {
  return seeds.map((si, i) => {
    let poly = boundary.slice();
    for (let j = 0; j < seeds.length && poly.length >= 3; j++) {
      if (j === i) continue;
      const sj = seeds[j];
      // p is closer to si than sj  ⇔  p·(sj-si) <= (|sj|² - |si|²)/2
      const a = sj[0] - si[0];
      const b = sj[1] - si[1];
      const c = (sj[0] * sj[0] + sj[1] * sj[1] - si[0] * si[0] - si[1] * si[1]) / 2;
      poly = clipHalfPlane(poly, a, b, c);
    }
    return poly;
  });
}

/** Area-weighted centroid of a polygon (for label / tooltip anchoring). */
export function centroid(poly: Pt[]): Pt {
  let a = 0, cx = 0, cy = 0;
  for (let i = 0, n = poly.length; i < n; i++) {
    const [x0, y0] = poly[i];
    const [x1, y1] = poly[(i + 1) % n];
    const cross = x0 * y1 - x1 * y0;
    a += cross;
    cx += (x0 + x1) * cross;
    cy += (y0 + y1) * cross;
  }
  if (Math.abs(a) < 1e-9) {
    // degenerate — average vertices
    const s = poly.reduce((acc, p) => [acc[0] + p[0], acc[1] + p[1]] as Pt, [0, 0] as Pt);
    return [s[0] / poly.length, s[1] / poly.length];
  }
  a *= 0.5;
  return [cx / (6 * a), cy / (6 * a)];
}
