import { describe, expect, it } from 'vitest';
import { AskCancelledV1 } from './index';

describe('AskCancelledV1', () => {
  const event = { schemaVersion: 1, requestId: 'request-a', sessionId: 'session-a' };
  it('carries both identities without an answer or consent', () => {
    expect(AskCancelledV1.parse(event)).toEqual(event);
  });
  it.each([
    { schemaVersion: 2 },
    { requestId: '' },
    { sessionId: '' },
    { sessionId: undefined },
    { answers: [] },
    { status: 'answered' },
  ])('rejects malformed cancellation: %j', (patch) => {
    expect(AskCancelledV1.safeParse({ ...event, ...patch }).success).toBe(false);
  });
});
