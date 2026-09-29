/**
 * earcut discards collinear / duplicate outline points, which would leave T-junctions
 * (the cap no longer shares those boundary vertices with the mesh). Re-insert each
 * dropped point by splitting the triangle whose edge passes through it.
 */
export function restoreDroppedVertices(tri: number[], coords: number[]): number[] {
  const n = coords.length / 2;
  const used = new Uint8Array(n);
  for (const i of tri) used[i] = 1;
  const out = [...tri];
  for (let v = 0; v < n; v++) {
    if (used[v]) continue;
    const px = coords[2 * v], py = coords[2 * v + 1];
    let best = -1, bestEdge = 0, bestDist = Infinity;
    for (let t = 0; t < out.length; t += 3) {
      for (let e = 0; e < 3; e++) {
        const a = out[t + e], b = out[t + ((e + 1) % 3)];
        const ax = coords[2 * a], ay = coords[2 * a + 1], bx = coords[2 * b], by = coords[2 * b + 1];
        const dx = bx - ax, dy = by - ay;
        const len2 = dx * dx + dy * dy;
        if (len2 === 0) continue;
        const s = ((px - ax) * dx + (py - ay) * dy) / len2;
        if (s <= 0 || s >= 1) continue;
        const dist = Math.abs((px - ax) * dy - (py - ay) * dx) / Math.sqrt(len2);
        if (dist < bestDist) {
          bestDist = dist;
          best = t;
          bestEdge = e;
        }
      }
    }
    if (best < 0) continue;
    const a = out[best + bestEdge], b = out[best + ((bestEdge + 1) % 3)], c = out[best + ((bestEdge + 2) % 3)];
    out.splice(best, 3, a, v, c, v, b, c);
    used[v] = 1;
  }
  return out;
}
