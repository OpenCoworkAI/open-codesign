import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import {
  type EngineeringConfig,
  EngineeringConfigV1,
  type EngineeringFramework,
  type EngineeringPackageManager,
  type LaunchEntry,
  type LaunchEntryConfidence,
} from '@open-codesign/shared';
import { getLogger } from '../logger';
import { readEngineeringSettings } from './settings';

const logger = getLogger('engineering-detector');

export interface DetectionResult {
  framework: EngineeringFramework | 'unsupported';
  /** Sorted by confidence (high → low). Empty when framework === 'unsupported'. */
  launchEntries: LaunchEntry[];
  packageManager: EngineeringPackageManager | null;
  /** Populated when framework === 'unsupported'. Stable values used by UI for
   *  copy: 'missing-package-json' | 'detected-vue' | 'detected-svelte' |
   *  'detected-angular' | 'detected-solid' | 'no-react-dep'. */
  reason?: string;
  /** Echoed back when a previously saved engineering config was found, so the
   *  caller knows the first launchEntry came from .codesign/settings.json. */
  savedConfig: EngineeringConfig | null;
}

interface PackageJson {
  name?: string;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  packageManager?: string;
}

const HIGH_CONFIDENCE_SCRIPT_NAMES = ['dev', 'start', 'serve'];
const HIGH_CONFIDENCE_COMMAND_TOKENS = [
  'vite',
  'next',
  'react-scripts',
  'rsbuild',
  'rspack',
  'webpack-dev-server',
  'parcel',
  'remix dev',
];

const NON_REACT_FRAMEWORK_DEPS: ReadonlyArray<readonly [string, string]> = [
  ['vue', 'detected-vue'],
  ['@vue/cli-service', 'detected-vue'],
  ['svelte', 'detected-svelte'],
  ['@sveltejs/kit', 'detected-svelte'],
  ['@angular/core', 'detected-angular'],
  ['solid-js', 'detected-solid'],
];

function readPackageJson(workspacePath: string): PackageJson | null {
  const filePath = path.join(workspacePath, 'package.json');
  if (!existsSync(filePath)) return null;
  try {
    const raw = readFileSync(filePath, 'utf8');
    return JSON.parse(raw) as PackageJson;
  } catch (err) {
    logger.warn('package.json unreadable', {
      workspacePath,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

function detectPackageManager(
  workspacePath: string,
  pkg: PackageJson | null,
): EngineeringPackageManager {
  // Prefer the explicit `packageManager` field (Corepack convention).
  const declared = pkg?.packageManager ?? '';
  if (declared.startsWith('pnpm')) return 'pnpm';
  if (declared.startsWith('yarn')) return 'yarn';
  if (declared.startsWith('bun')) return 'bun';
  if (declared.startsWith('npm')) return 'npm';

  // Fall back to lockfile presence.
  if (existsSync(path.join(workspacePath, 'pnpm-lock.yaml'))) return 'pnpm';
  if (existsSync(path.join(workspacePath, 'yarn.lock'))) return 'yarn';
  if (existsSync(path.join(workspacePath, 'bun.lockb'))) return 'bun';
  if (existsSync(path.join(workspacePath, 'bun.lock'))) return 'bun';
  if (existsSync(path.join(workspacePath, 'package-lock.json'))) return 'npm';

  return 'npm';
}

function isReactProject(pkg: PackageJson): boolean {
  const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
  return 'react' in allDeps;
}

function detectNonReactFramework(pkg: PackageJson): string | null {
  const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
  for (const [dep, reason] of NON_REACT_FRAMEWORK_DEPS) {
    if (dep in allDeps) return reason;
  }
  return null;
}

function scorePackageScript(name: string, command: string): LaunchEntryConfidence {
  const nameMatches = HIGH_CONFIDENCE_SCRIPT_NAMES.includes(name);
  const commandMatches = HIGH_CONFIDENCE_COMMAND_TOKENS.some((token) =>
    command.toLowerCase().includes(token),
  );
  if (nameMatches && commandMatches) return 'high';
  if (nameMatches || commandMatches) return 'medium';
  return 'low';
}

function packageScriptEntries(pkg: PackageJson): LaunchEntry[] {
  const scripts = pkg.scripts ?? {};
  const entries: LaunchEntry[] = [];
  for (const [name, command] of Object.entries(scripts)) {
    if (typeof command !== 'string' || command.trim() === '') continue;
    entries.push({
      schemaVersion: 1,
      kind: 'package-script',
      value: name,
      confidence: scorePackageScript(name, command),
      source: 'package-script',
      label: `${name} — ${command}`,
    });
  }
  // Sort: high → medium → low; within same confidence keep package.json order.
  const order: Record<LaunchEntryConfidence, number> = { high: 0, medium: 1, low: 2 };
  return entries.sort((a, b) => order[a.confidence] - order[b.confidence]);
}

/** Detect whether `workspacePath` can enter engineering mode and propose
 *  launch entries. Pure I/O reads — no spawning, no installation. */
export function detect(workspacePath: string): DetectionResult {
  const pkg = readPackageJson(workspacePath);
  const savedConfig = readEngineeringSettings(workspacePath);

  if (pkg === null) {
    return {
      framework: 'unsupported',
      launchEntries: [],
      packageManager: null,
      reason: 'missing-package-json',
      savedConfig,
    };
  }

  if (!isReactProject(pkg)) {
    const nonReactReason = detectNonReactFramework(pkg);
    return {
      framework: 'unsupported',
      launchEntries: [],
      packageManager: detectPackageManager(workspacePath, pkg),
      reason: nonReactReason ?? 'no-react-dep',
      savedConfig,
    };
  }

  const packageManager = detectPackageManager(workspacePath, pkg);
  const scriptEntries = packageScriptEntries(pkg);

  // Saved entry (if present) wins the top slot at high confidence so the UI
  // can short-circuit straight to start. We do not deduplicate against the
  // package script list — saved manual commands and saved script picks both
  // surface as the canonical "what we ran last time" entry.
  const launchEntries: LaunchEntry[] = [];
  if (savedConfig !== null) {
    launchEntries.push({
      schemaVersion: 1,
      kind: savedConfig.launchEntry.kind,
      value: savedConfig.launchEntry.value,
      confidence: 'high',
      source: 'saved',
      ...(savedConfig.launchEntry.label !== undefined
        ? { label: savedConfig.launchEntry.label }
        : {}),
    });
  }
  launchEntries.push(...scriptEntries);

  return {
    framework: 'react',
    launchEntries,
    packageManager,
    savedConfig,
  };
}

/** Validate that a launch entry produced by the renderer is well-formed.
 *  Used by IPC before persisting. Returns the normalized entry or throws. */
export function validateLaunchEntry(entry: unknown): LaunchEntry {
  // Re-parse through the schema's launch entry sub-shape so callers can hand
  // us renderer-side data without trusting it.
  const cfg = EngineeringConfigV1.shape.launchEntry.parse(entry);
  return cfg;
}
