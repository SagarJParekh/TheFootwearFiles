/// <reference lib="webworker" />
/**
 * Heavy mesh operations run here so the UI never blocks. Exposed via Comlink;
 * the main thread talks to it through `meshClient.ts`.
 *
 * Meshes are passed as `MeshRef`: either the full MeshData, or just `{ id }` when the
 * worker already holds that mesh version in its small cache (avoids structured-cloning
 * tens of MB on the main thread for every call). Unknown ids throw MESH_NOT_CACHED and
 * the client retries with the full mesh. Results are transferred (zero-copy); the worker
 * keeps its own copy of result meshes so follow-up calls can use the id.
 */
import * as Comlink from 'comlink';
import Module, { type ManifoldToplevel } from 'manifold-3d';
import manifoldWasmUrl from 'manifold-3d/manifold.wasm?url';
import type { ProjectDocument } from '../core/document';
import { deserializeProject, serializeProject } from '../core/io/project';
import { writeBinaryStl } from '../core/io/stlWrite';
import { transformPositions } from '../core/math/transform';
import { analyzeMesh } from '../core/mesh/analyze';
import { distancesToSurface } from '../core/mesh/closestPoint';
import { cutMeshByPlane, type CutResult } from '../core/mesh/cut';
import { fillHoles, type FillOptions } from '../core/mesh/fill/fillHoles';
import { findBoundaryLoops, suggestExcludedLoops } from '../core/mesh/holes';
import { manifoldTrim } from '../core/mesh/manifoldCut';
import { computeVertexNormals } from '../core/mesh/normals';
import { makeMesh, type MeshData, type MeshStats, type Plane, type RigidTransform, type Vec3 } from '../core/types';
import { adjustArchPositions, archRegion } from '../core/foot/archAdjust';
import { MESH_NOT_CACHED, type MeshRef } from './meshRef';
import type { ImportInfo } from '../core/units';
import { generateInsole, samplePlantarSurface, type InsoleResult, type PlantarSurface } from '../core/insole/generate';
import type { InsoleParams } from '../core/insole/params';
import type { FrameLandmarks } from '../core/insole/frame';
import { fuseFootwearSolids, generateFootwear, prepareFootData, type FootData, type FootwearResult } from '../core/footwear/generate';
import { concatMeshes, latticeToMesh } from '../core/footwear/lattice';
import { mergeFootwear } from '../core/footwear/merge';
import { MESH_DETAIL, type MeshDetail } from '../core/detail';
import type { FootwearParams } from '../core/footwear/params';

// Plantar surface sampling is the slow part (rasterising the whole scan) – cache the latest.
// (a few entries: the insole and the footwear may use different mesh detail = grid spacing)
const plantarCache = new Map<string, PlantarSurface>();
function plantarSurface(mesh: MeshData, transform: RigidTransform, landmarks: FrameLandmarks, detail: MeshDetail = 'standard'): PlantarSurface {
  const key = `${mesh.id}|${JSON.stringify(transform)}|${JSON.stringify(landmarks)}|${detail}`;
  let surface = plantarCache.get(key);
  if (!surface) {
    surface = samplePlantarSurface(transformPositions(mesh.positions, transform), mesh.indices, landmarks, MESH_DETAIL[detail].grid);
    if (plantarCache.size >= 3) plantarCache.delete(plantarCache.keys().next().value!);
    plantarCache.set(key, surface);
  }
  return surface;
}

export type InsoleOutput = Omit<InsoleResult, 'mesh'> & { mesh: MeshData; normals: Float32Array };

// Footwear: per-scan data (dorsum raster, silhouette, BVH) and the last generated parts (for export).
let footCache: { key: string; data: FootData } | null = null;
function footData(mesh: MeshData, transform: RigidTransform, landmarks: FrameLandmarks, detail: MeshDetail): FootData {
  const key = `${mesh.id}|${JSON.stringify(transform)}|${JSON.stringify(landmarks)}|${detail}`;
  if (footCache?.key !== key) {
    const surface = plantarSurface(mesh, transform, landmarks, detail);
    footCache = { key, data: prepareFootData(surface, transformPositions(mesh.positions, transform), mesh.indices) };
  }
  return footCache.data;
}
let lastFootwear: { key: string; result: FootwearResult; fused: MeshData | null } | null = null;
/**
 * The generated footwear. With smooth joins, the solid parts are replaced by one smoothly fused
 * solid (fillets at every junction); the lattice is unchanged.
 */
function footwear(mesh: MeshData, transform: RigidTransform, landmarks: FrameLandmarks, params: FootwearParams): FootwearResult {
  const key = `${mesh.id}|${JSON.stringify(transform)}|${JSON.stringify(landmarks)}|${JSON.stringify(params)}`;
  if (lastFootwear?.key !== key) {
    const foot = footData(mesh, transform, landmarks, params.detail);
    const result = generateFootwear(foot, params);
    let fused: MeshData | null = null;
    if (params.smoothJoins) {
      fused = fuseFootwearSolids(foot, result, params.clearance, MESH_DETAIL[params.detail].fuseVoxel);
      const all = concatMeshes([fused, latticeToMesh(result.parts.lattice, MESH_DETAIL[params.detail].strutSides)]);
      result.mesh = makeMesh(all.positions, all.indices);
      result.parts = { ...result.parts, solids: [fused] };
    }
    lastFootwear = { key, result, fused };
  }
  return lastFootwear.result;
}

export type FootwearOutput = Omit<FootwearResult, 'mesh' | 'parts'> & { mesh: MeshData; normals: Float32Array };
import { finishImport, type ImportOverrides } from '../formats/finishImport';
import { FORMATS, type FormatInfo } from '../formats/registry';
import {
  parse3dmModel, parseCadModel, parseObjModel, parseOffModel, parsePlyModel, parseStlModel, type ParsedModel,
} from '../formats/workerParsers';

/** Hole description sent to the UI (loop polyline instead of vertex indices). */
export interface HoleInfo {
  id: number;
  edgeCount: number;
  perimeter: number;
  diameter: number;
  centroid: Vec3;
  /** Closed polyline, xyz per loop vertex (mesh-local). */
  points: Float32Array;
  suggestedExclude: boolean;
}

/**
 * manifold-3d (single-threaded WASM) scales poorly past ~1.5M triangles (≈3 s at 1.3M,
 * ≈23 s at 5M) while the own split is ~6× faster, so manifold is used below this size.
 */
const MANIFOLD_MAX_TRIANGLES = 1_500_000;

let manifoldPromise: Promise<ManifoldToplevel> | null = null;
function manifold(): Promise<ManifoldToplevel> {
  manifoldPromise ??= Module({ locateFile: () => manifoldWasmUrl }).then((m) => {
    m.setup();
    return m;
  });
  return manifoldPromise;
}

// --- mesh cache ---------------------------------------------------------------
const CACHE_SIZE = 3;
const cache = new Map<string, MeshData>();

function remember(mesh: MeshData): void {
  cache.delete(mesh.id);
  cache.set(mesh.id, mesh);
  while (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value!);
}

function resolve(ref: MeshRef): MeshData {
  if ('positions' in ref) {
    remember(ref);
    return ref;
  }
  const m = cache.get(ref.id);
  if (!m) throw new Error(MESH_NOT_CACHED);
  remember(m);
  return m;
}

/** Keeps a private copy of each result mesh, then marks the originals' buffers for transfer. */
function transferMesh<T extends object>(result: T, ...meshes: MeshData[]): T {
  for (const m of meshes) remember({ id: m.id, positions: m.positions.slice(), indices: m.indices.slice() });
  return Comlink.transfer(
    result,
    meshes.flatMap((m) => [m.positions.buffer as ArrayBuffer, m.indices.buffer as ArrayBuffer]),
  );
}

export interface LoadResult {
  mesh: MeshData;
  stats: MeshStats;
  normals: Float32Array;
  info: ImportInfo;
  detail?: string;
}

function finish(parsed: ParsedModel, format: FormatInfo, overrides: ImportOverrides): LoadResult {
  const { mesh, info } = finishImport(parsed, format, overrides);
  const stats = analyzeMesh(mesh);
  const normals = computeVertexNormals(mesh);
  return Comlink.transfer(transferMesh({ mesh, stats, normals, info, detail: parsed.detail }, mesh), [normals.buffer]);
}

const api = {
  /** Parses a worker-side format (STL, OBJ, PLY, OFF, STEP, IGES, BREP, 3DM). */
  async loadModel(buffer: ArrayBuffer, formatId: string, overrides: ImportOverrides = {}): Promise<LoadResult> {
    const format = FORMATS.find((f) => f.id === formatId);
    if (!format) throw new Error(`Unknown format ${formatId}`);
    let parsed: ParsedModel;
    switch (format.id) {
      case 'stl': parsed = parseStlModel(buffer); break;
      case 'obj': parsed = parseObjModel(buffer); break;
      case 'ply': parsed = parsePlyModel(buffer); break;
      case 'off': parsed = parseOffModel(buffer); break;
      case 'step': case 'iges': case 'brep': parsed = await parseCadModel(buffer, format.id); break;
      case '3dm': parsed = await parse3dmModel(buffer); break;
      default: throw new Error(`${format.label} must be parsed on the main thread`);
    }
    return finish(parsed, format, overrides);
  },

  /** Finishes an import whose parsing happened on the main thread (DOM-based loaders). */
  async loadSoup(parsed: ParsedModel, formatId: string, overrides: ImportOverrides = {}): Promise<LoadResult> {
    const format = FORMATS.find((f) => f.id === formatId);
    if (!format) throw new Error(`Unknown format ${formatId}`);
    return finish(parsed, format, overrides);
  },

  async analyze(ref: MeshRef): Promise<MeshStats> {
    return analyzeMesh(resolve(ref));
  },

  async normals(ref: MeshRef): Promise<Float32Array> {
    const n = computeVertexNormals(resolve(ref));
    return Comlink.transfer(n, [n.buffer]);
  },

  async surfaceDistances(ref: MeshRef, points: Vec3[]): Promise<number[]> {
    return distancesToSurface(resolve(ref), points);
  },

  /**
   * Hybrid plane cut: manifold-3d for watertight meshes when capping (robust, always closed),
   * otherwise the own split + planar cap which also handles open scans.
   */
  async cut(ref: MeshRef, plane: Plane, keepPositive: boolean, cap: boolean, watertight: boolean): Promise<CutResult & { fallbackReason?: string }> {
    const mesh = resolve(ref);
    let fallbackReason: string | undefined;
    const tryManifold = async () => {
      const out = manifoldTrim(await manifold(), mesh, plane, keepPositive);
      return transferMesh({ mesh: out, cappedLoops: -1, openCutLoops: 0, method: 'manifold' as const }, out);
    };
    const small = mesh.indices.length / 3 <= MANIFOLD_MAX_TRIANGLES;
    if (cap && watertight && small) {
      try {
        return await tryManifold();
      } catch (e) {
        fallbackReason = e instanceof Error ? e.message : String(e);
      }
    }
    const r = cutMeshByPlane(mesh, plane, { keepPositive, cap });
    // Large watertight meshes use the (much faster) split first; fall back to manifold only
    // if the split result is not closed.
    if (cap && watertight && !small && !analyzeMesh(r.mesh).watertight) {
      try {
        return await tryManifold();
      } catch (e) {
        fallbackReason = e instanceof Error ? e.message : String(e);
      }
    }
    return transferMesh({ ...r, fallbackReason }, r.mesh);
  },

  /** Raises (+) / lowers (−) the arch of the foot scan itself; returns the modified mesh. */
  async adjustFootArch(ref: MeshRef, transform: RigidTransform, landmarks: FrameLandmarks, delta: number): Promise<MeshData> {
    const mesh = resolve(ref);
    const out = makeMesh(adjustArchPositions(mesh.positions, transform, archRegion(landmarks), delta), mesh.indices.slice());
    return transferMesh(out, out);
  },

  /** Foot length from the scan footprint (for the shoe-size suggestion). */
  async measureFoot(ref: MeshRef, transform: RigidTransform, landmarks: FrameLandmarks): Promise<number | null> {
    return plantarSurface(resolve(ref), transform, landmarks).footLength;
  },

  /** Generates the insole / orthosis solid (world coordinates) for the given parameters. */
  async generateInsole(ref: MeshRef, transform: RigidTransform, landmarks: FrameLandmarks, params: InsoleParams): Promise<InsoleOutput> {
    const r = generateInsole(plantarSurface(resolve(ref), transform, landmarks, params.detail), params);
    const normals = computeVertexNormals(r.mesh);
    return Comlink.transfer(transferMesh({ ...r, normals }, r.mesh), [normals.buffer]);
  },

  /** Generates the footwear (shoe / chappal) for the given parameters (world coordinates). */
  async generateFootwear(ref: MeshRef, transform: RigidTransform, landmarks: FrameLandmarks, params: FootwearParams): Promise<FootwearOutput> {
    const { mesh: _mesh, parts: _parts, ...rest } = footwear(resolve(ref), transform, landmarks, params);
    const mesh = makeMesh(_mesh.positions.slice(), _mesh.indices.slice());
    const normals = computeVertexNormals(mesh);
    return Comlink.transfer({ ...rest, mesh, normals }, [mesh.positions.buffer, mesh.indices.buffer, normals.buffer]);
  },

  /**
   * Footwear STL. `merge` = one watertight solid (manifold-3d union, slow); otherwise the
   * overlapping closed parts, which slicers union themselves.
   */
  async exportFootwearStl(ref: MeshRef, transform: RigidTransform, landmarks: FrameLandmarks, params: FootwearParams, merge: boolean): Promise<ArrayBuffer> {
    const r = footwear(resolve(ref), transform, landmarks, params);
    const mesh = merge ? mergeFootwear(await manifold(), r.parts, MESH_DETAIL[params.detail].strutSides) : r.mesh;
    const buf = writeBinaryStl({ positions: mesh.positions, indices: mesh.indices });
    return Comlink.transfer(buf, [buf]);
  },

  async findHoles(ref: MeshRef): Promise<HoleInfo[]> {
    const mesh = resolve(ref);
    const loops = findBoundaryLoops(mesh);
    const excluded = suggestExcludedLoops(loops);
    const holes = loops.map((l) => {
      const points = new Float32Array(l.vertices.length * 3);
      l.vertices.forEach((v, i) => points.set(mesh.positions.subarray(3 * v, 3 * v + 3), 3 * i));
      return {
        id: l.id, edgeCount: l.edgeCount, perimeter: l.perimeter, diameter: l.diameter,
        centroid: l.centroid, points, suggestedExclude: excluded.has(l.id),
      };
    });
    return Comlink.transfer(holes, holes.map((h) => h.points.buffer as ArrayBuffer));
  },

  async fillHoles(ref: MeshRef, loopIds: number[], options: FillOptions) {
    const r = fillHoles(resolve(ref), loopIds, options);
    return transferMesh(r, r.mesh);
  },

  async saveProject(doc: Omit<ProjectDocument, 'mesh'>, ref: MeshRef): Promise<Uint8Array> {
    const bytes = serializeProject({ ...doc, mesh: resolve(ref) });
    return Comlink.transfer(bytes, [bytes.buffer as ArrayBuffer]);
  },

  async loadProject(buffer: ArrayBuffer): Promise<{ doc: ProjectDocument; stats: MeshStats; normals: Float32Array }> {
    const doc = deserializeProject(new Uint8Array(buffer));
    const stats = analyzeMesh(doc.mesh);
    const normals = computeVertexNormals(doc.mesh);
    return Comlink.transfer(transferMesh({ doc, stats, normals }, doc.mesh), [normals.buffer]);
  },

  async exportStl(ref: MeshRef, transform: RigidTransform | null): Promise<ArrayBuffer> {
    const mesh = resolve(ref);
    const positions = transform ? transformPositions(mesh.positions, transform) : mesh.positions;
    const buf = writeBinaryStl({ positions, indices: mesh.indices });
    return Comlink.transfer(buf, [buf]);
  },
};

export type MeshWorkerApi = typeof api;

Comlink.expose(api);
