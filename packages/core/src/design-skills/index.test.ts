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

  it('silently skips files the user has deleted (best-effort read)', async () => {
    for (const name of DESIGN_SKILL_FILES.slice(0, 3)) {
      writeFileSync(path.join(dir, name), 'body', 'utf8');
    }
    const entries = await loadDesignSkills(dir);
    expect(entries.map(([n]) => n)).toEqual([...DESIGN_SKILL_FILES].slice(0, 3));
  });

  it('exposes the declared canonical file list for callers', () => {
    expect(DESIGN_SKILL_FILES.length).toBeGreaterThan(0);
    expect(new Set(DESIGN_SKILL_FILES).size).toBe(DESIGN_SKILL_FILES.length);
  });
});
