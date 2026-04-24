import { CodesignError, type Config, ERROR_CODES, hydrateConfig } from '@open-codesign/shared';
import { defaultConfigDir, writeConfig } from '../config';
import { dialog, shell } from '../electron-runtime';
import { defaultLogsDir } from '../logger';
import {
  type AppPaths,
  buildAppPathsForLocations,
  getDefaultUserDataDir,
  patchForStorageKind,
  readPersistedStorageLocations,
  type StorageKind,
  writeStorageLocations,
} from '../storage-settings';
import { getCachedConfig, setCachedConfig } from './config-cache';

export function defaultDataDir(): string {
  return getDefaultUserDataDir();
}

export function getStoragePathDefaults() {
  return {
    configDir: defaultConfigDir(),
    logsDir: defaultLogsDir(),
    dataDir: defaultDataDir(),
  };
}

export function parseStorageKind(raw: unknown): StorageKind {
  if (raw === 'config' || raw === 'logs' || raw === 'data') return raw;
  throw new CodesignError(
    'storage kind must be "config", "logs", or "data"',
    ERROR_CODES.IPC_BAD_INPUT,
  );
}

export async function runGetPaths(): Promise<AppPaths> {
  const persisted = await readPersistedStorageLocations();
  return buildAppPathsForLocations(persisted, getStoragePathDefaults());
}

export async function runChooseStorageFolder(raw: unknown): Promise<AppPaths> {
  const kind = parseStorageKind(raw);
  const result = await dialog.showOpenDialog({
    properties: ['openDirectory', 'createDirectory'],
  });
  if (result.canceled || result.filePaths.length === 0) {
    return runGetPaths();
  }
  const selected = result.filePaths[0];
  if (selected === undefined || selected.trim().length === 0) {
    return runGetPaths();
  }
  await writeStorageLocations(patchForStorageKind(kind, selected));
  return runGetPaths();
}

export async function runOpenFolder(raw: unknown): Promise<void> {
  if (typeof raw !== 'string') {
    throw new CodesignError('open-folder expects a path string', ERROR_CODES.IPC_BAD_INPUT);
  }
  const error = await shell.openPath(raw);
  if (error) {
    throw new CodesignError(`Could not open ${raw}: ${error}`, ERROR_CODES.OPEN_PATH_FAILED);
  }
}

export async function runResetOnboarding(): Promise<void> {
  const cfg = getCachedConfig();
  if (cfg === null) return;
  // Clear secrets so onboarding flow triggers again on next load.
  const next: Config = hydrateConfig({
    version: 3,
    activeProvider: cfg.activeProvider,
    activeModel: cfg.activeModel,
    secrets: {},
    providers: cfg.providers,
    ...(cfg.designSystem !== undefined ? { designSystem: cfg.designSystem } : {}),
  });
  await writeConfig(next);
  setCachedConfig(next);
}
