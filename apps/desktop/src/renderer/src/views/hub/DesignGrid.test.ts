import { describe, expect, it } from 'vitest';
import { getDesignCardStatus } from './DesignGrid';

describe('getDesignCardStatus', () => {
  it('marks the current design independently from background work', () => {
    expect(
      getDesignCardStatus('design-a', 'design-a', {
        'design-b': { generationId: 'gen-b', stage: 'streaming' },
      }),
    ).toEqual({ isCurrent: true, isWorking: false });

    expect(
      getDesignCardStatus('design-b', 'design-a', {
        'design-b': { generationId: 'gen-b', stage: 'streaming' },
      }),
    ).toEqual({ isCurrent: false, isWorking: true });
  });

  it('allows the same design to be both current and working', () => {
    expect(
      getDesignCardStatus('design-a', 'design-a', {
        'design-a': { generationId: 'gen-a', stage: 'thinking' },
      }),
    ).toEqual({ isCurrent: true, isWorking: true });
  });
});
