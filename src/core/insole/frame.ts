import type { Vec3 } from '../types';

/**
 * 2D insole frame on the ground plane (world XY, Z up):
 *   origin = heel centre (projected), +b = towards the midpoint of the 1st/5th metatarsal heads,
 *   +a = b × Z (to the right when looking down with the toes pointing up).
 * `medialSign` is the sign of `a` on the medial side (from where M1 lies relative to M5).
 */
export interface InsoleFrame {
  origin: [number, number];
  u: [number, number];
  v: [number, number];
  medialSign: 1 | -1;
  /** Landmarks in frame coordinates (a, b) plus their world Z. */
  heel: [number, number];
  met1: [number, number];
  met5: [number, number];
  arch: [number, number] | null;
  archStart: [number, number] | null;
  archEnd: [number, number] | null;
  /** Malleoli in frame coordinates (a, b) and world height z. */
  medialMalleolus: [number, number, number] | null;
  lateralMalleolus: [number, number, number] | null;
}

export interface FrameLandmarks {
  heelCentre: Vec3;
  met1Head: Vec3;
  met5Head: Vec3;
  archPeak?: Vec3;
  archStart?: Vec3;
  archEnd?: Vec3;
  /** Ankle landmarks (footwear: the shoe collar is kept below them). */
  medialMalleolus?: Vec3;
  lateralMalleolus?: Vec3;
}

export function buildInsoleFrame(lm: FrameLandmarks): InsoleFrame {
  const o: [number, number] = [lm.heelCentre[0], lm.heelCentre[1]];
  const mid = [(lm.met1Head[0] + lm.met5Head[0]) / 2, (lm.met1Head[1] + lm.met5Head[1]) / 2];
  let vx = mid[0] - o[0], vy = mid[1] - o[1];
  const len = Math.hypot(vx, vy);
  if (len < 20) throw new Error('Heel centre and metatarsal heads are too close together – check the landmarks.');
  vx /= len;
  vy /= len;
  const u: [number, number] = [vy, -vx];
  const v: [number, number] = [vx, vy];
  const toFrame = (p: Vec3): [number, number] => {
    const dx = p[0] - o[0], dy = p[1] - o[1];
    return [dx * u[0] + dy * u[1], dx * v[0] + dy * v[1]];
  };
  const met1 = toFrame(lm.met1Head), met5 = toFrame(lm.met5Head);
  return {
    origin: o,
    u,
    v,
    medialSign: met1[0] < met5[0] ? -1 : 1,
    heel: [0, 0],
    met1,
    met5,
    arch: lm.archPeak ? toFrame(lm.archPeak) : null,
    archStart: lm.archStart ? toFrame(lm.archStart) : null,
    archEnd: lm.archEnd ? toFrame(lm.archEnd) : null,
    medialMalleolus: lm.medialMalleolus ? [...toFrame(lm.medialMalleolus), lm.medialMalleolus[2]] : null,
    lateralMalleolus: lm.lateralMalleolus ? [...toFrame(lm.lateralMalleolus), lm.lateralMalleolus[2]] : null,
  };
}

export function frameToWorld(f: InsoleFrame, a: number, b: number): [number, number] {
  return [f.origin[0] + a * f.u[0] + b * f.v[0], f.origin[1] + a * f.u[1] + b * f.v[1]];
}

export function worldToFrame(f: InsoleFrame, x: number, y: number): [number, number] {
  const dx = x - f.origin[0], dy = y - f.origin[1];
  return [dx * f.u[0] + dy * f.u[1], dx * f.v[0] + dy * f.v[1]];
}
