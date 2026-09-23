import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ExporterFormat } from '@open-codesign/exporters';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (_event: unknown, raw: unknown) => Promise<unknown>>(),
  directory: '',
  pick: vi.fn(),
  exportArtifact: vi.fn(),
  slides: vi.fn(),
}));
vi.mock('./electron-runtime', () => ({
  app: { getPath: () => mocks.directory },
  dialog: { showSaveDialog: mocks.pick },
  ipcMain: {
    handle: (name: string, handler: (_event: unknown, raw: unknown) => Promise<unknown>) =>
      mocks.handlers.set(name, handler),
  },
}));
vi.mock('@open-codesign/exporters', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@open-codesign/exporters')>()),
  exportArtifact: mocks.exportArtifact,
  readResearchSlides: mocks.slides,
}));
vi.mock('./web-research-store', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./web-research-store')>();
  return { ...actual, writeUniqueSources: vi.fn(actual.writeUniqueSources) };
});

import { type ExportResponse, registerExporterIpc } from './exporter-ipc';
import { saveResearchStore, writeUniqueSources } from './web-research-store';

const source = '<section data-slide-id="overview"><h1>Overview</h1><p>Design content</p></section>';
let directory: string;

beforeEach(async () => {
  vi.clearAllMocks();
  mocks.handlers.clear();
  directory = await mkdtemp(join(tmpdir(), 'codesign-companion-'));
  mocks.directory = directory;
  await writeFile(join(directory, 'deck.html'), source);
  await saveResearchStore(directory, {
    schemaVersion: 1,
    sources: [],
    evidence: [],
    usages: [
      {
        id: 'overview',
        title: 'Overview',
        path: 'deck.html',
        fingerprint: 'same-content',
        evidenceIds: [],
      },
    ],
  });
  mocks.slides.mockResolvedValue([
    { id: 'overview', title: 'Overview', fingerprint: 'same-content' },
  ]);
  mocks.exportArtifact.mockImplementation(
    async (_format: string, body: string, destination: string) => {
      await writeFile(destination, body);
      return { path: destination, bytes: Buffer.byteLength(body) };
    },
  );
  registerExporterIpc(() => null);
});
afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

async function exportDesign(format: ExporterFormat = 'html'): Promise<ExportResponse> {
  const destination = join(directory, `export.${format === 'markdown' ? 'md' : format}`);
  mocks.pick.mockResolvedValueOnce({ canceled: false, filePath: destination });
  const handler = mocks.handlers.get('codesign:export');
  if (!handler) throw new Error('Missing export IPC handler');
  return (await handler(null, {
    format,
    workspacePath: directory,
    sourcePath: 'deck.html',
    artifactSource: source,
  })) as ExportResponse;
}

describe('optional research companion export', () => {
  it.each([
    'html',
    'pdf',
    'pptx',
    'zip',
    'markdown',
  ] as const)('keeps the primary %s export when saved research is corrupt', async (format) => {
    await writeFile(join(directory, '.codesign', 'research.json'), '{corrupt');
    const result = await exportDesign(format);
    expect(result.status).toBe('saved');
    expect(result.sourcesPath).toBeUndefined();
    expect(result.researchWarnings).toEqual([
      expect.stringContaining('Cannot restore research records'),
    ]);
    expect(result.path).toBeDefined();
    expect(await readFile(result.path ?? '', 'utf8')).toBe(source);
    expect(mocks.exportArtifact).toHaveBeenCalledOnce();
    expect(mocks.exportArtifact.mock.calls[0]?.[3]).not.toHaveProperty('assets');
    expect(mocks.slides).not.toHaveBeenCalled();
    expect(await readFile(join(directory, '.codesign', 'research.json'), 'utf8')).toBe('{corrupt');
  });

  it.each([
    'Every research slide needs a unique stable data-slide-id.',
    'Research slides require inspectable text/SVG charts, not canvas/iframe/video.',
    'Research deck did not render. Repair preview/runtime errors.',
    'System browser not available for source snapshots.',
  ])('returns a warning instead of failing a primary export when companion preparation fails: %s', async (message) => {
    mocks.slides.mockRejectedValueOnce(new Error(message));
    const result = await exportDesign();
    expect(result.status).toBe('saved');
    expect(result.researchWarnings).toEqual([`Sources companion was not exported: ${message}`]);
    expect(result.sourcesPath).toBeUndefined();
    expect(await readFile(result.path ?? '', 'utf8')).toBe(source);
  });

  it('keeps a saved primary file when writing its companion fails', async () => {
    vi.mocked(writeUniqueSources).mockRejectedValueOnce(
      new Error('Sources destination is not writable.'),
    );
    const result = await exportDesign();
    expect(result.status).toBe('saved');
    expect(result.researchWarnings).toEqual([
      expect.stringContaining('Sources destination is not writable'),
    ]);
    expect(result.sourcesPath).toBeUndefined();
    expect(await readFile(result.path ?? '', 'utf8')).toBe(source);
  });

  it('still writes a separate companion on success', async () => {
    const result = await exportDesign();
    expect(result.status).toBe('saved');
    expect(result.researchWarnings).toEqual([]);
    expect(await readFile(result.sourcesPath ?? '', 'utf8')).toContain('## 1. Overview');
    expect(await readFile(result.path ?? '', 'utf8')).toBe(source);
  });

  it('still passes successful companions into ZIP assets', async () => {
    const result = await exportDesign('zip');
    expect(result.status).toBe('saved');
    expect(result.sourcesPath).toBeUndefined();
    expect(mocks.exportArtifact.mock.calls[0]?.[3]).toMatchObject({
      assets: [
        {
          path: expect.stringMatching(/^sources-.*\.md$/),
          content: expect.stringContaining('## 1. Overview'),
        },
      ],
    });
    expect(writeUniqueSources).not.toHaveBeenCalled();
  });

  it('does not suppress primary exporter failures', async () => {
    mocks.exportArtifact.mockRejectedValueOnce(new Error('Primary PDF export failed.'));
    await expect(exportDesign('pdf')).rejects.toThrow('Primary PDF export failed.');
    expect(writeUniqueSources).not.toHaveBeenCalled();
  });

  it('leaves non-research exports unchanged', async () => {
    await rm(join(directory, '.codesign', 'research.json'));
    const result = await exportDesign();
    expect(result.status).toBe('saved');
    expect(result).not.toHaveProperty('researchWarnings');
    expect(mocks.slides).not.toHaveBeenCalled();
    expect(writeUniqueSources).not.toHaveBeenCalled();
  });
});
