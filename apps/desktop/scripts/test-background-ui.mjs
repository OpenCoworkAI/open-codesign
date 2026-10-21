import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const child = spawn(
  process.execPath,
  [
    join(dirname(require.resolve('vitest/package.json')), 'vitest.mjs'),
    'run',
    'src/debug/ui-debug.integration.test.ts',
  ],
  {
    stdio: 'inherit',
    windowsHide: true,
    env: { ...process.env, CODESIGN_UI_DEBUG_INTEGRATION: '1' },
  },
);
child.on('error', () => {
  process.exitCode = 1;
});
child.on('exit', (code) => {
  process.exitCode = code ?? 1;
});
