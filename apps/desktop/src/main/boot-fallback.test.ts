import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { formatBootError, showBootDialog, writeBootErrorSync } from './boot-fallback';

function mkCtx(overrides: Partial<Parameters<typeof formatBootError>[0]> = {}) {
  return {
    error: new Error('bad config'),
    logsDir: join(tmpdir(), 'open-codesign-boot-fallback-test'),
    appVersion: '0.2.0',
    platform: 'darwin',
    electronVersion: '30.0.0',
    nodeVersion: '22.0.0',
    ...overrides,
  };
}

describe('formatBootError', () => {
  it('includes message, stack, and env for Error inputs', () => {
    const err = new Error('kaboom');
    const out = formatBootError(mkCtx({ error: err }));
    expect(out).toContain('kaboom');
    expect(out).toContain('App version: 0.2.0');
    expect(out).toContain('Electron: 30.0.0');
    const firstStackLine = err.stack?.split('\n')[0] ?? '';
    expect(out).toContain(firstStackLine);
  });

  it('stringifies non-Error values with a placeholder stack', () => {
    const out = formatBootError(mkCtx({ error: 'string-err' }));
    expect(out).toContain('string-err');
    expect(out).toContain('(no stack available)');
  });

  it('includes a timestamp in ISO 8601 form', () => {
    const out = formatBootError(mkCtx());
    expect(out).toMatch(/Timestamp: \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });
});

describe('writeBootErrorSync', () => {
  it('writes to the provided logsDir, creating it if missing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'boot-fallback-ok-'));
    const nested = join(dir, 'nested-logs');
    try {
      const out = writeBootErrorSync(mkCtx({ logsDir: nested }));
      expect(out).toBe(join(nested, 'boot-errors.log'));
      expect(existsSync(out)).toBe(true);
      expect(readFileSync(out, 'utf8')).toContain('Open CoDesign boot failure');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('falls back to the OS tmpdir when the primary path is unwritable', () => {
    // Build a path whose parent is a regular file — mkdirSync then throws
    // ENOTDIR on both POSIX and Windows, exercising the tmpdir fallback in a
    // platform-agnostic way.
    const scratchDir = mkdtempSync(join(tmpdir(), 'boot-fallback-bad-'));
    const blocker = join(scratchDir, 'not-a-dir');
    writeFileSync(blocker, 'blocker');
    try {
      const bogus = join(blocker, 'logs');
      const out = writeBootErrorSync(mkCtx({ logsDir: bogus }));
      expect(out).toBe(join(tmpdir(), 'boot-errors.log'));
      expect(existsSync(out)).toBe(true);
    } finally {
      rmSync(scratchDir, { recursive: true, force: true });
    }
  });
});

describe('showBootDialog', () => {
  it('does NOT call the driver when app.isReady() is false', () => {
    const driver = { showMessageBoxSync: vi.fn(() => 0) };
    const stderrWrite = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    try {
      const result = showBootDialog({ isReady: () => false }, driver, {
        type: 'error',
        message: 'boom',
        detail: '/tmp/x.log',
        buttons: ['Quit'],
        defaultId: 0,
        cancelId: 0,
      });
      expect(driver.showMessageBoxSync).not.toHaveBeenCalled();
      expect(result).toBe(0);
      expect(stderrWrite).toHaveBeenCalled();
    } finally {
      stderrWrite.mockRestore();
    }
  });

  it('calls the driver when app.isReady() is true and returns its choice', () => {
    const driver = { showMessageBoxSync: vi.fn(() => 2) };
    const result = showBootDialog({ isReady: () => true }, driver, {
      type: 'error',
      message: 'boom',
      buttons: ['A', 'B', 'C'],
      defaultId: 2,
      cancelId: 2,
    });
    expect(driver.showMessageBoxSync).toHaveBeenCalledTimes(1);
    expect(result).toBe(2);
  });

  it('returns 0 when not ready and cancelId is undefined', () => {
    const driver = { showMessageBoxSync: vi.fn(() => 9) };
    const stderrWrite = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    try {
      const result = showBootDialog({ isReady: () => false }, driver, {
        type: 'error',
        message: 'm',
      });
      expect(result).toBe(0);
    } finally {
      stderrWrite.mockRestore();
    }
  });
});
