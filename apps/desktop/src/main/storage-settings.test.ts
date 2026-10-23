import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ERROR_CODES } from '@open-codesign/shared';
import { afterEach, describe, expect, it } from 'vitest';
import {
  buildAppPaths,
  buildAppPathsForLocations,
  coerceWindowsDriveBase,
  initStorageSettings,
  isWindowsDriveRoot,
  patchForStorageKind,
  readPersistedStorageLocations,
  storageSettingsPath,
  writeStorageLocations,
} from './storage-settings';

const tempDirs: string[] = [];

async function tempRoot(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'open-codesign-storage-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('buildAppPaths', () => {
  it('returns file paths and their containing folders for config and logs', () => {
    const paths = buildAppPaths(
      '/tmp/open-codesign/config.toml',
      '/tmp/open-codesign/logs/main.log',
      '/tmp/open-codesign',
    );

    expect(paths).toEqual({
      config: '/tmp/open-codesign/config.toml',
      configFolder: '/tmp/open-codesign',
      logs: '/tmp/open-codesign/logs/main.log',
      logsFolder: '/tmp/open-codesign/logs',
      data: '/tmp/open-codesign',
    });
  });

  it('builds paths from persisted storage locations and defaults', () => {
    const configDir = join('custom', 'config');
    const dataDir = join('custom', 'data');
    const logsDir = join('default', 'logs');
    const paths = buildAppPathsForLocations(
      { configDir, dataDir },
      {
        configDir: join('default', 'config'),
        logsDir,
        dataDir: join('default', 'data'),
      },
    );

    expect(paths).toEqual({
      config: join(configDir, 'config.toml'),
      configFolder: configDir,
      logs: join(logsDir, 'main.log'),
      logsFolder: logsDir,
      data: dataDir,
    });
  });

  it('persists storage locations in the bootstrap userData directory', async () => {
    const root = await tempRoot();
    initStorageSettings(root);
    const dataDir = join(root, 'chosen-data');

    const next = await writeStorageLocations(patchForStorageKind('data', dataDir));

    expect(next).toEqual({ dataDir });
    await expect(readPersistedStorageLocations(root)).resolves.toEqual({ dataDir });
    await expect(readFile(storageSettingsPath(root), 'utf8')).resolves.toContain('"dataDir":');
  });

  it('fails fast when boot-time storage settings are malformed', async () => {
    const root = await tempRoot();
    await writeFile(storageSettingsPath(root), '{"dataDir":', 'utf8');

    expect(() => initStorageSettings(root)).toThrow(
      expect.objectContaining({ code: ERROR_CODES.STORAGE_SETTINGS_PARSE_FAILED }),
    );
  });
});

describe('Windows storage path guards', () => {
  it('detects drive roots and coerces bare drive letters', () => {
    if (process.platform !== 'win32') {
      // Helpers are no-ops / false on non-Windows; still exercise the API.
      expect(isWindowsDriveRoot('D:\\')).toBe(false);
      expect(coerceWindowsDriveBase('D:')).toBe('D:');
      return;
    }
    expect(isWindowsDriveRoot('D:\\')).toBe(true);
    expect(isWindowsDriveRoot('D:')).toBe(true);
    expect(isWindowsDriveRoot('D:\\codesign')).toBe(false);
    expect(coerceWindowsDriveBase('D:')).toBe('D:\\');
    expect(coerceWindowsDriveBase('D:\\codesign')).toBe('D:\\codesign');
  });

  it('rejects Windows drive roots when persisting storage locations', async () => {
    if (process.platform !== 'win32') return;
    const root = await tempRoot();
    initStorageSettings(root);
    await expect(
      writeStorageLocations(patchForStorageKind('config', 'D:\\')),
    ).rejects.toMatchObject({
      code: ERROR_CODES.STORAGE_SETTINGS_INVALID,
    });
    await expect(writeStorageLocations(patchForStorageKind('config', 'D:'))).rejects.toMatchObject({
      code: ERROR_CODES.STORAGE_SETTINGS_INVALID,
    });
  });
});
