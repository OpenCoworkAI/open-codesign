import { mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CodesignError } from '@open-codesign/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadAllSkills, loadSkillsFromDir } from './loader.js';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

let testDir: string;

beforeEach(async () => {
  testDir = join(tmpdir(), `skills-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(testDir, { recursive: true });
});

afterEach(async () => {
  await rm(testDir, { recursive: true, force: true });
});

async function writeSkill(dir: string, filename: string, content: string) {
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, filename), content, 'utf-8');
}

const MINIMAL_SKILL = `---
schemaVersion: 1
name: my-skill
description: A minimal test skill.
---

Skill body content.
`;

const FULL_SKILL = `---
schemaVersion: 1
name: full-skill
description: A fully specified test skill.
trigger:
  providers: ['anthropic', 'openai']
  scope: prefix
disable_model_invocation: false
user_invocable: true
allowed_tools: ['read_file', 'write_file']
---

Full skill body here.
`;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('loadSkillsFromDir()', () => {
  it('loads 4 builtin skills from the real builtin directory', async () => {
    const builtinDir = new URL('./builtin', import.meta.url).pathname;
    const skills = await loadSkillsFromDir(builtinDir, 'builtin');
    expect(skills.length).toBe(4);
    const ids = skills.map((s) => s.id).sort();
    expect(ids).toContain('frontend-design-anti-slop');
    expect(ids).toContain('pitch-deck');
    expect(ids).toContain('data-viz-recharts');
    expect(ids).toContain('mobile-mock');
  });

  it('returns empty array when directory does not exist', async () => {
    const skills = await loadSkillsFromDir(join(testDir, 'nonexistent'), 'user');
    expect(skills).toHaveLength(0);
  });

  it('propagates non-ENOENT readdir errors (e.g. ENOTDIR)', async () => {
    const filePath = join(testDir, 'not-a-dir.md');
    await writeFile(filePath, '---\nname: x\n---\n');
    await expect(loadSkillsFromDir(filePath, 'user')).rejects.toMatchObject({
      code: 'ENOTDIR',
    });
  });

  it('parses minimal frontmatter and body correctly', async () => {
    await writeSkill(testDir, 'my-skill.md', MINIMAL_SKILL);
    const skills = await loadSkillsFromDir(testDir, 'user');
    expect(skills).toHaveLength(1);
    const skill = skills[0];
    if (!skill) throw new Error('expected skill');
    expect(skill.id).toBe('my-skill');
    expect(skill.source).toBe('user');
    expect(skill.frontmatter.name).toBe('my-skill');
    expect(skill.frontmatter.description).toBe('A minimal test skill.');
    expect(skill.body).toBe('Skill body content.');
  });

  it('parses full frontmatter including trigger block', async () => {
    await writeSkill(testDir, 'full-skill.md', FULL_SKILL);
    const skills = await loadSkillsFromDir(testDir, 'user');
    expect(skills).toHaveLength(1);
    const skill = skills[0];
    if (!skill) throw new Error('expected skill');
    expect(skill.frontmatter.trigger.providers).toEqual(['anthropic', 'openai']);
    expect(skill.frontmatter.trigger.scope).toBe('prefix');
    expect(skill.frontmatter.allowed_tools).toEqual(['read_file', 'write_file']);
  });

  it('applies defaults for omitted frontmatter fields', async () => {
    const minimal = `---
schemaVersion: 1
name: defaults-test
description: Testing defaults.
---
Body.
`;
    await writeSkill(testDir, 'defaults-test.md', minimal);
    const [skill] = await loadSkillsFromDir(testDir, 'builtin');
    if (!skill) throw new Error('expected skill');
    expect(skill.frontmatter.disable_model_invocation).toBe(false);
    expect(skill.frontmatter.user_invocable).toBe(true);
    expect(skill.frontmatter.trigger.scope).toBe('system');
    expect(skill.frontmatter.trigger.providers).toEqual(['*']);
  });

  it('throws SKILL_LOAD_FAILED when a skill has a description exceeding 1536 characters', async () => {
    const longDesc = 'x'.repeat(1537);
    const content = `---
schemaVersion: 1
name: too-long
description: ${longDesc}
---
Body.
`;
    await writeSkill(testDir, 'too-long.md', content);
    await expect(loadSkillsFromDir(testDir, 'user')).rejects.toSatisfy(
      (err: unknown) => err instanceof CodesignError && err.code === 'SKILL_LOAD_FAILED',
    );
  });

  it('throws SKILL_LOAD_FAILED when any skill file has invalid frontmatter', async () => {
    // Valid skill
    await writeSkill(testDir, 'good.md', MINIMAL_SKILL);
    // Broken skill — description exceeds max → validation fails → throws
    await writeSkill(
      testDir,
      'bad.md',
      `---\nschemaVersion: 1\nname: bad\ndescription: ${'z'.repeat(2000)}\n---\nBody.`,
    );
    await expect(loadSkillsFromDir(testDir, 'user')).rejects.toSatisfy(
      (err: unknown) => err instanceof CodesignError && err.code === 'SKILL_LOAD_FAILED',
    );
  });

  it('ignores non-.md files in the directory', async () => {
    await writeSkill(testDir, 'my-skill.md', MINIMAL_SKILL);
    await writeFile(join(testDir, 'readme.txt'), 'ignore me', 'utf-8');
    await writeFile(join(testDir, 'config.json'), '{}', 'utf-8');
    const skills = await loadSkillsFromDir(testDir, 'user');
    expect(skills).toHaveLength(1);
  });

  it('preserves newlines in literal block scalars (|) and folds them in folded scalars (>)', async () => {
    const content = `---
schemaVersion: 1
name: scalars
description: |
  line one
  line two
  line three
---
Body.
`;
    await writeSkill(testDir, 'scalars.md', content);
    const [skill] = await loadSkillsFromDir(testDir, 'user');
    if (!skill) throw new Error('expected skill');
    expect(skill.frontmatter.description).toBe('line one\nline two\nline three');

    const folded = `---
schemaVersion: 1
name: folded
description: >
  line one
  line two
  line three
---
Body.
`;
    await writeSkill(testDir, 'folded.md', folded);
    const skills = await loadSkillsFromDir(testDir, 'user');
    const f = skills.find((s) => s.id === 'folded');
    if (!f) throw new Error('expected folded skill');
    expect(f.frontmatter.description).toBe('line one line two line three');
  });
});

describe('loadAllSkills()', () => {
  it('merges builtin, user, and project tiers', async () => {
    const builtinDir = join(testDir, 'builtin');
    const userDir = join(testDir, 'user');
    await writeSkill(builtinDir, 'shared.md', MINIMAL_SKILL);
    await writeSkill(
      builtinDir,
      'only-builtin.md',
      MINIMAL_SKILL.replace('my-skill', 'only-builtin').replace(
        'A minimal test skill.',
        'Built-in only skill.',
      ),
    );
    await writeSkill(
      userDir,
      'user-only.md',
      MINIMAL_SKILL.replace('my-skill', 'user-only').replace(
        'A minimal test skill.',
        'User only skill.',
      ),
    );

    const skills = await loadAllSkills({ builtinDir, userDir });
    const ids = skills.map((s) => s.id).sort();
    expect(ids).toContain('shared');
    expect(ids).toContain('only-builtin');
    expect(ids).toContain('user-only');
  });

  it('user skill overrides builtin when they share the same id', async () => {
    const builtinDir = join(testDir, 'builtin');
    const userDir = join(testDir, 'user');
    await writeSkill(
      builtinDir,
      'shared.md',
      '---\nschemaVersion: 1\nname: shared\ndescription: Builtin version.\n---\nBuiltin body.',
    );
    await writeSkill(
      userDir,
      'shared.md',
      '---\nschemaVersion: 1\nname: shared\ndescription: User version.\n---\nUser body.',
    );

    const skills = await loadAllSkills({ builtinDir, userDir });
    const shared = skills.find((s) => s.id === 'shared');
    if (!shared) throw new Error('expected shared skill');
    expect(shared.source).toBe('user');
    expect(shared.body).toBe('User body.');
  });

  it('project skill overrides user and builtin when they share the same id', async () => {
    const builtinDir = join(testDir, 'builtin');
    const userDir = join(testDir, 'user');
    const projectDir = join(testDir, 'project');
    await writeSkill(
      builtinDir,
      'shared.md',
      '---\nschemaVersion: 1\nname: shared\ndescription: Builtin version.\n---\nBuiltin body.',
    );
    await writeSkill(
      userDir,
      'shared.md',
      '---\nschemaVersion: 1\nname: shared\ndescription: User version.\n---\nUser body.',
    );
    await writeSkill(
      projectDir,
      'shared.md',
      '---\nschemaVersion: 1\nname: shared\ndescription: Project version.\n---\nProject body.',
    );

    const skills = await loadAllSkills({ builtinDir, userDir, projectDir });
    const shared = skills.find((s) => s.id === 'shared');
    if (!shared) throw new Error('expected shared skill');
    expect(shared.source).toBe('project');
    expect(shared.body).toBe('Project body.');
  });

  it('works without optional dirs (only builtinDir provided)', async () => {
    const builtinDir = join(testDir, 'builtin');
    await writeSkill(builtinDir, 'my-skill.md', MINIMAL_SKILL);
    const skills = await loadAllSkills({ builtinDir });
    expect(skills).toHaveLength(1);
    expect(skills[0]?.source).toBe('builtin');
  });

  it('throws SKILL_LOAD_FAILED when a broken skill (missing description) is present', async () => {
    const builtinDir = join(testDir, 'builtin');
    // Skill missing required `description` field
    const brokenSkill = `---
schemaVersion: 1
name: broken-skill
---
Body without description.
`;
    await writeSkill(builtinDir, 'broken-skill.md', brokenSkill);
    await expect(loadAllSkills({ builtinDir })).rejects.toSatisfy(
      (err: unknown) =>
        err instanceof CodesignError &&
        err.code === 'SKILL_LOAD_FAILED' &&
        err.message.includes('broken-skill.md'),
    );
  });
});
