declare module 'three-mesh-bvh/src/workers/GenerateMeshBVHWorker.js' {
  import type { BufferGeometry } from 'three';
  import type { MeshBVH, MeshBVHOptions } from 'three-mesh-bvh';
  export class GenerateMeshBVHWorker {
    readonly running: boolean;
    generate(geometry: BufferGeometry, options?: MeshBVHOptions): Promise<MeshBVH>;
    dispose(): void;
  }
}

declare module 'occt-import-js' {
  const init: (module?: { locateFile?: (path: string) => string }) => Promise<unknown>;
  export default init;
}
declare module 'rhino3dm/rhino3dm.module.js' {
  const init: (module?: { locateFile?: (path: string) => string }) => Promise<unknown>;
  export default init;
}

/** Commit and date of the running version (vite.config.ts). */
declare const __APP_VERSION__: string;
