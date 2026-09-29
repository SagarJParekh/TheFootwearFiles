import { computeMeasurements, describeMissing } from '../../core/landmarks/measurements';
import { useStore } from '../../state/store';
import { Panel, fmt } from '../common';

export function MeasurementsPanel() {
  const landmarks = useStore((s) => s.doc?.landmarks);
  const scan = useStore((s) => s.doc?.scan);
  if (!landmarks || !scan) return null;
  const measurements = computeMeasurements(landmarks, scan.type);

  return (
    <Panel title="Measurements">
      <table className="measure" data-testid="measurements">
        <tbody>
          {measurements.map((m) => (
            <tr key={m.id} className={m.value === null ? 'na' : ''} title={m.description}>
              <td>{m.label}</td>
              <td className="v" data-testid={`m-${m.id}`}>
                {m.value !== null ? `${fmt(m.value)} mm` : m.missing.length ? `needs ${describeMissing(m)}` : 'n/a'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="hint">Plantar plane: through heel centre, M1 and M5. Arch height is the perpendicular distance from it.</p>
    </Panel>
  );
}
