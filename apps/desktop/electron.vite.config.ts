import { cpSync, mkdirSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'electron-vite';
import pkg from './package.json' with { type: 'json' };

const APP_VERSION = JSON.stringify(pkg.version);

// prompts/sections/*.md live in packages/core/src/prompts/sections/ and are
// read via readFileSync(import.meta.url → here) at module init. After bundling,
// loader.ts is inlined into out/main/index.js so import.meta.url resolves to
// out/main/, and load('identity') reads out/main/identity.md flat.
const PROMPT_SECTIONS_SRC = resolve(__dirname, '../../packages/core/src/prompts/sections');

function copyPromptSections() {
  return {
    name: 'codesign:copy-prompt-sections',
    writeBundle() {
      const dest = resolve(__dirname, 'out/main');
      mkdirSync(dest, { recursive: true });
      const mds = readdirSync(PROMPT_SECTIONS_SRC).filter((f) => f.endsWith('.md'));
      if (mds.length === 0) throw new Error('no prompt sections found');
      for (const name of mds) {
        cpSync(resolve(PROMPT_SECTIONS_SRC, name), resolve(dest, name));
      }
    },
  };
}

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
        plugins: [copyPromptSections()],
      },
    },
  },
  preload: {
    build: {
      outDir: 'out/preload',
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/preload/index.ts') },
        output: { format: 'cjs', entryFileNames: 'index.cjs' },
        external: ['electron'],
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
