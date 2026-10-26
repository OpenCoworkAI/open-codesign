import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';
import { createBoundEdit } from './bound-edit';
import { liveCases } from './live-cases';

function setup() {
  const fixture = liveCases()[0];
  const root = mkdtempSync(path.join(tmpdir(), 'codesign-bound-'));
  for (const [file, source] of Object.entries(fixture.files))
    writeFileSync(path.join(root, file), source);
  const editor = createBoundEdit(root, fixture.grant);
  const proposal = {
    handle: editor.publicBinding.handle,
    kind: 'set-text',
    field: 'text',
    value: '随记',
  };
  return { fixture, root, editor, proposal };
}
it('applies a real JSX edit with no model-supplied hash, path or AST identity', () => {
  const { fixture, root, editor, proposal } = setup();
  expect(editor.execute(proposal).status).toBe('applied');
  expect(readFileSync(path.join(root, 'App.jsx'), 'utf8')).toBe(fixture.expectedContent);
  expect(readFileSync(path.join(root, 'Archive.jsx'), 'utf8')).toBe(fixture.files['Archive.jsx']);
  expect(editor.execute(proposal).reason).toBe('consumed-selection');
});
it('rejects edits made after selection without silently filling in a fresh hash', () => {
  const { root, editor, proposal } = setup();
  writeFileSync(path.join(root, 'App.jsx'), 'function App(){return <main>new version</main>}');
  expect(editor.execute(proposal).status).toBe('rejected');
  expect(readFileSync(path.join(root, 'App.jsx'), 'utf8')).toContain('new version');
});
it.each([
  { path: 'Archive.jsx' },
  { expectedSourceHash: 'fake' },
  { targetId: 'other' },
])('rejects metadata override %j', (extra) => {
  const { editor, proposal } = setup();
  expect(editor.execute({ ...proposal, ...extra }).reason).toBe('invalid-bound-proposal');
});
it('keeps a captured selection immutable and enforces its permitted fields', () => {
  const { fixture, editor, proposal } = setup();
  fixture.grant.fields = [...fixture.grant.fields, 'style:color'];
  editor.publicBinding.fields.push('style:color');
  expect(
    editor.execute({ ...proposal, kind: 'set-style', field: 'color', value: 'blue' }).reason,
  ).toBe('field-not-authorized');
});
it('rejects foreign handles', () => {
  const { editor, proposal } = setup();
  expect(editor.execute({ ...proposal, handle: 'foreign' }).reason).toBe('unknown-selection');
});
