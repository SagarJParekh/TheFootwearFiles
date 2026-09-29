/**
 * Generates test STL files into public/samples (served by the app's "Samples" menu).
 *   npm run fixtures            # standard set
 *   npm run fixtures -- --large # also a ~1.3M triangle sphere for performance testing
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { box, icosphere, sphereWithHoles } from '../src/core/fixtures/primitives';
import { closedFoot, lowerLimbScan, plantarScan } from '../src/core/fixtures/footShapes';
import { writeAsciiStl, writeBinaryStl } from '../src/core/io/stlWrite';
import { analyzeMesh } from '../src/core/mesh/analyze';
import type { MeshData } from '../src/core/types';

const outDir = join(import.meta.dirname, '..', 'public', 'samples');
mkdirSync(outDir, { recursive: true });

function save(name: string, mesh: MeshData, ascii = false) {
  const path = join(outDir, name);
  if (ascii) writeFileSync(path, writeAsciiStl(mesh, name.replace(/\.stl$/, '')));
  else writeFileSync(path, new Uint8Array(writeBinaryStl(mesh, `Footwear Files fixture: ${name}`)));
  const s = analyzeMesh(mesh);
  console.log(
    `${name.padEnd(24)} ${String(s.triangleCount).padStart(8)} tris  watertight=${s.watertight}  open edges=${s.boundaryEdgeCount}`,
  );
}

save('cube-ascii.stl', box([40, 40, 40], [0, 0, 20]), true);
save('cube-binary.stl', box([40, 40, 40], [0, 0, 20]));
save('sphere.stl', icosphere(50, 4, [0, 0, 50]));
save('sphere-with-holes.stl', sphereWithHoles());
save('foot-closed.stl', closedFoot());
save('foot-plantar.stl', plantarScan());
save('leg-open-top.stl', lowerLimbScan());
if (process.argv.includes('--large')) save('sphere-large.stl', icosphere(60, 8));

// --- Import-format fixtures (coarse closed foot in many formats), used by e2e/formats.mjs ---
{
  const { writeObj, writePlyBinary, writePlyAscii, writeOff, write3mf, writeAmf, writeGltf, writeGlb, writeDae, writeVrml, write3dm } =
    await import('./formatWriters');
  const dir = join(import.meta.dirname, '..', 'fixtures', 'formats');
  mkdirSync(dir, { recursive: true });
  const foot = closedFoot(8);
  const files: Record<string, string | Uint8Array> = {
    'foot.stl': new Uint8Array(writeBinaryStl(foot)),
    'foot.obj': writeObj(foot),
    'foot-binary.ply': writePlyBinary(foot),
    'foot-ascii.ply': writePlyAscii(foot),
    'foot.off': writeOff(foot),
    'foot-mm.3mf': write3mf(foot, 'millimeter'),
    'foot-cm.3mf': write3mf(foot, 'centimeter'),
    'foot-inch.amf': writeAmf(foot, 'inch'),
    'foot.gltf': writeGltf(foot),
    'foot.glb': writeGlb(foot),
    'foot.dae': writeDae(foot),
    'foot.wrl': writeVrml(foot),
    'foot.3dm': await write3dm(foot),
  };
  for (const [name, data] of Object.entries(files)) writeFileSync(join(dir, name), data);
  console.log(`format fixtures: ${Object.keys(files).length} files in fixtures/formats (${foot.indices.length / 3} tris each)`);
}
