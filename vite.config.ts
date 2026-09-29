import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  worker: { format: 'es' },
  optimizeDeps: { exclude: ['manifold-3d'] },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    testTimeout: 30000,
  },
});
