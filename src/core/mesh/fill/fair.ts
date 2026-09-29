/**
 * Patch fairing: moves the free (new) vertices so the surface minimises the
 * squared umbrella Laplacian over the patch *and* its boundary ring. Including the
 * boundary vertices' Laplacians – which involve the surrounding original mesh –
 * gives the patch tangent continuity with the existing surface, so it follows the
 * neighbouring curvature instead of staying flat (a discrete thin-plate / bi-Laplacian
 * energy). Solved as least squares with conjugate gradients on the normal equations.
 */

export interface FairInput {
  positions: number[];
  /** Vertices that may move. */
  free: number[];
  /** Neighbour lists for every free vertex and every fixed vertex adjacent to one. */
  neighbours: Map<number, number[]>;
  maxIterations?: number;
}

export function fairPatch({ positions: p, free, neighbours, maxIterations = 2000 }: FairInput): void {
  const F = free.length;
  if (F === 0) return;
  const freeIndex = new Map<number, number>();
  free.forEach((v, i) => freeIndex.set(v, i));

  // Rows: Laplacian at each free vertex and each fixed vertex with a free neighbour.
  const rowVerts = new Set<number>(free);
  for (const v of free) for (const u of neighbours.get(v) ?? []) rowVerts.add(u);

  interface Row { cols: number[]; coefs: number[]; constant: [number, number, number] }
  const rows: Row[] = [];
  for (const v of rowVerts) {
    const nb = neighbours.get(v);
    if (!nb || nb.length === 0) continue;
    const w = 1 / nb.length;
    const cols: number[] = [];
    const coefs: number[] = [];
    const constant: [number, number, number] = [0, 0, 0];
    const add = (u: number, coef: number) => {
      const fi = freeIndex.get(u);
      if (fi !== undefined) {
        cols.push(fi);
        coefs.push(coef);
      } else {
        constant[0] += coef * p[3 * u];
        constant[1] += coef * p[3 * u + 1];
        constant[2] += coef * p[3 * u + 2];
      }
    };
    for (const u of nb) add(u, w);
    add(v, -1);
    if (cols.length) rows.push({ cols, coefs, constant });
  }

  const Ax = (x: Float64Array, out: Float64Array) => {
    for (let r = 0; r < rows.length; r++) {
      const { cols, coefs } = rows[r];
      let s = 0;
      for (let k = 0; k < cols.length; k++) s += coefs[k] * x[cols[k]];
      out[r] = s;
    }
  };
  const ATy = (y: Float64Array, out: Float64Array) => {
    out.fill(0);
    for (let r = 0; r < rows.length; r++) {
      const { cols, coefs } = rows[r];
      for (let k = 0; k < cols.length; k++) out[cols[k]] += coefs[k] * y[r];
    }
  };

  const tmpRows = new Float64Array(rows.length);
  const normalOp = (x: Float64Array, out: Float64Array) => {
    Ax(x, tmpRows);
    ATy(tmpRows, out);
  };

  for (let axis = 0; axis < 3; axis++) {
    // Solve AᵀA x = −Aᵀ c
    const c = new Float64Array(rows.length);
    rows.forEach((r, i) => (c[i] = -r.constant[axis]));
    const b = new Float64Array(F);
    ATy(c, b);
    const x = new Float64Array(F);
    free.forEach((v, i) => (x[i] = p[3 * v + axis]));
    conjugateGradient(normalOp, b, x, maxIterations, 1e-12);
    free.forEach((v, i) => (p[3 * v + axis] = x[i]));
  }
}

function conjugateGradient(
  op: (x: Float64Array, out: Float64Array) => void,
  b: Float64Array,
  x: Float64Array,
  maxIter: number,
  tol: number,
) {
  const n = b.length;
  const r = new Float64Array(n);
  const Ap = new Float64Array(n);
  op(x, Ap);
  for (let i = 0; i < n; i++) r[i] = b[i] - Ap[i];
  const pvec = r.slice();
  let rr = dot(r, r);
  const bb = Math.max(dot(b, b), 1e-30);
  for (let it = 0; it < maxIter && rr / bb > tol; it++) {
    op(pvec, Ap);
    const alpha = rr / (dot(pvec, Ap) || 1e-30);
    for (let i = 0; i < n; i++) {
      x[i] += alpha * pvec[i];
      r[i] -= alpha * Ap[i];
    }
    const rrNew = dot(r, r);
    const beta = rrNew / rr;
    rr = rrNew;
    for (let i = 0; i < n; i++) pvec[i] = r[i] + beta * pvec[i];
  }
}

function dot(a: Float64Array, b: Float64Array) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}
