import { describe, expect, it } from 'vitest';
import { getDesignCardStatus } from './DesignGrid';

describe('getDesignCardStatus', () => {
  it('marks only designs with active generation work', () => {
    expect(
      getDesignCardStatus('design-a', {
        'design-b': { generationId: 'gen-b', stage: 'streaming' },
      }),
    ).toEqual({ isWorking: false });

    expect(
      getDesignCardStatus('design-b', {
        'design-b': { generationId: 'gen-b', stage: 'streaming' },
      }),
    ).toEqual({ isWorking: true });
  });
});
