import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseAnnotationDrafts } from './annotation-drafts.js';
import { parseCorpus } from './corpus.js';

const load = (name: string): unknown =>
  JSON.parse(readFileSync(new URL(name, import.meta.url), 'utf8'));
describe('development-only draft annotations', () => {
  it('validates all drafts against prefix/evidence and frozen input without evaluator data', () => {
    const sessions = parseCorpus(load('./corpus-inputs.json'));
    const drafts = parseAnnotationDrafts(
      load('./annotation-drafts.json'),
      sessions,
      load('./corpus-manifest.json'),
    );
    expect(drafts.cases).toHaveLength(8);
    expect(drafts.reviewedByHuman).toBe(false);
    for (const item of drafts.cases) expect(item.reviewStatus).toBe('needs-human-review');
    expect(drafts.cases.some((c) => c.caseId.startsWith('s07') || c.caseId.startsWith('s08'))).toBe(
      false,
    );
  });
  it('rejects changed input bindings, missing development cases and falsely approved drafts', () => {
    const sessions = parseCorpus(load('./corpus-inputs.json'));
    const source = parseAnnotationDrafts(
      load('./annotation-drafts.json'),
      sessions,
      load('./corpus-manifest.json'),
    );
    const first = source.cases[0];
    if (!first) throw new Error('Missing fixture');
    expect(() =>
      parseAnnotationDrafts(
        { ...source, cases: [{ ...first, inputHash: '0'.repeat(64) }, ...source.cases.slice(1)] },
        sessions,
        load('./corpus-manifest.json'),
      ),
    ).toThrow();
    expect(() =>
      parseAnnotationDrafts(
        { ...source, cases: source.cases.slice(1) },
        sessions,
        load('./corpus-manifest.json'),
      ),
    ).toThrow();
    expect(() =>
      parseAnnotationDrafts(
        { ...source, reviewedByHuman: true },
        sessions,
        load('./corpus-manifest.json'),
      ),
    ).toThrow();
  });
});
