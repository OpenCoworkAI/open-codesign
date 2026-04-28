import { type ChildProcess, spawn } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { EngineeringPackageManager } from '@open-codesign/shared';
import { getLogger } from '../logger';

const logger = getLogger('engineering-init');

const INSTALL_TIMEOUT_MS = 5 * 60_000;
const ERROR_EXCERPT_LINES = 30;

export interface InstallNeeded {
  needed: boolean;
  reason: 'missing-node-modules' | 'lockfile-newer' | 'no-package-json' | 'up-to-date';
}

export interface InstallProgressLine {
  stream: 'stdout' | 'stderr';
  text: string;
}

export interface InstallResult {
  exitCode: number;
  excerpt: string[];
}

const LOCKFILE_BY_PM: Record<EngineeringPackageManager, string> = {
  pnpm: 'pnpm-lock.yaml',
  npm: 'package-lock.json',
  yarn: 'yarn.lock',
  bun: 'bun.lockb',
};

/** Decide whether `<workspace>` needs an install pass before the dev server
 *  can boot. Conservative: any uncertainty defaults to "needed". */
export function shouldInstall(
  workspacePath: string,
  packageManager: EngineeringPackageManager,
): InstallNeeded {
  const packageJson = join(workspacePath, 'package.json');
  if (!existsSync(packageJson)) {
    return { needed: false, reason: 'no-package-json' };
  }
  const nodeModules = join(workspacePath, 'node_modules');
  if (!existsSync(nodeModules)) {
    return { needed: true, reason: 'missing-node-modules' };
  }
  const lockfile = join(workspacePath, LOCKFILE_BY_PM[packageManager]);
  if (existsSync(lockfile)) {
    try {
      const lockMtime = statSync(lockfile).mtimeMs;
      const modulesMtime = statSync(nodeModules).mtimeMs;
      if (lockMtime > modulesMtime + 1_000) {
        // 1s grace for filesystem timestamp granularity.
        return { needed: true, reason: 'lockfile-newer' };
      }
    } catch (err) {
      logger.warn('shouldInstall stat failed; assuming up-to-date', {
        workspacePath,
        err: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return { needed: false, reason: 'up-to-date' };
}

/** Run `<pm> install` in `workspacePath`. Resolves with exit code; the
 *  caller is responsible for treating non-zero as a launch error. */
export function runInstall(
  workspacePath: string,
  packageManager: EngineeringPackageManager,
  onLine: (line: InstallProgressLine) => void,
): Promise<InstallResult> {
  return new Promise<InstallResult>((resolve, reject) => {
    const args = packageManager === 'yarn' ? ['install'] : ['install'];
    const buffer: InstallProgressLine[] = [];
    let child: ChildProcess;
    try {
      child = spawn(packageManager, args, {
        cwd: workspacePath,
        env: {
          ...process.env,
          FORCE_COLOR: '0',
          NO_COLOR: '1',
          CI: '1',
        },
        shell: false,
        windowsHide: true,
      });
    } catch (err) {
      reject(err instanceof Error ? err : new Error(String(err)));
      return;
    }

    const timer = setTimeout(() => {
      try {
        child.kill('SIGTERM');
      } catch {
        // noop
      }
      reject(new Error(`install timed out after ${INSTALL_TIMEOUT_MS / 1000}s`));
    }, INSTALL_TIMEOUT_MS);

    const handleChunk = (stream: 'stdout' | 'stderr', chunk: Buffer | string) => {
      const text = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
      for (const text_ of text.split(/\r?\n/)) {
        if (text_ === '') continue;
        const line: InstallProgressLine = { stream, text: text_ };
        buffer.push(line);
        if (buffer.length > ERROR_EXCERPT_LINES * 4) buffer.shift();
        onLine(line);
      }
    };

    child.stdout?.on('data', (c) => handleChunk('stdout', c));
    child.stderr?.on('data', (c) => handleChunk('stderr', c));
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('exit', (code) => {
      clearTimeout(timer);
      const exitCode = code ?? -1;
      const excerpt = buffer.slice(-ERROR_EXCERPT_LINES).map((l) => l.text);
      resolve({ exitCode, excerpt });
    });
  });
}
