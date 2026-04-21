/**
 * User preferences IPC handlers (main process).
 *
 * Persists non-provider, non-locale preferences to
 * `~/.config/open-codesign/preferences.json`.  Kept separate from config.toml
 * so it can be read quickly at boot before the TOML loader finishes.
 *
 * Schema: { schemaVersion: 1, updateChannel: 'stable'|'beta', generationTimeoutSec: number }
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { CodesignError, ERROR_CODES } from '@open-codesign/shared';
import { ipcMain } from 'electron';
import { configDir } from './config';
import { getLogger } from './logger';

const logger = getLogger('preferences-ipc');

const SCHEMA_VERSION = 3;
// v1 → v2: raise the abandoned 120s timeout default (which aborted real
// agentic runs mid-loop) to 600s. Values that happen to equal the old
// default are treated as unmigrated defaults, not user intent.
const V1_DEFAULT_TIMEOUT_SEC = 120;
// v2 -> v3: 600s still clips slower long-form multi-turn runs, so the default
// moves to 1200s.
const V2_DEFAULT_TIMEOUT_SEC = 600;

function prefsFile(): string {
  return join(configDir(), 'preferences.json');
}

export type UpdateChannel = 'stable' | 'beta';

export interface Preferences {
  updateChannel: UpdateChannel;
  generationTimeoutSec: number;
}

interface PreferencesFile extends Preferences {
  schemaVersion: number;
}

const DEFAULTS: Preferences = {
  updateChannel: 'stable',
  // Agentic runs do multiple LLM turns + tool executions + file writes, so
  // 120s was too tight and 600s still clips slower long-form runs. Default to
  // 1200s (20 min); users on fast endpoints can lower this
  // in Settings → Advanced.
  generationTimeoutSec: 1200,
};

export async function readPersisted(): Promise<Preferences> {
  const file = prefsFile();
  try {
    const raw = await readFile(file, 'utf8');
    const parsed = JSON.parse(raw) as Partial<PreferencesFile>;
    const persistedSchema = typeof parsed.schemaVersion === 'number' ? parsed.schemaVersion : 1;
    const rawTimeout =
      typeof parsed.generationTimeoutSec === 'number' && parsed.generationTimeoutSec > 0
        ? parsed.generationTimeoutSec
        : DEFAULTS.generationTimeoutSec;
    const migratedTimeout =
      persistedSchema < 2 && rawTimeout === V1_DEFAULT_TIMEOUT_SEC
        ? DEFAULTS.generationTimeoutSec
        : persistedSchema < 3 && rawTimeout === V2_DEFAULT_TIMEOUT_SEC
          ? DEFAULTS.generationTimeoutSec
          : rawTimeout;
    return {
      updateChannel:
        parsed.updateChannel === 'stable' || parsed.updateChannel === 'beta'
          ? parsed.updateChannel
          : DEFAULTS.updateChannel,
      generationTimeoutSec: migratedTimeout,
    };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { ...DEFAULTS };
    throw new CodesignError(
      `Failed to read preferences at ${file}: ${err instanceof Error ? err.message : String(err)}`,
      'PREFERENCES_READ_FAILED',
    );
  }
}

async function writePersisted(prefs: Preferences): Promise<void> {
  const file = prefsFile();
  await mkdir(dirname(file), { recursive: true });
  const payload: PreferencesFile = { schemaVersion: SCHEMA_VERSION, ...prefs };
  await writeFile(file, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

function parsePreferences(raw: unknown): Partial<Preferences> {
  if (typeof raw !== 'object' || raw === null) {
    throw new CodesignError('preferences:update expects an object', ERROR_CODES.IPC_BAD_INPUT);
  }
  const r = raw as Record<string, unknown>;
  const out: Partial<Preferences> = {};
  if (r['updateChannel'] !== undefined) {
    if (r['updateChannel'] !== 'stable' && r['updateChannel'] !== 'beta') {
      throw new CodesignError(
        'updateChannel must be "stable" or "beta"',
        ERROR_CODES.IPC_BAD_INPUT,
      );
    }
    out.updateChannel = r['updateChannel'] as UpdateChannel;
  }
  if (r['generationTimeoutSec'] !== undefined) {
    if (typeof r['generationTimeoutSec'] !== 'number' || r['generationTimeoutSec'] <= 0) {
      throw new CodesignError(
        'generationTimeoutSec must be a positive number',
        ERROR_CODES.IPC_BAD_INPUT,
      );
    }
    out.generationTimeoutSec = r['generationTimeoutSec'];
  }
  return out;
}

export function registerPreferencesIpc(): void {
  // ── Preferences v1 channels ─────────────────────────────────────────────────

  ipcMain.handle('preferences:v1:get', async (): Promise<Preferences> => {
    return readPersisted();
  });

  ipcMain.handle('preferences:v1:update', async (_e, raw: unknown): Promise<Preferences> => {
    const patch = parsePreferences(raw);
    const current = await readPersisted();
    const next: Preferences = { ...current, ...patch };
    await writePersisted(next);
    return next;
  });

  // ── Preferences legacy shims (schedule removal next minor) ──────────────────

  ipcMain.handle('preferences:get', async (): Promise<Preferences> => {
    logger.warn('legacy preferences:get channel used, schedule removal next minor');
    return readPersisted();
  });

  ipcMain.handle('preferences:update', async (_e, raw: unknown): Promise<Preferences> => {
    logger.warn('legacy preferences:update channel used, schedule removal next minor');
    const patch = parsePreferences(raw);
    const current = await readPersisted();
    const next: Preferences = { ...current, ...patch };
    await writePersisted(next);
    return next;
  });
}
