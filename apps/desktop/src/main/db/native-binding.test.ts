import { randomUUID } from 'node:crypto';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveNativeBindingPath } from './native-binding';

function makeReleaseDir(files: string[]): string {
  const dir = path.join(tmpdir(), `codesign-native-binding-${randomUUID()}`);
  mkdirSync(dir, { recursive: true });
  for (const file of files) {
    writeFileSync(path.join(dir, file), '');
  }
  return dir;
}

describe('resolveNativeBindingPath', () => {
  it('prefers the packaged Electron arch-specific better-sqlite3 binary', () => {
    const releaseDir = makeReleaseDir([
      'better_sqlite3.node-electron-arm64.node',
      'better_sqlite3.node-electron-x64.node',
    ]);
    try {
      expect(resolveNativeBindingPath(releaseDir, true, 'arm64')).toBe(
        path.join(releaseDir, 'better_sqlite3.node-electron-arm64.node'),
      );
    } finally {
      rmSync(releaseDir, { recursive: true, force: true });
    }
  });

  it('keeps Node tests on the Node ABI binary when not running in Electron', () => {
    const releaseDir = makeReleaseDir([
      'better_sqlite3.node-electron-arm64.node',
      'better_sqlite3.node-node.node',
    ]);
    try {
      expect(resolveNativeBindingPath(releaseDir, false, 'arm64')).toBe(
        path.join(releaseDir, 'better_sqlite3.node-node.node'),
      );
    } finally {
      rmSync(releaseDir, { recursive: true, force: true });
    }
  });

  it('allows the legacy host Electron alias for local dev only', () => {
    const releaseDir = makeReleaseDir(['better_sqlite3.node-electron.node']);
    try {
      expect(resolveNativeBindingPath(releaseDir, true, 'arm64')).toBe(
        path.join(releaseDir, 'better_sqlite3.node-electron.node'),
      );
    } finally {
      rmSync(releaseDir, { recursive: true, force: true });
    }
  });

  it('does not fall back from Electron to the default Node ABI binary', () => {
    const releaseDir = makeReleaseDir(['better_sqlite3.node']);
    try {
      expect(() => resolveNativeBindingPath(releaseDir, true, 'arm64')).toThrow(
        /Electron native binding missing/,
      );
    } finally {
      rmSync(releaseDir, { recursive: true, force: true });
    }
  });

  it('fails fast when the Node ABI binary is missing', () => {
    const releaseDir = makeReleaseDir(['better_sqlite3.node']);
    try {
      expect(() => resolveNativeBindingPath(releaseDir, false, 'arm64')).toThrow(
        /Node native binding missing/,
      );
    } finally {
      rmSync(releaseDir, { recursive: true, force: true });
    }
  });
});
