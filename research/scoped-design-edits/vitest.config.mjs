import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const dependencies = process.env.RESEARCH_DEPENDENCY_ROOT || root;
const desktop = createRequire(path.join(dependencies, 'apps/desktop/package.json'));
const shared = createRequire(path.join(dependencies, 'packages/shared/package.json'));
export default {
  resolve: {
    alias: {
      vitest: path.join(path.dirname(desktop.resolve('vitest/package.json')), 'dist/index.js'),
      '@babel/parser': desktop.resolve('@babel/parser'),
      '@open-codesign/shared': path.join(root, 'packages/shared/src/source-edits.ts'),
      zod: shared.resolve('zod'),
    },
  },
  test: {
    include: ['research/scoped-design-edits/*.test.*'],
    environment: 'node',
    maxWorkers: 1,
  },
};
