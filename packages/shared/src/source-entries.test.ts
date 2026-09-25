import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import * as shared from './index';
import {
  DEFAULT_SOURCE_ENTRY,
  DesignSourceEntryV1,
  LEGACY_SOURCE_ENTRY,
  NEW_HTML_SOURCE_ENTRY,
  SourceEntryGetRequestV1,
  SourceEntryPath,
  SourceEntryResultV1,
  SourceEntrySelectRequestV1,
  SourceIdentityV1,
} from './source-entries';

const revision = 'c0658270-3e9e-4a70-b850-231c36e40e0d';
const source = {
  schemaVersion: 1,
  path: 'pages/index.html',
  format: 'html',
  runtimeMode: 'native-html',
} as const;
const binding = {
  schemaVersion: 1,
  designId: 'design-a',
  workspacePath: 'C:/work/design-a',
  revision,
} as const;
const declaration = { ...binding, phase: 'planned', source } as const;
const selectRequest = {
  schemaVersion: 1,
  designId: binding.designId,
  path: source.path,
  expectedWorkspacePath: binding.workspacePath,
  expectedRevision: revision,
} as const;
const results = [
  { ...binding, status: 'planned', source, content: null },
  { ...binding, status: 'planned', source, content: '<main>Draft</main>' },
  { ...binding, status: 'ready', source, content: '<main>Ready</main>', origin: 'declared' },
  {
    ...binding,
    revision: null,
    status: 'ready',
    source: { ...source, runtimeMode: 'legacy-auto' },
    content: '<main>Legacy</main>',
    origin: 'legacy',
  },
  {
    ...binding,
    revision: null,
    status: 'needs-selection',
    candidates: [source, { ...source, path: 'App.jsx', format: 'jsx', runtimeMode: 'legacy-auto' }],
    reason: 'ambiguous-candidates',
    message: 'Choose the main source.',
  },
  {
    ...binding,
    revision: null,
    status: 'needs-selection',
    candidates: [],
    reason: 'no-candidates',
    message: 'Select a source file.',
  },
  {
    ...binding,
    workspacePath: null,
    status: 'invalid',
    reason: 'invalidated',
    message: 'The workspace was unbound.',
  },
  {
    ...binding,
    revision: null,
    status: 'invalid',
    reason: 'invalid-metadata',
    message: 'The source declaration could not be read.',
  },
  {
    ...binding,
    workspacePath: null,
    revision: null,
    status: 'not-applicable',
    reason: 'connected-url',
    message: 'This design previews a URL.',
  },
];

function accepts(schema: z.ZodType, input: unknown): boolean {
  expect(schema).toBeDefined();
  return schema.safeParse(input).success;
}

describe('source entry exports', () => {
  it('preserves the old defaults and adds an explicit native HTML default', () => {
    expect(DEFAULT_SOURCE_ENTRY).toBe('App.jsx');
    expect(LEGACY_SOURCE_ENTRY).toBe('index.html');
    expect(NEW_HTML_SOURCE_ENTRY).toBe('index.html');
  });

  it('exports the schemas and new constant through shared', () => {
    expect(shared.NEW_HTML_SOURCE_ENTRY).toBe('index.html');
    expect(shared.SourceEntryPath).toBe(SourceEntryPath);
    expect(shared.SourceIdentityV1).toBe(SourceIdentityV1);
    expect(shared.DesignSourceEntryV1).toBe(DesignSourceEntryV1);
    expect(shared.SourceEntryResultV1).toBe(SourceEntryResultV1);
    expect(shared.SourceEntryGetRequestV1).toBe(SourceEntryGetRequestV1);
    expect(shared.SourceEntrySelectRequestV1).toBe(SourceEntrySelectRequestV1);
  });
});

describe('SourceIdentityV1', () => {
  it.each([
    'index.html',
    'pages/start.htm',
    'src/App.jsx',
    'src/App.tsx',
    '页面/首页.HTML',
  ])('accepts safe source path %s without inferring format from its extension', (path) => {
    expect(accepts(SourceIdentityV1, { ...source, path })).toBe(true);
  });

  it.each(['html', 'jsx', 'tsx'])('preserves actual legacy format %s', (format) => {
    expect(accepts(SourceIdentityV1, { ...source, format, runtimeMode: 'legacy-auto' })).toBe(true);
  });

  it.each(['jsx', 'tsx'])('rejects native-html with format %s', (format) => {
    expect(accepts(SourceIdentityV1, { ...source, format })).toBe(false);
  });

  it.each([
    '',
    ' ',
    '/index.html',
    '//server/share/index.html',
    'C:/index.html',
    'C:index.html',
    '\\\\server\\share\\index.html',
    'pages\\index.html',
    'index\0.html',
    '../index.html',
    'pages/../index.html',
    './index.html',
    'pages/./index.html',
    'pages//index.html',
    'pages/index.html/',
    'index.html:stream',
    'pages:stream/index.html',
    'CON.html',
    'aux/index.html',
    'prn.htm',
    'nul.jsx',
    'COM1.tsx',
    'lpt9/index.html',
    'COM¹.html',
    'LPT²/index.html',
    'CONIN$.html',
    'CONOUT$.html',
    'NUL .html',
    'pages./index.html',
    'pages /index.html',
    'index.html ',
    'index.html.',
    'bad?/index.html',
    'bad*/index.html',
    'bad</index.html',
    'bad>/index.html',
    'bad|/index.html',
    'bad"/index.html',
    'bad\n/index.html',
    'index.js',
    'index.svg',
    'README.md',
    'index',
  ])('rejects unsafe or unsupported source path %j', (path) => {
    expect(accepts(SourceEntryPath, path)).toBe(false);
    expect(accepts(SourceIdentityV1, { ...source, path })).toBe(false);
    expect(accepts(SourceEntrySelectRequestV1, { ...selectRequest, path })).toBe(false);
  });

  it.each([
    'COM10.html',
    'console.html',
    'pages with spaces/index.html',
    'v1.2/index.html',
  ])('does not reject safe path %s', (path) => {
    expect(accepts(SourceIdentityV1, { ...source, path })).toBe(true);
  });

  it.each([
    { schemaVersion: 2 },
    { format: 'svg' },
    { runtimeMode: 'auto' },
    { permission: 'write' },
  ])('rejects invalid identity fields %j', (fields) => {
    expect(accepts(SourceIdentityV1, { ...source, ...fields })).toBe(false);
  });
});

describe('DesignSourceEntryV1', () => {
  it.each(['planned', 'confirmed'])('requires a bound source for phase %s', (phase) => {
    expect(accepts(DesignSourceEntryV1, { ...declaration, phase })).toBe(true);
    for (const fields of [
      { workspacePath: null },
      { workspacePath: '' },
      { workspacePath: '  ' },
      { source: null },
    ]) {
      expect(accepts(DesignSourceEntryV1, { ...declaration, phase, ...fields })).toBe(false);
    }
  });

  it('allows invalidated records to retain or clear their former binding and source', () => {
    expect(accepts(DesignSourceEntryV1, { ...declaration, phase: 'invalidated' })).toBe(true);
    expect(
      accepts(DesignSourceEntryV1, {
        ...declaration,
        phase: 'invalidated',
        workspacePath: null,
        source: null,
      }),
    ).toBe(true);
  });

  it.each([
    { revision: null },
    { revision: '' },
    { revision: 'revision-1' },
    { schemaVersion: 2 },
    { designId: '' },
    { designId: ' ' },
    { phase: 'ready' },
    { extra: true },
    { source: { ...source, extra: true } },
    { source: { ...source, schemaVersion: 2 } },
  ])('rejects malformed declarations %j', (fields) => {
    expect(accepts(DesignSourceEntryV1, { ...declaration, ...fields })).toBe(false);
  });
});

describe('SourceEntryResultV1', () => {
  it.each(results)('accepts $status result with binding identity', (result) => {
    expect(accepts(SourceEntryResultV1, result)).toBe(true);
  });

  it.each(results)('requires version and binding fields on $status', (result) => {
    for (const field of ['schemaVersion', 'designId', 'workspacePath', 'revision']) {
      const input: Record<string, unknown> = { ...result };
      delete input[field];
      expect(accepts(SourceEntryResultV1, input)).toBe(false);
    }
    expect(accepts(SourceEntryResultV1, { ...result, schemaVersion: 2 })).toBe(false);
    expect(accepts(SourceEntryResultV1, { ...result, revision: 'stale' })).toBe(false);
    expect(accepts(SourceEntryResultV1, { ...result, extra: true })).toBe(false);
  });

  it.each([
    { status: 'planned', source, content: null, revision: null },
    { status: 'planned', source: null, content: null },
    { status: 'planned', source, content: null, workspacePath: null },
    { status: 'ready', source, content: '', origin: 'declared' },
    { status: 'ready', source, content: '   ', origin: 'declared' },
    { status: 'ready', source, content: '<main/>', origin: 'declared', revision: null },
    { status: 'ready', source, content: '<main/>', origin: 'cache' },
    { status: 'ready', source: null, content: '<main/>', origin: 'declared' },
    { status: 'ready', source, content: '<main/>', origin: 'declared', workspacePath: null },
    {
      status: 'needs-selection',
      candidates: [{ ...source, path: '../index.html' }],
      reason: 'ambiguous-candidates',
      message: 'Choose.',
    },
    { status: 'invalid', reason: '', message: 'Invalid.' },
    { status: 'invalid', reason: 'invalidated', message: '' },
    { status: 'not-applicable', reason: 'managed-file', message: 'Not applicable.' },
    { status: 'confirmed', source },
  ])('rejects inconsistent result %j', (fields) => {
    expect(accepts(SourceEntryResultV1, { ...binding, ...fields })).toBe(false);
  });
});

describe('source entry requests', () => {
  it('gets by design identity only', () => {
    expect(accepts(SourceEntryGetRequestV1, { schemaVersion: 1, designId: binding.designId })).toBe(
      true,
    );
  });

  it('selects a path using the expected workspace and revision', () => {
    expect(accepts(SourceEntrySelectRequestV1, selectRequest)).toBe(true);
    expect(accepts(SourceEntrySelectRequestV1, { ...selectRequest, expectedRevision: null })).toBe(
      true,
    );
  });

  it.each([
    'format',
    'runtimeMode',
    'mode',
    'source',
    'permission',
  ])('rejects client-provided authority field %s', (field) => {
    expect(accepts(SourceEntrySelectRequestV1, { ...selectRequest, [field]: 'html' })).toBe(false);
  });

  it.each([
    { schemaVersion: 2 },
    { designId: '' },
    { designId: ' ' },
    { expectedWorkspacePath: null },
    { expectedWorkspacePath: '' },
    { expectedWorkspacePath: ' ' },
    { expectedRevision: 'old' },
  ])('rejects invalid selection request %j', (fields) => {
    expect(accepts(SourceEntrySelectRequestV1, { ...selectRequest, ...fields })).toBe(false);
  });

  it.each([
    'path',
    'expectedWorkspacePath',
    'expectedRevision',
  ])('requires select field %s', (field) => {
    const input: Record<string, unknown> = { ...selectRequest };
    delete input[field];
    expect(accepts(SourceEntrySelectRequestV1, input)).toBe(false);
  });

  it.each([
    { schemaVersion: 2 },
    { designId: '' },
    { designId: ' ' },
    { path: 'index.html' },
  ])('rejects invalid get fields %j', (fields) => {
    expect(
      accepts(SourceEntryGetRequestV1, { schemaVersion: 1, designId: binding.designId, ...fields }),
    ).toBe(false);
  });
});
