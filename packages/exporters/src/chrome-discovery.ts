import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { CodesignError } from '@open-codesign/shared';

/**
 * Locate a system Chrome/Chromium binary. We refuse to bundle Chromium —
 * PRINCIPLES §1 caps the installer at 80 MB and a Chrome download is ~150 MB.
 * Throws `EXPORTER_NO_CHROME` (loud, with install link) when nothing is found.
 */
const CHROME_INSTALL_URL = 'https://www.google.com/chrome';

const MAC_PATHS = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
];

const WIN_RELATIVE = [
  'Google\\Chrome\\Application\\chrome.exe',
  'Google\\Chrome Beta\\Application\\chrome.exe',
  'Chromium\\Application\\chrome.exe',
  'Microsoft\\Edge\\Application\\msedge.exe',
];

const LINUX_BINARIES = [
  'google-chrome-stable',
  'google-chrome',
  'chromium-browser',
  'chromium',
  'microsoft-edge',
];

export interface ChromeDiscoveryDeps {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  fileExists?: (p: string) => boolean;
  which?: (binary: string) => string | null;
}

export async function findSystemChrome(deps: ChromeDiscoveryDeps = {}): Promise<string> {
  const platform = deps.platform ?? process.platform;
  const env = deps.env ?? process.env;
  const fileExists = deps.fileExists ?? defaultFileExists;
  const which = deps.which ?? defaultWhich;

  const found = locate({ platform, env, fileExists, which });
  if (found) return found;

  throw new CodesignError(
    `System Chrome not found. Install from ${CHROME_INSTALL_URL} (or any Chromium-based browser: Edge, Chromium).`,
    'EXPORTER_NO_CHROME',
  );
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: per-OS branching is inherently a switch — extracting per-OS helpers obscures the resolution order
function locate(d: {
  platform: NodeJS.Platform;
  env: NodeJS.ProcessEnv;
  fileExists: (p: string) => boolean;
  which: (binary: string) => string | null;
}): string | null {
  const override = d.env['CODESIGN_CHROME_PATH'];
  if (override && d.fileExists(override)) return override;

  if (d.platform === 'darwin') {
    for (const p of MAC_PATHS) if (d.fileExists(p)) return p;
    return null;
  }
  if (d.platform === 'win32') {
    const roots = uniq([d.env['ProgramFiles'], d.env['ProgramFiles(x86)'], d.env['LOCALAPPDATA']]);
    for (const root of roots) {
      for (const rel of WIN_RELATIVE) {
        const candidate = `${root}\\${rel}`;
        if (d.fileExists(candidate)) return candidate;
      }
    }
    return null;
  }
  for (const bin of LINUX_BINARIES) {
    const resolved = d.which(bin);
    if (resolved && d.fileExists(resolved)) return resolved;
  }
  return null;
}

function uniq(items: ReadonlyArray<string | undefined>): string[] {
  const out: string[] = [];
  for (const item of items) {
    if (item && !out.includes(item)) out.push(item);
  }
  return out;
}

function defaultFileExists(p: string): boolean {
  try {
    return existsSync(p);
  } catch {
    return false;
  }
}

function defaultWhich(binary: string): string | null {
  try {
    const out = execFileSync('which', [binary], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const path = out.trim();
    return path.length > 0 ? path : null;
  } catch {
    return null;
  }
}
