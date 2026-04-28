import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { collectResourceManifest } from './resource-manifest';

const logger = {
  info: () => {},
  warn: () => {},
  error: () => {},
};

describe('resource manifest', () => {
  let root: string;

  beforeEach(() => {
    root = path.join(tmpdir(), `codesign-resource-manifest-${process.pid}-${Date.now()}`);
    mkdirSync(path.join(root, 'skills'), { recursive: true });
    mkdirSync(path.join(root, 'scaffolds', 'device-frames'), { recursive: true });
    mkdirSync(path.join(root, 'brand-refs', 'acme'), { recursive: true });
    writeFileSync(
      path.join(root, 'skills', 'chart-rendering.md'),
      [
        '---',
        'schemaVersion: 1',
        'name: chart-rendering',
        'description: Render real charts.',
        'aliases: [charts]',
        'dependencies: [artifact-composition]',
        'validationHints: [real chart marks]',
        '---',
        '# Body must not enter prompt manifest',
      ].join('\n'),
      'utf8',
    );
    writeFileSync(
      path.join(root, 'scaffolds', 'manifest.json'),
      JSON.stringify({
        schemaVersion: 1,
        scaffolds: {
          'iphone-frame': {
            description: 'Device frame starter.',
            path: 'device-frames/iphone.jsx',
            category: 'device-frame',
            license: 'MIT-internal',
            source: 'test fixture',
            aliases: ['phone-frame'],
          },
        },
      }),
      'utf8',
    );
    writeFileSync(path.join(root, 'scaffolds', 'device-frames', 'iphone.jsx'), 'frame', 'utf8');
    writeFileSync(
      path.join(root, 'brand-refs', 'manifest.json'),
      JSON.stringify({
        schemaVersion: 1,
        brands: [{ slug: 'acme', name: 'Acme', category: 'Test', path: 'acme/DESIGN.md' }],
      }),
      'utf8',
    );
    writeFileSync(path.join(root, 'brand-refs', 'acme', 'DESIGN.md'), '# Acme', 'utf8');
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('builds a short manifest across skills, scaffolds, and brand refs', async () => {
    const result = await collectResourceManifest({
      log: logger,
      providerId: 'anthropic',
      templatesRoot: root,
    });

    expect(result.manifest.entries.map((entry) => entry.name)).toEqual([
      'chart-rendering',
      'iphone-frame',
      'brand:acme',
    ]);
    expect(result.manifest.entries.find((entry) => entry.name === 'chart-rendering')).toMatchObject(
      {
        aliases: ['charts'],
        dependencies: ['artifact-composition'],
        license: 'MIT',
      },
    );
    expect(result.sections.join('\n')).toContain('deps: artifact-composition');
    expect(result.sections.join('\n')).not.toContain('Body must not enter prompt manifest');
  });

  it('surfaces load failures as warnings without dumping skill bodies', async () => {
    writeFileSync(path.join(root, 'skills', 'broken.md'), '# no frontmatter', 'utf8');
    const result = await collectResourceManifest({
      log: logger,
      providerId: 'anthropic',
      templatesRoot: root,
    });

    expect(result.warnings).toEqual([expect.stringContaining('Skill manifest unavailable')]);
    expect(result.sections.join('\n')).not.toContain('# no frontmatter');
  });
});
