import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  CodesignError,
  type Config,
  ConfigV3Schema,
  ERROR_CODES,
  parseConfigFlexible,
  toPersistedV3,
} from '@open-codesign/shared';
import { parse as parseToml, stringify as stringifyToml } from 'smol-toml';
import { getActiveStorageLocations } from './storage-settings';

const XDG_DEFAULT = join(homedir(), '.config', 'open-codesign');

export function defaultConfigDir(): string {
  const xdg = process.env['XDG_CONFIG_HOME'];
  if (xdg && xdg.length > 0) return join(xdg, 'open-codesign');
  return XDG_DEFAULT;
}

export function configDir(): string {
  return getActiveStorageLocations().configDir ?? defaultConfigDir();
}

export function configPath(): string {
  return join(configDir(), 'config.toml');
}

export async function readConfig(): Promise<Config | null> {
  const path = configPath();
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch (err) {
    if (isNotFound(err)) return null;
    throw new CodesignError(`Failed to read config at ${path}`, ERROR_CODES.CONFIG_READ_FAILED, {
      cause: err,
    });
  }

  let parsed: unknown;
  try {
    parsed = parseToml(raw);
  } catch (err) {
    throw new CodesignError(
      `Config at ${path} is not valid TOML`,
      ERROR_CODES.CONFIG_PARSE_FAILED,
      {
        cause: err,
      },
    );
  }

  const validated = safeParseConfig(parsed);
  if (!validated.ok) {
    throw new CodesignError(
      `Config at ${path} does not match the expected schema: ${validated.error}`,
      ERROR_CODES.CONFIG_SCHEMA_INVALID,
      { cause: validated.cause },
    );
  }
  return validated.data;
}

function safeParseConfig(
  parsed: unknown,
): { ok: true; data: Config } | { ok: false; error: string; cause: unknown } {
  try {
    return { ok: true, data: parseConfigFlexible(parsed) };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      cause: err,
    };
  }
}

export async function writeConfig(config: Config): Promise<void> {
  const persisted = toPersistedV3(config);
  // Fail fast on shape drift at write-time instead of letting a broken
  // config land on disk and crash the NEXT boot. This is how the v0.1
  // "app won't reopen after deleting all providers" bug shipped —
  // activeModel='' was written here, then readConfig's parse rejected it.
  ConfigV3Schema.parse(persisted);
  const dir = configDir();
  await mkdir(dir, { recursive: true });
  const path = configPath();
  const body = stringifyToml(persisted as Record<string, unknown>);
  await writeFile(path, body, { encoding: 'utf8', mode: 0o600 });
}

function isNotFound(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: unknown }).code === 'ENOENT'
  );
}
