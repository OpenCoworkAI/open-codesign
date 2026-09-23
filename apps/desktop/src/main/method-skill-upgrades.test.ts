import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ensureUserTemplates } from './ensure-user-templates';
import { METHOD_SKILL_HISTORY } from './method-skill-history';
import { upgradeMethodSkills } from './method-skill-upgrades';

const name = 'frontend-design-anti-slop.md';
const old = 'known original\n';
const next = 'new bundled method\n';
const sha = (text: string) => createHash('sha256').update(text).digest('hex');
const hooks = vi.hoisted(() => ({
  copyFile: undefined as
    | undefined
    | ((source: string, dest: string, mode?: number) => Promise<void>),
  open: undefined as undefined | ((file: string) => Promise<void>),
  link: undefined as undefined | ((source: string, dest: string) => Promise<void>),
  rename: undefined as undefined | ((source: string, dest: string) => Promise<void>),
}));
const log = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }));
vi.mock('./logger', () => ({ getLogger: () => log }));
vi.mock('./method-skill-history', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./method-skill-history')>();
  const { createHash } = await import('node:crypto');
  return {
    ...actual,
    METHOD_SKILL_HISTORY: {
      ...actual.METHOD_SKILL_HISTORY,
      'frontend-design-anti-slop.md': [
        [createHash('sha256').update('known original\n').digest('hex'), 'test-fixture'],
      ],
    },
  };
});
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    copyFile: async (source: string, dest: string, mode?: number) => {
      await hooks.copyFile?.(source, dest, mode);
      return actual.copyFile(source, dest, mode);
    },
    open: async (...args: Parameters<typeof actual.open>) => {
      await hooks.open?.(String(args[0]));
      return actual.open(...args);
    },
    link: async (source: string, dest: string) => {
      await hooks.link?.(source, dest);
      return actual.link(source, dest);
    },
    rename: async (source: string, dest: string) => {
      await hooks.rename?.(source, dest);
      return actual.rename(source, dest);
    },
  };
});

let root: string;
let source: string;
let user: string;
let dest: string;
let candidate: string;

beforeEach(async () => {
  vi.clearAllMocks();
  hooks.link = undefined;
  hooks.copyFile = undefined;
  hooks.open = undefined;
  hooks.rename = undefined;
  root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'codesign-method-upgrade-')));
  source = path.join(root, 'bundled');
  user = path.join(root, 'user');
  dest = path.join(user, 'templates');
  candidate = path.join(dest, 'skills', name);
  await fs.mkdir(path.join(source, 'skills'), { recursive: true });
  await fs.mkdir(path.dirname(candidate), { recursive: true });
  await fs.writeFile(path.join(source, 'skills', name), next);
});
afterEach(async () => {
  hooks.link = undefined;
  hooks.copyFile = undefined;
  hooks.open = undefined;
  hooks.rename = undefined;
  await fs.rm(root, { recursive: true, force: true });
});

async function transactions() {
  const state = path.join(dest, '.codesign-skill-upgrades');
  return (await fs.readdir(state)).map((entry) => path.join(state, entry));
}

async function journal(
  options: {
    backup?: string;
    candidate?: string;
    stage?: boolean;
    patch?: Record<string, unknown>;
  } = {},
) {
  const tx = path.join(dest, '.codesign-skill-upgrades', '11111111-1111-4111-8111-111111111111');
  await fs.mkdir(tx, { recursive: true });
  await fs.writeFile(
    path.join(tx, 'pending.json'),
    JSON.stringify({
      schemaVersion: 1,
      name,
      previousHash: sha(old),
      installedHash: sha(next),
      ...options.patch,
    }),
  );
  if (options.backup !== undefined)
    await fs.writeFile(path.join(tx, 'original.md'), options.backup);
  if (options.candidate !== undefined) await fs.writeFile(candidate, options.candidate);
  if (options.stage) await fs.writeFile(path.join(tx, 'staged.md'), next);
  return tx;
}

describe('method skill upgrades', () => {
  it.each([
    'ENOTSUP',
    'EOPNOTSUPP',
    'EXDEV',
  ])('seeds all seven methods in a fresh root with exclusive copies when links report %s', async (code) => {
    await fs.rmdir(path.dirname(candidate));
    await fs.rmdir(dest);
    for (const skill of Object.keys(METHOD_SKILL_HISTORY)) {
      await fs.writeFile(path.join(source, 'skills', skill), `${skill}: bundled`);
    }
    hooks.link = async () => {
      throw Object.assign(new Error('Links unavailable'), { code });
    };
    const copy = vi.fn();
    hooks.copyFile = async (...args) => {
      copy(...args);
    };
    expect(await ensureUserTemplates(user, source)).toMatchObject({
      action: 'seeded',
      methodSkills: { installed: 7, updated: 0, preserved: 0, failed: 0 },
    });
    expect(copy).toHaveBeenCalledTimes(7);
    expect(copy.mock.calls.every((call) => call[2] === constants.COPYFILE_EXCL)).toBe(true);
    expect((await fs.readdir(path.dirname(candidate))).sort()).toEqual(
      Object.keys(METHOD_SKILL_HISTORY).sort(),
    );
    for (const skill of Object.keys(METHOD_SKILL_HISTORY)) {
      expect(await fs.readFile(path.join(dest, 'skills', skill), 'utf8')).toBe(`${skill}: bundled`);
    }
    expect(log.info).toHaveBeenCalledWith(
      'skill.install.exclusive_copy',
      expect.objectContaining({ status: 'installed-missing-file' }),
    );
  });

  it('preserves old methods while exclusively installing missing ones on an unsupported filesystem', async () => {
    await fs.writeFile(candidate, old);
    await fs.writeFile(path.join(source, 'skills', 'craft-polish.md'), 'new missing method');
    hooks.link = async () => {
      throw Object.assign(new Error('Links unavailable'), { code: 'ENOTSUP' });
    };
    expect(await ensureUserTemplates(user, source)).toMatchObject({
      action: 'merged',
      updatedFiles: 0,
      methodSkills: { installed: 1, updated: 0, preserved: 1, failed: 1 },
    });
    expect(await fs.readFile(candidate, 'utf8')).toBe(old);
    expect(await fs.readFile(path.join(dest, 'skills', 'craft-polish.md'), 'utf8')).toBe(
      'new missing method',
    );
    expect(await transactions()).toEqual([]);
  });

  it('preserves a candidate created between unsupported-link failure and fallback copying', async () => {
    hooks.link = async () => {
      throw Object.assign(new Error('Links unavailable'), { code: 'ENOTSUP' });
    };
    hooks.copyFile = async (_from, to, mode) => {
      expect(mode).toBe(constants.COPYFILE_EXCL);
      await fs.writeFile(to, 'concurrent user content', { flag: 'wx' });
    };
    expect(await ensureUserTemplates(user, source)).toMatchObject({
      methodSkills: { installed: 0, updated: 0, preserved: 1 },
    });
    expect(await fs.readFile(candidate, 'utf8')).toBe('concurrent user content');
    expect(log.info).not.toHaveBeenCalledWith('skill.install.exclusive_copy', expect.anything());
  });

  it.each([
    'EACCES',
    'EPERM',
    'EIO',
  ])('keeps unexpected missing-file link error %s visible without fallback', async (code) => {
    hooks.link = async () => {
      throw Object.assign(new Error('Unexpected link error'), { code });
    };
    const copy = vi.fn();
    hooks.copyFile = async (...args) => {
      copy(...args);
    };
    await expect(ensureUserTemplates(user, source)).rejects.toThrow('Unexpected link error');
    expect(copy).not.toHaveBeenCalled();
    await expect(fs.stat(candidate)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(log.error).toHaveBeenCalledWith(
      'skills.upgrade.failed',
      expect.objectContaining({ dest }),
    );
  });

  it('keeps fallback copy failures visible rather than claiming an installation', async () => {
    hooks.link = async () => {
      throw Object.assign(new Error('Links unavailable'), { code: 'ENOTSUP' });
    };
    hooks.copyFile = async () => {
      throw Object.assign(new Error('Copy failed'), { code: 'EIO' });
    };
    await expect(ensureUserTemplates(user, source)).rejects.toThrow('Copy failed');
    expect(log.error).toHaveBeenCalledWith(
      'skills.upgrade.failed',
      expect.objectContaining({ installed: 0, updated: 0 }),
    );
    expect(await fs.readdir(path.dirname(candidate))).toEqual([]);
  });
  it('recovers a missing-skill installation interrupted after publication', async () => {
    const stage = path.join(
      path.dirname(candidate),
      `.skill-${name}.11111111-1111-4111-8111-111111111111.tmp`,
    );
    await fs.writeFile(stage, next);
    await fs.link(stage, candidate);
    expect(await upgradeMethodSkills(dest, source)).toMatchObject({ recovered: 1, unchanged: 1 });
    expect((await fs.stat(candidate)).nlink).toBe(1);
    expect(await fs.readdir(path.dirname(candidate))).toEqual([name]);
  });

  it('preserves unknown install-stage content without treating its filename as authority', async () => {
    const stage = path.join(
      path.dirname(candidate),
      `.skill-${name}.11111111-1111-4111-8111-111111111111.tmp`,
    );
    await fs.writeFile(stage, 'user edited stage');
    await fs.link(stage, candidate);
    expect(await upgradeMethodSkills(dest, source)).toMatchObject({ recovered: 0, preserved: 1 });
    expect(await fs.readFile(stage, 'utf8')).toBe('user edited stage');
    expect(await fs.readFile(candidate, 'utf8')).toBe('user edited stage');
  });
  it.each([
    'staged.md',
    'pending.tmp',
  ])('preserves the candidate if preparing %s fails', async (failureFile) => {
    await fs.writeFile(candidate, old);
    hooks.open = async (file) => {
      if (file.endsWith(failureFile)) throw new Error('Write denied');
    };
    await expect(upgradeMethodSkills(dest, source)).rejects.toThrow('retained or recovered');
    expect(await fs.readFile(candidate, 'utf8')).toBe(old);
    hooks.open = undefined;
    expect(await upgradeMethodSkills(dest, source)).toMatchObject({ updated: 1 });
  });

  it('preserves the candidate if moving the backup fails', async () => {
    await fs.writeFile(candidate, old);
    hooks.rename = async (_from, to) => {
      if (to.endsWith('original.md')) throw new Error('Backup denied');
    };
    await expect(upgradeMethodSkills(dest, source)).rejects.toThrow('retained or recovered');
    expect(await fs.readFile(candidate, 'utf8')).toBe(old);
  });

  it('restores the original if staged bytes change before publication', async () => {
    await fs.writeFile(candidate, old);
    hooks.rename = async (_from, to) => {
      if (to.endsWith('original.md'))
        await fs.writeFile(path.join(path.dirname(to), 'staged.md'), 'not the bundled skill');
    };
    await expect(upgradeMethodSkills(dest, source)).rejects.toThrow('retained or recovered');
    expect(await fs.readFile(candidate, 'utf8')).toBe(old);
  });

  it('recovers after receipt publication fails without overwriting the installed skill', async () => {
    await fs.writeFile(candidate, old);
    hooks.link = async (_from, to) => {
      if (to.endsWith('receipt.json')) throw new Error('Receipt denied');
    };
    await expect(upgradeMethodSkills(dest, source)).rejects.toThrow('recovery failed');
    expect(await fs.readFile(candidate, 'utf8')).toBe(next);
    hooks.link = undefined;
    expect((await ensureUserTemplates(user, source)).methodSkills).toMatchObject({
      recovered: 1,
      unchanged: 1,
    });
  });

  it.each([
    false,
    true,
  ])('replays a completed receipt with a pending journal (linked temp: %s)', async (linked) => {
    const tx = await journal({ backup: old, candidate: next });
    const receipt = JSON.stringify({
      schemaVersion: 1,
      name,
      previousHash: sha(old),
      installedHash: sha(next),
      outcome: 'installed',
    });
    await fs.writeFile(path.join(tx, 'receipt.tmp'), receipt);
    await fs.link(path.join(tx, 'receipt.tmp'), path.join(tx, 'receipt.json'));
    if (!linked) await fs.unlink(path.join(tx, 'receipt.tmp'));
    expect((await ensureUserTemplates(user, source)).methodSkills).toMatchObject({
      recovered: 1,
      unchanged: 1,
    });
    expect((await ensureUserTemplates(user, source)).methodSkills?.recovered).toBe(0);
  });

  it('rejects a corrupt receipt before restoring a missing skill', async () => {
    const tx = await journal({ backup: old });
    await fs.writeFile(path.join(tx, 'receipt.json'), '{}');
    await expect(ensureUserTemplates(user, source)).rejects.toThrow('corrupt receipt');
    await expect(fs.stat(candidate)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await fs.readFile(path.join(tx, 'original.md'), 'utf8')).toBe(old);
  });

  it('rejects a corrupt completed receipt before any missing-file installation', async () => {
    const tx = await journal({ backup: old });
    await fs.unlink(path.join(tx, 'pending.json'));
    await fs.writeFile(path.join(tx, 'receipt.json'), '{}');
    await expect(ensureUserTemplates(user, source)).rejects.toThrow('Corrupt receipt');
    await expect(fs.stat(candidate)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await fs.readFile(path.join(tx, 'original.md'), 'utf8')).toBe(old);
  });

  it('preserves a linked method path including its external content', async () => {
    const external = path.join(root, 'external');
    await fs.mkdir(external);
    await fs.writeFile(path.join(external, 'private.md'), old);
    await fs.symlink(external, candidate, process.platform === 'win32' ? 'junction' : 'dir');
    expect((await ensureUserTemplates(user, source)).methodSkills?.preserved).toBe(1);
    expect((await fs.lstat(candidate)).isSymbolicLink()).toBe(true);
    expect(await fs.readFile(path.join(external, 'private.md'), 'utf8')).toBe(old);
  });

  it('rejects a symlinked backup without following or restoring it', async () => {
    const tx = await journal();
    const external = path.join(root, 'external');
    await fs.mkdir(external);
    await fs.writeFile(path.join(external, 'private.md'), old);
    await fs.symlink(
      external,
      path.join(tx, 'original.md'),
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    await expect(ensureUserTemplates(user, source)).rejects.toThrow('Linked path');
    await expect(fs.stat(candidate)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await fs.readFile(path.join(external, 'private.md'), 'utf8')).toBe(old);
  });
  it('installs missing methods, then is an unchanged idempotent no-op', async () => {
    expect(await upgradeMethodSkills(dest, source)).toMatchObject({ installed: 1, updated: 0 });
    expect(await fs.readFile(candidate, 'utf8')).toBe(next);
    expect(await upgradeMethodSkills(dest, source)).toMatchObject({
      unchanged: 1,
      installed: 0,
      updated: 0,
    });
    expect(await fs.readdir(path.dirname(candidate))).toEqual([name]);
  });

  it('upgrades exact known bytes with an independent backup and versioned installed-hash receipt', async () => {
    await fs.writeFile(candidate, old);
    expect(await upgradeMethodSkills(dest, source)).toMatchObject({ updated: 1, preserved: 0 });
    const [tx] = await transactions();
    if (!tx) throw new Error('Missing transaction');
    expect(await fs.readFile(path.join(tx, 'original.md'), 'utf8')).toBe(old);
    expect(JSON.parse(await fs.readFile(path.join(tx, 'receipt.json'), 'utf8'))).toEqual({
      schemaVersion: 1,
      name,
      previousHash: sha(old),
      installedHash: sha(next),
      outcome: 'installed',
    });
    await fs.writeFile(candidate, 'custom after upgrade');
    expect(await fs.readFile(path.join(tx, 'original.md'), 'utf8')).toBe(old);
    expect(await upgradeMethodSkills(dest, source)).toMatchObject({ preserved: 1, updated: 0 });
    expect(await transactions()).toHaveLength(1);
  });

  it.each([
    'custom edit',
    'known original\r\n',
    'known original\n ',
  ])('preserves unknown bytes without normalizing: %j', async (text) => {
    await fs.writeFile(candidate, text);
    expect(await upgradeMethodSkills(dest, source)).toMatchObject({ preserved: 1 });
    expect(await fs.readFile(candidate, 'utf8')).toBe(text);
    expect(log.info).toHaveBeenCalledWith('skill.preserved.custom_or_unknown', { candidate });
  });

  it('never changes private brands, existing scaffolds or unknown method names', async () => {
    for (const relative of [
      'brand-refs/private/DESIGN.md',
      'scaffolds/private.jsx',
      'skills/my-method.md',
    ]) {
      await fs.mkdir(path.dirname(path.join(source, relative)), { recursive: true });
      await fs.mkdir(path.dirname(path.join(dest, relative)), { recursive: true });
      await fs.writeFile(path.join(source, relative), 'bundled');
      await fs.writeFile(path.join(dest, relative), 'private edits');
    }
    await fs.writeFile(candidate, old);
    const result = await ensureUserTemplates(user, source);
    expect(result.methodSkills).toMatchObject({ updated: 1 });
    for (const relative of [
      'brand-refs/private/DESIGN.md',
      'scaffolds/private.jsx',
      'skills/my-method.md',
    ]) {
      expect(await fs.readFile(path.join(dest, relative), 'utf8')).toBe('private edits');
    }
  });

  it.each([
    'ENOTSUP',
    'EOPNOTSUPP',
    'EXDEV',
  ])('reports unsupported %s without moving originals or blocking startup seeding', async (code) => {
    await fs.writeFile(candidate, old);
    hooks.link = async () => {
      throw Object.assign(new Error('Unsupported hard links'), { code });
    };
    const move = vi.fn();
    hooks.rename = async (...args) => {
      move(...args);
    };
    expect(await ensureUserTemplates(user, source)).toMatchObject({
      action: 'skipped',
      updatedFiles: 0,
      methodSkills: { failed: 1, preserved: 1, updated: 0 },
    });
    expect(await fs.readFile(candidate, 'utf8')).toBe(old);
    expect(await transactions()).toEqual([]);
    expect(move).not.toHaveBeenCalled();
    expect(log.warn).toHaveBeenCalledWith(
      'skill.upgrade.unsupported',
      expect.objectContaining({ candidate, status: 'failed-preserved-original' }),
    );
  });

  it.each([
    'EACCES',
    'EPERM',
    'EIO',
  ])('does not disguise unexpected preflight %s as a safe unsupported skip', async (code) => {
    await fs.writeFile(candidate, old);
    hooks.link = async () => {
      throw Object.assign(new Error('Denied'), { code });
    };
    await expect(ensureUserTemplates(user, source)).rejects.toThrow('retained or recovered');
    expect(await fs.readFile(candidate, 'utf8')).toBe(old);
    expect(log.error).toHaveBeenCalled();
  });

  it('preserves an edit that arrives before the final comparison', async () => {
    await fs.writeFile(candidate, old);
    hooks.link = async (_from, to) => {
      if (to.endsWith('probe.md')) await fs.writeFile(candidate, 'edited before comparison');
    };
    expect(await upgradeMethodSkills(dest, source)).toMatchObject({ preserved: 1, updated: 0 });
    expect(await fs.readFile(candidate, 'utf8')).toBe('edited before comparison');
  });

  it('keeps an edit racing with the move in its backup and fails visibly rather than publishing', async () => {
    await fs.writeFile(candidate, old);
    hooks.rename = async (from, to) => {
      if (from === candidate && to.endsWith('original.md'))
        await fs.writeFile(candidate, 'racing edit');
    };
    await expect(upgradeMethodSkills(dest, source)).rejects.toThrow('recovery failed');
    const [tx] = await transactions();
    expect(await fs.readFile(path.join(tx ?? '', 'original.md'), 'utf8')).toBe('racing edit');
    await expect(fs.stat(candidate)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(ensureUserTemplates(user, source)).rejects.toThrow('Backup changed');
    await expect(fs.stat(candidate)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('never overwrites a concurrent replacement during publication', async () => {
    await fs.writeFile(candidate, old);
    hooks.link = async (from, to) => {
      if (to === candidate && from.endsWith('staged.md'))
        await fs.writeFile(candidate, 'concurrent replacement', { flag: 'wx' });
    };
    await expect(upgradeMethodSkills(dest, source)).rejects.toThrow('retained or recovered');
    expect(await fs.readFile(candidate, 'utf8')).toBe('concurrent replacement');
    const [tx] = await transactions();
    expect(await fs.readFile(path.join(tx ?? '', 'original.md'), 'utf8')).toBe(old);
  });

  it('recovers the original after a publication failure', async () => {
    await fs.writeFile(candidate, old);
    hooks.link = async (from, to) => {
      if (to === candidate && from.endsWith('staged.md')) throw new Error('Publish denied');
    };
    await expect(upgradeMethodSkills(dest, source)).rejects.toThrow('retained or recovered');
    expect(await fs.readFile(candidate, 'utf8')).toBe(old);
    const [tx] = await transactions();
    await fs.writeFile(candidate, 'subsequent edit');
    expect(await fs.readFile(path.join(tx ?? '', 'original.md'), 'utf8')).toBe(old);
  });

  it('retains a pending journal and backup if restoration is unsupported', async () => {
    const tx = await journal({ backup: old });
    hooks.link = async () => {
      throw new Error('Hard links unavailable');
    };
    await expect(ensureUserTemplates(user, source)).rejects.toThrow('Hard links unavailable');
    expect(await fs.readFile(path.join(tx, 'original.md'), 'utf8')).toBe(old);
    await expect(fs.stat(path.join(tx, 'pending.json'))).resolves.toBeDefined();
    await expect(fs.stat(candidate)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it.each([
    { label: 'journal before move', candidate: old },
    { label: 'after move', backup: old },
    { label: 'after publication', backup: old, candidate: next },
    { label: 'custom concurrent replacement', backup: old, candidate: 'custom' },
  ])('recovers $label before ordinary seeding and is idempotent', async ({
    label: _label,
    ...state
  }) => {
    await journal(state);
    const result = await ensureUserTemplates(user, source);
    expect(result.methodSkills?.recovered).toBe(1);
    expect(await fs.readFile(candidate, 'utf8')).toBe(
      state.candidate === 'custom' ? 'custom' : next,
    );
    expect((await ensureUserTemplates(user, source)).methodSkills?.recovered).toBe(0);
  });

  it('recovers a crash between hard-link publication and staging cleanup', async () => {
    const tx = await journal({ backup: old, stage: true });
    await fs.link(path.join(tx, 'staged.md'), candidate);
    expect((await ensureUserTemplates(user, source)).methodSkills).toMatchObject({
      recovered: 1,
      unchanged: 1,
    });
    expect((await fs.stat(candidate)).nlink).toBe(1);
  });

  it('recovers a crash between hard-link restoration and cleanup', async () => {
    const tx = await journal({ backup: old });
    await fs.writeFile(path.join(tx, 'restore.md'), old);
    await fs.link(path.join(tx, 'restore.md'), candidate);
    expect((await ensureUserTemplates(user, source)).methodSkills).toMatchObject({
      recovered: 1,
      updated: 1,
    });
    expect(await fs.readFile(candidate, 'utf8')).toBe(next);
  });

  it.each([
    { schemaVersion: 2 },
    { name: '../../private.md' },
    { name: 'my-method.md' },
    { previousHash: sha('custom') },
    { installedHash: sha('unknown target') },
    { source: '../../elsewhere' },
  ])('rejects untrusted journal fields without changing any path: %j', async (patch) => {
    await journal({ backup: old, patch });
    await expect(ensureUserTemplates(user, source)).rejects.toThrow();
    await expect(fs.stat(candidate)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(log.error).toHaveBeenCalled();
  });

  it('rejects corrupt JSON, preserving the backup and missing path', async () => {
    const tx = await journal({ backup: old });
    await fs.writeFile(path.join(tx, 'pending.json'), '{bad');
    await expect(ensureUserTemplates(user, source)).rejects.toThrow();
    expect(await fs.readFile(path.join(tx, 'original.md'), 'utf8')).toBe(old);
    await expect(fs.stat(candidate)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('preserves linked method directories without copying missing files through them', async () => {
    const external = path.join(root, 'external');
    await fs.mkdir(external);
    await fs.rmdir(path.dirname(candidate));
    await fs.symlink(
      external,
      path.dirname(candidate),
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    expect((await ensureUserTemplates(user, source)).methodSkills?.preserved).toBe(1);
    expect(await fs.readdir(external)).toEqual([]);
  });

  it('preserves hard-linked method files without editing their other name', async () => {
    const external = path.join(root, 'external.md');
    await fs.writeFile(external, old);
    await fs.link(external, candidate);
    expect((await ensureUserTemplates(user, source)).methodSkills?.preserved).toBe(1);
    expect(await fs.readFile(external, 'utf8')).toBe(old);
  });

  it('rejects a linked recovery directory without following it', async () => {
    const external = path.join(root, 'external');
    await fs.mkdir(external);
    await fs.symlink(
      external,
      path.join(dest, '.codesign-skill-upgrades'),
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    await expect(ensureUserTemplates(user, source)).rejects.toThrow('Unsafe upgrade state');
    expect(await fs.readdir(external)).toEqual([]);
  });
});
