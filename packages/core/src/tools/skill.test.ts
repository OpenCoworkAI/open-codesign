import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { CodesignError } from '@open-codesign/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { invokeSkill, listSkillManifest, makeSkillTool } from './skill';

describe('skill tool', () => {
  let skillsRoot: string;
  let brandRefsRoot: string;

  beforeEach(() => {
    const base = path.join(tmpdir(), `codesign-skill-${process.pid}-${Date.now()}`);
    skillsRoot = path.join(base, 'skills');
    brandRefsRoot = path.join(base, 'brand-refs');
    mkdirSync(skillsRoot, { recursive: true });
    mkdirSync(path.join(brandRefsRoot, 'demo'), { recursive: true });
    writeFileSync(
      path.join(skillsRoot, 'form-layout.md'),
      [
        '---',
        'schemaVersion: 1',
        'name: form-layout',
        'description: Rules for forms.',
        'aliases: [forms]',
        'dependencies: [empty-states]',
        'validationHints: [labels]',
        '---',
        '# form-layout',
        '',
        'Rules for forms.',
      ].join('\n'),
      'utf8',
    );
    writeFileSync(
      path.join(skillsRoot, 'empty-states.md'),
      [
        '---',
        'schemaVersion: 1',
        'name: empty-states',
        'description: What to show when there is nothing.',
        '---',
        '# empty-states',
        '',
        'What to show when there is nothing.',
      ].join('\n'),
      'utf8',
    );
    writeFileSync(
      path.join(brandRefsRoot, 'demo', 'DESIGN.md'),
      '# Demo Brand\n\nPalette, type, motion notes.\n',
      'utf8',
    );
  });

  afterEach(() => {
    rmSync(path.dirname(skillsRoot), { recursive: true, force: true });
  });

  it('manifest exposes design skills and brand refs from the provided roots', async () => {
    const m = await listSkillManifest({ skillsRoot, brandRefsRoot });
    expect(m.some((e) => e.name === 'form-layout' && e.category === 'design')).toBe(true);
    expect(m.some((e) => e.name === 'brand:demo' && e.category === 'brand')).toBe(true);
    expect(m.find((e) => e.name === 'form-layout')?.dependencies).toEqual(['empty-states']);
  });

  it('returns "already-loaded" for repeated invocations', async () => {
    const first = await invokeSkill({ name: 'form-layout', roots: { skillsRoot, brandRefsRoot } });
    expect(first.status).toBe('loaded');
    const second = await invokeSkill({
      name: 'form-layout',
      roots: { skillsRoot, brandRefsRoot },
      alreadyLoaded: new Set(['form-layout']),
    });
    expect(second.status).toBe('already-loaded');
  });

  it('returns not-found for unknown names', async () => {
    const r = await invokeSkill({
      name: 'no-such-skill',
      roots: { skillsRoot, brandRefsRoot },
    });
    expect(r.status).toBe('not-found');
  });

  it('resolves aliases to the canonical skill name', async () => {
    const r = await invokeSkill({
      name: 'forms',
      roots: { skillsRoot, brandRefsRoot },
    });
    expect(r.status).toBe('loaded');
    expect(r.metadata?.name).toBe('form-layout');
  });

  it('treats missing roots as explicit empty manifests', async () => {
    const m = await listSkillManifest({
      skillsRoot: path.join(skillsRoot, 'missing'),
      brandRefsRoot: path.join(brandRefsRoot, 'missing'),
    });
    expect(m).toEqual([]);
  });

  it('throws when a registered skill file cannot be read', async () => {
    rmSync(path.join(brandRefsRoot, 'demo', 'DESIGN.md'));
    await expect(
      invokeSkill({ name: 'brand:demo', roots: { skillsRoot, brandRefsRoot } }),
    ).rejects.toSatisfy(
      (err: unknown) => err instanceof CodesignError && err.code === 'SKILL_LOAD_FAILED',
    );
  });
});

describe('makeSkillTool', () => {
  let skillsRoot: string;
  let brandRefsRoot: string;

  beforeEach(() => {
    const base = path.join(tmpdir(), `codesign-skill-tool-${process.pid}-${Date.now()}`);
    skillsRoot = path.join(base, 'skills');
    brandRefsRoot = path.join(base, 'brand-refs');
    mkdirSync(skillsRoot, { recursive: true });
    mkdirSync(brandRefsRoot, { recursive: true });
    writeFileSync(
      path.join(skillsRoot, 'form-layout.md'),
      [
        '---',
        'schemaVersion: 1',
        'name: form-layout',
        'description: Rules.',
        'aliases: [forms]',
        'dependencies: [empty-states]',
        'validationHints: [labels]',
        '---',
        '# form-layout',
        '',
        'Rules.',
      ].join('\n'),
      'utf8',
    );
  });

  afterEach(() => {
    rmSync(path.dirname(skillsRoot), { recursive: true, force: true });
  });

  it('loads a known builtin skill and returns markdown body', async () => {
    const tool = makeSkillTool({ skillsRoot, brandRefsRoot });
    const result = await tool.execute('call-1', { name: 'form-layout' });
    expect(result.details?.status).toBe('loaded');
    expect(result.details?.name).toBe('form-layout');
    expect(result.details?.dependencies).toEqual(['empty-states']);
    const text = result.content.find((c) => c.type === 'text');
    expect(text).toBeDefined();
    expect(text && 'text' in text && text.text.length).toBeGreaterThan(0);
  });

  it('returns already-loaded on second call with the same dedup set', async () => {
    const dedup = new Set<string>();
    const tool = makeSkillTool({ skillsRoot, brandRefsRoot, dedup });
    const first = await tool.execute('call-1', { name: 'form-layout' });
    expect(first.details?.status).toBe('loaded');
    const second = await tool.execute('call-2', { name: 'form-layout' });
    expect(second.details?.status).toBe('already-loaded');
  });

  it('dedups aliases across the same session state', async () => {
    const dedup = new Set<string>();
    const tool = makeSkillTool({ skillsRoot, brandRefsRoot, dedup });
    const first = await tool.execute('call-1', { name: 'forms' });
    expect(first.details?.status).toBe('loaded');
    expect(first.details?.name).toBe('form-layout');
    const second = await tool.execute('call-2', { name: 'form-layout' });
    expect(second.details?.status).toBe('already-loaded');
  });

  it('returns not-found for unknown skill name', async () => {
    const tool = makeSkillTool({ skillsRoot, brandRefsRoot });
    const result = await tool.execute('call-1', { name: 'no-such-skill' });
    expect(result.details?.status).toBe('not-found');
  });
});
