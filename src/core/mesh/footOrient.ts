/**
 * Which way do the toes point? Scans come from many sources and often point their toes along
 * −Y or ±X; the app's convention is +Y. For a foot lying on the floor (Z up) this looks along the
 * longer horizontal axis and picks the toe end:
 *  - with the ankle / leg in the scan, the heel end is much higher than the toe end;
 *  - for a low (plantar) scan, the forefoot end is wider than the heel end.
 * Returns the turn about Z (degrees, world axis) that brings the toes to +Y, or null when the
 * model doesn't look like a foot lying on the floor (then the user orients it by hand).
 */
export function detectToeTurn(positions: Float32Array): { turn: 0 | 90 | 180 | -90; by: 'height' | 'width' } | null {
  const n = positions.length / 3;
  if (n < 30) return null;
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3)
    for (let k = 0; k < 3; k++) {
      lo[k] = Math.min(lo[k], positions[i + k]);
      hi[k] = Math.max(hi[k], positions[i + k]);
    }
  const Lx = hi[0] - lo[0], Ly = hi[1] - lo[1], H = hi[2] - lo[2];
  const ax = Ly >= Lx ? 1 : 0, cx = 1 - ax; // long (length) and short (width) horizontal axes
  const L = Math.max(Lx, Ly), W = Math.min(Lx, Ly);
  // a foot lying on the floor: clearly longer than wide, and not standing up
  if (L < 1.5 * W || H > 0.9 * L) return null;
  // height and width of the two end quarters
  const q = 0.25 * L;
  const zMax = [-Infinity, -Infinity], wLo = [Infinity, Infinity], wHi = [-Infinity, -Infinity];
  const step = Math.max(1, Math.floor(n / 200000));
  for (let v = 0; v < n; v += step) {
    const t = positions[3 * v + ax] - lo[ax];
    const end = t < q ? 0 : t > L - q ? 1 : -1;
    if (end < 0) continue;
    zMax[end] = Math.max(zMax[end], positions[3 * v + 2]);
    wLo[end] = Math.min(wLo[end], positions[3 * v + cx]);
    wHi[end] = Math.max(wHi[end], positions[3 * v + cx]);
  }
  const h0 = zMax[0] - lo[2], h1 = zMax[1] - lo[2];
  const w0 = wHi[0] - wLo[0], w1 = wHi[1] - wLo[1];
  let toesAtHigh: boolean; // toes at the + end of the long axis
  let by: 'height' | 'width';
  if (Math.abs(h0 - h1) > 0.2 * Math.max(h0, h1)) {
    toesAtHigh = h1 < h0; // the ankle is over the heel
    by = 'height';
  } else if (Math.abs(w0 - w1) > 0.08 * Math.max(w0, w1)) {
    toesAtHigh = w1 > w0; // the forefoot is wider than the heel
    by = 'width';
  } else return null;
  // toes along +Y → 0, −Y → 180, +X → +90 (turns +X onto +Y), −X → −90
  const turn = ax === 1 ? (toesAtHigh ? 0 : 180) : toesAtHigh ? 90 : -90;
  return { turn, by };
}
