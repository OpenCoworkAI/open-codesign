import { describe, expect, it } from 'vitest';
import { invokeSkill, listSkillManifest, makeSkillTool } from './skill';

describe('skill tool', () => {
  it('manifest exposes builtin design skills', async () => {
    const m = await listSkillManifest();
    expect(m.length).toBeGreaterThan(0);
    expect(m.some((e) => e.category === 'design' && e.source === 'builtin')).toBe(true);
  });

  it('returns "already-loaded" for repeated invocations', async () => {
    const m = await listSkillManifest();
    const designs = m.filter((e) => e.category === 'design');
    if (designs.length === 0) return; // skip if no skills (subagent ordering)
    const first = await invokeSkill({ name: designs[0]!.name });
    expect(first.status).toBe('loaded');
    const second = await invokeSkill({
      name: designs[0]!.name,
      alreadyLoaded: new Set([designs[0]!.name]),
    });
    expect(second.status).toBe('already-loaded');
  });

  it('returns not-found for unknown names', async () => {
    const r = await invokeSkill({ name: 'no-such-skill' });
    expect(r.status).toBe('not-found');
  });
});

describe('makeSkillTool', () => {
  it('loads a known builtin skill and returns markdown body', async () => {
    const tool = makeSkillTool();
    const result = await tool.execute('call-1', { name: 'form-layout' });
    expect(result.details?.status).toBe('loaded');
    expect(result.details?.name).toBe('form-layout');
    const text = result.content.find((c) => c.type === 'text');
    expect(text).toBeDefined();
    expect(text && 'text' in text && text.text.length).toBeGreaterThan(0);
  });

  it('returns already-loaded on second call with the same dedup set', async () => {
    const dedup = new Set<string>();
    const tool = makeSkillTool({ dedup });
    const first = await tool.execute('call-1', { name: 'form-layout' });
    expect(first.details?.status).toBe('loaded');
    const second = await tool.execute('call-2', { name: 'form-layout' });
    expect(second.details?.status).toBe('already-loaded');
  });

  it('returns not-found for unknown skill name', async () => {
    const tool = makeSkillTool();
    const result = await tool.execute('call-1', { name: 'no-such-skill' });
    expect(result.details?.status).toBe('not-found');
  });
});
