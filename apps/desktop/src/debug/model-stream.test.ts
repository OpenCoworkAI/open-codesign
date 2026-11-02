import {
  createAssistantMessageEventStream,
  getApiProvider,
  getModel,
  registerApiProvider,
  streamSimple,
} from '@mariozechner/pi-ai';
import { describe, expect, it } from 'vitest';
import { fixtureStream, installDebugModelBoundary } from './model-stream';

const model = {
  ...getModel('openai', 'gpt-4o-mini'),
  provider: 'background-fixture',
  id: 'fixture',
};
describe('pi debug model boundary', () => {
  it('settles even when a broken provider ignores abort', async () => {
    const provider = getApiProvider(model.api);
    if (!provider) throw new Error('Missing provider');
    const stalled = () => createAssistantMessageEventStream();
    registerApiProvider({ api: model.api, stream: stalled, streamSimple: stalled });
    const boundary = installDebugModelBoundary({
      mode: 'live',
      provider: model.provider,
      model: model.id,
      secrets: [],
      timeoutMs: 20,
      record: () => {},
    });
    try {
      expect((await streamSimple(model, { messages: [] }).result()).stopReason).toBe('aborted');
      await boundary.stop();
      expect(boundary.evidence.active).toBe(0);
    } finally {
      boundary.restore();
      registerApiProvider(provider);
    }
  });
  it('runs the installed pi stream with bounded calls and a selected provider', async () => {
    const boundary = installDebugModelBoundary({
      mode: 'fixture',
      provider: model.provider,
      model: model.id,
      secrets: [],
      maxCalls: 1,
      record: () => {},
    });
    try {
      const result = await streamSimple(model, { messages: [] }).result();
      expect(result.stopReason).toBe('stop');
      expect(() => streamSimple(model, { messages: [] })).toThrow('BACKGROUND_MODEL_CALL_LIMIT');
      expect(() => streamSimple({ ...model, provider: 'other' }, { messages: [] })).toThrow(
        'BACKGROUND_MODEL_SELECTION_DENIED',
      );
      await boundary.stop();
      expect(boundary.evidence).toMatchObject({ calls: 1, completed: 1, active: 0 });
    } finally {
      boundary.restore();
    }
  });
  it('redacts exact stored secrets before model responses reach logs or renderer', async () => {
    const provider = getApiProvider(model.api);
    if (!provider) throw new Error('Missing pi provider');
    const fail = () => {
      throw new Error('private-sentinel arbitrary-token');
    };
    registerApiProvider({ api: model.api, stream: fail, streamSimple: fail });
    const boundary = installDebugModelBoundary({
      mode: 'live',
      provider: model.provider,
      model: model.id,
      secrets: ['private-sentinel', 'arbitrary-token'],
      record: () => {},
    });
    try {
      const result = await streamSimple(model, { messages: [] }).result();
      expect(result.stopReason).toBe('error');
      expect(result.errorMessage).toBe('[REDACTED] [REDACTED]');
    } finally {
      await boundary.stop();
      boundary.restore();
      registerApiProvider(provider);
    }
  });
  it('cancels delayed fixtures on deadline and settles all pending calls', async () => {
    const boundary = installDebugModelBoundary({
      mode: 'fixture',
      provider: model.provider,
      model: model.id,
      secrets: [],
      timeoutMs: 20,
      record: () => {},
    });
    try {
      const result = await streamSimple(model, {
        messages: [],
        tools: [{ name: 'ask', description: '', parameters: { type: 'object', properties: {} } }],
      }).result();
      expect(result.stopReason).toBe('aborted');
      await boundary.stop();
      expect(boundary.evidence).toMatchObject({ active: 0, cancelled: 1 });
      expect(() => streamSimple(model, { messages: [] })).toThrow('BACKGROUND_MODEL_CLOSED');
    } finally {
      boundary.restore();
    }
  });
  it('provides deterministic tool calls rather than fabricating completed UI state', async () => {
    const result = await fixtureStream(model, {
      messages: [{ role: 'user', content: 'User request: Build a test', timestamp: 1 }],
      tools: [
        { name: 'set_todos', description: '', parameters: { type: 'object', properties: {} } },
      ],
    }).result();
    expect(result.stopReason).toBe('toolUse');
    expect(result.content[0]).toMatchObject({ name: 'set_todos' });
  });
});
