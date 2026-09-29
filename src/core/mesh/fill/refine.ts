/**
 * Patch refinement after Liepa, "Filling Holes in Meshes" (SGP 2003): split triangles
 * by their centroid until the local edge-length scale σ of the surrounding mesh is met,
 * relaxing edges (Delaunay-style flips) after each pass so the patch stays well shaped.
 */

export interface RefineInput {
  /** Growable xyz array (existing vertices + new ones are appended). */
  positions: number[];
  /** Patch triangles (global vertex indices), oriented. */
  triangles: number[];
  /** σ (target edge length) for vertices already in the patch. */
  sigma: Map<number, number>;
  /** Stop splitting once the patch has this many vertices. */
  maxNewVertices?: number;
}

const ALPHA = Math.SQRT2;

const edgeKey = (a: number, b: number) => (a < b ? `${a},${b}` : `${b},${a}`);

function dist(p: number[], a: number, b: number) {
  return Math.hypot(p[3 * a] - p[3 * b], p[3 * a + 1] - p[3 * b + 1], p[3 * a + 2] - p[3 * b + 2]);
}

function angleAt(p: number[], apex: number, a: number, b: number) {
  const ux = p[3 * a] - p[3 * apex], uy = p[3 * a + 1] - p[3 * apex + 1], uz = p[3 * a + 2] - p[3 * apex + 2];
  const vx = p[3 * b] - p[3 * apex], vy = p[3 * b + 1] - p[3 * apex + 1], vz = p[3 * b + 2] - p[3 * apex + 2];
  const d = (ux * vx + uy * vy + uz * vz) / (Math.hypot(ux, uy, uz) * Math.hypot(vx, vy, vz) || 1);
  return Math.acos(Math.max(-1, Math.min(1, d)));
}

/** Returns the list of vertices created. Mutates `positions`, `triangles`, `sigma`. */
export function refinePatch(input: RefineInput): number[] {
  const { positions: p, triangles: tris, sigma } = input;
  const maxNew = input.maxNewVertices ?? 50_000;
  const created: number[] = [];

  for (let pass = 0; pass < 60; pass++) {
    let split = false;
    const count = tris.length / 3;
    for (let t = 0; t < count; t++) {
      if (created.length >= maxNew) break;
      const a = tris[3 * t], b = tris[3 * t + 1], c = tris[3 * t + 2];
      const cx = (p[3 * a] + p[3 * b] + p[3 * c]) / 3;
      const cy = (p[3 * a + 1] + p[3 * b + 1] + p[3 * c + 1]) / 3;
      const cz = (p[3 * a + 2] + p[3 * b + 2] + p[3 * c + 2]) / 3;
      const sc = (sigma.get(a)! + sigma.get(b)! + sigma.get(c)!) / 3;
      let ok = true;
      for (const v of [a, b, c]) {
        const d = ALPHA * Math.hypot(cx - p[3 * v], cy - p[3 * v + 1], cz - p[3 * v + 2]);
        if (d <= sc || d <= sigma.get(v)!) {
          ok = false;
          break;
        }
      }
      if (!ok) continue;
      const m = p.length / 3;
      p.push(cx, cy, cz);
      sigma.set(m, sc);
      created.push(m);
      tris[3 * t + 2] = m; // (a, b, m)
      tris.push(b, c, m, c, a, m);
      split = true;
    }
    relaxEdges(p, tris);
    if (!split) break;
  }
  return created;
}

/** Flips interior patch edges whose opposite angles sum to more than π (not locally Delaunay). */
export function relaxEdges(p: number[], tris: number[], maxSweeps = 20): void {
  for (let sweep = 0; sweep < maxSweeps; sweep++) {
    const edgeTris = new Map<string, number[]>();
    const existing = new Set<string>();
    for (let t = 0; t < tris.length / 3; t++) {
      for (let e = 0; e < 3; e++) {
        const k = edgeKey(tris[3 * t + e], tris[3 * t + ((e + 1) % 3)]);
        existing.add(k);
        const list = edgeTris.get(k);
        if (list) list.push(t);
        else edgeTris.set(k, [t]);
      }
    }
    const touched = new Set<number>();
    let flips = 0;
    for (const [, list] of edgeTris) {
      if (list.length !== 2) continue;
      const [t1, t2] = list;
      if (touched.has(t1) || touched.has(t2)) continue;
      // find shared edge a→b in t1 (b→a in t2)
      const T1 = [tris[3 * t1], tris[3 * t1 + 1], tris[3 * t1 + 2]];
      const T2 = [tris[3 * t2], tris[3 * t2 + 1], tris[3 * t2 + 2]];
      let a = -1, b = -1, c = -1, d = -1;
      for (let e = 0; e < 3; e++) {
        const x = T1[e], y = T1[(e + 1) % 3];
        const j = T2.indexOf(y);
        if (j >= 0 && T2[(j + 1) % 3] === x) {
          a = x; b = y; c = T1[(e + 2) % 3]; d = T2[(j + 2) % 3];
          break;
        }
      }
      if (a < 0 || c === d || existing.has(edgeKey(c, d))) continue;
      if (angleAt(p, c, a, b) + angleAt(p, d, a, b) <= Math.PI + 1e-9) continue;
      // Guard against folding: the new triangles must not be degenerate.
      if (dist(p, c, d) < 1e-9) continue;
      tris[3 * t1] = a; tris[3 * t1 + 1] = d; tris[3 * t1 + 2] = c;
      tris[3 * t2] = d; tris[3 * t2 + 1] = b; tris[3 * t2 + 2] = c;
      existing.add(edgeKey(c, d));
      touched.add(t1);
      touched.add(t2);
      flips++;
    }
    if (flips === 0) break;
  }
}
