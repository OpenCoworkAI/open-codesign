import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { METHOD_SKILL_HISTORY } from './method-skill-history';
import { upgradeMethodSkills } from './method-skill-upgrades';

vi.mock('./logger', () => ({
  getLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));
const resources = fileURLToPath(new URL('../../resources/templates/skills', import.meta.url));
let root: string | undefined;
afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
});

describe('method skill history provenance', () => {
  it('keeps only the seven bounded filenames with exact SHA256 and commit evidence', () => {
    expect(Object.keys(METHOD_SKILL_HISTORY).sort()).toEqual([
      'accessibility-states.md',
      'app-shell-navigation.md',
      'artifact-composition.md',
      'craft-polish.md',
      'design-system-baton.md',
      'frontend-design-anti-slop.md',
      'mobile-mock.md',
    ]);
    for (const revisions of Object.values(METHOD_SKILL_HISTORY)) {
      for (const [sha, commit] of revisions) {
        expect(sha).toMatch(/^[0-9a-f]{64}$/);
        expect(commit).toMatch(/^[0-9a-f]{40}$/);
      }
      expect(new Set(revisions.map(([sha]) => sha)).size).toBe(revisions.length);
    }
  });

  it('upgrades seven real bundled baselines using the production allowlist and retains exact backups', async () => {
    root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'codesign-skill-history-')));
    const source = path.join(root, 'bundle');
    const dest = path.join(root, 'templates');
    await mkdir(path.join(source, 'skills'), { recursive: true });
    await mkdir(path.join(dest, 'skills'), { recursive: true });
    const originals = new Map<string, Buffer>();
    for (const [name, history] of Object.entries(METHOD_SKILL_HISTORY)) {
      const bytes = await readFile(path.join(resources, name));
      const sha = createHash('sha256').update(bytes).digest('hex');
      expect(
        history.some(([known]) => known === sha),
        `${name}: record each newly shipped blob with commit provenance`,
      ).toBe(true);
      originals.set(name, bytes);
      await writeFile(path.join(dest, 'skills', name), bytes);
      await writeFile(path.join(source, 'skills', name), `${name}: next bundled revision`);
    }
    expect(await upgradeMethodSkills(dest, source)).toMatchObject({ updated: 7, preserved: 0 });
    for (const tx of await readdir(path.join(dest, '.codesign-skill-upgrades'))) {
      const dir = path.join(dest, '.codesign-skill-upgrades', tx);
      const receipt = JSON.parse(await readFile(path.join(dir, 'receipt.json'), 'utf8')) as {
        name: string;
      };
      expect(await readFile(path.join(dir, 'original.md'))).toEqual(originals.get(receipt.name));
    }
    expect(await upgradeMethodSkills(dest, source)).toMatchObject({ unchanged: 7, updated: 0 });
  });
});
