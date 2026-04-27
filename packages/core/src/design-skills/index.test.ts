import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DESIGN_SKILL_FILES, loadDesignSkills } from './index.js';

describe('loadDesignSkills', () => {
  let dir: string;

  beforeEach(() => {
    dir = path.join(tmpdir(), `codesign-design-skills-${process.pid}-${Date.now()}`);
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

  it('throws when a declared skill file is missing from an existing directory', async () => {
    for (const name of DESIGN_SKILL_FILES.slice(0, 3)) {
      writeFileSync(path.join(dir, name), 'body', 'utf8');
    }
    await expect(loadDesignSkills(dir)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('exposes the declared canonical file list for callers', () => {
    expect(DESIGN_SKILL_FILES.length).toBeGreaterThan(0);
    expect(new Set(DESIGN_SKILL_FILES).size).toBe(DESIGN_SKILL_FILES.length);
  });
});
