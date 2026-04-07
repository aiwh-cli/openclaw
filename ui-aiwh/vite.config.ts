import { defineConfig } from 'vite';
import { resolve } from 'path';

const HERE = import.meta.dirname;
const OPENCLAW_ROOT = resolve(HERE, '..');
const DASHBOARD_PUBLIC = resolve(HERE, '../../core/dashboard/public');

export default defineConfig({
  publicDir: false,
  resolve: {
    alias: {
      '@openclaw/ui': resolve(OPENCLAW_ROOT, 'ui/src/ui'),
      '@openclaw/src': resolve(OPENCLAW_ROOT, 'src'),
    },
  },
  build: {
    outDir: resolve(DASHBOARD_PUBLIC, 'lit'),
    emptyDirFirst: false,
    sourcemap: false,
    lib: {
      entry: resolve(HERE, 'src/index.ts'),
      formats: ['es'],
      fileName: 'components',
    },
    rollupOptions: {
      // Bundle ALL deps into the output file — no externals
      external: [],
      output: {
        entryFileNames: 'components.js',
      },
    },
  },
});
