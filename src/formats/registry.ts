import type { LengthUnit, UpAxis } from '../core/units';

/**
 * Supported model formats. `thread` says where the parser runs: 'worker' parsers are pure
 * JS/WASM; 'main' parsers are Three.js loaders that need DOMParser / image decoding, which
 * Web Workers don't have. Either way the result is a triangle soup that the worker welds.
 */
export interface FormatInfo {
  id: string;
  label: string;
  extensions: string[];
  thread: 'worker' | 'main';
  /** Units fixed by the format spec (overridden by units found in the file). */
  units?: LengthUnit;
  /** Up axis fixed by the format spec / loader convention. */
  upAxis?: UpAxis;
}

export const FORMATS: FormatInfo[] = [
  { id: 'stl', label: 'STL', extensions: ['stl'], thread: 'worker' },
  { id: 'obj', label: 'Wavefront OBJ', extensions: ['obj'], thread: 'worker' },
  { id: 'ply', label: 'PLY (Stanford)', extensions: ['ply'], thread: 'worker' },
  { id: 'off', label: 'OFF', extensions: ['off'], thread: 'worker' },
  { id: '3mf', label: '3MF', extensions: ['3mf'], thread: 'main', units: 'mm', upAxis: 'z' },
  { id: 'amf', label: 'AMF', extensions: ['amf'], thread: 'main', units: 'mm', upAxis: 'z' },
  { id: 'gltf', label: 'glTF / GLB', extensions: ['gltf', 'glb'], thread: 'main', units: 'm', upAxis: 'y' },
  // ColladaLoader converts Z-up files to Y-up, so the loader output is always Y-up.
  { id: 'dae', label: 'COLLADA', extensions: ['dae'], thread: 'main', upAxis: 'y' },
  { id: 'fbx', label: 'FBX', extensions: ['fbx'], thread: 'main', upAxis: 'y' },
  { id: '3ds', label: '3DS', extensions: ['3ds'], thread: 'main', upAxis: 'z' },
  { id: 'wrl', label: 'VRML', extensions: ['wrl', 'vrml'], thread: 'main', units: 'm', upAxis: 'y' },
  { id: 'step', label: 'STEP', extensions: ['step', 'stp'], thread: 'worker', units: 'mm', upAxis: 'z' },
  { id: 'iges', label: 'IGES', extensions: ['iges', 'igs'], thread: 'worker', units: 'mm', upAxis: 'z' },
  { id: 'brep', label: 'OpenCASCADE BREP', extensions: ['brep', 'brp'], thread: 'worker', upAxis: 'z' },
  { id: '3dm', label: 'Rhino 3DM', extensions: ['3dm'], thread: 'worker', upAxis: 'z' },
];

/** Native CAD formats that can't be read in a browser, with advice on what to export instead. */
export const UNSUPPORTED: Record<string, string> = {
  f3d: 'Fusion 360 .f3d files are a proprietary archive that no open library can read. In Fusion 360 use File → Export and choose STEP (.stp) for CAD bodies or STL/OBJ for meshes, then open that file.',
  f3z: 'Fusion 360 .f3z files are proprietary. Export STEP or STL from Fusion 360 instead.',
  sldprt: 'SolidWorks parts are proprietary. Save As STEP (.step) or STL from SolidWorks.',
  sldasm: 'SolidWorks assemblies are proprietary. Save As STEP (.step) or STL from SolidWorks.',
  ipt: 'Inventor parts are proprietary. Export STEP or STL from Inventor.',
  iam: 'Inventor assemblies are proprietary. Export STEP or STL from Inventor.',
  prt: 'Native CAD part files (Creo/NX) are proprietary. Export STEP or STL instead.',
  catpart: 'CATIA parts are proprietary. Export STEP or STL from CATIA.',
  x_t: 'Parasolid files are not supported. Export STEP or STL instead.',
  x_b: 'Parasolid files are not supported. Export STEP or STL instead.',
  skp: 'SketchUp files are not supported. Export OBJ, STL or glTF from SketchUp.',
  blend: 'Blender files are not supported. Export OBJ, STL, PLY or glTF from Blender.',
  usdz: 'USDZ is not supported yet. Export OBJ, STL or glTF instead.',
  xyz: 'Point clouds (.xyz) have no surface. Mesh the scan first (e.g. in the scanner software) and export STL/OBJ/PLY.',
  pcd: 'Point clouds (.pcd) have no surface. Mesh the scan first and export STL/OBJ/PLY.',
};

export function extensionOf(fileName: string): string {
  const m = /\.([^.]+)$/.exec(fileName.toLowerCase());
  return m ? m[1] : '';
}

export function formatForFile(fileName: string): FormatInfo | null {
  const ext = extensionOf(fileName);
  return FORMATS.find((f) => f.extensions.includes(ext)) ?? null;
}

/** Value for the file input's `accept` attribute. */
export const ACCEPT = [...FORMATS.flatMap((f) => f.extensions), 'tffproj', 'json'].map((e) => `.${e}`).join(',');

export function unsupportedMessage(fileName: string): string {
  const ext = extensionOf(fileName);
  return (
    UNSUPPORTED[ext] ??
    `Unsupported file type ".${ext}". Supported: ${FORMATS.flatMap((f) => f.extensions).join(', ')}, plus .tffproj projects and landmark .json.`
  );
}
