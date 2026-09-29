/**
 * Minimal writers for generating import fixtures in many formats from one mesh (mm, Z up).
 * Used by scripts/generate-fixtures.ts and the format import tests; not part of the app bundle.
 */
import { strToU8, zipSync } from 'fflate';
import type { MeshData } from '../src/core/types';

type Mesh = Pick<MeshData, 'positions' | 'indices'>;
const f = (v: number) => (Math.round(v * 1e5) / 1e5).toString();

export function writeObj(m: Mesh): string {
  const out: string[] = ['# Footwear Files fixture (mm, Z up)', 'o foot'];
  for (let i = 0; i < m.positions.length; i += 3) out.push(`v ${f(m.positions[i])} ${f(m.positions[i + 1])} ${f(m.positions[i + 2])}`);
  for (let i = 0; i < m.indices.length; i += 3) out.push(`f ${m.indices[i] + 1} ${m.indices[i + 1] + 1} ${m.indices[i + 2] + 1}`);
  return out.join('\n') + '\n';
}

export function writePlyAscii(m: Mesh): string {
  const nv = m.positions.length / 3, nf = m.indices.length / 3;
  const out = ['ply', 'format ascii 1.0', `element vertex ${nv}`, 'property float x', 'property float y', 'property float z',
    `element face ${nf}`, 'property list uchar int vertex_indices', 'end_header'];
  for (let i = 0; i < m.positions.length; i += 3) out.push(`${f(m.positions[i])} ${f(m.positions[i + 1])} ${f(m.positions[i + 2])}`);
  for (let i = 0; i < m.indices.length; i += 3) out.push(`3 ${m.indices[i]} ${m.indices[i + 1]} ${m.indices[i + 2]}`);
  return out.join('\n') + '\n';
}

export function writePlyBinary(m: Mesh): Uint8Array {
  const nv = m.positions.length / 3, nf = m.indices.length / 3;
  const header = strToU8(['ply', 'format binary_little_endian 1.0', `element vertex ${nv}`, 'property float x', 'property float y',
    'property float z', `element face ${nf}`, 'property list uchar int vertex_indices', 'end_header', ''].join('\n'));
  const body = new DataView(new ArrayBuffer(nv * 12 + nf * 13));
  let o = 0;
  for (let i = 0; i < m.positions.length; i++, o += 4) body.setFloat32(o, m.positions[i], true);
  for (let t = 0; t < nf; t++) {
    body.setUint8(o++, 3);
    for (let k = 0; k < 3; k++, o += 4) body.setInt32(o, m.indices[3 * t + k], true);
  }
  const out = new Uint8Array(header.length + body.byteLength);
  out.set(header);
  out.set(new Uint8Array(body.buffer), header.length);
  return out;
}

export function writeOff(m: Mesh): string {
  const out = ['OFF', `${m.positions.length / 3} ${m.indices.length / 3} 0`];
  for (let i = 0; i < m.positions.length; i += 3) out.push(`${f(m.positions[i])} ${f(m.positions[i + 1])} ${f(m.positions[i + 2])}`);
  for (let i = 0; i < m.indices.length; i += 3) out.push(`3 ${m.indices[i]} ${m.indices[i + 1]} ${m.indices[i + 2]}`);
  return out.join('\n') + '\n';
}

function xmlVerticesTriangles(m: Mesh, vtx: (x: string, y: string, z: string) => string, tri: (a: number, b: number, c: number) => string) {
  const v: string[] = [], t: string[] = [];
  for (let i = 0; i < m.positions.length; i += 3) v.push(vtx(f(m.positions[i]), f(m.positions[i + 1]), f(m.positions[i + 2])));
  for (let i = 0; i < m.indices.length; i += 3) t.push(tri(m.indices[i], m.indices[i + 1], m.indices[i + 2]));
  return { v: v.join(''), t: t.join('') };
}

/** 3MF package; `unit` lets tests check unit handling (coordinates are divided accordingly). */
export function write3mf(m: Mesh, unit: 'millimeter' | 'centimeter' = 'millimeter'): Uint8Array {
  const div = unit === 'centimeter' ? 10 : 1;
  const scaled = { positions: m.positions.map((x) => x / div), indices: m.indices };
  const { v, t } = xmlVerticesTriangles(scaled, (x, y, z) => `<vertex x="${x}" y="${y}" z="${z}"/>`, (a, b, c) => `<triangle v1="${a}" v2="${b}" v3="${c}"/>`);
  const model = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="${unit}" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
<resources><object id="1" type="model"><mesh><vertices>${v}</vertices><triangles>${t}</triangles></mesh></object></resources>
<build><item objectid="1"/></build></model>`;
  return zipSync({
    '[Content_Types].xml': strToU8(`<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>`),
    '_rels/.rels': strToU8(`<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>`),
    '3D/3dmodel.model': strToU8(model),
  });
}

export function writeAmf(m: Mesh, unit: 'millimeter' | 'inch' = 'millimeter'): string {
  const div = unit === 'inch' ? 25.4 : 1;
  const scaled = { positions: m.positions.map((x) => x / div), indices: m.indices };
  const { v, t } = xmlVerticesTriangles(scaled, (x, y, z) => `<vertex><coordinates><x>${x}</x><y>${y}</y><z>${z}</z></coordinates></vertex>`, (a, b, c) => `<triangle><v1>${a}</v1><v2>${b}</v2><v3>${c}</v3></triangle>`);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<amf unit="${unit}"><object id="0"><mesh><vertices>${v}</vertices><volume>${t}</volume></mesh></object></amf>\n`;
}

/** Converts app coordinates (mm, Z up) to glTF/VRML conventions (metres, Y up). */
function toYUpMetres(m: Mesh): Float32Array {
  const out = new Float32Array(m.positions.length);
  for (let i = 0; i < m.positions.length; i += 3) {
    out[i] = m.positions[i] / 1000;
    out[i + 1] = m.positions[i + 2] / 1000;
    out[i + 2] = -m.positions[i + 1] / 1000;
  }
  return out;
}

function gltfParts(m: Mesh) {
  const pos = toYUpMetres(m);
  const idx = new Uint32Array(m.indices);
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < pos.length; i++) {
    min[i % 3] = Math.min(min[i % 3], pos[i]);
    max[i % 3] = Math.max(max[i % 3], pos[i]);
  }
  const bin = new Uint8Array(pos.byteLength + idx.byteLength);
  bin.set(new Uint8Array(pos.buffer), 0);
  bin.set(new Uint8Array(idx.buffer), pos.byteLength);
  const json = {
    asset: { version: '2.0', generator: 'Footwear Files fixtures' },
    scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }],
    buffers: [{ byteLength: bin.byteLength }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: pos.byteLength, target: 34962 },
      { buffer: 0, byteOffset: pos.byteLength, byteLength: idx.byteLength, target: 34963 },
    ],
    accessors: [
      { bufferView: 0, componentType: 5126, count: pos.length / 3, type: 'VEC3', min, max },
      { bufferView: 1, componentType: 5125, count: idx.length, type: 'SCALAR' },
    ],
  };
  return { json, bin };
}

export function writeGltf(m: Mesh): string {
  const { json, bin } = gltfParts(m);
  (json.buffers[0] as Record<string, unknown>).uri = `data:application/octet-stream;base64,${Buffer.from(bin).toString('base64')}`;
  return JSON.stringify(json);
}

export function writeGlb(m: Mesh): Uint8Array {
  const { json, bin } = gltfParts(m);
  let jsonBytes = strToU8(JSON.stringify(json));
  const pad = (n: number) => (4 - (n % 4)) % 4;
  jsonBytes = Uint8Array.from([...jsonBytes, ...new Array(pad(jsonBytes.length)).fill(0x20)]);
  const binPadded = new Uint8Array(bin.length + pad(bin.length));
  binPadded.set(bin);
  const total = 12 + 8 + jsonBytes.length + 8 + binPadded.length;
  const out = new DataView(new ArrayBuffer(total));
  out.setUint32(0, 0x46546c67, true);
  out.setUint32(4, 2, true);
  out.setUint32(8, total, true);
  out.setUint32(12, jsonBytes.length, true);
  out.setUint32(16, 0x4e4f534a, true);
  new Uint8Array(out.buffer).set(jsonBytes, 20);
  const o = 20 + jsonBytes.length;
  out.setUint32(o, binPadded.length, true);
  out.setUint32(o + 4, 0x004e4942, true);
  new Uint8Array(out.buffer).set(binPadded, o + 8);
  return new Uint8Array(out.buffer);
}

/** COLLADA with <unit meter="0.001"> and Z_UP, i.e. the raw app coordinates. */
export function writeDae(m: Mesh): string {
  const pos = Array.from(m.positions, f).join(' ');
  const p = Array.from(m.indices).join(' ');
  const nv = m.positions.length / 3, nf = m.indices.length / 3;
  return `<?xml version="1.0" encoding="utf-8"?>
<COLLADA xmlns="http://www.collada.org/2005/11/COLLADASchema" version="1.4.1">
<asset><unit name="millimeter" meter="0.001"/><up_axis>Z_UP</up_axis></asset>
<library_geometries><geometry id="foot" name="foot"><mesh>
<source id="foot-pos"><float_array id="foot-pos-array" count="${nv * 3}">${pos}</float_array>
<technique_common><accessor source="#foot-pos-array" count="${nv}" stride="3"><param name="X" type="float"/><param name="Y" type="float"/><param name="Z" type="float"/></accessor></technique_common></source>
<vertices id="foot-vtx"><input semantic="POSITION" source="#foot-pos"/></vertices>
<triangles count="${nf}"><input semantic="VERTEX" source="#foot-vtx" offset="0"/><p>${p}</p></triangles>
</mesh></geometry></library_geometries>
<library_visual_scenes><visual_scene id="Scene"><node id="foot-node"><instance_geometry url="#foot"/></node></visual_scene></library_visual_scenes>
<scene><instance_visual_scene url="#Scene"/></scene>
</COLLADA>
`;
}

/** VRML97 IndexedFaceSet (metres, Y up). */
export function writeVrml(m: Mesh): string {
  const pos = toYUpMetres(m);
  const pts: string[] = [];
  const g = (v: number) => v.toPrecision(9); // metres: keep µm precision
  for (let i = 0; i < pos.length; i += 3) pts.push(`${g(pos[i])} ${g(pos[i + 1])} ${g(pos[i + 2])}`);
  const faces: string[] = [];
  for (let i = 0; i < m.indices.length; i += 3) faces.push(`${m.indices[i]} ${m.indices[i + 1]} ${m.indices[i + 2]} -1`);
  return `#VRML V2.0 utf8\nShape { geometry IndexedFaceSet { solid FALSE coord Coordinate { point [ ${pts.join(', ')} ] } coordIndex [ ${faces.join(' ')} ] } }\n`;
}

/** Rhino .3dm with one mesh object, millimetres. */
export async function write3dm(m: Mesh): Promise<Uint8Array> {
  const { default: init } = await import('rhino3dm');
  const rh = (await (init as unknown as () => Promise<unknown>)()) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  const mesh = new rh.Mesh();
  const verts = mesh.vertices();
  for (let i = 0; i < m.positions.length; i += 3) verts.add(m.positions[i], m.positions[i + 1], m.positions[i + 2]);
  const faces = mesh.faces();
  for (let i = 0; i < m.indices.length; i += 3) faces.addTriFace(m.indices[i], m.indices[i + 1], m.indices[i + 2]);
  const doc = new rh.File3dm();
  doc.settings().modelUnitSystem = rh.UnitSystem.Millimeters;
  doc.objects().add(mesh, null);
  return doc.toByteArray();
}
