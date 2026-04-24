import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'electron-vite';
import pkg from './package.json' with { type: 'json' };

const APP_VERSION = JSON.stringify(pkg.version);

export default defineConfig({
  main: {
    define: { __APP_VERSION__: APP_VERSION },
    build: {
      outDir: 'out/main',
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/main/index.ts') },
        external: [
          'electron',
          'puppeteer-core',
          'pptxgenjs',
          'zip-lib',
          'better-sqlite3',
          '@mariozechner/pi-coding-agent',
          '@mariozechner/pi-agent-core',
          '@mariozechner/pi-ai',
          '@mariozechner/pi-tui',
        ],
      },
    },
  },
  preload: {
    build: {
      outDir: 'out/preload',
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/preload/index.ts') },
        output: { format: 'cjs', entryFileNames: 'index.cjs' },
      },
    },
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    define: { __APP_VERSION__: APP_VERSION },
    build: {
      outDir: 'out/renderer',
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/renderer/index.html') },
      },
    },
    plugins: [react()],
  },
});
