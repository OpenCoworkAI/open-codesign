#!/usr/bin/env node
// Lint guard for the recurring codex review blockers.
// Three banned patterns; each accepts a per-line allow-list comment.
//
// Usage:
//   node scripts/check-blockers.mjs            # check staged .ts/.tsx files (pre-commit)
//   node scripts/check-blockers.mjs --ci       # check every .ts/.tsx under apps/ + packages/
//   node scripts/check-blockers.mjs <files>    # check explicit files

import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(fileURLToPath(import.meta.url), '..', '..');

export const RULES = [
  {
    id: 'silent-catch',
    pattern: /catch\s*\(_?\w*\)\s*\{\s*\}/g,
    allowMarker: 'silent-ok:',
    allowOn: ['same', 'previous'],
    message:
      'Empty silent catch — log via console.warn/error or rethrow. Allow with `// silent-ok: <reason>`',
  },
  {
    id: 'hardcoded-px',
    pattern: /(?:text|h|w|gap|p[xy]?|m[xy]?|min-w|max-w|min-h|max-h)-\[\d+(?:\.\d+)?px\]/g,
    allowMarker: 'token-ok:',
    allowOn: ['same', 'previous'],
    message:
      'Hardcoded px utility violates token-only UI. Use var(--text-xs)/var(--space-2)/etc. Allow with `// token-ok: <reason>`',
  },
  {
    id: 'bare-i18n',
    pattern: /\b(?:aria-label|title|placeholder)=\{?["'][A-Z][a-zA-Z ]+["']\}?/g,
    allowMarker: 'i18n-ok:',
    allowOn: ['same', 'previous'],
    message:
      "Hardcoded English string in user-facing attribute. Use t('...'). Allow with `// i18n-ok: <reason>`",
  },
];

function lineFromIndex(text, index) {
  let line = 1;
  for (let i = 0; i < index && i < text.length; i++) {
    if (text.charCodeAt(i) === 10) line++;
  }
  return line;
}

function hasAllowComment(lines, lineNumber, marker, scopes) {
  const sameLine = lines[lineNumber - 1] ?? '';
  const prevLine = lines[lineNumber - 2] ?? '';
  if (scopes.includes('same') && sameLine.includes(marker)) return true;
  if (scopes.includes('previous') && prevLine.includes(marker)) return true;
  return false;
}

export function checkSource(filename, source) {
  const lines = source.split('\n');
  const fileDisabled = new Set();
  const headerScan = lines.slice(0, 20).join('\n');
  const fileMarker = /\/\/\s*check-blockers-disable:\s*([a-z0-9-]+(?:\s*,\s*[a-z0-9-]+)*)/i.exec(
    headerScan,
  );
  if (fileMarker) {
    for (const id of fileMarker[1].split(',')) fileDisabled.add(id.trim());
  }
  const violations = [];
  for (const rule of RULES) {
    if (fileDisabled.has(rule.id)) continue;
    rule.pattern.lastIndex = 0;
    let match = rule.pattern.exec(source);
    while (match !== null) {
      const line = lineFromIndex(source, match.index);
      if (!hasAllowComment(lines, line, rule.allowMarker, rule.allowOn)) {
        violations.push({
          rule: rule.id,
          file: filename,
          line,
          snippet: (lines[line - 1] ?? '').trim().slice(0, 160),
          message: rule.message,
        });
      }
      match = rule.pattern.exec(source);
    }
  }
  return violations;
}

async function walk(dir, out) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === 'dist-electron')
      continue;
    if (entry.name.startsWith('.')) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      await walk(full, out);
    } else if (/\.(ts|tsx)$/.test(entry.name) && !/\.d\.ts$/.test(entry.name)) {
      out.push(full);
    }
  }
}

function stagedFiles() {
  let raw;
  try {
    raw = execFileSync('git', ['diff', '--cached', '--name-only', '--diff-filter=ACMR'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    });
  } catch {
    return [];
  }
  return raw
    .split('\n')
    .map((s) => s.trim())
    .filter((s) => /\.(ts|tsx)$/.test(s) && !/\.d\.ts$/.test(s))
    .map((s) => resolve(REPO_ROOT, s))
    .filter((p) => {
      try {
        return statSync(p).isFile();
      } catch {
        return false;
      }
    });
}

async function ciFiles() {
  const out = [];
  for (const root of ['apps', 'packages']) {
    await walk(join(REPO_ROOT, root), out);
  }
  return out;
}

async function main() {
  const args = process.argv.slice(2);
  const ci = args.includes('--ci');
  const explicit = args.filter((a) => !a.startsWith('-'));

  let files;
  if (explicit.length > 0) {
    files = explicit.map((p) => resolve(REPO_ROOT, p));
  } else if (ci) {
    files = await ciFiles();
  } else {
    files = stagedFiles();
  }

  if (files.length === 0) {
    if (ci) console.log('check-blockers: no .ts/.tsx files found.');
    return;
  }

  const violations = [];
  for (const file of files) {
    let source;
    try {
      source = readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    violations.push(...checkSource(file, source));
  }

  if (violations.length === 0) {
    if (ci) console.log(`check-blockers: ${files.length} file(s) scanned, no violations.`);
    return;
  }

  for (const v of violations) {
    const rel = relative(REPO_ROOT, v.file);
    console.error(`\n[${v.rule}] ${rel}:${v.line}`);
    console.error(`  ${v.snippet}`);
    console.error(`  ${v.message}`);
  }
  console.error(
    `\ncheck-blockers: ${violations.length} violation(s) across ${files.length} file(s).`,
  );
  process.exit(1);
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((err) => {
    console.error(err);
    process.exit(2);
  });
}
