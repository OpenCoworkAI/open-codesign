/**
 * Bounded experiment host policy.
 *
 * Pure validation helper: it never writes files, spawns processes, opens
 * sockets or touches the network. It only reads the job's config/preflight
 * JSON, checks that every relevant canonical path stays inside the granted
 * root, and returns a frozen snapshot of the accepted job.
 */
import { existsSync, lstatSync, readFileSync, realpathSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { z } from 'zod';
import { hashJson } from './corpus.js';
import { parseUnifiedConfig, type UnifiedConfig } from './unified-config.js';

const identifier = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const hashPattern = /^[a-f0-9]{64}$/u;
const allowedBudgets = new Set([2048]);
const maxTrials = 3;
const lockedNumbers = ['maxOutputTokens', 'summaryMaxBytes', 'timeoutMs'] as const;

const jobSchema = z.strictObject({
  id: z.string().min(1).max(64),
  track: z.string().min(1).max(64),
  config: z.string().min(1),
  preflight: z.string().min(1),
  output: z.string().min(1),
});

const planSchema = z.looseObject({
  planHash: z.string(),
  config: z.unknown(),
});

export interface HostPolicy {
  root: string;
  seedConfig: UnifiedConfig;
  remainingCalls: number;
  seenPlans: Set<string>;
}

export interface HostJob {
  id: string;
  track: string;
  config: string;
  preflight: string;
  output: string;
}

export interface ValidatedHostJob {
  id: string;
  track: string;
  configPath: string;
  preflightPath: string;
  outputPath: string;
  reserveCalls: number;
  planHash: string;
  config: UnifiedConfig & Record<string, unknown>;
  preflight: { config: UnifiedConfig & Record<string, unknown>; planHash: string } & Record<
    string,
    unknown
  >;
}

function fail(message: string): never {
  throw new Error(`Host policy: ${message}`);
}

function isUnder(base: string, candidate: string): boolean {
  const rel = relative(base, candidate);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

function realRoot(policy: HostPolicy): string {
  if (!policy || typeof policy.root !== 'string' || policy.root.length === 0)
    fail('policy root must be a non-empty path string');
  let root: string;
  try {
    root = realpathSync(resolve(policy.root));
  } catch {
    fail(`policy root does not exist or cannot be resolved: ${policy.root}`);
  }
  let stat: ReturnType<typeof lstatSync>;
  try {
    stat = lstatSync(root);
  } catch {
    fail(`policy root cannot be inspected: ${root}`);
  }
  if (!stat.isDirectory()) fail(`policy root is not a directory: ${root}`);
  return root;
}

/** Realpath of the nearest existing ancestor plus the not-yet-created tail. */
function canonicalPath(root: string, value: string, field: string): string {
  const target = resolve(value);
  if (!isAbsolute(target)) fail(`${field} path outside policy root must be absolute: ${value}`);
  const missing: string[] = [];
  let cursor = target;
  for (;;) {
    if (existsSync(cursor)) break;
    const parent = dirname(cursor);
    if (parent === cursor) fail(`${field} path cannot be resolved: ${value}`);
    missing.unshift(basename(cursor));
    cursor = parent;
  }
  let base: string;
  try {
    base = realpathSync(cursor);
  } catch {
    fail(`${field} path does not resolve inside the policy root: ${value}`);
  }
  const canonical = missing.length === 0 ? base : join(base, ...missing);
  if (!isUnder(root, canonical) || (missing.length === 0 && canonical === root))
    fail(`${field} path escapes or leaves the policy root (outside allowed root): ${value}`);
  return canonical;
}

function readJsonFile(path: string, field: string): unknown {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    fail(`${field} file cannot be read inside the policy root: ${path}`);
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    fail(`${field} file is not valid JSON: ${path}`);
  }
}

function snapshotConfig(
  value: UnifiedConfig & Record<string, unknown>,
): UnifiedConfig & Record<string, unknown> {
  return structuredClone(value);
}

/**
 * Normalize a config using the known unified schema keys while keeping the
 * unknown future dimension fields untouched, so a plan built with a newer
 * field list still compares equal to the source config.
 */
function normalizeConfig(value: unknown): UnifiedConfig & Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    fail('config must be an object');
  const source = value as Record<string, unknown>;
  const known = new Set(Object.keys(parseUnifiedConfig({})));
  const subset: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(source)) {
    if (known.has(key)) subset[key] = entry;
  }
  const normalized = { ...parseUnifiedConfig(subset) } as UnifiedConfig & Record<string, unknown>;
  for (const [key, entry] of Object.entries(source)) {
    if (!known.has(key)) normalized[key] = structuredClone(entry);
  }
  return normalized;
}

function checkIds(job: HostJob): void {
  if (!identifier.test(job.id))
    fail(`id must be lowercase alphanumeric words joined by hyphens, got: ${job.id}`);
  if (!identifier.test(job.track))
    fail(`track must be lowercase alphanumeric words joined by hyphens, got: ${job.track}`);
}

function checkLocked(source: UnifiedConfig, planConfig: UnifiedConfig, seed: UnifiedConfig): void {
  const sourceModels = source.models;
  if (hashJson(sourceModels) !== hashJson(planConfig.models))
    fail('preflight plan config does not match the source config models');
  if (hashJson(sourceModels) !== hashJson(seed.models))
    fail('config model, endpoint, credentialEnv or window differs from the locked seed policy');
  for (const key of lockedNumbers) {
    if (source[key] !== seed[key])
      fail(`config limit ${key} is locked to the seed policy value ${seed[key]}`);
    if (planConfig[key] !== seed[key])
      fail(`preflight limit ${key} does not match the seed policy value ${seed[key]}`);
  }
}

function checkBudget(config: UnifiedConfig, remaining: number): number {
  for (const budget of config.budgets) {
    if (!allowedBudgets.has(budget))
      fail(`budget ${budget} is not permitted; only [2048] is allowed`);
  }
  if (config.trials > maxTrials)
    fail(`trials ${config.trials} exceeds the policy maximum ${maxTrials}`);
  if (!Number.isInteger(config.maxCalls) || config.maxCalls <= 0)
    fail('maxCalls must be a positive integer to reserve calls');
  if (config.maxCalls > remaining)
    fail(`budget cap exhausted: reserving ${config.maxCalls} calls exceeds remaining ${remaining}`);
  return config.maxCalls;
}

/** Validate a host experiment job against the bounded policy. */
export function validateHostJob(value: unknown, policy: HostPolicy): ValidatedHostJob {
  const parsed = jobSchema.safeParse(value);
  if (!parsed.success) {
    const keys = parsed.error.issues.map((issue) => issue.path.join('.') || '(root)');
    fail(
      `job must contain only id, track, config, preflight and output (rejected: ${keys.join(', ')})`,
    );
  }
  const job = parsed.data;
  checkIds(job);
  if (!policy || typeof policy !== 'object') fail('policy object is required');
  if (!(policy.seenPlans instanceof Set)) fail('policy seenPlans must be a Set of plan hashes');
  const remaining = policy.remainingCalls;
  if (typeof remaining !== 'number' || !Number.isFinite(remaining) || remaining < 0)
    fail('policy remainingCalls must be a non-negative number');

  const seed = parseUnifiedConfigChecked(policy.seedConfig);
  const root = realRoot(policy);

  const configPath = canonicalPath(root, job.config, 'config');
  const preflightPath = canonicalPath(root, job.preflight, 'preflight');
  const outputPath = canonicalPath(root, job.output, 'output');
  if (existsSync(outputPath)) fail(`output path already exists and is refused: ${job.output}`);

  const rawConfig = readJsonFile(configPath, 'config');
  const rawPlan = readJsonFile(preflightPath, 'preflight');
  const planParsed = planSchema.safeParse(rawPlan);
  if (!planParsed.success) fail('preflight plan must be a JSON object with config and planHash');
  const plan = planParsed.data;
  if (!hashPattern.test(plan.planHash))
    fail('preflight planHash must be a canonical 64-character sha256 hex digest');

  const { planHash, ...planBody } = plan;
  const expectedHash = hashJson(planBody);
  if (expectedHash !== planHash)
    fail(
      `preflight plan hash mismatch: the plan body does not match its canonical hash ${planHash}`,
    );
  if (policy.seenPlans.has(planHash))
    fail(`duplicate plan replay refused: plan hash ${planHash} was already seen`);

  const config = parseUnifiedConfigChecked(rawConfig);
  const planConfig = parseUnifiedConfigChecked(plan.config);
  if (hashJson(normalizeConfig(rawConfig)) !== hashJson(normalizeConfig(plan.config)))
    fail('source config does not match the config recorded in the preflight plan');

  checkLocked(config, planConfig, seed);
  const reserveCalls = checkBudget(config, remaining);

  return {
    id: job.id,
    track: job.track,
    configPath,
    preflightPath,
    outputPath,
    reserveCalls,
    planHash,
    config: snapshotConfig(config),
    preflight: structuredClone(plan) as ValidatedHostJob['preflight'],
  };
}

function parseUnifiedConfigChecked(value: unknown): UnifiedConfig & Record<string, unknown> {
  if (value === undefined || value === null) fail('config value is required');
  try {
    return normalizeConfig(value);
  } catch {
    fail('config does not satisfy the unified config schema');
  }
}
