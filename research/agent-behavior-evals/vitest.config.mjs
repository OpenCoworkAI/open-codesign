import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const dependencies = process.env.RESEARCH_DEPENDENCY_ROOT || root;
const provider = createRequire(path.join(dependencies, 'packages/providers/package.json'));
export default {
  resolve: {
    alias: {
      vitest: path.join(path.dirname(provider.resolve('vitest/package.json')), 'dist/index.js'),
    },
  },
  test: {
    include: ['research/agent-behavior-evals/*.test.*'],
    environment: 'node',
    maxWorkers: 1,
  },
};
