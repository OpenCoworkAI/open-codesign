#!/usr/bin/env tsx
/**
 * smoke-models.ts — batch-test (provider, model, prompt) combos through the
 * exact same `generate()` code path the desktop app uses. Saves each artifact
 * to /tmp/smoke/, runs lightweight quality checks, prints a colored report.
 *
 * Usage:
 *   pnpm smoke
 *   pnpm smoke --model openai/gpt-oss-120b:free
 *   pnpm smoke --prompt "数据看板"
 *   pnpm smoke --only-failed
 *   pnpm smoke --config scripts/my-models.toml
 *
 * API keys come from the environment (one per provider you want to hit):
 *   OPENROUTER_API_KEY, ANTHROPIC_API_KEY, OPENAI_API_KEY, GOOGLE_API_KEY,
 *   GROQ_API_KEY, CEREBRAS_API_KEY, XAI_API_KEY, MISTRAL_API_KEY.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import * as TOML from '@iarna/toml';
import { generate } from '@open-codesign/core';
import { Parser } from 'acorn';

interface SmokeModel {
  provider: string;
  modelId: string;
}
interface SmokePrompt {
  name: string;
  text: string;
}
interface SmokeConfig {
  prompts: SmokePrompt[];
  models: SmokeModel[];
}

interface RunResult {
  model: string;
  prompt: string;
  ok: boolean;
  ms: number;
  bytes: number;
  artifactPath?: string;
  issues: string[];
  error?: string;
}

const ENV_KEY: Record<string, string> = {
  anthropic: 'ANTHROPIC_API_KEY',
  openai: 'OPENAI_API_KEY',
  google: 'GOOGLE_API_KEY',
  openrouter: 'OPENROUTER_API_KEY',
  groq: 'GROQ_API_KEY',
  cerebras: 'CEREBRAS_API_KEY',
  xai: 'XAI_API_KEY',
  mistral: 'MISTRAL_API_KEY',
};

const COLOR = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  dim: '\x1b[2m',
  bold: '\x1b[1m',
};

const SMOKE_DIR = '/tmp/smoke';
const LAST_RESULTS = `${SMOKE_DIR}/.last-results.json`;

function parseConfig(path: string): SmokeConfig {
  const raw = readFileSync(path, 'utf8');
  const parsed = TOML.parse(raw) as unknown as SmokeConfig;
  if (!Array.isArray(parsed.prompts) || !Array.isArray(parsed.models)) {
    throw new Error(`${path} must declare [[prompts]] and [[models]] tables`);
  }
  return parsed;
}

function slug(model: SmokeModel, prompt: SmokePrompt): string {
  const safeModel = `${model.provider}_${model.modelId}`.replace(/[^a-zA-Z0-9._-]/g, '_');
  const safePrompt = prompt.name.replace(/[^a-zA-Z0-9._-]/g, '_');
  return `${safeModel}__${safePrompt}`;
}

function qualityCheck(html: string): string[] {
  const issues: string[] = [];

  const mainCount = (html.match(/<main[\s>]/gi) ?? []).length;
  if (mainCount > 1) issues.push(`${mainCount}x <main> elements`);

  // Emoji used as content icons (anti-slop). Heuristic: emoji codepoint sitting
  // inside a <div> with aria-hidden or a role suggesting decoration. Broad,
  // intentionally — false positives are cheap signals here.
  const emojiInIcon = html.match(
    /aria-hidden=["']true["'][^>]*>[\s]*[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu,
  );
  if (emojiInIcon) issues.push(`${emojiInIcon.length} emoji icon(s)`);

  // Validate every <script> body parses as JS. We deliberately don't
  // distinguish module from script (Babel handles JSX in the artifact at
  // runtime) — just check it's lexically clean enough that tools like esbuild
  // wouldn't choke.
  const scripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)];
  for (const m of scripts) {
    const body = m[1]?.trim();
    if (!body) continue;
    try {
      Parser.parse(body, { ecmaVersion: 'latest', sourceType: 'script' });
    } catch (err) {
      issues.push(`script syntax error: ${(err as Error).message.split('\n')[0]}`);
      break;
    }
  }

  if (!/TWEAK_DEFAULTS\s*=\s*\/\*EDITMODE-BEGIN\*\//.test(html)) {
    issues.push('no EDITMODE block');
  }

  return issues;
}

function printResult(r: RunResult): void {
  if (r.ok) {
    const head = `${COLOR.green}✓${COLOR.reset} ${COLOR.bold}${r.model}${COLOR.reset} × ${r.prompt}`;
    const body = `${COLOR.dim}${(r.ms / 1000).toFixed(1)}s  ${(r.bytes / 1024).toFixed(1)}kb  →${COLOR.reset} ${r.artifactPath}`;
    console.log(head);
    console.log(`  ${body}`);
    for (const issue of r.issues) {
      console.log(`  ${COLOR.yellow}⚠${COLOR.reset} ${issue}`);
    }
  } else {
    console.log(`${COLOR.red}✗${COLOR.reset} ${COLOR.bold}${r.model}${COLOR.reset} × ${r.prompt}`);
    console.log(`  ${COLOR.red}${r.error}${COLOR.reset}`);
  }
}

async function runOne(model: SmokeModel, prompt: SmokePrompt, apiKey: string): Promise<RunResult> {
  const t0 = Date.now();
  try {
    const result = await generate({
      prompt: prompt.text,
      history: [],
      model: { provider: model.provider as never, modelId: model.modelId },
      apiKey,
      onRetry: (info) => {
        console.log(`  ${COLOR.dim}↻ retry: ${info.reason}${COLOR.reset}`);
      },
    });
    const ms = Date.now() - t0;
    const artifact = result.artifacts[0];
    if (!artifact?.content?.trim()) {
      throw new Error('No HTML artifact returned from generate()');
    }
    const html = artifact.content;
    const artifactPath = resolve(SMOKE_DIR, `${slug(model, prompt)}.html`);
    // Use platform-aware containment instead of POSIX-only startsWith — slug
    // sanitization should already prevent traversal, this is defense-in-depth.
    const rel = relative(SMOKE_DIR, artifactPath);
    if (rel.startsWith('..') || isAbsolute(rel)) {
      throw new Error(`Refusing to write outside ${SMOKE_DIR}: ${artifactPath}`);
    }
    writeFileSync(artifactPath, html);
    return {
      model: `${model.provider}/${model.modelId}`,
      prompt: prompt.name,
      ok: true,
      ms,
      bytes: html.length,
      artifactPath,
      issues: qualityCheck(html),
    };
  } catch (err) {
    return {
      model: `${model.provider}/${model.modelId}`,
      prompt: prompt.name,
      ok: false,
      ms: Date.now() - t0,
      bytes: 0,
      issues: [],
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function selectModels(all: SmokeModel[], filter: string | undefined): SmokeModel[] {
  if (!filter) return all;
  const matched = all.filter(
    (m) => `${m.provider}/${m.modelId}` === filter || m.modelId === filter,
  );
  if (matched.length === 0) {
    console.error(`${COLOR.red}No model matched --model=${filter}${COLOR.reset}`);
    process.exit(2);
  }
  return matched;
}

function selectPrompts(all: SmokePrompt[], override: string | undefined): SmokePrompt[] {
  if (!override) return all;
  return [{ name: 'cli', text: override }];
}

function loadFailedKeys(): Set<string> | null {
  if (!existsSync(LAST_RESULTS)) return null;
  const last = JSON.parse(readFileSync(LAST_RESULTS, 'utf8')) as RunResult[];
  const failed = new Set(last.filter((r) => !r.ok).map((r) => `${r.model}|${r.prompt}`));
  if (failed.size === 0) {
    console.log('No failed runs in last report. Nothing to retry.');
    return new Set();
  }
  return failed;
}

async function runMatrix(
  models: SmokeModel[],
  prompts: SmokePrompt[],
  onlyKeys: Set<string> | null,
): Promise<RunResult[]> {
  const results: RunResult[] = [];
  for (const m of models) {
    const envName = ENV_KEY[m.provider];
    if (!envName) {
      throw new Error(
        `Unsupported provider in smoke config: ${m.provider}. Add it to ENV_KEY or fix scripts/smoke-models.toml.`,
      );
    }

    const apiKey = process.env[envName];
    if (!apiKey) {
      console.log(
        `${COLOR.dim}— ${m.provider}/${m.modelId}  (no $${envName}; skipped)${COLOR.reset}`,
      );
      continue;
    }
    for (const p of prompts) {
      if (onlyKeys && !onlyKeys.has(`${m.provider}/${m.modelId}|${p.name}`)) continue;
      const r = await runOne(m, p, apiKey);
      printResult(r);
      results.push(r);
    }
  }
  return results;
}

function printSummary(results: RunResult[]): void {
  const passed = results.filter((r) => r.ok).length;
  const issued = results.filter((r) => r.ok && r.issues.length > 0).length;
  console.log('');
  console.log(
    `${COLOR.bold}${passed}/${results.length}${COLOR.reset} passed${
      issued > 0 ? `, ${COLOR.yellow}${issued}${COLOR.reset} with quality warnings` : ''
    }. Artifacts in ${SMOKE_DIR}/`,
  );
  process.exit(passed === results.length ? 0 : 1);
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      config: { type: 'string', default: 'scripts/smoke-models.toml' },
      model: { type: 'string' },
      prompt: { type: 'string' },
      'only-failed': { type: 'boolean', default: false },
    },
  });

  const cfg = parseConfig(resolve(values.config ?? 'scripts/smoke-models.toml'));
  const models = selectModels(cfg.models, values.model);
  const prompts = selectPrompts(cfg.prompts, values.prompt);
  const onlyKeys = values['only-failed'] ? loadFailedKeys() : null;
  if (onlyKeys && onlyKeys.size === 0) return;

  mkdirSync(SMOKE_DIR, { recursive: true });
  const results = await runMatrix(models, prompts, onlyKeys);
  writeFileSync(LAST_RESULTS, JSON.stringify(results, null, 2));
  printSummary(results);
}

main().catch((err) => {
  console.error(`${COLOR.red}smoke harness crashed:${COLOR.reset}`, err);
  process.exit(2);
});
