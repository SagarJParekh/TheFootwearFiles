import { planeWorldToLocal } from '../core/math/plane';
import { applyTransform } from '../core/math/transform';
import type { Vec3 } from '../core/types';
import { meshWorker, withMesh } from '../workers/meshClient';
import { withBusy } from './actions';
import { commit, setClip, useStore } from './store';

const get = useStore.getState;

/** World-space corners of the model's (local) bounding box. */
function worldCorners(): Vec3[] {
  const { doc, derived } = get();
  if (!doc || !derived) return [];
  const { min, max } = derived.stats.bounds;
  const out: Vec3[] = [];
  for (let i = 0; i < 8; i++) {
    out.push(applyTransform(doc.transform, [i & 1 ? max[0] : min[0], i & 2 ? max[1] : min[1], i & 4 ? max[2] : min[2]]));
  }
  return out;
}

export function modelWorldCentre(): Vec3 {
  const c = worldCorners();
  if (!c.length) return [0, 0, 0];
  const s = c.reduce((a, p) => [a[0] + p[0], a[1] + p[1], a[2] + p[2]], [0, 0, 0] as Vec3);
  return [s[0] / c.length, s[1] / c.length, s[2] / c.length];
}

/** Range of dot(normal, p) over the model (used for the offset slider). */
export function clipRange(normal: Vec3): [number, number] {
  const c = worldCorners();
  if (!c.length) return [-100, 100];
  const d = c.map((p) => p[0] * normal[0] + p[1] * normal[1] + p[2] * normal[2]);
  return [Math.min(...d), Math.max(...d)];
}

/** Aligns the clip plane with a world axis through the model centre. */
export function alignClip(axis: 0 | 1 | 2, sign: 1 | -1 = 1): void {
  const normal: Vec3 = [0, 0, 0];
  normal[axis] = sign;
  const c = modelWorldCentre();
  setClip({ enabled: true, normal, constant: c[0] * normal[0] + c[1] * normal[1] + c[2] * normal[2] });
}

export function flipClip(): void {
  const { normal, constant } = get().clip;
  setClip({ normal: [-normal[0], -normal[1], -normal[2]], constant: -constant });
}

/**
 * Destructive cut with the current clip plane. `keep` = 'visible' keeps the side that
 * the clipping plane currently shows.
 */
export async function cutWithClipPlane(keep: 'visible' | 'hidden', cap: boolean): Promise<void> {
  const { doc, derived, clip } = get();
  if (!doc || !derived) return;
  const localPlane = planeWorldToLocal({ normal: clip.normal, constant: clip.constant }, doc.transform);
  await withBusy('Cutting', async () => {
    const r = await withMesh(doc.mesh, (m) => meshWorker().cut(m, localPlane, keep === 'visible', cap, derived.stats.watertight));
    if (r.mesh.indices.length === 0) throw new Error('Nothing would remain on the kept side');
    commit(`Cut (${keep === 'visible' ? 'keep visible' : 'keep hidden'}${cap ? ', capped' : ''})`, (d) => ({ ...d, mesh: r.mesh }));
    const parts = [`Cut done (${r.method === 'manifold' ? 'manifold-3d' : 'plane split'})`];
    if (r.cappedLoops > 0) parts.push(`${r.cappedLoops} cap loop${r.cappedLoops > 1 ? 's' : ''}`);
    if (r.openCutLoops > 0) parts.push(`${r.openCutLoops} open section(s) could not be capped`);
    if (r.fallbackReason) parts.push(`manifold fallback: ${r.fallbackReason}`);
    useStore.setState({ notice: parts.join(' · ') });
    // Keep showing the result: switch clipping off if we kept the visible side.
    setClip({ enabled: false, gizmo: 'none' });
  });
}
