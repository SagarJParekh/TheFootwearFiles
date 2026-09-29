import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  worker: { format: 'es' },
  optimizeDeps: {
    exclude: ['manifold-3d'],
    // Pre-bundle lazily imported format loaders so the dev server doesn't reload the page
    // the first time a user opens e.g. a STEP or glTF file.
    include: [
      'occt-import-js',
      'three/examples/jsm/loaders/OBJLoader.js',
      'three/examples/jsm/loaders/PLYLoader.js',
      'three/examples/jsm/loaders/3MFLoader.js',
      'three/examples/jsm/loaders/AMFLoader.js',
      'three/examples/jsm/loaders/GLTFLoader.js',
      'three/examples/jsm/loaders/DRACOLoader.js',
      'three/examples/jsm/libs/meshopt_decoder.module.js',
      'three/examples/jsm/loaders/ColladaLoader.js',
      'three/examples/jsm/loaders/FBXLoader.js',
      'three/examples/jsm/loaders/TDSLoader.js',
      'three/examples/jsm/loaders/VRMLLoader.js',
    ],
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    testTimeout: 30000,
  },
});
