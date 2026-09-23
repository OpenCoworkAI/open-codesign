import { type Config, hydrateConfig } from '@open-codesign/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  readConfig: vi.fn<() => Promise<Config | null>>(),
  writeConfig: vi.fn(async (_config: Config) => {}),
  warn: vi.fn(),
}));
vi.mock('../config', () => ({ readConfig: mocks.readConfig, writeConfig: mocks.writeConfig }));
vi.mock('../logger', () => ({ getLogger: () => ({ warn: mocks.warn }) }));
vi.mock('../provider-settings', () => ({ isKeylessProviderAllowed: () => false }));
vi.mock('../electron-runtime', () => ({
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (value: string) => Buffer.from(`encrypted:${value}`),
    decryptString: () => {
      throw new Error('fixture-secret-in-native-error');
    },
  },
}));

import {
  getApiKeyForProvider,
  getCachedConfig,
  getOnboardingState,
  loadConfigOnBoot,
} from './config-cache';

beforeEach(() => {
  vi.clearAllMocks();
});
function config(secrets: Config['secrets']): Config {
  return hydrateConfig({ version: 3, activeProvider: '', activeModel: '', providers: {}, secrets });
}

describe('credential migration at boot', () => {
  it('loads the config and leaves Settings accessible with an invalid optional Tavily key', async () => {
    const cfg = config({ tavily: { ciphertext: 'tvly-fixture-without-prefix' } });
    mocks.readConfig.mockResolvedValueOnce(cfg);
    await expect(loadConfigOnBoot()).resolves.toBeUndefined();
    expect(getCachedConfig()).toEqual(cfg);
    expect(getOnboardingState().hasKey).toBe(false);
    expect(mocks.writeConfig).not.toHaveBeenCalled();
    expect(mocks.warn).toHaveBeenCalledWith(
      'keychain.migration.skipped',
      expect.objectContaining({ provider: 'tavily' }),
    );
    expect(JSON.stringify(mocks.warn.mock.calls)).not.toMatch(/tvly-fixture|fixture-secret/);
    expect(() => getApiKeyForProvider('tavily')).toThrow(/plain:YOUR_API_KEY/);
  });

  it('persists successful migrations without removing or rewriting an unreadable entry', async () => {
    const cfg = config({
      tavily: { ciphertext: 'legacy-fixture' },
      openai: { ciphertext: 'plain:sk-fixture' },
    });
    mocks.readConfig.mockResolvedValueOnce(cfg);
    await loadConfigOnBoot();
    expect(mocks.writeConfig).toHaveBeenCalledOnce();
    const saved = mocks.writeConfig.mock.calls[0]?.[0];
    expect(saved?.secrets['tavily']).toEqual(cfg.secrets['tavily']);
    expect(saved?.secrets['openai']?.ciphertext).toMatch(/^safe:/);
    expect(getCachedConfig()).toEqual(saved);
  });

  it('continues to support the documented explicit plaintext Tavily config', async () => {
    mocks.readConfig.mockResolvedValueOnce(
      config({ tavily: { ciphertext: 'plain:tvly-fixture' } }),
    );
    await loadConfigOnBoot();
    expect(mocks.warn).not.toHaveBeenCalled();
    expect(getCachedConfig()?.secrets['tavily']?.ciphertext).toMatch(/^safe:/);
    expect(mocks.writeConfig).toHaveBeenCalledOnce();
  });

  it('does not hide unrelated configuration read/parse errors', async () => {
    mocks.readConfig.mockRejectedValueOnce(new Error('Invalid TOML'));
    await expect(loadConfigOnBoot()).rejects.toThrow('Invalid TOML');
    expect(mocks.writeConfig).not.toHaveBeenCalled();
  });
});
