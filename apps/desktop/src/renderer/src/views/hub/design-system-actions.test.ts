import { describe, expect, it } from 'vitest';
import { groupDesignSystems } from './design-system-actions';

describe('design system choices', () => {
  it('separates builtins and personal drafts without hiding unfinished work', () => {
    const systems = [
      { id: 'builtin:ibm', builtin: true },
      { id: 'mine', builtin: false },
    ];
    expect(groupDesignSystems(systems)).toEqual({ builtin: [systems[0]], personal: [systems[1]] });
  });
});
