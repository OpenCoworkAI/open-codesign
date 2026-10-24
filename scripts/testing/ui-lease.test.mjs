import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { acquireUiLease } from '../../apps/desktop/src/debug/ui-lease.mjs';
import { requireUiTestLease } from './require-ui-lease.mjs';

test('sessions and suites share exclusive ownership, with one nested session per suite', () => {
  const directory = mkdtempSync(join(tmpdir(), 'codesign-lease-test-'));
  const lock = join(directory, 'lease');
  try {
    const session = acquireUiLease('session', lock, {});
    assert.throws(() => acquireUiLease('suite', lock, {}), /UI_DEBUG_BUSY/);
    assert.throws(() => acquireUiLease('session', lock, {}), /UI_DEBUG_BUSY/);
    session.release();
    const suite = acquireUiLease('suite', lock, {});
    assert.throws(() => requireUiTestLease(lock, {}), /SUPERVISOR_REQUIRED/);
    requireUiTestLease(lock, suite.env);
    assert.throws(() => acquireUiLease('suite', lock, suite.env), /UI_DEBUG_BUSY/);
    assert.throws(() => acquireUiLease('session', lock, {}), /UI_DEBUG_BUSY/);
    assert.throws(
      () => acquireUiLease('session', lock, { CODESIGN_UI_TEST_LEASE: 'wrong' }),
      /INVALID_LEASE/,
    );
    const child = acquireUiLease('session', lock, suite.env);
    assert.throws(() => acquireUiLease('session', lock, suite.env), /UI_DEBUG_BUSY/);
    child.release();
    acquireUiLease('session', lock, suite.env).release();
    suite.release();
    assert.throws(() => acquireUiLease('session', lock, suite.env), /INVALID_LEASE/);
    acquireUiLease('suite', lock, {}).release();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('a stale or incomplete lease cannot be stolen while descendants might remain', () => {
  const directory = mkdtempSync(join(tmpdir(), 'codesign-stale-lease-'));
  const lock = join(directory, 'lease');
  try {
    mkdirSync(lock);
    assert.throws(() => acquireUiLease('suite', lock, {}), /UI_DEBUG_BUSY/);
    const owner = { schemaVersion: 1, pid: 0x7fffffff, token: 'old-owner' };
    const contents = JSON.stringify(owner);
    writeFileSync(join(lock, 'owner.json'), contents);
    assert.throws(() => acquireUiLease('suite', lock, {}), /UI_DEBUG_BUSY/);
    assert.throws(
      () => acquireUiLease('session', lock, { CODESIGN_UI_TEST_LEASE: owner.token }),
      /INVALID_LEASE/,
    );
    assert.throws(
      () => requireUiTestLease(lock, { CODESIGN_UI_TEST_LEASE: owner.token }),
      /SUPERVISOR_REQUIRED/,
    );
    assert.equal(readFileSync(join(lock, 'owner.json'), 'utf8'), contents);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
