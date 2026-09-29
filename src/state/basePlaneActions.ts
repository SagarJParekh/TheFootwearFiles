import { hasBasePlaneLandmarks, setBasePlane, syncBasePlane } from '../core/align/basePlane';
import { commit, endGesture, requestCamera, setView, useStore } from './store';

const get = useStore.getState;
const set = useStore.setState;

/** True (and tells the user) when the base plane locks the model's position and rotation. */
export function transformLocked(): boolean {
  if (get().doc?.basePlaneLocked) {
    set({ notice: 'The base plane is set – the model cannot be rotated or moved. Use "Release base plane" to unlock.' });
    return true;
  }
  return false;
}

/** Aligns the model to the heel/M1/M5 plane and locks its transform. */
export function setBasePlaneAction(label = 'Set base plane'): void {
  const { doc } = get();
  if (!doc) return;
  try {
    commit(label, (d) => setBasePlane(d));
    setView({ gizmo: 'none' });
    requestCamera('preset', 'iso');
    set({ notice: 'Base plane set: heel centre, 1st and 5th metatarsal heads are on the floor. Rotation is locked.' });
  } catch (e) {
    set({ error: e instanceof Error ? e.message : String(e) });
  }
}

export function releaseBasePlane(): void {
  commit('Release base plane', (d) => (d.basePlaneLocked ? { ...d, basePlaneLocked: false } : d));
}

/** Called after a landmark edit: set the plane automatically once all three points exist. */
export function autoSetBasePlane(): void {
  const { doc } = get();
  if (doc && !doc.basePlaneLocked && hasBasePlaneLandmarks(doc)) setBasePlaneAction('Set base plane (auto)');
}

/**
 * Ends a landmark drag: records the undo step, then re-aligns to the moved point within the
 * same step (the model doesn't move while dragging, which would fight the cursor).
 */
export function endLandmarkGesture(label: string): void {
  endGesture(label);
  const { doc } = get();
  if (doc?.basePlaneLocked) set({ doc: syncBasePlane(doc) });
}
