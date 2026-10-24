import { readFile } from 'node:fs/promises';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectResourceManifest, composeSystemPrompt } from '@open-codesign/core';
import { buildPreviewDocument, validateNativeGenerationSource } from '@open-codesign/runtime';
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
  it('ships all native resources with readable licensed overlays and static HTML starters', async () => {
    const templatesRoot = join(repoRoot, 'apps/desktop/resources/templates');
    const source = {
      schemaVersion: 1,
      path: 'pages/main.htm',
      format: 'html',
      runtimeMode: 'native-html',
    } as const;
    const manifest = await collectResourceManifest({
      templatesRoot,
      source,
      providerId: 'test',
      log: { info() {}, warn() {}, error() {} },
    });
    expect(manifest.warnings).toEqual([]);
    const scaffolds = manifest.manifest.entries.filter((entry) => entry.category === 'scaffold');
    expect(scaffolds).toHaveLength(11);
    expect(scaffolds.filter((entry) => extname(entry.path) === '.html')).toHaveLength(3);
    expect(scaffolds.filter((entry) => extname(entry.path) === '.css')).toHaveLength(7);
    expect(scaffolds.filter((entry) => extname(entry.path) === '.md')).toHaveLength(1);
    for (const entry of scaffolds) {
      const raw = await readFile(join(scaffoldsRoot, entry.path), 'utf8');
      expect(entry.license).toMatch(/MIT/);
      expect(entry.source.length).toBeGreaterThan(0);
      expect(raw).not.toMatch(
        /<script[^>]+src=["']https?:|Deck title|Page content|Replace this|Point one/i,
      );
      if (extname(entry.path) === '.html') {
        expect(() => validateNativeGenerationSource(raw)).not.toThrow();
        const built = buildPreviewDocument(raw, { runtimeMode: 'native-html' });
        expect(built).not.toMatch(/react\.production|babel\.min|ocd-tweak/);
      }
    }
    for (const name of ['craft-polish', 'design-reference-to-html', 'chart-rendering']) {
      const entry = manifest.manifest.entries.find((item) => item.name === name);
      expect(entry).toBeDefined();
      const raw = await readFile(join(templatesRoot, 'skills', entry?.path ?? ''), 'utf8');
      expect(raw).toContain(`name: ${name}`);
      expect(raw).toContain('license: MIT');
      expect(raw).toContain('Source: Open CoDesign');
    }
    expect(composeSystemPrompt({ mode: 'tweak', source })).toContain('# Targeted native tweaks');
    const builder = await readFile(join(repoRoot, 'apps/desktop/electron-builder.yml'), 'utf8');
    expect(builder).toContain('resources/templates');
    const vite = await readFile(join(repoRoot, 'apps/desktop/electron.vite.config.ts'), 'utf8');
    expect(vite).toContain('prompts');
    expect(vite).toContain('.md');
  });
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
