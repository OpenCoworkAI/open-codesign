import { describe, expect, it } from 'vitest';
import { GeneratePayload, GeneratePayloadV1 } from './index';

const BASE_VALID = {
  schemaVersion: 1 as const,
  prompt: 'Design a landing page',
  history: [],
  model: { provider: 'anthropic' as const, modelId: 'claude-sonnet-4-6' },
  generationId: 'gen-abc123',
};

describe('GeneratePayloadV1', () => {
  it('accepts a valid v1 payload', () => {
    const result = GeneratePayloadV1.parse(BASE_VALID);
    expect(result.schemaVersion).toBe(1);
    expect(result.generationId).toBe('gen-abc123');
    expect(result.attachments).toEqual([]);
  });

  it('rejects a payload missing schemaVersion', () => {
    const { schemaVersion: _, ...noVersion } = BASE_VALID;
    expect(() => GeneratePayloadV1.parse(noVersion)).toThrow();
  });

  it('rejects a payload with a future schemaVersion (forward incompat)', () => {
    expect(() => GeneratePayloadV1.parse({ ...BASE_VALID, schemaVersion: 2 })).toThrow();
  });

  it('rejects a payload with an empty generationId', () => {
    expect(() => GeneratePayloadV1.parse({ ...BASE_VALID, generationId: '' })).toThrow();
  });

  it('rejects a payload missing generationId', () => {
    const { generationId: _, ...noId } = BASE_VALID;
    expect(() => GeneratePayloadV1.parse(noId)).toThrow();
  });
});

describe('GeneratePayload (legacy — no schemaVersion)', () => {
  it('accepts a legacy payload without schemaVersion and optional generationId', () => {
    const raw = {
      prompt: 'Design a landing page',
      history: [],
      model: { provider: 'anthropic' as const, modelId: 'claude-sonnet-4-6' },
    };
    const result = GeneratePayload.parse(raw);
    expect(result.generationId).toBeUndefined();
    expect(result.attachments).toEqual([]);
  });

  it('accepts a legacy payload with generationId present', () => {
    const raw = {
      prompt: 'Design a landing page',
      history: [],
      model: { provider: 'anthropic' as const, modelId: 'claude-sonnet-4-6' },
      generationId: 'gen-old-123',
    };
    const result = GeneratePayload.parse(raw);
    expect(result.generationId).toBe('gen-old-123');
  });

  it('can be promoted to GeneratePayloadV1 by injecting schemaVersion and falling back generationId', () => {
    const legacy = GeneratePayload.parse({
      prompt: 'Design a landing page',
      history: [],
      model: { provider: 'anthropic' as const, modelId: 'claude-sonnet-4-6' },
    });
    const id = legacy.generationId ?? `gen-${Date.now()}`;
    const v1 = GeneratePayloadV1.parse({ schemaVersion: 1, ...legacy, generationId: id });
    expect(v1.schemaVersion).toBe(1);
    expect(v1.generationId).toMatch(/^gen-/);
  });
});
