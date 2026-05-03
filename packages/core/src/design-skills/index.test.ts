import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DESIGN_SKILL_FILES, loadDesignSkills } from './index.js';

describe.sequential('loadDesignSkills', () => {
  let dir: string;

  beforeEach(() => {
    dir = path.join(tmpdir(), `codesign-design-skills-${process.pid}-${randomUUID()}`);
    mkdirSync(dir, { recursive: true });
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function writeAll(payload: string): void {
    for (const name of DESIGN_SKILL_FILES) {
      writeFileSync(path.join(dir, name), payload, 'utf8');
    }
  }

  it('returns all known skill files in canonical order when all are present', async () => {
    writeAll('placeholder');
    const entries = await loadDesignSkills(dir);
    expect(entries.map(([n]) => n)).toEqual([...DESIGN_SKILL_FILES]);
  });

  it('returns an explicit empty state when the directory is missing', async () => {
    rmSync(dir, { recursive: true, force: true });
    await expect(loadDesignSkills(dir)).resolves.toEqual([]);
  });

  it('returns an explicit empty state when the directory has no skill files', async () => {
    await expect(loadDesignSkills(dir)).resolves.toEqual([]);
  });

  it('throws when a declared skill file is missing from an existing directory', async () => {
    for (const name of DESIGN_SKILL_FILES.slice(0, 3)) {
      writeFileSync(path.join(dir, name), 'body', 'utf8');
    }
    await expect(loadDesignSkills(dir)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rejects symlinked design-skill files', async () => {
    writeAll('placeholder');
    const first = DESIGN_SKILL_FILES[0];
    if (first === undefined) throw new Error('expected at least one design skill file');
    const outside = path.join(
      tmpdir(),
      `codesign-design-skills-out-${process.pid}-${randomUUID()}`,
    );
    mkdirSync(outside, { recursive: true });
    writeFileSync(path.join(outside, 'secret.jsx'), 'secret', 'utf8');
    const linkPath = path.join(dir, first);
    rmSync(linkPath, { force: true });
    if (existsSync(linkPath)) unlinkSync(linkPath);
    try {
      try {
        symlinkSync(path.join(outside, 'secret.jsx'), linkPath);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'EPERM') return;
        throw err;
      }

      await expect(loadDesignSkills(dir)).rejects.toThrow(/symbolic link/);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it('exposes the declared canonical file list for callers', () => {
    expect(DESIGN_SKILL_FILES.length).toBeGreaterThan(0);
    expect(new Set(DESIGN_SKILL_FILES).size).toBe(DESIGN_SKILL_FILES.length);
  });
});
