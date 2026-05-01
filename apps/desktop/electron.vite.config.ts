import { cpSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'electron-vite';
import pkg from './package.json' with { type: 'json' };

const APP_VERSION = JSON.stringify(pkg.version);
const WORKSPACE_PACKAGES = [
  '@open-codesign/artifacts',
  '@open-codesign/core',
  '@open-codesign/exporters',
  '@open-codesign/i18n',
  '@open-codesign/providers',
  '@open-codesign/runtime',
  '@open-codesign/shared',
  '@open-codesign/templates',
  '@open-codesign/ui',
];
const BUNDLED_RUNTIME_PACKAGES = [
  '@mariozechner/pi-agent-core',
  '@mariozechner/pi-ai',
  '@mariozechner/pi-coding-agent',
  'electron-log',
  'electron-log/main',
  'electron-updater',
  'pptxgenjs',
  'smol-toml',
  'zip-lib',
];

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
      for (const name of readdirSync(dest).filter((f) => f.endsWith('.md'))) {
        rmSync(resolve(dest, name), { force: true });
      }
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
      externalizeDeps: { exclude: [...WORKSPACE_PACKAGES, ...BUNDLED_RUNTIME_PACKAGES] },
      outDir: 'out/main',
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/main/index.ts') },
        treeshake: {
          moduleSideEffects: (id) =>
            !id.includes('/node_modules/@mariozechner/pi-coding-agent/dist/'),
        },
        external: ['electron', 'puppeteer-core', 'better-sqlite3'],
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
