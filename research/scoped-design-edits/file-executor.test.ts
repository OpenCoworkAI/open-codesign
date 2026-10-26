import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { decodeProposal, executeFile } from './file-executor';
import { liveCases } from './live-cases';

function setup() {
  const f = liveCases()[0];
  const root = mkdtempSync(path.join(tmpdir(), 'codesign-scope-'));
  for (const [file, content] of Object.entries(f.files))
    writeFileSync(path.join(root, file), content);
  const proposal = {
    path: 'App.jsx',
    expectedSourceHash: f.grant.sourceHash,
    targetId: f.grant.targetIds[0],
    kind: 'set-text',
    field: 'text',
    value: '随记',
  };
  return { root, f, proposal };
}
describe('disk execution of actual source edits', () => {
  it('writes accepted JSX and preserves the other file', () => {
    const { root, f, proposal } = setup();
    expect(executeFile(root, f.grant, proposal, true).status).toBe('applied');
    expect(readFileSync(path.join(root, 'App.jsx'), 'utf8')).toBe(f.expectedContent);
    expect(readFileSync(path.join(root, 'Archive.jsx'), 'utf8')).toBe(f.files['Archive.jsx']);
  });
  it('paired comparator changes the other file while the selection gate refuses it', () => {
    const { root, f, proposal } = setup();
    proposal.path = 'Archive.jsx';
    expect(executeFile(root, f.grant, proposal, true).status).toBe('rejected');
    expect(readFileSync(path.join(root, 'Archive.jsx'), 'utf8')).toBe(f.files['Archive.jsx']);
    expect(executeFile(root, f.grant, proposal, false).status).toBe('applied');
  });
  it.each(['../outside.jsx', 'C:/outside.jsx', '/tmp/outside.jsx'])('rejects path %s', (file) => {
    const { root, f, proposal } = setup();
    expect(executeFile(root, f.grant, { ...proposal, path: file }, false).status).toBe('rejected');
  });
  it('refuses an external edit detected immediately before replacement', () => {
    const { root, f, proposal } = setup();
    const changed = `${f.files['App.jsx']}\n// external revision`;
    const result = executeFile(root, f.grant, proposal, true, () =>
      writeFileSync(path.join(root, 'App.jsx'), changed),
    );
    expect(result.reason).toBe('source-changed-before-write');
    expect(readFileSync(path.join(root, 'App.jsx'), 'utf8')).toBe(changed);
  });
  it('refuses stale source and unauthorized fields', () => {
    const { root, f, proposal } = setup();
    expect(
      executeFile(root, f.grant, { ...proposal, expectedSourceHash: '0'.repeat(64) }, true).status,
    ).toBe('rejected');
    expect(
      executeFile(
        root,
        f.grant,
        { ...proposal, kind: 'set-style', field: 'color', value: 'blue' },
        true,
      ).status,
    ).toBe('rejected');
  });
  it('does not treat within-scope wrong content as completion', () => {
    const { root, f, proposal } = setup();
    expect(executeFile(root, f.grant, { ...proposal, value: 'wrong' }, true).status).toBe(
      'applied',
    );
    expect(readFileSync(path.join(root, 'App.jsx'), 'utf8')).not.toBe(f.expectedContent);
  });
  it('rejects extra keys and invalid operations without repair', () => {
    const { proposal } = setup();
    expect(decodeProposal({ ...proposal, authorized: true })).toBeNull();
    expect(decodeProposal({ ...proposal, kind: 'set-style', field: 'backgroundImage' })).toBeNull();
  });
});
