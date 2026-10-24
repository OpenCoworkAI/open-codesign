import { mkdir, mkdtemp, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeWebResearchTools } from '@open-codesign/core';
import {
  EvidenceInputSchema,
  type ResearchSlide,
  type ResearchStore,
  type WebSource,
} from '@open-codesign/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createResearchHost } from './web-research';
import {
  buildSourcesMarkdown,
  linkSlide,
  loadResearchStore,
  recordEvidence,
  saveResearchStore,
  saveSources,
  writeUniqueSources,
} from './web-research-store';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function workspace() {
  const root = await mkdtemp(join(tmpdir(), 'codesign-research-test-'));
  roots.push(root);
  return root;
}
const source: WebSource = {
  id: 'src_fixture',
  url: 'https://example.com/industry',
  title: 'Industry fixture (not real data)',
  publisher: null,
  publishedAt: null,
  retrievedAt: '2026-01-01T00:00:00Z',
  excerpt: 'In 2025 the sample industry produced 42 units.',
  locator: null,
  originalRead: true,
};
const input = () =>
  EvidenceInputSchema.parse({
    claim: 'Sample industry: 42 units in 2025',
    sourceIds: [source.id],
    quote: source.excerpt,
    year: '2025',
    unit: 'units',
    scope: 'Mock integration fixture, not real industry statistics',
    kind: 'fact',
  });
const store = (): ResearchStore => ({ schemaVersion: 1, sources: [], evidence: [], usages: [] });
const slide = (id: string): ResearchSlide => ({ id, title: id, fingerprint: `${id}-content` });

describe('research records and deterministic export', () => {
  it('persists and restores structured source/evidence/usage and rejects unknown references', async () => {
    const root = await workspace();
    const records = store();
    saveSources(records, [source]);
    const evidence = recordEvidence(records, input());
    expect(evidence.originalRead).toBe(true);
    expect(recordEvidence(records, input()).id).toBe(evidence.id);
    linkSlide(records, 'App.jsx', slide('overview'), [evidence.id]);
    await saveResearchStore(root, records);
    expect(await loadResearchStore(root)).toEqual(records);
    expect(() => recordEvidence(records, { ...input(), sourceIds: ['missing'] })).toThrow(
      /Unknown source/,
    );
    expect(() => recordEvidence(records, { ...input(), quote: 'invented quote' })).toThrow(/Quote/);
    expect(() => recordEvidence(records, { ...input(), locator: 'page 9' })).toThrow(/Locator/);
    expect(() => linkSlide(records, 'App.jsx', slide('bad'), ['missing'])).toThrow(
      /Unknown evidence/,
    );
    const broken = structuredClone(records);
    broken.sources = [];
    await expect(saveResearchStore(root, broken)).rejects.toThrow(/dangling/);
  });
  it('includes only used sources, follows reorder/deletion, and removes stale support', () => {
    const records = store();
    saveSources(records, [
      source,
      { ...source, id: 'unused', url: 'https://example.com/unused', title: 'UNUSED' },
    ]);
    const evidence = recordEvidence(records, input());
    for (const id of ['overview', 'chart']) linkSlide(records, 'App.jsx', slide(id), [evidence.id]);
    const reordered = buildSourcesMarkdown(records, 'App.jsx', [slide('chart'), slide('overview')]);
    expect(reordered.markdown).toContain('## 1. chart');
    expect(reordered.warnings).toEqual([]);
    expect(reordered.markdown).not.toContain('UNUSED');
    const deleted = buildSourcesMarkdown(records, 'App.jsx', [slide('chart')]);
    expect(deleted.markdown).not.toContain('overview');
    const stale = buildSourcesMarkdown(records, 'App.jsx', [
      { ...slide('chart'), fingerprint: 'changed' },
    ]);
    expect(stale.markdown).toContain('Evidence gap');
    expect(stale.markdown).not.toContain(source.url);
  });
  it('exports calculation inputs/formula, forecast labels and unresolved uncertainty', () => {
    const records = store();
    saveSources(records, [source]);
    const base = recordEvidence(records, input());
    const calc = recordEvidence(
      records,
      EvidenceInputSchema.parse({
        claim: '84 units',
        sourceIds: [],
        inputEvidenceIds: [base.id],
        formula: '42 * 2 = 84',
        kind: 'calculation',
      }),
    );
    const forecast = recordEvidence(
      records,
      EvidenceInputSchema.parse({
        claim: 'Illustrative forecast, not actual',
        sourceIds: [source.id],
        kind: 'forecast',
        conflict: true,
        uncertainty: 'Incompatible populations',
      }),
    );
    linkSlide(records, 'App.jsx', slide('chart'), [calc.id, forecast.id]);
    const { markdown } = buildSourcesMarkdown(records, 'App.jsx', [slide('chart')]);
    expect(markdown).toContain('42 \\* 2 = 84');
    expect(markdown).toContain(source.url);
    expect(markdown).toContain('forecast');
    expect(markdown).toContain('Incompatible populations');
  });
  it('never overwrites existing user sources files', async () => {
    const root = await workspace();
    await writeFile(join(root, 'sources.md'), 'user text');
    const file = await writeUniqueSources(root, 'sources', 'generated');
    expect(file).toBe(join(root, 'sources-1.md'));
    expect(await readFile(join(root, 'sources.md'), 'utf8')).toBe('user text');
  });
  it('does not mark a search snippet as read merely because different original text was fetched', () => {
    const records = store();
    saveSources(records, [{ ...source, originalRead: false }]);
    saveSources(records, [{ ...source, excerpt: 'Unrelated body.', originalRead: true }]);
    expect(recordEvidence(records, input()).originalRead).toBe(false);
  });
});

it('denied or cancelled research never reaches the network or writes sources', async () => {
  const root = await workspace();
  const search = vi.fn(async () => [source]);
  const host = createResearchHost({
    network: { search, fetch: vi.fn() },
    inWorkspace: (fn) => fn(root),
    authorize: async () => {
      throw new Error('permission denied');
    },
  });
  await expect(host.search('industry', 1)).rejects.toThrow(/denied/);
  expect(search).not.toHaveBeenCalled();
  expect((await loadResearchStore(root)).sources).toEqual([]);
});

it('serializes research updates from different sessions sharing a workspace', async () => {
  const root = await workspace();
  const makeHost = (id: string) =>
    createResearchHost({
      network: { search: async () => [{ ...source, id }], fetch: vi.fn() },
      authorize: async () => {},
      inWorkspace: (fn) => fn(root),
    });
  await Promise.all(
    Array.from({ length: 12 }, (_, index) => makeHost(`source-${index}`).search('industry', 1)),
  );
  expect((await loadResearchStore(root)).sources).toHaveLength(12);
});

describe('read-only research records', () => {
  function hostFor(root: string) {
    return createResearchHost({
      network: { search: vi.fn(), fetch: vi.fn() },
      authorize: async () => {},
      inWorkspace: (fn) => fn(root),
    });
  }

  it('does not create the research file or directory in an empty workspace', async () => {
    const root = await workspace();
    const tool = makeWebResearchTools(hostFor(root)).find(
      (tool) => tool.name === 'research_records',
    );
    if (!tool) throw new Error('Missing research_records tool');
    const result = await tool.execute('read-empty', {});
    expect(result.details).toMatchObject({ totals: { sources: 0, evidence: 0, usages: 0 } });
    await expect(stat(join(root, '.codesign'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('does not create a missing research file inside an existing settings directory', async () => {
    const root = await workspace();
    await mkdir(join(root, '.codesign'));
    await writeFile(join(root, '.codesign', 'settings.json'), '{"schemaVersion":1}');
    expect(await hostFor(root).readRecords()).toEqual(store());
    await expect(stat(join(root, '.codesign', 'research.json'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
    expect(await readFile(join(root, '.codesign', 'settings.json'), 'utf8')).toBe(
      '{"schemaVersion":1}',
    );
  });

  it('preserves existing record bytes and modification time when the read tool runs', async () => {
    const root = await workspace();
    const records = store();
    saveSources(records, [source]);
    await saveResearchStore(root, records);
    const file = join(root, '.codesign', 'research.json');
    const bytes = JSON.stringify(records);
    await writeFile(file, bytes);
    const timestamp = new Date('2020-01-01T00:00:00Z');
    await utimes(file, timestamp, timestamp);
    const before = await stat(file);
    const tool = makeWebResearchTools(hostFor(root)).find(
      (tool) => tool.name === 'research_records',
    );
    if (!tool) throw new Error('Missing research_records tool');
    await tool.execute('read-existing', {});
    expect(await readFile(file, 'utf8')).toBe(bytes);
    expect((await stat(file)).mtimeMs).toBe(before.mtimeMs);
  });

  it('does not replace corrupt records during a read or explicit source export', async () => {
    const root = await workspace();
    await mkdir(join(root, '.codesign'));
    const file = join(root, '.codesign', 'research.json');
    await writeFile(file, '{corrupt');
    const host = hostFor(root);
    await expect(host.readRecords()).rejects.toThrow('Cannot restore research records');
    await expect(host.exportSources('deck.html')).rejects.toThrow(
      'Cannot restore research records',
    );
    expect(await readFile(file, 'utf8')).toBe('{corrupt');
    await expect(stat(join(root, 'sources.md'))).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
