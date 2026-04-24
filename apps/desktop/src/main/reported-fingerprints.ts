/**
 * Persisted store of recently-reported diagnostic fingerprints.
 *
 * Used by the Report dialog to warn the user "you already reported this in
 * the last 24h" before they open a duplicate GitHub issue. All entries older
 * than 24h are pruned on write.
 *
 * File shape: JSON at `~/.config/open-codesign/reported-fingerprints.json`
 * with `schemaVersion: 1`. Synchronous I/O is fine — the file is small and
 * only touched from the diagnostics IPC handlers.
 */

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join } from 'node:path';

export interface ReportedFingerprint {
  fingerprint: string;
  ts: number;
  issueUrl: string;
}

export interface ReportedFingerprintsFile {
  schemaVersion: 1;
  entries: ReportedFingerprint[];
}

const DEFAULT_WINDOW_MS = 24 * 60 * 60 * 1000;

function emptyFile(): ReportedFingerprintsFile {
  return { schemaVersion: 1, entries: [] };
}

export function readReported(filePath: string): ReportedFingerprintsFile {
  if (!existsSync(filePath)) return emptyFile();
  try {
    const raw = readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      (parsed as { schemaVersion?: unknown }).schemaVersion !== 1 ||
      !Array.isArray((parsed as { entries?: unknown }).entries)
    ) {
      return emptyFile();
    }
    const entries = ((parsed as ReportedFingerprintsFile).entries ?? []).filter(
      (e): e is ReportedFingerprint =>
        typeof e === 'object' &&
        e !== null &&
        typeof e.fingerprint === 'string' &&
        typeof e.ts === 'number' &&
        typeof e.issueUrl === 'string',
    );
    return { schemaVersion: 1, entries };
  } catch {
    return emptyFile();
  }
}

/**
 * Write `content` to `path` atomically via a temp file + rename. `renameSync`
 * is atomic on POSIX and behaves as atomic replacement on Windows since Node
 * 10, so a crash mid-write leaves either the old file or the new one — never
 * a truncated blob. Guards against clobbering when two Electron instances
 * race on the same config file.
 */
export function writeAtomic(path: string, content: string): void {
  const tmp = `${path}.tmp.${process.pid}`;
  try {
    writeFileSync(tmp, content, { encoding: 'utf8', mode: 0o600 });
    renameSync(tmp, path);
  } catch (err) {
    // Cleanup best effort — if unlink also fails we've already lost; leaving a
    // 0o600 tmp of this user's own data is the lesser evil.
    try {
      unlinkSync(tmp);
    } catch {
      // swallow
    }
    throw err;
  }
}

/**
 * One-shot sweep of stale `<filePath>.tmp.<pid>` siblings left behind by a
 * previous process that crashed mid-write. Called from boot so the config
 * directory doesn't accumulate litter across restarts.
 */
export function cleanupStaleTmps(filePath: string): void {
  const dir = dirname(filePath);
  const prefix = `${basename(filePath)}.tmp.`;
  try {
    for (const entry of readdirSync(dir)) {
      if (entry.startsWith(prefix)) {
        try {
          unlinkSync(join(dir, entry));
        } catch {
          // swallow
        }
      }
    }
  } catch {
    // swallow — a missing config dir is fine; we'll create it on first write.
  }
}

function writeFile(filePath: string, data: ReportedFingerprintsFile): void {
  try {
    mkdirSync(dirname(filePath), { recursive: true });
    writeAtomic(filePath, JSON.stringify(data, null, 2));
  } catch {
    // Best-effort — a missing dedup file just reverts us to "show the
    // warning never" behavior. Not worth crashing the report flow.
  }
}

export function recordReported(
  filePath: string,
  fingerprint: string,
  issueUrl: string,
  now: () => number = Date.now,
): void {
  const current = readReported(filePath);
  const cutoff = now() - DEFAULT_WINDOW_MS;
  const kept = current.entries.filter((e) => e.ts >= cutoff && e.fingerprint !== fingerprint);
  kept.push({ fingerprint, ts: now(), issueUrl });
  writeFile(filePath, { schemaVersion: 1, entries: kept });
}

export function findRecent(
  filePath: string,
  fingerprint: string,
  windowMs: number = DEFAULT_WINDOW_MS,
  now: () => number = Date.now,
): ReportedFingerprint | undefined {
  const file = readReported(filePath);
  const cutoff = now() - windowMs;
  const match = file.entries
    .filter((e) => e.fingerprint === fingerprint && e.ts >= cutoff)
    .sort((a, b) => b.ts - a.ts)[0];
  return match;
}
