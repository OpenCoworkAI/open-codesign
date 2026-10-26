import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const dependencies = process.env.RESEARCH_DEPENDENCY_ROOT || root;
const core = createRequire(path.join(dependencies, 'packages/core/package.json'));
const shared = createRequire(path.join(dependencies, 'packages/shared/package.json'));

export default {
  resolve: {
    alias: [
      {
        find: /^@open-codesign\/shared$/,
        replacement: path.join(root, 'packages/shared/src/index.ts'),
      },
      {
        find: /^@open-codesign\/providers$/,
        replacement: path.join(root, 'packages/providers/src/index.ts'),
      },
      {
        find: /^vitest$/,
        replacement: path.join(path.dirname(core.resolve('vitest/package.json')), 'dist/index.js'),
      },
      { find: /^zod$/, replacement: shared.resolve('zod') },
      { find: /^yaml$/, replacement: shared.resolve('yaml') },
      { find: /^@sinclair\/typebox\/value$/, replacement: core.resolve('@sinclair/typebox/value') },
      { find: /^@sinclair\/typebox$/, replacement: core.resolve('@sinclair/typebox') },
    ],
  },
  test: {
    include: ['research/goal-aware-context/*.test.*'],
    environment: 'node',
    maxWorkers: 1,
  },
};
