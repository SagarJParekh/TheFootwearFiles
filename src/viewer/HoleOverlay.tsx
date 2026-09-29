import { Line } from '@react-three/drei';
import { useMemo } from 'react';
import { useStore } from '../state/store';
import { holeColour } from '../ui/panels/HolesPanel';

/** Draws each boundary loop as a coloured polyline (in mesh-local space). */
export function HoleOverlay() {
  const holes = useStore((s) => s.holes);
  const meshId = useStore((s) => s.doc?.mesh.id);
  const show = useStore((s) => s.showHoles);
  const hovered = useStore((s) => s.hoveredHole);
  const excluded = useStore((s) => s.holeExcluded);

  const lines = useMemo(() => {
    if (!holes || holes.meshId !== meshId) return [];
    return holes.loops.map((l) => {
      const pts: [number, number, number][] = [];
      for (let i = 0; i < l.points.length; i += 3) pts.push([l.points[i], l.points[i + 1], l.points[i + 2]]);
      pts.push(pts[0]);
      return { id: l.id, pts };
    });
  }, [holes, meshId]);

  if (!show) return null;
  return (
    <group>
      {lines.map((l) => (
        <Line
          key={l.id}
          points={l.pts}
          color={holeColour(l.id)}
          lineWidth={hovered === l.id ? 6 : 3}
          dashed={excluded.has(l.id)}
          dashSize={3}
          gapSize={2}
          depthTest={hovered !== l.id}
          renderOrder={hovered === l.id ? 5 : 1}
        />
      ))}
    </group>
  );
}
