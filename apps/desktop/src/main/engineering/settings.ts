import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { type EngineeringConfig, EngineeringConfigV1 } from '@open-codesign/shared';
import { getLogger } from '../logger';

const logger = getLogger('engineering-settings');

const SETTINGS_DIR = '.codesign';
const SETTINGS_FILE = 'settings.json';

interface CodesignSettingsFile {
  schemaVersion?: number;
  engineering?: unknown;
  // Other top-level keys (e.g. v0.2 workspace settings) are passed through
  // unchanged so we never clobber sibling configuration.
  [key: string]: unknown;
}

function settingsPath(workspacePath: string): string {
  return path.join(workspacePath, SETTINGS_DIR, SETTINGS_FILE);
}

function readSettingsFile(workspacePath: string): CodesignSettingsFile | null {
  const filePath = settingsPath(workspacePath);
  if (!existsSync(filePath)) return null;
  try {
    const raw = readFileSync(filePath, 'utf8');
    return JSON.parse(raw) as CodesignSettingsFile;
  } catch (err) {
    logger.warn('.codesign/settings.json unreadable', {
      workspacePath,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/** Read the engineering segment of the workspace's `.codesign/settings.json`.
 *  Returns null when the file is missing, malformed, or has no engineering
 *  config. Never throws — callers treat null as "no saved config". */
export function readEngineeringSettings(workspacePath: string): EngineeringConfig | null {
  const file = readSettingsFile(workspacePath);
  if (file === null || file.engineering === undefined) return null;
  const parsed = EngineeringConfigV1.safeParse(file.engineering);
  if (!parsed.success) {
    logger.warn('engineering settings failed schema validation', {
      workspacePath,
      issues: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
    });
    return null;
  }
  return parsed.data;
}

/** Write the engineering segment of the workspace's `.codesign/settings.json`,
 *  preserving any unrelated top-level keys. Creates the `.codesign/` directory
 *  if it does not yet exist. */
export function writeEngineeringSettings(
  workspacePath: string,
  config: EngineeringConfig,
): EngineeringConfig {
  const validated = EngineeringConfigV1.parse(config);
  const dir = path.join(workspacePath, SETTINGS_DIR);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  const existing = readSettingsFile(workspacePath) ?? {};
  const next: CodesignSettingsFile = {
    schemaVersion: 1,
    ...existing,
    engineering: validated,
  };
  writeFileSync(settingsPath(workspacePath), `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  return validated;
}
