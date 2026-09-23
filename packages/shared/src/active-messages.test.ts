import { describe, expect, it } from 'vitest';
import { ActiveRunMessageInputV1 } from './active-messages';

const valid = {
  schemaVersion: 1,
  designId: 'design',
  generationId: 'run',
  messageId: 'message',
  mode: 'steer',
  text: 'change color',
};
describe('active message IPC schema', () => {
  it('accepts only explicit text-only versioned delivery modes', () => {
    expect(ActiveRunMessageInputV1.parse(valid)).toEqual(valid);
    for (const patch of [
      { mode: 'immediate' },
      { text: '' },
      { text: 'x'.repeat(32001) },
      { designId: '' },
      { generationId: '' },
      { messageId: '' },
      { schemaVersion: 2 },
      { attachments: [] },
      { model: 'other' },
    ]) {
      expect(() => ActiveRunMessageInputV1.parse({ ...valid, ...patch })).toThrow();
    }
  });
});
