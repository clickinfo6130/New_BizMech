import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    host: true, // allow LAN access for mobile testing
  },
  optimizeDeps: {
    // Force-bundle the sql.js CJS build so esbuild converts it to a proper
    // ESM module with a `default` export. Without this, Vite picks the
    // `browser` field (`dist/sql-wasm-browser.js`) which is an IIFE with no
    // default export and breaks `import initSqlJs from 'sql.js/...'`.
    include: ['sql.js/dist/sql-wasm.js'],
    // By default Vite crawls every .html in the project (including
    // public/viewers/viewer.html) and tries to resolve its bare imports
    // ('three', 'three/addons/...'). Those are runtime-only — the viewers
    // resolve them via an <importmap> pointing at local .js files.
    // Restrict the scanner to our real app entry so the viewer iframes are
    // left alone.
    entries: ['index.html'],
  },
  build: {
    target: 'es2020',
    sourcemap: false,
    chunkSizeWarningLimit: 1500,
  },
});
