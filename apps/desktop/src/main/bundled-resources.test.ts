import { readFile } from 'node:fs/promises';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateDesignMd } from '@open-codesign/shared/design-md';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../../../..');
const scaffoldsRoot = join(repoRoot, 'apps/desktop/resources/templates/scaffolds');

interface ScaffoldManifest {
  schemaVersion: number;
  scaffolds: Record<
    string,
    {
      description: string;
      path: string;
      category?: string;
      license: string;
      source: string;
    }
  >;
}

function classifyTemplateSource(raw: string): 'html' | 'jsx' | 'css' | 'design-md' | 'other' {
  const trimmed = raw.trimStart();
  if (/^<!doctype html/i.test(trimmed) || /^<html[\s>]/i.test(trimmed)) return 'html';
  if (/^---\n[\s\S]*\n---/m.test(trimmed) && trimmed.includes('version: alpha')) {
    return 'design-md';
  }
  if (
    /^const\s+/m.test(trimmed) ||
    /function\s+_?App\s*\(/.test(raw) ||
    /ReactDOM\.createRoot/.test(raw)
  ) {
    return 'jsx';
  }
  if (/^[\s\S]*[.#][\w-]+\s*\{/.test(raw) || raw.includes('@keyframes')) return 'css';
  return 'other';
}

describe('bundled scaffold resources', () => {
  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: existing complexity, see #118
  it('keeps scaffold manifest paths aligned with source format', async () => {
    const manifest = JSON.parse(
      await readFile(join(scaffoldsRoot, 'manifest.json'), 'utf8'),
    ) as ScaffoldManifest;
    expect(manifest.schemaVersion).toBe(1);

    const failures: string[] = [];
    for (const [kind, entry] of Object.entries(manifest.scaffolds)) {
      const raw = await readFile(join(scaffoldsRoot, entry.path), 'utf8');
      const type = classifyTemplateSource(raw);
      const extension = extname(entry.path).toLowerCase();
      if (type === 'html' && extension !== '.html') failures.push(`${kind}: HTML is ${extension}`);
      if (type === 'jsx' && extension !== '.jsx') failures.push(`${kind}: JSX is ${extension}`);
      if (type === 'css' && extension !== '.css') failures.push(`${kind}: CSS is ${extension}`);
      if (type === 'design-md' && extension !== '.md') {
        failures.push(`${kind}: DESIGN.md is ${extension}`);
      }
    }

    expect(failures).toEqual([]);
  });

  it('keeps scaffold DESIGN.md starters Google-compatible', async () => {
    const manifest = JSON.parse(
      await readFile(join(scaffoldsRoot, 'manifest.json'), 'utf8'),
    ) as ScaffoldManifest;
    const designMdEntries = Object.entries(manifest.scaffolds).filter(([, entry]) =>
      entry.path.endsWith('.md'),
    );
    expect(designMdEntries.length).toBeGreaterThan(0);

    for (const [kind, entry] of designMdEntries) {
      const raw = await readFile(join(scaffoldsRoot, entry.path), 'utf8');
      const errors = validateDesignMd(raw).filter((finding) => finding.severity === 'error');
      expect(errors, kind).toEqual([]);
    }
  });

  it('does not ship stale weak placeholder copy in scaffold assets', async () => {
    const manifest = JSON.parse(
      await readFile(join(scaffoldsRoot, 'manifest.json'), 'utf8'),
    ) as ScaffoldManifest;
    const weakCopy =
      /Deck title|Page content|Replace this|Replace with the brief|Point one|Point two|Point three|Headline\./i;
    const failures: string[] = [];

    for (const [kind, entry] of Object.entries(manifest.scaffolds)) {
      const raw = await readFile(join(scaffoldsRoot, entry.path), 'utf8');
      if (weakCopy.test(raw)) failures.push(kind);
    }

    expect(failures).toEqual([]);
  });
});
