import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
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
import { afterEach, expect, it, vi } from 'vitest';
import { prepareResearchExport } from './exporter-ipc';
import { createResearchHost } from './web-research';
import {
  buildSourcesMarkdown,
  linkSlide,
  recordEvidence,
  saveResearchStore,
  saveSources,
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
const _slide = (id: string): ResearchSlide => ({ id, title: id, fingerprint: `${id}-content` });

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
