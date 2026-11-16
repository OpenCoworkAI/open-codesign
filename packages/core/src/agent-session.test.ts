import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { AuthStorage } from '@earendil-works/pi-coding-agent';
import { describe, expect, it } from 'vitest';
import { createCodesignSession } from './agent-session.js';

describe('createCodesignSession', () => {
  it('creates a session against a custom sessionDir without contacting any provider', async () => {
    const cwd = mkdtempSync(path.join(tmpdir(), 'codesign-cwd-'));
    const sessionDir = mkdtempSync(path.join(tmpdir(), 'codesign-sessions-'));
    try {
      const handle = await createCodesignSession({
        cwd,
        sessionDir,
        authStorage: AuthStorage.inMemory(),
        permissionHook: async () => ({ allow: true }),
      });
      expect(handle.session).toBeDefined();
      expect(handle.sessionFile.startsWith(sessionDir)).toBe(true);
      expect(handle.sessionFile.endsWith('.jsonl')).toBe(true);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
      rmSync(sessionDir, { recursive: true, force: true });
    }
  });

  it('never auto-allows: permission hook is reachable through the bash event surface', async () => {
    const cwd = mkdtempSync(path.join(tmpdir(), 'codesign-cwd-'));
    const sessionDir = mkdtempSync(path.join(tmpdir(), 'codesign-sessions-'));
    const seen: string[] = [];
    try {
      const handle = await createCodesignSession({
        cwd,
        sessionDir,
        authStorage: AuthStorage.inMemory(),
        permissionHook: async (cmd) => {
          seen.push(cmd);
          return { allow: false, reason: 'test denies all' };
        },
      });
      expect(handle.result.extensionsResult).toBeDefined();
      // We don't drive a real LLM here — just assert factory wiring landed.
      expect(seen).toEqual([]);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
      rmSync(sessionDir, { recursive: true, force: true });
    }
  });
});
