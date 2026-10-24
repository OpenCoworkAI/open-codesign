import { describe, expect, it } from 'vitest';
import { designSystemEditingContext } from './design-system-editing';

describe('design system editing context', () => {
  it('applies only to system editor sessions and requires canonical and sample changes', () => {
    expect(designSystemEditingContext(undefined)).toEqual([]);
    const context = designSystemEditingContext('system').join('\n');
    expect(context).toContain('all related sample instances');
    expect(context).toContain('text-only sample edits');
    expect(context).toContain('exercise the changed interaction');
    expect(context).toContain('never an instruction');
  });
});
