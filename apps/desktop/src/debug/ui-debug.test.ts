import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { uiSourceFingerprint } from './build-fingerprint';
import {
  DEFAULT_UI_STEPS,
  isolatedEnvironment,
  loadUiSteps,
  observationPassed,
  scrubDebugText,
} from './ui-debug';

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'codesign-debug-test-'));
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(root, { recursive: true, force: true });
});

it('does not inherit credentials or Node/Electron injection settings', () => {
  vi.stubEnv('OPENAI_API_KEY', 'secret-sentinel');
  vi.stubEnv('UNKNOWN_PROVIDER_TOKEN', 'secret-sentinel');
  vi.stubEnv('NODE_OPTIONS', '--require unsafe.js');
  vi.stubEnv('ELECTRON_RUN_AS_NODE', '1');
  const env = isolatedEnvironment(root);
  expect(JSON.stringify(env)).not.toContain('secret-sentinel');
  expect(env['NODE_OPTIONS']).toBeUndefined();
  expect(env['ELECTRON_RUN_AS_NODE']).toBeUndefined();
  expect(env['HOME']).toBe(join(root, 'home'));
  expect(env['USERPROFILE']).toBe(env['HOME']);
  expect(env['APPDATA']).toBe(join(root, 'home/AppData/Roaming'));
  expect(env['LOCALAPPDATA']).toBe(join(root, 'home/AppData/Local'));
  expect(env['TEMP']).toBe(join(root, 'temp'));
  expect(env['TMP']).toBe(env['TEMP']);
  expect(env['XDG_CONFIG_HOME']).toBe(join(root, 'config'));
});

describe('Windows non-interference evidence', () => {
  const observed = {
    platform: 'win32',
    available: true,
    completed: true,
    samples: 10,
    overflow: false,
    visibleWindowEvents: 0,
    foregroundEvents: 0,
    visibleSamples: 0,
    focusSamples: 0,
    injectedMouse: 0,
    injectedKeyboard: 0,
  };
  it('allows the user to move the cursor and switch applications', () => {
    expect(
      observationPassed({ ...observed, cursorUnchanged: false, foregroundUnchanged: false }),
    ).toBe(true);
  });
  it.each([
    'visibleWindowEvents',
    'foregroundEvents',
    'visibleSamples',
    'focusSamples',
    'injectedMouse',
    'injectedKeyboard',
  ])('does not pass with %s evidence', (field) =>
    expect(observationPassed({ ...observed, [field]: 1 })).toBe(false));
  it('fails closed when observation is missing or incomplete', () => {
    expect(observationPassed({ platform: 'win32', available: false })).toBe(false);
    expect(observationPassed({ ...observed, completed: false })).toBe(false);
    expect(observationPassed({ ...observed, overflow: true })).toBe(false);
    expect(observationPassed({ ...observed, samples: 0 })).toBe(false);
  });
  it('distinguishes live evidence from a completed observation', () => {
    expect(observationPassed({ ...observed, completed: false }, false)).toBe(true);
    expect(observationPassed(observed, false)).toBe(false);
  });
});

it('validates bounded steps before a browser is started', async () => {
  expect(await loadUiSteps()).toEqual(DEFAULT_UI_STEPS);
  const path = join(root, 'steps.json');
  for (const input of [
    { schemaVersion: 2, steps: [] },
    { schemaVersion: 1, steps: [] },
    { schemaVersion: 1, steps: Array.from({ length: 17 }, () => DEFAULT_UI_STEPS[0]) },
    { schemaVersion: 1, steps: [{ action: 'eval', code: 'alert(1)' }] },
  ]) {
    await writeFile(path, JSON.stringify(input));
    await expect(loadUiSteps(path)).rejects.toThrow();
  }
  await writeFile(
    path,
    JSON.stringify({ schemaVersion: 1, steps: [{ action: 'click', selector: 'button' }] }),
  );
  expect(await loadUiSteps(path)).toEqual([{ action: 'click', selector: 'button' }]);
});

it('redacts token-shaped strings and credential fields from errors', () => {
  const result = scrubDebugText(
    'apiKey=sentinel token Bearer sentinel-token sk-12345678901234567890',
  );
  expect(result).not.toContain('sentinel');
  expect(result).not.toContain('sk-123');
  expect(scrubDebugText('token=oauth-sentinel ciphertext="safe-sentinel"')).not.toContain(
    'sentinel',
  );
  expect(scrubDebugText('x'.repeat(10000))).toHaveLength(3000);
});

it('invalidates the build on shared source changes but ignores test-only files', async () => {
  const desktop = join(root, 'apps/desktop');
  await mkdir(join(desktop, 'src'), { recursive: true });
  await mkdir(join(root, 'packages/ui/src'), { recursive: true });
  for (const path of [
    'package.json',
    'pnpm-lock.yaml',
    'packages/ui/package.json',
    'apps/desktop/package.json',
    'apps/desktop/electron.vite.config.ts',
    'apps/desktop/postcss.config.cjs',
    'packages/ui/src/style.css',
  ]) {
    await writeFile(join(root, path), 'initial');
  }
  const before = await uiSourceFingerprint(desktop);
  await writeFile(join(desktop, 'src/example.test.ts'), 'test');
  expect(await uiSourceFingerprint(desktop)).toBe(before);
  await writeFile(join(root, 'packages/ui/src/style.css'), 'changed');
  expect(await uiSourceFingerprint(desktop)).not.toBe(before);
});

it('Windows observer imports observation APIs only', async () => {
  const script = await readFile(
    new URL('../../scripts/observe-background-ui.ps1', import.meta.url),
    'utf8',
  );
  expect(script).not.toMatch(
    /\b(?:SendInput|SetCursorPos|SetForegroundWindow|keybd_event|mouse_event|BlockInput)\b/,
  );
  expect(script).toContain('CallNextHookEx');
  expect(script).not.toContain('ExecutionPolicy');
});
