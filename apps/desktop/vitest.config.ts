import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const rootDir = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  resolve: {
    alias: [
      {
        find: /^@excalidraw\/excalidraw$/,
        replacement: resolve(rootDir, 'src/renderer/test/excalidraw-shim.tsx'),
      },
      {
        find: /^@excalidraw\/excalidraw\/index\.css$/,
        replacement: resolve(rootDir, 'src/renderer/test/excalidraw-shim.css'),
      },
    ],
  },
});
