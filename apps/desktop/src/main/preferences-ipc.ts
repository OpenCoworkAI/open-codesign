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
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { CodesignError } from '@open-codesign/shared';
import { ipcMain } from 'electron';
import { getLogger } from './logger';

const logger = getLogger('preferences-ipc');

const CONFIG_DIR = join(homedir(), '.config', 'open-codesign');
const PREFS_FILE = join(CONFIG_DIR, 'preferences.json');
const SCHEMA_VERSION = 1;

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
  generationTimeoutSec: 120,
};

async function readPersisted(): Promise<Preferences> {
  try {
    const raw = await readFile(PREFS_FILE, 'utf8');
    const parsed = JSON.parse(raw) as Partial<PreferencesFile>;
    return {
      updateChannel:
        parsed.updateChannel === 'stable' || parsed.updateChannel === 'beta'
          ? parsed.updateChannel
          : DEFAULTS.updateChannel,
      generationTimeoutSec:
        typeof parsed.generationTimeoutSec === 'number' && parsed.generationTimeoutSec > 0
          ? parsed.generationTimeoutSec
          : DEFAULTS.generationTimeoutSec,
    };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { ...DEFAULTS };
    console.warn(`[preferences-ipc] failed to read ${PREFS_FILE}:`, err);
    return { ...DEFAULTS };
  }
}

async function writePersisted(prefs: Preferences): Promise<void> {
  await mkdir(dirname(PREFS_FILE), { recursive: true });
  const payload: PreferencesFile = { schemaVersion: SCHEMA_VERSION, ...prefs };
  await writeFile(PREFS_FILE, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

function parsePreferences(raw: unknown): Partial<Preferences> {
  if (typeof raw !== 'object' || raw === null) {
    throw new CodesignError('preferences:update expects an object', 'IPC_BAD_INPUT');
  }
  const r = raw as Record<string, unknown>;
  const out: Partial<Preferences> = {};
  if (r['updateChannel'] !== undefined) {
    if (r['updateChannel'] !== 'stable' && r['updateChannel'] !== 'beta') {
      throw new CodesignError('updateChannel must be "stable" or "beta"', 'IPC_BAD_INPUT');
    }
    out.updateChannel = r['updateChannel'] as UpdateChannel;
  }
  if (r['generationTimeoutSec'] !== undefined) {
    if (typeof r['generationTimeoutSec'] !== 'number' || r['generationTimeoutSec'] <= 0) {
      throw new CodesignError('generationTimeoutSec must be a positive number', 'IPC_BAD_INPUT');
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
