import { describe, expect, it } from 'vitest';
import { makeSetTitleTool, normalizeTitle } from './set-title';

describe('set-title tool', () => {
  it('normalizeTitle strips trailing punctuation and whitespace', () => {
    expect(normalizeTitle('Surf Retreat Landing.')).toBe('Surf Retreat Landing');
    expect(normalizeTitle('  data analytics dashboard  ')).toBe('data analytics dashboard');
    expect(normalizeTitle('Onboarding Flow —')).toBe('Onboarding Flow');
    expect(normalizeTitle('Logo!')).toBe('Logo');
  });

  it('execute returns a normalized title in details', async () => {
    const tool = makeSetTitleTool();
    const r = await tool.execute('call-1', { title: 'Surf Retreat Landing Page.' });
    expect(r.details).toEqual({ title: 'Surf Retreat Landing Page' });
    expect(r.content[0]?.type).toBe('text');
  });

  it('tool metadata is stable', () => {
    const tool = makeSetTitleTool();
    expect(tool.name).toBe('set_title');
    expect(tool.label).toBe('Title');
  });
});
