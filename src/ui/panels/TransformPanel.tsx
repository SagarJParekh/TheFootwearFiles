import { centreOnFloor, getRotationDeg, resetTransform, rotateStep, setPosition, setRotationDeg } from '../../state/actions';
import { setView, useStore, type GizmoMode } from '../../state/store';
import type { Vec3 } from '../../core/types';
import { NumberField, Panel } from '../common';

const AXES = ['X', 'Y', 'Z'] as const;

export function TransformPanel() {
  const transform = useStore((s) => s.doc?.transform);
  const gizmo = useStore((s) => s.view.gizmo);
  if (!transform) return null;
  const rot = getRotationDeg(transform);

  const gizmoButton = (mode: GizmoMode, label: string, key: string) => (
    <button
      className={gizmo === mode ? 'active' : ''}
      onClick={() => setView({ gizmo: gizmo === mode ? 'none' : mode })}
      title={`${label} gizmo (${key})`}
    >
      {label}
    </button>
  );

  return (
    <Panel title="Transform">
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
    </Panel>
  );
}
