import type { InsoleFrame } from './frame';

export type Pt = [number, number];

export interface OutlineInput {
  frame: InsoleFrame;
  /** Insole length (mm). */
  length: number;
  /** b-coordinate of the back of the heel (mm, frame coords). */
  heelBack: number;
  narrow: boolean;
}

/**
 * Insole outline in frame coordinates (a across, b along the foot), fitted to the
 * landmarks: the forefoot edge passes ~10 mm outside the 1st and 5th metatarsal heads,
 * the heel is ~25% of the length wide, and the toe apex sits towards the hallux.
 * Built as a closed Catmull-Rom spline through anatomical control points.
 */
export function insoleOutline({ frame, length: L, heelBack, narrow }: OutlineInput): Pt[] {
  const m = frame.medialSign, lat = -m;
  const w = narrow ? 0.9 : 1;
  const [a1, b1] = frame.met1, [a5, b5] = frame.met5;
  const medBall = (Math.abs(a1) + 10) * w;
  const latBall = (Math.abs(a5) + 10) * w;
  const hw = 0.125 * L * w;
  const bToe = heelBack + L;
  const ctrl: Pt[] = [
    [0, heelBack],
    [lat * hw * 0.8, heelBack + 0.05 * L],
    [lat * hw, heelBack + 0.16 * L],
    [lat * (0.45 * hw + 0.55 * latBall) * 0.97, heelBack + 0.45 * L],
    [lat * latBall, b5],
    [lat * latBall * 0.85, b5 + 0.45 * (bToe - b5)],
    [lat * latBall * 0.45, bToe - 0.05 * L],
    [m * 0.25 * medBall, bToe],
    [m * medBall * 0.95, b1 + 0.5 * (bToe - b1)],
    [m * medBall, b1],
    [m * hw * 0.78, heelBack + 0.45 * L],
    [m * hw, heelBack + 0.16 * L],
    [m * hw * 0.8, heelBack + 0.05 * L],
  ];
  return catmullRomClosed(ctrl, 14);
}

export function catmullRomClosed(p: Pt[], samples: number): Pt[] {
  const out: Pt[] = [];
  const n = p.length;
  for (let i = 0; i < n; i++) {
    const p0 = p[(i - 1 + n) % n], p1 = p[i], p2 = p[(i + 1) % n], p3 = p[(i + 2) % n];
    for (let s = 0; s < samples; s++) {
      const t = s / samples, t2 = t * t, t3 = t2 * t;
      out.push([
        0.5 * (2 * p1[0] + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3),
        0.5 * (2 * p1[1] + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3),
      ]);
    }
  }
  return out;
}

// --- signed distance (negative inside) ------------------------------------------------

export function polygonSdf(poly: Pt[], x: number, y: number): number {
  let d = Infinity;
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    const ex = xi - xj, ey = yi - yj;
    const wx = x - xj, wy = y - yj;
    const t = Math.max(0, Math.min(1, (wx * ex + wy * ey) / (ex * ex + ey * ey || 1)));
    const dx = wx - ex * t, dy = wy - ey * t;
    d = Math.min(d, dx * dx + dy * dy);
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside ? -Math.sqrt(d) : Math.sqrt(d);
}

export const circleSdf = (cx: number, cy: number, r: number, x: number, y: number) => Math.hypot(x - cx, y - cy) - r;

/** Half-plane through p with outward normal n (inside where dot(x − p, n) < 0). */
export const halfPlaneSdf = (px: number, py: number, nx: number, ny: number, x: number, y: number) => {
  const l = Math.hypot(nx, ny) || 1;
  return ((x - px) * nx + (y - py) * ny) / l;
};

export const sdfUnion = (a: number, b: number) => Math.min(a, b);
export const sdfIntersect = (a: number, b: number) => Math.max(a, b);
export const sdfSubtract = (a: number, b: number) => Math.max(a, -b);

export function polygonArea(poly: Pt[]): number {
  let s = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) s += poly[j][0] * poly[i][1] - poly[i][0] * poly[j][1];
  return s / 2;
}
