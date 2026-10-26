import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  type CorpusSession,
  createCorpusInput,
  createManifest,
  freezeContext,
  getCompressorInput,
  hashJson,
  parseCorpus,
  reuseContext,
  validateManifest,
} from './corpus.js';
import { createProductionFixture } from './production-fixtures.js';

function session(id = 's1', designId = 'd1'): CorpusSession {
  const [parsed] = parseCorpus([
    {
      schemaVersion: 1,
      sessionId: id,
      designId,
      relatedDesignIds: [],
      provenance: { kind: 'synthetic', sourceSessionId: id, author: 'Open CoDesign research' },
      rows: createProductionFixture()
        .chatRows.slice(0, 3)
        .map((row) => ({ ...row, designId })),
      checkpoints: [
        {
          id: `${id}-c1`,
          cutoffSeq: 1,
          capturedThroughSeq: 1,
          workspaceRevision: 'revision-1',
          context: {
            brief: null,
            historyBudgetChars: 4000,
            workspaceState: { sourcePath: 'App.jsx', hasSource: true },
          },
        },
      ],
    },
  ]);
  if (!parsed) throw new Error('Missing test session');
  return parsed;
}

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('Missing fixture value');
  return value;
}

describe('corpus boundaries', () => {
  it('projects only the prefix and allows no suffix to reach compression', () => {
    const source = session();
    const input = createCorpusInput(source, 's1-c1');
    expect(input.contextInput.chatRows.map((row) => row.seq)).toEqual([0, 1]);
    expect(JSON.stringify(getCompressorInput(input))).not.toContain('#123456');
    expect(Object.keys(getCompressorInput(input)).sort()).toEqual([
      'brief',
      'chatRows',
      'historyBudgetChars',
      'workspaceState',
    ]);
  });

  it('rejects injected evaluation fields instead of silently forwarding them', () => {
    const source = session();
    expect(() => parseCorpus([{ ...source, questions: ['SECRET'] }])).toThrow();
    const checkpoint = source.checkpoints[0];
    expect(() =>
      parseCorpus([
        {
          ...source,
          checkpoints: [
            { ...checkpoint, context: { ...checkpoint?.context, answers: ['SECRET'] } },
          ],
        },
      ]),
    ).toThrow();
    const input = createCorpusInput(source, 's1-c1');
    expect(() => getCompressorInput({ ...input, referenceAnswers: ['SECRET'] })).toThrow();
  });

  it('detaches compressor input from corpus objects', () => {
    const source = session();
    const projected = createCorpusInput(source, 's1-c1');
    const compressed = getCompressorInput(projected);
    const row = compressed.chatRows[0];
    if (row) row.payload = { text: 'mutated' };
    expect(JSON.stringify(source)).not.toContain('mutated');
    expect(JSON.stringify(projected)).not.toContain('mutated');
  });

  it('rejects future snapshots, unknown cutoff, unordered rows and wrong row design', () => {
    const source = session();
    const cp = source.checkpoints[0];
    const invalid = [
      { ...source, checkpoints: [{ ...cp, capturedThroughSeq: 2 }] },
      { ...source, checkpoints: [{ ...cp, cutoffSeq: 9 }] },
      { ...source, rows: [...source.rows].reverse() },
      { ...source, rows: source.rows.map((row) => ({ ...row, designId: 'unrelated' })) },
      { ...source, rows: [source.rows[0], source.rows[0]] },
    ];
    for (const candidate of invalid) expect(() => parseCorpus([candidate])).toThrow();
  });

  it('requires consent and redaction references for real sessions', () => {
    expect(() =>
      parseCorpus([
        {
          ...session(),
          provenance: {
            kind: 'consented-redacted',
            sourceSessionId: 'private-hash',
          },
        },
      ]),
    ).toThrow();
  });

  it('rejects wrong runtime types for brief and state', () => {
    const source = session();
    expect(() =>
      parseCorpus([
        {
          ...source,
          checkpoints: source.checkpoints.map((cp) => ({
            ...cp,
            context: { brief: { goal: 42 } },
          })),
        },
      ]),
    ).toThrow();
  });
});

describe('frozen splits and context binding', () => {
  it('rejects same-design or transitively related designs across splits', () => {
    const a = session('a', 'design-a');
    const b = session('b', 'design-b');
    const c = session('c', 'design-c');
    a.relatedDesignIds = ['design-b'];
    b.relatedDesignIds = ['design-c'];
    expect(() =>
      createManifest([a, b, c], { a: 'development', b: 'development', c: 'heldout' }, {}),
    ).toThrow(/split|leak/i);
    expect(() =>
      createManifest([session('x'), session('y')], { x: 'development', y: 'heldout' }, {}),
    ).toThrow(/split|leak/i);
  });

  it('keeps all checkpoints and aliased source sessions in one split', () => {
    const a = session('a', 'a');
    const b = session('b', 'b');
    b.provenance.sourceSessionId = 'a';
    expect(() => createManifest([a, b], { a: 'development', b: 'heldout' }, {})).toThrow(
      /split|leak/i,
    );
    a.checkpoints.push({ ...required(a.checkpoints[0]), id: 'a-c2', cutoffSeq: 2 });
    const manifest = createManifest([a], { a: 'development' }, {});
    required(manifest.cases[1]).split = 'heldout';
    expect(() => validateManifest([a], manifest, {})).toThrow(/split|leak/i);
  });

  it('detects changed data, labels, incomplete coverage and wrong input hashes', () => {
    const sessions = [session()];
    const evaluation = { reference: 'A' };
    const manifest = createManifest(sessions, { s1: 'development' }, evaluation);
    expect(() => validateManifest(sessions, manifest, evaluation)).not.toThrow();
    expect(() => validateManifest(sessions, manifest, { reference: 'B' })).toThrow(/hash/i);
    const changed = structuredClone(sessions);
    required(required(changed[0]).rows[0]).payload = { text: 'changed' };
    expect(() => validateManifest(changed, manifest, evaluation)).toThrow(/hash/i);
    expect(() => validateManifest(sessions, { ...manifest, cases: [] }, evaluation)).toThrow();
    required(manifest.cases[0]).inputHash = '0'.repeat(64);
    expect(() => validateManifest(sessions, manifest, evaluation)).toThrow(/hash/i);
  });

  it('binds frozen contexts to all inputs, cutoff, revision and condition', () => {
    const input = createCorpusInput(session(), 's1-c1');
    const frozen = freezeContext(input, 'production-raw@1', '固定上下文');
    expect(reuseContext(frozen, input, 'production-raw@1')).toBe('固定上下文');
    expect(() =>
      reuseContext(frozen, { ...input, workspaceRevision: 'revision-2' }, 'production-raw@1'),
    ).toThrow();
    const changed = structuredClone(input);
    changed.contextInput.historyBudgetChars = 8000;
    expect(() => reuseContext(frozen, changed, 'production-raw@1')).toThrow();
    expect(() => reuseContext(frozen, input, 'candidate@1')).toThrow();
    expect(() =>
      reuseContext({ ...frozen, context: 'tampered' }, input, 'production-raw@1'),
    ).toThrow();
  });

  it('hashes object key ordering consistently without losing unicode', () => {
    expect(hashJson({ b: '🙂', a: '中文' })).toBe(hashJson({ a: '中文', b: '🙂' }));
    expect(hashJson({ a: '中文' })).not.toBe(hashJson({ a: '中文🙂' }));
    expect(() => hashJson({ a: undefined })).toThrow();
  });

  it('loads the committed synthetic corpus and its exact frozen manifest', () => {
    const load = (name: string): unknown =>
      JSON.parse(readFileSync(new URL(name, import.meta.url), 'utf8'));
    const sessions = parseCorpus(load('./corpus-inputs.json'));
    expect(sessions).toHaveLength(8);
    const manifest = validateManifest(
      sessions,
      load('./corpus-manifest.json'),
      load('./corpus-evaluation.json'),
    );
    expect(manifest.cases).toHaveLength(10);
    expect(new Set(manifest.cases.map((c) => c.split))).toEqual(
      new Set(['development', 'heldout']),
    );
    for (const s of sessions) {
      expect(s.provenance.kind).toBe('synthetic');
      expect(s.rows.length).toBeGreaterThan(40);
      for (const checkpoint of s.checkpoints) {
        const projected = getCompressorInput(createCorpusInput(s, checkpoint.id));
        expect(projected.chatRows.every((row) => row.seq <= checkpoint.cutoffSeq)).toBe(true);
      }
    }
  });
});
