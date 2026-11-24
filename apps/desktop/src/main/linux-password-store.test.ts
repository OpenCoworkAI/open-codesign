import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  applyLinuxPasswordStore,
  linuxPasswordStorePath,
  linuxPasswordStoreRemediation,
} from './linux-password-store';

let directory: string;
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'codesign-password-store-'));
});
afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(directory, { recursive: true, force: true });
});

function commandLine(overridden = false) {
  return { hasSwitch: vi.fn(() => overridden), appendSwitch: vi.fn() };
}

describe('persistent Linux password-store selection', () => {
  it.each([
    'gnome-libsecret',
    'kwallet',
    'kwallet5',
    'kwallet6',
  ])('applies the configured secure backend %s independently of desktop recognition', (backend) => {
    vi.stubEnv('XDG_CURRENT_DESKTOP', 'unrecognized-window-manager');
    const filename = linuxPasswordStorePath(directory);
    writeFileSync(filename, JSON.stringify({ schemaVersion: 1, passwordStore: backend }));
    const before = readFileSync(filename);
    for (let launch = 0; launch < 2; launch++) {
      const chrome = commandLine();
      expect(applyLinuxPasswordStore('linux', directory, chrome)).toEqual({ source: 'file' });
      expect(chrome.appendSwitch).toHaveBeenCalledExactlyOnceWith('password-store', backend);
    }
    expect(readFileSync(filename).equals(before)).toBe(true);
  });

  it('leaves Electron selection alone when no preference exists', () => {
    const chrome = commandLine();
    expect(applyLinuxPasswordStore('linux', directory, chrome)).toEqual({
      source: 'platform-default',
    });
    expect(chrome.appendSwitch).not.toHaveBeenCalled();
  });

  it.each([
    'basic',
    'basic_text',
    'gnome_libsecret',
    'unknown',
    'gnome-libsecret --no-sandbox',
  ])('rejects insecure or unsupported stored backend %s', (backend) => {
    writeFileSync(
      linuxPasswordStorePath(directory),
      JSON.stringify({ schemaVersion: 1, passwordStore: backend }),
    );
    const chrome = commandLine();
    expect(applyLinuxPasswordStore('linux', directory, chrome)).toMatchObject({
      source: 'invalid',
      warning: expect.stringContaining('Insecure backends are not supported'),
    });
    expect(chrome.appendSwitch).not.toHaveBeenCalled();
  });

  it.each([
    '{',
    'null',
    '[]',
    '{"schemaVersion":2,"passwordStore":"gnome-libsecret"}',
  ])('keeps startup safe and reports malformed settings %s', (settings) => {
    writeFileSync(linuxPasswordStorePath(directory), settings);
    const chrome = commandLine();
    expect(applyLinuxPasswordStore('linux', directory, chrome).source).toBe('invalid');
    expect(chrome.appendSwitch).not.toHaveBeenCalled();
  });

  it('preserves an explicit command-line choice even if the preference is malformed', () => {
    writeFileSync(linuxPasswordStorePath(directory), '{');
    const chrome = commandLine(true);
    expect(applyLinuxPasswordStore('linux', directory, chrome)).toEqual({ source: 'command-line' });
    expect(chrome.hasSwitch).toHaveBeenCalledWith('password-store');
    expect(chrome.appendSwitch).not.toHaveBeenCalled();
  });

  it.each([
    'darwin',
    'win32',
  ] as const)('does not change other platform startup: %s', (platform) => {
    writeFileSync(linuxPasswordStorePath(directory), '{');
    const chrome = commandLine();
    expect(applyLinuxPasswordStore(platform, directory, chrome)).toEqual({
      source: 'platform-default',
    });
    expect(chrome.hasSwitch).not.toHaveBeenCalled();
    expect(chrome.appendSwitch).not.toHaveBeenCalled();
  });

  it('points remediation at the active config directory and requires a full restart', () => {
    expect(linuxPasswordStoreRemediation(directory)).toContain(linuxPasswordStorePath(directory));
    expect(linuxPasswordStoreRemediation(directory)).toContain('fully quit and restart');
    expect(linuxPasswordStoreRemediation(directory)).toContain('may already be installed');
  });
});
