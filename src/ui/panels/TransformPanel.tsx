import { centreOnFloor, getRotationDeg, resetTransform, rotateStep, setPosition, setRotationDeg } from '../../state/actions';
import { setView, useStore, type GizmoMode } from '../../state/store';
import type { Vec3 } from '../../core/types';
import { NumberField, Panel } from '../common';
import { releaseBasePlane, setBasePlaneAction } from '../../state/basePlaneActions';

/** Shows whether the heel / M1 / M5 base plane is set (model locked) and lets the user set or release it. */
export function BasePlaneStatus({ locked, hasPoints }: { locked: boolean; hasPoints: boolean }) {
  if (locked) {
    return (
      <div className="lock-banner" data-testid="base-plane-locked">
        <span>🔒 Base plane set (heel centre · M1 · M5 on the floor). Rotation is locked.</span>
        <button className="small" onClick={releaseBasePlane} title="Unlock the model so it can be rotated again (undoable)">
          Release base plane
        </button>
      </div>
    );
  }
  return (
    <div className="lock-banner open">
      <span>
        {hasPoints
          ? 'Base plane not set.'
          : 'Place the heel centre, 1st and 5th metatarsal heads – the plane through them becomes the base plane and the model is locked.'}
      </span>
      {hasPoints && (
        <button className="small" onClick={() => setBasePlaneAction()} data-testid="set-base-plane">
          Set base plane
        </button>
      )}
    </div>
  );
}

const AXES = ['X', 'Y', 'Z'] as const;

export function TransformPanel() {
  const transform = useStore((s) => s.doc?.transform);
  const gizmo = useStore((s) => s.view.gizmo);
  const locked = useStore((s) => !!s.doc?.basePlaneLocked);
  const hasPoints = useStore((s) => !!(s.doc?.landmarks.heelCentre && s.doc.landmarks.met1Head && s.doc.landmarks.met5Head));
  if (!transform) return null;
  const rot = getRotationDeg(transform);

  const gizmoButton = (mode: GizmoMode, label: string, key: string) => (
    <button
      disabled={locked}
      className={gizmo === mode ? 'active' : ''}
      onClick={() => setView({ gizmo: gizmo === mode ? 'none' : mode })}
      title={`${label} gizmo (${key})`}
    >
      {label}
    </button>
  );

  return (
    <Panel title="Transform">
      <BasePlaneStatus locked={locked} hasPoints={hasPoints} />
      <fieldset className="plain" disabled={locked}>
      <div className="button-row">
        {gizmoButton('translate', 'Move', 'G')}
        {gizmoButton('rotate', 'Rotate', 'R')}
      </div>
      <div className="field-group-label">Position (mm)</div>
      <div className="xyz-row">
        {AXES.map((a, i) => (
          <NumberField
            key={a}
            label={a}
            value={transform.position[i]}
            step={1}
            disabled={locked}
            onCommit={(v) => {
              const p = [...transform.position] as Vec3;
              p[i] = v;
              setPosition(p);
            }}
          />
        ))}
      </div>
      <div className="field-group-label">Rotation (° XYZ, about model centre)</div>
      <div className="xyz-row">
        {AXES.map((a, i) => (
          <NumberField
            key={a}
            label={a}
            value={rot[i]}
            step={1}
            disabled={locked}
            onCommit={(v) => {
              const r = [...rot] as Vec3;
              r[i] = v;
              setRotationDeg(r);
            }}
          />
        ))}
      </div>
      <div className="field-group-label">Quick rotate 90°</div>
      <div className="button-row small">
        {AXES.map((a, i) => (
          <span key={a} className="pair">
            <button onClick={() => rotateStep(i as 0 | 1 | 2, -90)}>{a}−</button>
            <button onClick={() => rotateStep(i as 0 | 1 | 2, 90)}>{a}+</button>
          </span>
        ))}
      </div>
      <div className="button-row">
        <button onClick={centreOnFloor} title="Centre the model on the Z axis and put its lowest point on Z = 0">
          Centre on floor
        </button>
        <button onClick={resetTransform}>Reset</button>
      </div>
      </fieldset>
    </Panel>
  );
}
