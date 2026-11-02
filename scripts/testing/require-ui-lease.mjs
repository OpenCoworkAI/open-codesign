import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { uiLeaseDirectory } from '../../apps/desktop/src/debug/ui-lease.mjs';

export function requireUiTestLease(directory = uiLeaseDirectory, env = process.env) {
  try {
    const owner = JSON.parse(readFileSync(join(directory, 'owner.json'), 'utf8'));
    process.kill(owner.pid, 0);
    if (owner.token && owner.token === env.CODESIGN_UI_TEST_LEASE) return;
  } catch {
    // Raw Vitest invocation must not bypass the supervisor.
  }
  throw new Error('UI_TEST_SUPERVISOR_REQUIRED: use pnpm test:browser or test:debug-ui');
}
