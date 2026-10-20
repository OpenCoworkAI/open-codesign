import { describe, expect, it } from 'vitest';
import { normalizeMiniMaxPayload } from './minimax-compat';

describe('MiniMax payload preservation', () => {
  it('keeps Chat Completions reasoning, tools, and images intact', () => {
    const messages = [
      {
        role: 'assistant',
        reasoning_content: 'Keep this reasoning',
        tool_calls: [{ id: 'call-1', function: { name: 'read_file', arguments: '{}' } }],
      },
      { role: 'tool', tool_call_id: 'call-1', content: 'result' },
      {
        role: 'user',
        content: [{ type: 'image_url', image_url: { url: 'data:image/png;base64,aGVsbG8=' } }],
      },
    ];
    const original = structuredClone(messages);
    const payload = { messages, service_tier: 'priority', reasoning_split: true };
    normalizeMiniMaxPayload(
      payload,
      'MiniMax-M3.1-Flash',
      'https://api.minimax.io/v1',
      'openai-completions',
      'off',
    );
    expect(payload.messages).toBe(messages);
    expect(payload.messages).toEqual(original);
    expect(payload).not.toHaveProperty('service_tier');
    expect(payload).not.toHaveProperty('reasoning_split');
  });
  it('keeps Anthropic thinking signatures and tool blocks intact', () => {
    const messages = [
      {
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: 'reason', signature: 'opaque' },
          { type: 'tool_use', id: 'call-1', name: 'read_file', input: {} },
        ],
      },
      {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 'call-1', content: 'result' }],
      },
    ];
    const original = structuredClone(messages);
    const payload = { messages };
    normalizeMiniMaxPayload(
      payload,
      'MiniMax-M3.1-Flash',
      'https://api.minimaxi.com/anthropic',
      'anthropic-messages',
      'high',
    );
    expect(payload.messages).toBe(messages);
    expect(payload.messages).toEqual(original);
  });
  it('retains complete Responses input while removing server-side state', () => {
    const input = [
      { type: 'function_call', call_id: 'call-1', name: 'read_file', arguments: '{}' },
      { type: 'function_call_output', call_id: 'call-1', output: 'result' },
    ];
    const payload = { input, store: true, previous_response_id: 'resp-1', conversation: 'conv-1' };
    normalizeMiniMaxPayload(
      payload,
      'MiniMax-M3.1-Flash',
      'https://api.minimax.io/v1',
      'openai-responses',
      'high',
    );
    expect(payload.input).toBe(input);
    expect(payload).not.toHaveProperty('store');
    expect(payload).not.toHaveProperty('previous_response_id');
    expect(payload).not.toHaveProperty('conversation');
  });
});
