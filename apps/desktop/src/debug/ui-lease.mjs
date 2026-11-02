import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir, userInfo } from 'node:os';
import { join } from 'node:path';

export const uiLeaseDirectory = join(
  tmpdir(),
  `open-codesign-ui-${Buffer.from(userInfo().username).toString('hex')}.lock`,
);

function claim(directory) {
  const owner = { schemaVersion: 1, pid: process.pid, token: randomUUID() };
  try {
    mkdirSync(directory, { mode: 0o700 });
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    throw new Error('UI_DEBUG_BUSY: another UI run owns the lease; see BACKGROUND_DEBUG.md');
  }
  try {
    writeFileSync(join(directory, 'owner.json'), JSON.stringify(owner), {
      flag: 'wx',
      mode: 0o600,
    });
  } catch (error) {
    rmSync(directory, { recursive: true });
    throw error;
  }
  return {
    owner,
    release() {
      const saved = JSON.parse(readFileSync(join(directory, 'owner.json'), 'utf8'));
      if (saved.token !== owner.token) throw new Error('UI_DEBUG_LEASE_CHANGED');
      rmSync(directory, { recursive: true });
    },
  };
}

/** One lease across worktrees. Never automatically steal a stale lease: descendants may survive. */
export function acquireUiLease(role, directory = uiLeaseDirectory, env = process.env) {
  if (role === 'session' && env.CODESIGN_UI_TEST_LEASE) {
    let inherited = false;
    try {
      const owner = JSON.parse(readFileSync(join(directory, 'owner.json'), 'utf8'));
      process.kill(owner.pid, 0);
      inherited = owner.token === env.CODESIGN_UI_TEST_LEASE;
    } catch {
      // A stale or unrelated token must not bypass exclusive ownership.
    }
    if (!inherited) throw new Error('UI_DEBUG_INVALID_LEASE');
    const child = claim(join(directory, 'session'));
    return { env: {}, release: child.release };
  }
  const lease = claim(directory);
  return {
    env: role === 'suite' ? { CODESIGN_UI_TEST_LEASE: lease.owner.token } : {},
    release: lease.release,
  };
}
