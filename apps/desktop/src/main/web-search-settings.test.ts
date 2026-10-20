import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseConfigFlexible, toPersistedV3 } from '@open-codesign/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as configFile from './config';
import { readConfigRedacted } from './diagnostics/redact';
import { decryptSecret } from './keychain';
import { getCachedConfig, loadConfigOnBoot, setCachedConfig } from './onboarding/config-cache';
import {
  getWebSearchSettings,
  saveWebSearchSettings,
  testWebSearchSettings,
} from './web-search-settings';

const mocks = vi.hoisted(() => ({
  configDir: '',
  encrypted: false,
  probe: vi.fn(),
  log: vi.fn(),
}));
vi.mock('./storage-settings', () => ({
  getActiveStorageLocations: () => ({ configDir: mocks.configDir }),
}));
vi.mock('./electron-runtime', () => ({
  safeStorage: {
    isEncryptionAvailable: () => mocks.encrypted,
    encryptString: (value: string) => Buffer.from(`encrypted:${value}`),
    decryptString: (value: Buffer) => {
      const text = value.toString();
      if (!text.startsWith('encrypted:')) throw new Error('private decrypt failure');
      return text.slice('encrypted:'.length);
    },
  },
}));
vi.mock('./logger', () => ({
  getLogger: () => ({ warn: mocks.log, info: mocks.log, error: mocks.log, debug: mocks.log }),
}));
vi.mock('./web-research-network', () => ({ testTavilyConnection: mocks.probe }));

const key = 'tvly-settings-test-fixture';
const limits = { enabled: true, maxCalls: 7, timeoutMs: 4000, maxChars: 3000 };
function fixture(ciphertext = `plain:${key}`) {
  return parseConfigFlexible({
    version: 3,
    activeProvider: '',
    activeModel: '',
    providers: {},
    secrets: { tavily: { ciphertext }, other: { ciphertext: 'plain:other-fixture' } },
    webSearch: limits,
    imageGeneration: { schemaVersion: 1, enabled: false },
  });
}

beforeEach(async () => {
  mocks.configDir = await mkdtemp(join(tmpdir(), 'codesign-search-settings-'));
  mocks.encrypted = false;
  mocks.probe.mockReset().mockResolvedValue({ status: 'ok' });
  mocks.log.mockClear();
  setCachedConfig(fixture());
});
afterEach(async () => {
  vi.restoreAllMocks();
  await rm(mocks.configDir, { recursive: true, force: true });
});

describe('web search settings persistence', () => {
  it('reads only configured status, without decrypting or returning any credential', () => {
    setCachedConfig(fixture('safe:unreadable-fixture'));
    expect(getWebSearchSettings()).toEqual({ enabled: true, hasKey: true });
    expect(JSON.stringify(getWebSearchSettings())).not.toContain(key);
    expect(mocks.probe).not.toHaveBeenCalled();
  });

  it('preserves keys, limits and unrelated settings when toggling search', async () => {
    const before = toPersistedV3(fixture());
    expect(await saveWebSearchSettings({ enabled: false })).toEqual({
      enabled: false,
      hasKey: true,
    });
    const stored = await configFile.readConfig();
    expect(stored && toPersistedV3(stored)).toEqual({
      ...before,
      webSearch: { ...limits, enabled: false },
    });
    expect(getCachedConfig()?.webSearch?.enabled).toBe(false);
    expect(mocks.probe).not.toHaveBeenCalled();
  });

  it.each([
    false,
    true,
  ])('saves and replaces a key using existing encryption (encrypted=%s)', async (encrypted) => {
    mocks.encrypted = encrypted;
    for (const apiKey of ['tvly-first-fixture', 'tvly-replacement-fixture']) {
      const state = await saveWebSearchSettings({ apiKey });
      expect(state).toEqual({ enabled: true, hasKey: true });
      const stored = await configFile.readConfig();
      const ref = stored?.secrets['tavily'];
      expect(ref?.ciphertext).toMatch(encrypted ? /^safe:/ : /^plain:/);
      expect(decryptSecret(ref?.ciphertext ?? '')).toBe(apiKey);
      expect(JSON.stringify(state)).not.toContain(apiKey);
      const diagnostic = await readConfigRedacted({ includePaths: true, includeUrls: true });
      expect(diagnostic).not.toContain(apiKey);
      expect(diagnostic).not.toContain(ref?.ciphertext);
      expect(diagnostic).toContain('***REDACTED***');
      expect(stored?.webSearch).toEqual(limits);
      expect(stored?.secrets['other']).toEqual(fixture().secrets['other']);
    }
    expect(JSON.stringify(mocks.log.mock.calls)).not.toContain('tvly-');
    expect(mocks.probe).not.toHaveBeenCalled();
  });

  it.each([
    true,
    false,
  ])('clears only Tavily and preserves the enabled=%s switch', async (enabled) => {
    setCachedConfig(
      parseConfigFlexible({ ...toPersistedV3(fixture()), webSearch: { ...limits, enabled } }),
    );
    expect(await saveWebSearchSettings({ clearKey: true })).toEqual({ enabled, hasKey: false });
    const stored = await configFile.readConfig();
    expect(stored?.secrets['tavily']).toBeUndefined();
    expect(stored?.secrets['other']).toEqual(fixture().secrets['other']);
    expect(stored?.webSearch).toEqual({ ...limits, enabled });
    expect(await readFile(configFile.configPath(), 'utf8')).not.toContain(key);
    await saveWebSearchSettings({ enabled: !enabled });
    expect(getWebSearchSettings().hasKey).toBe(false);
  });

  it('preserves absent webSearch when only replacing or clearing a key', async () => {
    const { webSearch: _settings, ...rest } = toPersistedV3(fixture());
    setCachedConfig(parseConfigFlexible(rest));
    await saveWebSearchSettings({ apiKey: 'tvly-new-fixture' });
    expect(getCachedConfig()?.webSearch).toBeUndefined();
    await saveWebSearchSettings({ clearKey: true });
    expect(getCachedConfig()?.webSearch).toBeUndefined();
  });

  it('can configure before model onboarding without auto enabling search', async () => {
    await loadConfigOnBoot();
    expect(getWebSearchSettings()).toEqual({ enabled: false, hasKey: false });
    await saveWebSearchSettings({ apiKey: key });
    expect(getWebSearchSettings()).toEqual({ enabled: false, hasKey: true });
    expect((await configFile.readConfig())?.activeProvider).toBe('');
  });

  it.each([
    null,
    { enabled: 'true' },
    { apiKey: '' },
    { apiKey: '  ' },
    { apiKey: `${key}\nunsafe` },
    { apiKey: key, clearKey: true },
    { unknown: key },
  ])('rejects invalid payloads with sanitized errors', async (input) => {
    await expect(saveWebSearchSettings(input)).rejects.toMatchObject({
      code: 'IPC_BAD_INPUT',
      message: 'Invalid web search settings.',
    });
    expect(getCachedConfig()?.secrets['tavily']).toEqual(fixture().secrets['tavily']);
  });

  it('retains cache on persistence failure and does not leak low-level errors', async () => {
    vi.spyOn(configFile, 'writeConfig').mockRejectedValueOnce(new Error(`failed ${key}`));
    await expect(saveWebSearchSettings({ clearKey: true })).rejects.toMatchObject({
      code: 'WEB_SEARCH_SAVE_FAILED',
      message: 'Could not save web search settings.',
    });
    expect(getWebSearchSettings().hasKey).toBe(true);
    await saveWebSearchSettings({ enabled: false });
    expect(getWebSearchSettings()).toEqual({ enabled: false, hasKey: true });
  });

  it('serializes overlapping search settings saves without losing keys or switch', async () => {
    await Promise.all([
      saveWebSearchSettings({ apiKey: 'tvly-concurrent-fixture' }),
      saveWebSearchSettings({ enabled: false }),
    ]);
    expect(decryptSecret(getCachedConfig()?.secrets['tavily']?.ciphertext ?? '')).toBe(
      'tvly-concurrent-fixture',
    );
    expect(getWebSearchSettings()).toEqual({ enabled: false, hasKey: true });
  });
});

describe('explicit saved-key testing', () => {
  it('reports missing and unreadable credentials locally without making a request', async () => {
    await saveWebSearchSettings({ clearKey: true });
    expect(await testWebSearchSettings()).toEqual({ status: 'missing-key' });
    setCachedConfig(fixture('safe:unreadable-fixture'));
    expect(await testWebSearchSettings()).toEqual({ status: 'unreadable-key' });
    expect(mocks.probe).not.toHaveBeenCalled();
  });

  it.each([
    'plain',
    'safe',
    'legacy',
  ])('supports %s credential format without modifying the configuration', async (format) => {
    mocks.encrypted = true;
    const encoded = Buffer.from(`encrypted:${key}`).toString('base64');
    const ciphertext =
      format === 'plain' ? `plain:${key}` : format === 'safe' ? `safe:${encoded}` : encoded;
    setCachedConfig(fixture(ciphertext));
    await saveWebSearchSettings({ enabled: false });
    const before = getCachedConfig();
    expect(await testWebSearchSettings()).toEqual({ status: 'ok' });
    expect(mocks.probe).toHaveBeenCalledExactlyOnceWith(key, limits.timeoutMs);
    expect(getCachedConfig()).toBe(before);
    expect(getWebSearchSettings().enabled).toBe(false);
  });
});
