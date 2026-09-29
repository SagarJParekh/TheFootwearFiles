/**
 * Parametric insole / orthosis generator.
 *
 * 1. The aligned scan (world coords, sole down) is rasterised into a height map of its lowest
 *    surface – the plantar surface – on a grid in the insole frame (heel centre → metatarsals).
 * 2. The outline is fitted to the shoe size and the M1/M5 landmarks.
 * 3. Modifications are applied as height offsets to the top (contact) surface or as outline
 *    operations (signed distance fields).
 * 4. A closed solid is meshed between the top and bottom surfaces.
 *
 * Soft insole: full length, shell of `paddingThickness` following the plantar surface.
 * Orthosis ("Add thickness"): 3/4 length (+ Morton's options), underside filled flat to the
 * ground through the rearfoot/midfoot, heel post, apertures for offloads, optional heel hole.
 */
import { makeMesh, type MeshData } from '../types';
import { buildInsoleFrame, frameToWorld, type FrameLandmarks, type InsoleFrame } from './frame';
import { fillMissing, gaussianBlur, rasterizeLowestSurface, type Grid } from './heightfield';
import { circleSdf, insoleOutline, polygonSdf, sdfIntersect, sdfSubtract, sdfUnion, type Pt } from './outline';
import { insoleLengthMm, METATARSALS, type InsoleParams } from './params';
import { buildSolid } from './solidMesh';

export const GRID_SPACING_MM = 1;
const MIN_THICKNESS = 0.8;

export interface PlantarSurface {
  frame: InsoleFrame;
  grid: Grid;
  /** Smoothed, gap-filled plantar height (world Z) per grid node. */
  z: Float32Array;
  /** Raw coverage (true where the scan had data). */
  covered: Uint8Array;
  /** Foot length measured from the scan footprint (mm), null if not measurable. */
  footLength: number | null;
  /** b of the back of the heel from the footprint (frame coords). */
  heelBack: number | null;
}

/** Step 1 – expensive (depends only on scan, transform and landmarks), so callers cache it. */
export function samplePlantarSurface(worldPositions: Float32Array, indices: Uint32Array, landmarks: FrameLandmarks): PlantarSurface {
  const frame = buildInsoleFrame(landmarks);
  const h = GRID_SPACING_MM;
  const grid: Grid = { a0: -95, b0: -110, h, nx: Math.round(190 / h) + 1, ny: Math.round(470 / h) + 1 };
  const raw = rasterizeLowestSurface(worldPositions, indices, frame, grid);
  const covered = new Uint8Array(raw.length);
  for (let k = 0; k < raw.length; k++) covered[k] = Number.isNaN(raw[k]) ? 0 : 1;

  // Footprint extent along the central strip (|a| < 12 mm) → heel back and foot length.
  let bMin = Infinity, bMax = -Infinity;
  for (let j = 0; j < grid.ny; j++)
    for (let i = 0; i < grid.nx; i++) {
      const a = grid.a0 + i * h;
      if (Math.abs(a) > 12 || !covered[j * grid.nx + i]) continue;
      const b = grid.b0 + j * h;
      bMin = Math.min(bMin, b);
      bMax = Math.max(bMax, b);
    }
  // toes are usually medial of the centre line: use the whole width for the front
  for (let k = 0; k < raw.length; k++) if (covered[k]) bMax = Math.max(bMax, grid.b0 + Math.floor(k / grid.nx) * h);
  const heelBack = Number.isFinite(bMin) && bMin < -5 && bMin > -100 ? bMin : null;
  const footLength = heelBack !== null && bMax > 100 ? bMax - heelBack : null;

  const z = gaussianBlur(fillMissing(raw, grid), grid, 2.5);
  return { frame, grid, z, covered, footLength, heelBack };
}

export interface InsoleResult {
  mesh: MeshData;
  outlineWorld: [number, number][];
  length: number;
  width: number;
  minThickness: number;
  maxThickness: number;
  footLength: number | null;
  kind: 'insole' | 'orthosis';
}

const smoothstep = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};
/** Smooth bump: 1 at the centre, 0 at q ≥ 1 (q = normalised squared radius). */
const bump = (q: number) => (q >= 1 ? 0 : (1 - q) * (1 - q));

/** Steps 2–4 – cheap, rerun on every parameter change. */
export function generateInsole(surface: PlantarSurface, params: InsoleParams): InsoleResult {
  const { frame, grid: g, z: plantar } = surface;
  const L = insoleLengthMm(params.shoeSizeUK);
  const heelBack = surface.heelBack ?? -0.11 * L;
  const m = frame.medialSign;
  const [a1, b1] = frame.met1, [a5, b5] = frame.met5;
  const bMT = (b1 + b5) / 2;
  const orth = params.orthosis.enabled;

  // --- outline(s) -------------------------------------------------------------------
  const outline: Pt[] = insoleOutline({ frame, length: L, heelBack, narrow: params.narrowProfile });
  // MT line: from M1 to M5; distal normal points towards the toes.
  let mtDirA = a5 - a1, mtDirB = b5 - b1;
  const mtLen = Math.hypot(mtDirA, mtDirB) || 1;
  mtDirA /= mtLen;
  mtDirB /= mtLen;
  let distalA = -mtDirB, distalB = mtDirA;
  if (distalB < 0) [distalA, distalB] = [-distalA, -distalB];
  const mtHead = (k: number): Pt => [a1 + ((k - 1) / 4) * (a5 - a1), b1 + ((k - 1) / 4) * (b5 - b1)];
  const distMT = (a: number, b: number) => (a - a1) * distalA + (b - b1) * distalB; // + distal of MT line
  const acrossMT = (a: number, b: number) => ((a - a1) * mtDirA + (b - b1) * mtDirB) / mtLen; // 0 at M1, 1 at M5

  const nodeCount = g.nx * g.ny;
  const sdf = new Float32Array(nodeCount);
  const outlineSdf = new Float32Array(nodeCount);
  const rowMin = new Float32Array(g.ny).fill(Infinity), rowMax = new Float32Array(g.ny).fill(-Infinity);
  for (let j = 0; j < g.ny; j++) {
    const b = g.b0 + j * g.h;
    for (let i = 0; i < g.nx; i++) {
      const a = g.a0 + i * g.h;
      const k = j * g.nx + i;
      const d0 = polygonSdf(outline, a, b);
      outlineSdf[k] = d0;
      if (d0 < 0) {
        rowMin[j] = Math.min(rowMin[j], a);
        rowMax[j] = Math.max(rowMax[j], a);
      }
      let d = d0;
      if (orth) {
        const cut = distMT(a, b) + 6; // keep proximal of (MT line − 6 mm)
        const proximal = sdfIntersect(d0, cut);
        let extension = Infinity;
        const c = acrossMT(a, b);
        if (params.orthosis.mortonsExtension === 'mortons') extension = sdfIntersect(d0, (c - 0.22) * mtLen);
        if (params.orthosis.mortonsExtension === 'reverseMortons') extension = sdfIntersect(d0, (0.22 - c) * mtLen);
        d = sdfUnion(proximal, extension);
        if (params.orthosis.provideOffloads) {
          for (const id of params.orthosis.offloads) {
            const [ha, hb] = mtHead(METATARSALS.indexOf(id) + 1);
            d = sdfSubtract(d, circleSdf(ha, hb - 3, 9, a, b));
          }
        }
        if (params.orthosis.holeInHeel) d = sdfSubtract(d, circleSdf(0, 0, 10, a, b));
      }
      sdf[k] = d;
    }
  }

  // Ground: lowest plantar point inside the outline (1st percentile, robust to spikes).
  const inside: number[] = [];
  for (let k = 0; k < nodeCount; k++) if (outlineSdf[k] < 0) inside.push(plantar[k]);
  if (!inside.length) throw new Error('Insole outline is empty');
  inside.sort((x, y) => x - y);
  const z0 = inside[Math.floor(inside.length * 0.01)];

  const sampleAt = (a: number, b: number) => {
    const i = Math.min(g.nx - 1, Math.max(0, Math.round((a - g.a0) / g.h)));
    const j = Math.min(g.ny - 1, Math.max(0, Math.round((b - g.b0) / g.h)));
    return plantar[j * g.nx + i];
  };
  // Forefoot level: height of the plantar surface under the 1st and 5th metatarsal heads.
  const forefootLevel = (sampleAt(a1, b1) + sampleAt(a5, b5)) / 2;

  // --- surfaces ----------------------------------------------------------------------
  const top = new Float32Array(nodeCount);
  const bottom = new Float32Array(nodeCount);
  const archA = frame.arch?.[0] ?? m * Math.max(12, 0.45 * Math.abs(a1));
  const archB = frame.arch?.[1] ?? 0.45 * bMT;
  const padA = a1 + 0.4 * (a5 - a1), padB = b1 + 0.4 * (b5 - b1) - 12;
  const grooveStart: Pt = [m * 3, 12];
  const grooveEnd: Pt = [a1 + 0.3 * (a5 - a1) - distalA * 22, b1 + 0.3 * (b5 - b1) - distalB * 22];
  const tanW = Math.tan((params.wedge.angleDeg * Math.PI) / 180);
  const hr = params.orthosis.heelRaise;

  for (let j = 0; j < g.ny; j++) {
    const b = g.b0 + j * g.h;
    const s = (b - heelBack) / L; // 0 at heel back, 1 at toe tip
    for (let i = 0; i < g.nx; i++) {
      const a = g.a0 + i * g.h;
      const k = j * g.nx + i;
      // "shape" moves the whole surface (the soft shell follows it); "material" only thickens.
      let shape = plantar[k];
      // Forefoot: from the M1–M5 line forward the insole is completely flat (no toe contours
      // are traced). A 12 mm band just behind the line blends into the traced surface.
      const flat = smoothstep(-12, 0, distMT(a, b));
      if (flat > 0) shape = shape * (1 - flat) + forefootLevel * flat;
      let material = 0;

      // Medial arch pressure: push the insole up into (+) or away from (−) the medial arch.
      if (params.medialArchPressure !== 0) {
        shape += params.medialArchPressure * bump(((a - archA) / 22) ** 2 + ((b - archB) / (0.22 * L)) ** 2);
      }
      // Heel raise (orthosis): lift the rearfoot, tapering to zero at the metatarsals.
      const lift = orth && hr > 0 ? hr * smoothstep(bMT - 10, 0.35 * bMT, b) : 0;
      shape += lift;
      // Heel cup: near the edge of the rearfoot the surface blends to a rim heelCupHeight above
      // the ground (and follows the heel raise).
      const inward = -outlineSdf[k];
      const cupRegion = smoothstep(0.55, 0.3, s);
      if (cupRegion > 0 && inward < 14) {
        const f = smoothstep(14, 0, inward) * cupRegion;
        shape = shape * (1 - f) + (z0 + params.heelCupHeight + lift) * f;
      }

      // Metatarsal pad: dome just proximal to the 2nd–4th metatarsal heads.
      if (params.mtPad.enabled && params.mtPad.height > 0) {
        material += params.mtPad.height * bump(((a - padA) / 12) ** 2 + ((b - padB) / 17) ** 2);
      }
      // Metatarsal bar: transverse ridge just proximal to the MT line, full width.
      if (params.mtBar.enabled) {
        const dm = distMT(a, b) + 10;
        if (Math.abs(dm) < 10) material += params.mtBar.thickness * 0.5 * (1 + Math.cos((Math.PI * dm) / 10));
      }
      // Plantar fascia groove: channel along the medial band from heel to the 1st/2nd ray.
      if (params.fasciaGroove.enabled && params.fasciaGroove.depth > 0) {
        const ex = grooveEnd[0] - grooveStart[0], ey = grooveEnd[1] - grooveStart[1];
        const tt = Math.max(0, Math.min(1, ((a - grooveStart[0]) * ex + (b - grooveStart[1]) * ey) / (ex * ex + ey * ey)));
        const dd = Math.hypot(a - (grooveStart[0] + ex * tt), b - (grooveStart[1] + ey * tt));
        if (dd < 6) {
          const taper = smoothstep(0, 0.15, tt) * smoothstep(1, 0.85, tt);
          material -= params.fasciaGroove.depth * 0.5 * (1 + Math.cos((Math.PI * dd) / 6)) * taper;
        }
      }
      // Wedge (posting): tilt about the opposite border, in the chosen region.
      if (params.wedge.enabled && tanW > 0 && Number.isFinite(rowMin[j])) {
        const region = params.wedge.type === 'full' ? 1 : params.wedge.type === 'heel' ? smoothstep(0.5, 0.35, s) : smoothstep(0.5, 0.6, s);
        const raisedSign = params.wedge.side === 'medial' ? m : -m;
        const pivot = raisedSign > 0 ? rowMin[j] : rowMax[j];
        material += tanW * Math.abs(a - pivot) * region;
      }

      const t = shape + material;
      top[k] = t;

      if (!orth) {
        bottom[k] = shape - params.paddingThickness;
      } else {
        const fp = params.orthosis.footplateThickness;
        const shellBottom = shape - fp; // follows the shape, not pads/grooves added on top
        // Filled underside through rearfoot/midfoot, blending to a shell before the MT line.
        const fill = smoothstep(bMT - 12, 0.55 * bMT, b);
        const postWidth = { narrow: 0.7, normal: 0.85, wide: 1.0 }[params.orthosis.heelBaseWidth];
        const hasRow = Number.isFinite(rowMin[j]);
        const half = hasRow ? Math.max(1, (rowMax[j] - rowMin[j]) / 2) : 1;
        const centre = hasRow ? (rowMax[j] + rowMin[j]) / 2 : 0;
        const inPost = smoothstep(postWidth, postWidth - 0.3, Math.abs(a - centre) / half);
        const post = smoothstep(0.45 * bMT, 0.25 * bMT, b);
        const ground = z0 - fp - params.orthosis.heelHeight * post * inPost;
        const filled = Math.min(ground, shellBottom);
        const w = fill * (0.35 + 0.65 * inPost);
        bottom[k] = shellBottom * (1 - w) + filled * w;
      }
      if (bottom[k] > top[k] - MIN_THICKNESS) bottom[k] = top[k] - MIN_THICKNESS;
    }
  }

  // Smooth the orthosis underside (post/shell blends) and re-apply the minimum thickness.
  if (orth) {
    const smooth = gaussianBlur(bottom, g, 1.5);
    const minT = params.orthosis.footplateThickness;
    for (let k = 0; k < nodeCount; k++) bottom[k] = Math.min(smooth[k], top[k] - Math.min(minT, top[k] - bottom[k]));
  }

  // --- mesh ----------------------------------------------------------------------------
  const mesh = buildSolid(g, sdf, top, bottom, (a, b, z) => {
    const [x, y] = frameToWorld(frame, a, b);
    return [x, y, z];
  });

  let minT = Infinity, maxT = -Infinity;
  for (let k = 0; k < nodeCount; k++) {
    if (sdf[k] >= 0) continue;
    const th = top[k] - bottom[k];
    minT = Math.min(minT, th);
    maxT = Math.max(maxT, th);
  }
  let wMin = Infinity, wMax = -Infinity;
  for (const [a] of outline) {
    wMin = Math.min(wMin, a);
    wMax = Math.max(wMax, a);
  }
  return {
    mesh: makeMesh(mesh.positions, mesh.indices),
    outlineWorld: outline.map(([a, b]) => frameToWorld(frame, a, b)),
    length: L,
    width: wMax - wMin,
    minThickness: minT,
    maxThickness: maxT,
    footLength: surface.footLength,
    kind: orth ? 'orthosis' : 'insole',
  };
}
