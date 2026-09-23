import { mkdir, mkdtemp, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeWebResearchTools } from '@open-codesign/core';
import { exportArtifact, readResearchSlides } from '@open-codesign/exporters';
import {
  EvidenceInputSchema,
  type ResearchSlide,
  type ResearchStore,
  type WebSource,
} from '@open-codesign/shared';
import JSZip from 'jszip';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { prepareResearchExport } from './exporter-ipc';
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

it('mock research E2E: recent industry chart → saved evidence → rendered slides → Markdown/ZIP; reorder and style without searching again', async () => {
  const root = await workspace();
  const search = vi.fn(async () => [{ ...source, originalRead: false }]);
  const fetch = vi.fn(async () => ({
    source,
    finalUrl: source.url,
    contentType: 'text/plain',
    text: source.excerpt ?? '',
    truncated: false,
  }));
  const authorize = vi.fn(async () => {});
  const createHost = () =>
    createResearchHost({ network: { search, fetch }, authorize, inWorkspace: (fn) => fn(root) });
  let host = createHost();
  let tools = makeWebResearchTools(host);
  const call = async (name: string, params: Record<string, unknown>) => {
    const tool = tools.find((tool) => tool.name === name);
    if (!tool) throw new Error('Missing tool');
    return tool.execute('fixture-call', params);
  };
  const searched = await call('web_search', { query: 'recent industry data 2025', count: 1 });
  expect(searched.content[0]).toMatchObject({ text: expect.stringContaining(source.id) });
  await call('web_fetch', { url: source.url });
  const saved = await call('research_evidence', input());
  const evidenceId = (saved.details as { id: string }).id;
  const overview =
    '<section data-slide-id="overview"><h1>Industry overview</h1><p>2025: 42 units</p></section>';
  const chart =
    '<section data-slide-id="chart"><h2>Production in 2025</h2><svg aria-label="42 units"><rect width="42" height="20" fill="blue"/></svg><p>42 units</p></section>';
  const deck = (sections: string) =>
    `<!doctype html><html><head><style>section { width:1280px; height:720px; }</style></head><body>${sections}</body></html>`;
  await writeFile(join(root, 'deck.html'), deck(overview + chart));
  await call('research_slide', {
    path: 'deck.html',
    slideId: 'overview',
    evidenceIds: [evidenceId],
  });
  await call('research_slide', { path: 'deck.html', slideId: 'chart', evidenceIds: [evidenceId] });
  const exported = await call('research_export', { path: 'deck.html' });
  expect(await readFile(join(root, (exported.details as { path: string }).path), 'utf8')).toContain(
    source.url,
  );
  host = createHost();
  tools = makeWebResearchTools(host);
  expect((await host.readRecords()).evidence[0]?.id).toBe(evidenceId);
  const changed = deck(chart.replace('blue', 'purple') + overview);
  await writeFile(join(root, 'deck.html'), changed);
  const companion = await prepareResearchExport({
    format: 'zip',
    workspacePath: root,
    sourcePath: 'deck.html',
    artifactSource: changed,
  });
  expect(companion?.warnings).toEqual([]);
  expect(companion?.markdown).toContain('## 1. Production in 2025');
  const archive = join(root, 'industry.zip');
  await exportArtifact('zip', changed, archive, {
    sourcePath: 'deck.html',
    assetRootPath: root,
    assetBasePath: root,
    assets: [{ path: 'sources.md', content: companion?.markdown ?? '' }],
  });
  const zip = await JSZip.loadAsync(await readFile(archive));
  expect(await zip.file('sources.md')?.async('string')).toContain(source.url);
  expect(await zip.file('index.html')?.async('string')).not.toMatch(
    /example\.com|references|citation/i,
  );
  expect(await readFile(join(root, 'deck.html'), 'utf8')).toBe(changed);
  const current = await readResearchSlides(deck(chart), { sourcePath: 'deck.html' });
  const deleted = buildSourcesMarkdown(await host.readRecords(), 'deck.html', current);
  expect(deleted.markdown).not.toContain('Industry overview');
  const stale = await readResearchSlides(deck(chart.replace('42', '99')), {
    sourcePath: 'deck.html',
  });
  expect(buildSourcesMarkdown(await host.readRecords(), 'deck.html', stale).markdown).not.toContain(
    source.url,
  );
  expect(search).toHaveBeenCalledTimes(1);
  expect(fetch).toHaveBeenCalledTimes(1);
}, 120000);

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

it('renders stable slide IDs from the default JSX source format', async () => {
  const jsx =
    'function App() { return <main><section data-slide-id="overview"><h1>Industry</h1><p>2025: 42 units</p></section></main>; }';
  const snapshots = await readResearchSlides(jsx, { sourcePath: 'App.jsx' });
  expect(snapshots).toHaveLength(1);
  expect(snapshots[0]).toMatchObject({ id: 'overview', title: 'Industry' });
  const records = store();
  saveSources(records, [source]);
  const evidence = recordEvidence(records, input());
  if (!snapshots[0]) throw new Error('Missing snapshot');
  linkSlide(records, 'App.jsx', snapshots[0], [evidence.id]);
  expect(buildSourcesMarkdown(records, 'App.jsx', snapshots).markdown).toContain(source.url);
}, 60000);

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

it('uses the same nested workspace asset resolution when linking slides and exporting sources', async () => {
  const root = await workspace();
  await mkdir(join(root, 'decks'));
  await mkdir(join(root, 'assets'));
  await writeFile(
    join(root, 'assets', 'mark.svg'),
    '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><rect width="20" height="20"/></svg>',
  );
  const html =
    '<section data-slide-id="overview"><h1>Industry</h1><img src="../assets/mark.svg" alt="Industry mark"><p>2025: 42 units</p></section>';
  await writeFile(join(root, 'decks', 'industry.html'), html);
  const records = store();
  saveSources(records, [source]);
  const evidence = recordEvidence(records, input());
  await saveResearchStore(root, records);
  const host = createResearchHost({
    network: { search: vi.fn(), fetch: vi.fn() },
    authorize: async () => {},
    inWorkspace: (fn) => fn(root),
  });
  await host.linkSlide('decks/industry.html', 'overview', [evidence.id]);
  const companion = await prepareResearchExport({
    format: 'html',
    workspacePath: root,
    sourcePath: 'decks/industry.html',
    artifactSource: html,
  });
  expect(companion?.warnings).toEqual([]);
  expect(companion?.markdown).toContain(source.url);
}, 60000);

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
