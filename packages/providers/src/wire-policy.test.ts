import { describe, expect, it } from 'vitest';
import {
  THIRD_PARTY_REASONING_MODEL_RE,
  applyResponsesRoleShaping,
  inferReasoning,
  requiresResponsesRoleShaping,
} from './wire-policy';

// ── inferReasoning ────────────────────────────────────────────────────────────

describe('inferReasoning — anthropic wire', () => {
  it('always returns true regardless of model or baseUrl', () => {
    expect(inferReasoning('anthropic', 'claude-opus-4-5', 'https://api.anthropic.com')).toBe(true);
    expect(inferReasoning('anthropic', 'claude-sonnet-4-6', undefined)).toBe(true);
  });
});

describe('inferReasoning — openai-responses wire', () => {
  it('always returns true (Responses API supports reasoning unconditionally)', () => {
    expect(inferReasoning('openai-responses', 'gpt-5.4', 'https://proxy.example/v1')).toBe(true);
    expect(inferReasoning('openai-responses', 'gpt-4o', 'https://api.openai.com/v1')).toBe(true);
  });
});

describe('inferReasoning — openai-codex-responses wire', () => {
  it('always returns true', () => {
    expect(
      inferReasoning('openai-codex-responses', 'gpt-5.3-codex', 'https://api.openai.com/v1'),
    ).toBe(true);
  });
});

describe('inferReasoning — openai-chat wire, official OpenAI endpoint', () => {
  const official = 'https://api.openai.com/v1';

  it('returns false for gpt-4o (non-reasoning model)', () => {
    expect(inferReasoning('openai-chat', 'gpt-4o', official)).toBe(false);
  });

  it('returns true for o1 family', () => {
    expect(inferReasoning('openai-chat', 'o1-mini', official)).toBe(true);
    expect(inferReasoning('openai-chat', 'o1-preview', official)).toBe(true);
    expect(inferReasoning('openai-chat', 'o1', official)).toBe(true);
  });

  it('returns true for o3 family', () => {
    expect(inferReasoning('openai-chat', 'o3-mini', official)).toBe(true);
    expect(inferReasoning('openai-chat', 'o3', official)).toBe(true);
  });

  it('returns true for o4 family', () => {
    expect(inferReasoning('openai-chat', 'o4-mini', official)).toBe(true);
  });

  it('returns true for gpt-5 family', () => {
    expect(inferReasoning('openai-chat', 'gpt-5', official)).toBe(true);
    expect(inferReasoning('openai-chat', 'gpt-5-turbo', official)).toBe(true);
    expect(inferReasoning('openai-chat', 'gpt-5.4', official)).toBe(true);
  });

  it('returns false for models that look like reasoning on third-party but are not on official', () => {
    // claude-sonnet-4 is only a reasoning model via third-party gateways
    expect(inferReasoning('openai-chat', 'claude-sonnet-4-6', official)).toBe(false);
  });
});

describe('inferReasoning — openai-chat wire, third-party gateways (#183)', () => {
  it('returns false for Qwen DashScope (non-reasoning model id)', () => {
    expect(
      inferReasoning(
        'openai-chat',
        'qwen3.6-plus',
        'https://dashscope.aliyuncs.com/compatible-mode/v1',
      ),
    ).toBe(false);
  });

  it('returns false for DeepSeek chat (non-reasoning)', () => {
    expect(inferReasoning('openai-chat', 'deepseek-chat', 'https://api.deepseek.com/v1')).toBe(
      false,
    );
  });

  it('returns false for GLM/BigModel (non-reasoning)', () => {
    expect(inferReasoning('openai-chat', 'glm-4.6v', 'https://open.bigmodel.cn/api/paas/v4')).toBe(
      false,
    );
  });

  it('returns true for Claude 4 models proxied via third-party (#188)', () => {
    const proxy = 'https://api.univibe.cc/openai';
    expect(inferReasoning('openai-chat', 'claude-opus-4-6', proxy)).toBe(true);
    expect(inferReasoning('openai-chat', 'claude-sonnet-4-6', proxy)).toBe(true);
    expect(inferReasoning('openai-chat', 'anthropic/claude-opus-4-6', proxy)).toBe(true);
  });

  it('returns true for OpenAI reasoning models proxied via third-party', () => {
    const proxy = 'https://my-proxy.example/v1';
    expect(inferReasoning('openai-chat', 'openai/o3-mini', proxy)).toBe(true);
    expect(inferReasoning('openai-chat', 'openai/gpt-5.1', proxy)).toBe(true);
    expect(inferReasoning('openai-chat', 'o1-mini', proxy)).toBe(true);
  });

  it('returns true for qwen/qwq models', () => {
    expect(
      inferReasoning('openai-chat', 'qwen/qwq-32b-preview', 'https://my-proxy.example/v1'),
    ).toBe(true);
  });

  it('returns true for :thinking-suffixed model IDs', () => {
    expect(inferReasoning('openai-chat', 'some-model:thinking', 'https://proxy.example/v1')).toBe(
      true,
    );
  });

  it('returns true for minimax reasoning models', () => {
    expect(inferReasoning('openai-chat', 'minimax/minimax-m1', 'https://proxy.example/v1')).toBe(
      true,
    );
  });

  it('returns true for deepseek-r series', () => {
    expect(inferReasoning('openai-chat', 'deepseek/deepseek-r1', 'https://proxy.example/v1')).toBe(
      true,
    );
  });
});

describe('inferReasoning — unknown/undefined wire', () => {
  it('returns false for undefined wire (safe default)', () => {
    expect(inferReasoning(undefined, 'gpt-4o', 'https://api.openai.com/v1')).toBe(false);
    expect(inferReasoning(undefined, 'claude-opus-4-5', 'https://api.anthropic.com')).toBe(false);
  });
});

// ── THIRD_PARTY_REASONING_MODEL_RE ────────────────────────────────────────────

describe('THIRD_PARTY_REASONING_MODEL_RE', () => {
  it('does not match plain non-reasoning model IDs', () => {
    expect(THIRD_PARTY_REASONING_MODEL_RE.test('gpt-4o')).toBe(false);
    expect(THIRD_PARTY_REASONING_MODEL_RE.test('qwen3.6-plus')).toBe(false);
    expect(THIRD_PARTY_REASONING_MODEL_RE.test('deepseek-chat')).toBe(false);
    expect(THIRD_PARTY_REASONING_MODEL_RE.test('glm-4.6v')).toBe(false);
  });

  it('matches known reasoning model families', () => {
    expect(THIRD_PARTY_REASONING_MODEL_RE.test('claude-opus-4-6')).toBe(true);
    expect(THIRD_PARTY_REASONING_MODEL_RE.test('claude-sonnet-4-6')).toBe(true);
    expect(THIRD_PARTY_REASONING_MODEL_RE.test('o1-mini')).toBe(true);
    expect(THIRD_PARTY_REASONING_MODEL_RE.test('o3')).toBe(true);
    expect(THIRD_PARTY_REASONING_MODEL_RE.test('gpt-5')).toBe(true);
    expect(THIRD_PARTY_REASONING_MODEL_RE.test('deepseek/deepseek-r1')).toBe(true);
    expect(THIRD_PARTY_REASONING_MODEL_RE.test('qwen/qwq-32b')).toBe(true);
    expect(THIRD_PARTY_REASONING_MODEL_RE.test('any:thinking')).toBe(true);
  });
});

// ── applyResponsesRoleShaping ─────────────────────────────────────────────────

describe('applyResponsesRoleShaping', () => {
  it('sets top-level instructions and strips system/developer items from input[]', () => {
    const payload = {
      input: [
        { role: 'system', content: 'ignored' },
        { role: 'developer', content: 'also ignored' },
        { role: 'user', content: [{ type: 'input_text', text: 'hi' }] },
      ],
    };

    const result = applyResponsesRoleShaping(payload, 'You are open-codesign.') as {
      instructions?: string;
      input: Array<{ role: string }>;
    };

    expect(result.instructions).toBe('You are open-codesign.');
    expect(result.input.map((e) => e.role)).toEqual(['user']);
  });

  it('returns the payload unchanged when systemPrompt is empty string', () => {
    const payload = { input: [{ role: 'system' }] };
    expect(applyResponsesRoleShaping(payload, '')).toBe(payload);
  });

  it('returns the payload unchanged when systemPrompt is undefined', () => {
    const payload = { input: [{ role: 'system' }] };
    expect(applyResponsesRoleShaping(payload, undefined)).toBe(payload);
  });

  it('keeps assistant and user entries intact', () => {
    const payload = {
      input: [
        { role: 'user', content: 'hello' },
        { role: 'assistant', content: 'hi' },
        { role: 'user', content: 'bye' },
      ],
    };

    const result = applyResponsesRoleShaping(payload, 'Be helpful.') as {
      input: Array<{ role: string }>;
    };

    expect(result.input).toHaveLength(3);
    expect(result.input.map((e) => e.role)).toEqual(['user', 'assistant', 'user']);
  });

  it('handles missing input[] gracefully (no array to filter)', () => {
    const payload = { model: 'gpt-5.1' };
    const result = applyResponsesRoleShaping(payload, 'Some prompt.') as {
      instructions?: string;
      input?: unknown;
    };
    expect(result.instructions).toBe('Some prompt.');
    expect(result.input).toBeUndefined();
  });
});

// ── requiresResponsesRoleShaping ──────────────────────────────────────────────

describe('requiresResponsesRoleShaping', () => {
  it('returns true only for openai-responses wire', () => {
    expect(requiresResponsesRoleShaping('openai-responses')).toBe(true);
  });

  it('returns false for all other wires', () => {
    expect(requiresResponsesRoleShaping('anthropic')).toBe(false);
    expect(requiresResponsesRoleShaping('openai-chat')).toBe(false);
    expect(requiresResponsesRoleShaping('openai-codex-responses')).toBe(false);
    expect(requiresResponsesRoleShaping(undefined)).toBe(false);
  });
});
