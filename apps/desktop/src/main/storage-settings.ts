import { existsSync, readFileSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { CodesignError, ERROR_CODES } from '@open-codesign/shared';

export interface AppPaths {
  config: string;
  configFolder: string;
  logs: string;
  logsFolder: string;
  data: string;
}

export type StorageKind = 'config' | 'logs' | 'data';

export interface StorageLocations {
  configDir?: string;
  logsDir?: string;
  dataDir?: string;
}

export type StorageLocationPatch = Partial<
  Record<keyof StorageLocations, string | null | undefined>
>;

export interface StoragePathDefaults {
  configDir: string;
  logsDir: string;
  dataDir: string;
}

interface StorageSettingsFile extends StorageLocations {
  schemaVersion: 1;
}

const STORAGE_SETTINGS_FILE = 'storage-settings.json';

let bootstrapUserDataDir: string | null = null;
let activeLocations: StorageLocations = {};

export function buildAppPaths(configFile: string, logFile: string, dataDir: string): AppPaths {
  return {
    config: configFile,
    configFolder: dirname(configFile),
    logs: logFile,
    logsFolder: dirname(logFile),
    data: dataDir,
  };
}

export function initStorageSettings(defaultUserDataDir: string): StorageLocations {
  bootstrapUserDataDir = defaultUserDataDir;
  activeLocations = readStorageLocationsSync(defaultUserDataDir);
  return getActiveStorageLocations();
}

export function getActiveStorageLocations(): StorageLocations {
  return { ...activeLocations };
}

export function getDefaultUserDataDir(): string {
  return requireBootstrapDir();
}

export function storageSettingsPath(defaultUserDataDir = requireBootstrapDir()): string {
  return join(defaultUserDataDir, STORAGE_SETTINGS_FILE);
}

export function buildAppPathsForLocations(
  locations: StorageLocations,
  defaults: StoragePathDefaults,
): AppPaths {
  const dirs = resolveStorageDirs(locations, defaults);
  return buildAppPaths(
    join(dirs.configDir, 'config.toml'),
    join(dirs.logsDir, 'main.log'),
    dirs.dataDir,
  );
}

export function resolveStorageDirs(
  locations: StorageLocations,
  defaults: StoragePathDefaults,
): Required<StorageLocations> {
  return {
    configDir: locations.configDir ?? defaults.configDir,
    logsDir: locations.logsDir ?? defaults.logsDir,
    dataDir: locations.dataDir ?? defaults.dataDir,
  };
}

export async function readPersistedStorageLocations(
  defaultUserDataDir = requireBootstrapDir(),
): Promise<StorageLocations> {
  const file = storageSettingsPath(defaultUserDataDir);
  try {
    const raw = await readFile(file, 'utf8');
    return parseStorageSettingsFile(raw);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw new CodesignError(
      `Failed to read storage settings at ${file}: ${
        err instanceof Error ? err.message : String(err)
      }`,
      ERROR_CODES.STORAGE_SETTINGS_READ_FAILED,
    );
  }
}

export async function writeStorageLocations(
  patch: StorageLocationPatch,
  defaultUserDataDir = requireBootstrapDir(),
): Promise<StorageLocations> {
  const current = await readPersistedStorageLocations(defaultUserDataDir);
  const next = applyStorageLocationPatch(current, patch);
  const payload: StorageSettingsFile = { schemaVersion: 1, ...next };
  const file = storageSettingsPath(defaultUserDataDir);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  return next;
}

export function patchForStorageKind(kind: StorageKind, dir: string): StorageLocationPatch {
  switch (kind) {
    case 'config':
      return { configDir: dir };
    case 'logs':
      return { logsDir: dir };
    case 'data':
      return { dataDir: dir };
  }
}

function requireBootstrapDir(): string {
  if (bootstrapUserDataDir === null) {
    throw new CodesignError(
      'Storage settings were read before boot initialization',
      ERROR_CODES.BOOT_ORDER,
    );
  }
  return bootstrapUserDataDir;
}

function readStorageLocationsSync(defaultUserDataDir: string): StorageLocations {
  const file = storageSettingsPath(defaultUserDataDir);
  if (!existsSync(file)) return {};
  try {
    return parseStorageSettingsFile(readFileSync(file, 'utf8'));
  } catch (err) {
    if (err instanceof CodesignError) throw err;
    throw new CodesignError(
      `Failed to read storage settings at ${file}: ${
        err instanceof Error ? err.message : String(err)
      }`,
      ERROR_CODES.STORAGE_SETTINGS_READ_FAILED,
      { cause: err },
    );
  }
}

function parseStorageSettingsFile(raw: string): StorageLocations {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new CodesignError(
      `storage-settings.json is not valid JSON: ${
        err instanceof Error ? err.message : String(err)
      }`,
      ERROR_CODES.STORAGE_SETTINGS_PARSE_FAILED,
    );
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new CodesignError(
      'storage-settings.json must contain an object',
      ERROR_CODES.STORAGE_SETTINGS_INVALID,
    );
  }
  return sanitizeStorageLocations(parsed as Record<string, unknown>);
}

function sanitizeStorageLocations(raw: Record<string, unknown>): StorageLocations {
  const out: StorageLocations = {};
  const configDir = normalizeOptionalDir(raw['configDir']);
  const logsDir = normalizeOptionalDir(raw['logsDir']);
  const dataDir = normalizeOptionalDir(raw['dataDir']);
  if (configDir !== undefined) out.configDir = configDir;
  if (logsDir !== undefined) out.logsDir = logsDir;
  if (dataDir !== undefined) out.dataDir = dataDir;
  return out;
}

function applyStorageLocationPatch(
  current: StorageLocations,
  patch: StorageLocationPatch,
): StorageLocations {
  const next: StorageLocations = { ...current };
  if ('configDir' in patch) applyDir(next, 'configDir', patch.configDir);
  if ('logsDir' in patch) applyDir(next, 'logsDir', patch.logsDir);
  if ('dataDir' in patch) applyDir(next, 'dataDir', patch.dataDir);
  return next;
}

function applyDir(
  target: StorageLocations,
  key: keyof StorageLocations,
  value: string | null | undefined,
): void {
  if (value === null || value === undefined || value.trim().length === 0) {
    delete target[key];
    return;
  }
  target[key] = normalizeDir(value);
}

function normalizeOptionalDir(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.trim().length === 0) return undefined;
  return normalizeDir(value);
}

function normalizeDir(value: string): string {
  const trimmed = value.trim();
  if (!isAbsolute(trimmed)) {
    throw new CodesignError(
      `Storage directory must be an absolute path: ${value}`,
      ERROR_CODES.STORAGE_SETTINGS_INVALID,
    );
  }
  return resolve(trimmed);
}
