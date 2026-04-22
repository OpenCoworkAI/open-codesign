import { describe, expect, it } from 'vitest';
import {
  canonicalBaseUrl,
  ensureVersionedBase,
  modelsEndpointUrl,
  stripInferenceEndpointSuffix,
} from './base-url';

describe('stripInferenceEndpointSuffix', () => {
  // ── API root cases: leave untouched ──────────────────────────────────────
  it('leaves OpenAI root untouched', () => {
    expect(stripInferenceEndpointSuffix('https://api.openai.com/v1')).toBe(
      'https://api.openai.com/v1',
    );
  });

  it('leaves Anthropic root untouched', () => {
    expect(stripInferenceEndpointSuffix('https://api.anthropic.com')).toBe(
      'https://api.anthropic.com',
    );
  });

  // ── Trailing slashes ─────────────────────────────────────────────────────
  it('strips trailing slash', () => {
    expect(stripInferenceEndpointSuffix('https://api.openai.com/v1/')).toBe(
      'https://api.openai.com/v1',
    );
  });

  it('strips multiple trailing slashes', () => {
    expect(stripInferenceEndpointSuffix('https://api.openai.com/v1///')).toBe(
      'https://api.openai.com/v1',
    );
  });

  // ── OpenAI inference endpoints ───────────────────────────────────────────
  it('strips /v1/chat/completions', () => {
    expect(stripInferenceEndpointSuffix('https://api.openai.com/v1/chat/completions')).toBe(
      'https://api.openai.com/v1',
    );
  });

  it('strips /chat/completions without /v1 prefix', () => {
    expect(stripInferenceEndpointSuffix('https://gateway.example/chat/completions')).toBe(
      'https://gateway.example',
    );
  });

  it('strips /v1/responses', () => {
    expect(stripInferenceEndpointSuffix('https://api.openai.com/v1/responses')).toBe(
      'https://api.openai.com/v1',
    );
  });

  it('strips /v1/completions (legacy)', () => {
    expect(stripInferenceEndpointSuffix('https://api.openai.com/v1/completions')).toBe(
      'https://api.openai.com/v1',
    );
  });

  it('strips /v1/models', () => {
    expect(stripInferenceEndpointSuffix('https://api.openai.com/v1/models')).toBe(
      'https://api.openai.com/v1',
    );
  });

  // ── Anthropic ────────────────────────────────────────────────────────────
  it('strips /v1/messages', () => {
    expect(stripInferenceEndpointSuffix('https://api.anthropic.com/v1/messages')).toBe(
      'https://api.anthropic.com/v1',
    );
  });

  // ── Trailing slash + suffix combined ─────────────────────────────────────
  it('strips trailing slash before suffix match', () => {
    expect(stripInferenceEndpointSuffix('https://x.com/v1/chat/completions/')).toBe(
      'https://x.com/v1',
    );
  });

  // ── Query / hash ─────────────────────────────────────────────────────────
  it('strips ?api-version query string (Azure paste)', () => {
    expect(
      stripInferenceEndpointSuffix(
        'https://x.com/v1/chat/completions?api-version=2024-02-15-preview',
      ),
    ).toBe('https://x.com/v1');
  });

  it('strips ?query with no path suffix', () => {
    expect(stripInferenceEndpointSuffix('https://x.com/v1?foo=bar')).toBe('https://x.com/v1');
  });

  it('strips #hash fragment', () => {
    expect(stripInferenceEndpointSuffix('https://x.com/v1/chat/completions#tip')).toBe(
      'https://x.com/v1',
    );
  });

  // ── Nested / custom base paths ───────────────────────────────────────────
  it('preserves gateway prefix before /v1', () => {
    expect(
      stripInferenceEndpointSuffix('https://gateway.example/my-prefix/v1/chat/completions'),
    ).toBe('https://gateway.example/my-prefix/v1');
  });

  it('preserves one-api style /api prefix', () => {
    expect(stripInferenceEndpointSuffix('http://localhost:3000/v1/chat/completions')).toBe(
      'http://localhost:3000/v1',
    );
  });

  // ── Real-world gateway URLs ──────────────────────────────────────────────
  it('Ollama: full endpoint', () => {
    expect(stripInferenceEndpointSuffix('http://localhost:11434/v1/chat/completions')).toBe(
      'http://localhost:11434/v1',
    );
  });

  it('DeepSeek: full endpoint', () => {
    expect(stripInferenceEndpointSuffix('https://api.deepseek.com/v1/chat/completions')).toBe(
      'https://api.deepseek.com/v1',
    );
  });

  it('SiliconFlow: full endpoint', () => {
    expect(stripInferenceEndpointSuffix('https://api.siliconflow.cn/v1/chat/completions')).toBe(
      'https://api.siliconflow.cn/v1',
    );
  });

  it('OpenRouter: full endpoint', () => {
    expect(stripInferenceEndpointSuffix('https://openrouter.ai/api/v1/chat/completions')).toBe(
      'https://openrouter.ai/api/v1',
    );
  });

  // ── Idempotence ──────────────────────────────────────────────────────────
  it('is idempotent', () => {
    const once = stripInferenceEndpointSuffix('https://x.com/v1/chat/completions/');
    const twice = stripInferenceEndpointSuffix(once);
    expect(twice).toBe(once);
  });

  // ── Safety: do not truncate legit paths that happen to contain a keyword ─
  it('does not strip mid-path occurrences', () => {
    // "completions" sits mid-path, not at end — must not be stripped
    expect(stripInferenceEndpointSuffix('https://x.com/completions/v1')).toBe(
      'https://x.com/completions/v1',
    );
  });

  it('does not strip non-inference paths', () => {
    expect(stripInferenceEndpointSuffix('https://x.com/v1/users')).toBe('https://x.com/v1/users');
  });

  // ── Azure deployment URL: we refuse to get cute ──────────────────────────
  // Azure has its own URL scheme (`/openai/deployments/{name}/chat/completions`
  // with `?api-version`). After stripping query + `/chat/completions` we leave
  // `/openai/deployments/{name}` — which is NOT a valid OpenAI root. But we
  // don't claim to fix Azure here; we just verify we don't corrupt it further.
  it('Azure: query stripped, one suffix removed, deployment path preserved', () => {
    const input =
      'https://rg.openai.azure.com/openai/deployments/gpt4/chat/completions?api-version=2024-02-15-preview';
    expect(stripInferenceEndpointSuffix(input)).toBe(
      'https://rg.openai.azure.com/openai/deployments/gpt4',
    );
  });

  // ── Empty-ish input ──────────────────────────────────────────────────────
  it('handles empty string', () => {
    expect(stripInferenceEndpointSuffix('')).toBe('');
  });

  it('handles root with just slash', () => {
    expect(stripInferenceEndpointSuffix('/')).toBe('');
  });
});

describe('ensureVersionedBase', () => {
  // ── Default: add /v1 when no version present ─────────────────────────────
  it('adds /v1 to bare OpenAI root', () => {
    expect(ensureVersionedBase('https://api.openai.com')).toBe('https://api.openai.com/v1');
  });

  it('adds /v1 when URL has no version segment', () => {
    expect(ensureVersionedBase('https://proxy.example.com')).toBe('https://proxy.example.com/v1');
  });

  // ── Existing /v1: trust it ───────────────────────────────────────────────
  it('keeps /v1', () => {
    expect(ensureVersionedBase('https://api.openai.com/v1')).toBe('https://api.openai.com/v1');
  });

  it('strips /v1/chat/completions → /v1', () => {
    expect(ensureVersionedBase('https://api.openai.com/v1/chat/completions')).toBe(
      'https://api.openai.com/v1',
    );
  });

  // ── Real-world non-/v1 vendors ───────────────────────────────────────────
  it('Zhipu GLM: preserves /api/paas/v4 — does NOT force /v1', () => {
    expect(ensureVersionedBase('https://open.bigmodel.cn/api/paas/v4')).toBe(
      'https://open.bigmodel.cn/api/paas/v4',
    );
  });

  it('Zhipu GLM: /api/paas/v4/chat/completions → /api/paas/v4', () => {
    expect(ensureVersionedBase('https://open.bigmodel.cn/api/paas/v4/chat/completions')).toBe(
      'https://open.bigmodel.cn/api/paas/v4',
    );
  });

  it('Volcengine/豆包: /api/v3 preserved', () => {
    expect(ensureVersionedBase('https://ark.cn-beijing.volces.com/api/v3')).toBe(
      'https://ark.cn-beijing.volces.com/api/v3',
    );
  });

  it('Volcengine/豆包: /api/v3/chat/completions → /api/v3', () => {
    expect(ensureVersionedBase('https://ark.cn-beijing.volces.com/api/v3/chat/completions')).toBe(
      'https://ark.cn-beijing.volces.com/api/v3',
    );
  });

  it('Google AI Studio: /v1beta/openai preserved (no /v1 appended)', () => {
    expect(ensureVersionedBase('https://generativelanguage.googleapis.com/v1beta/openai')).toBe(
      'https://generativelanguage.googleapis.com/v1beta/openai',
    );
  });

  it('Google AI Studio: /v1beta/openai/chat/completions → /v1beta/openai', () => {
    expect(
      ensureVersionedBase(
        'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
      ),
    ).toBe('https://generativelanguage.googleapis.com/v1beta/openai');
  });

  // ── DashScope compatible-mode (already /v1, no surprise) ─────────────────
  it('DashScope: /compatible-mode/v1 preserved', () => {
    expect(ensureVersionedBase('https://dashscope.aliyuncs.com/compatible-mode/v1')).toBe(
      'https://dashscope.aliyuncs.com/compatible-mode/v1',
    );
  });

  it('Moonshot Kimi: /v1 preserved', () => {
    expect(ensureVersionedBase('https://api.moonshot.cn/v1/chat/completions')).toBe(
      'https://api.moonshot.cn/v1',
    );
  });

  it('OpenRouter: /api/v1 preserved', () => {
    expect(ensureVersionedBase('https://openrouter.ai/api/v1/chat/completions')).toBe(
      'https://openrouter.ai/api/v1',
    );
  });

  it('MiniMax: /v1 preserved', () => {
    expect(ensureVersionedBase('https://api.minimax.io/v1/chat/completions')).toBe(
      'https://api.minimax.io/v1',
    );
  });

  // ── Self-hosted & relays ─────────────────────────────────────────────────
  it('Ollama: /v1 preserved', () => {
    expect(ensureVersionedBase('http://localhost:11434/v1/chat/completions')).toBe(
      'http://localhost:11434/v1',
    );
  });

  it('one-api self-hosted: adds /v1 to bare host', () => {
    expect(ensureVersionedBase('http://localhost:3000')).toBe('http://localhost:3000/v1');
  });

  // ── Idempotence ──────────────────────────────────────────────────────────
  it('is idempotent', () => {
    const once = ensureVersionedBase('https://open.bigmodel.cn/api/paas/v4/chat/completions');
    const twice = ensureVersionedBase(once);
    expect(twice).toBe(once);
  });

  // ── Does not match non-version "v" words ─────────────────────────────────
  it('does not treat /verbose or /vanilla as a version', () => {
    expect(ensureVersionedBase('https://x.com/vanilla')).toBe('https://x.com/vanilla/v1');
  });
});

describe('canonicalBaseUrl', () => {
  // ── Anthropic wire: strip /v1, leave root for SDK to append /v1/messages ─
  it('anthropic: strips /v1/messages to root', () => {
    expect(canonicalBaseUrl('https://api.anthropic.com/v1/messages', 'anthropic')).toBe(
      'https://api.anthropic.com',
    );
  });

  it('anthropic: strips trailing /v1', () => {
    expect(canonicalBaseUrl('https://api.anthropic.com/v1', 'anthropic')).toBe(
      'https://api.anthropic.com',
    );
  });

  it('anthropic: leaves root untouched', () => {
    expect(canonicalBaseUrl('https://api.anthropic.com', 'anthropic')).toBe(
      'https://api.anthropic.com',
    );
  });

  it('anthropic: MiniMax Anthropic-compat preserves /anthropic subpath', () => {
    expect(canonicalBaseUrl('https://api.minimax.io/anthropic', 'anthropic')).toBe(
      'https://api.minimax.io/anthropic',
    );
  });

  it('anthropic: GLM Anthropic-compat preserves /api/anthropic', () => {
    expect(canonicalBaseUrl('https://open.bigmodel.cn/api/anthropic', 'anthropic')).toBe(
      'https://open.bigmodel.cn/api/anthropic',
    );
  });

  // ── OpenAI-chat wire: base must carry version ────────────────────────────
  it('openai-chat: bare root gets /v1 appended', () => {
    expect(canonicalBaseUrl('https://api.openai.com', 'openai-chat')).toBe(
      'https://api.openai.com/v1',
    );
  });

  it('openai-chat: /v1/chat/completions → /v1', () => {
    expect(canonicalBaseUrl('https://api.openai.com/v1/chat/completions', 'openai-chat')).toBe(
      'https://api.openai.com/v1',
    );
  });

  it('openai-chat: GLM /api/paas/v4 preserved without adding /v1', () => {
    expect(
      canonicalBaseUrl('https://open.bigmodel.cn/api/paas/v4/chat/completions', 'openai-chat'),
    ).toBe('https://open.bigmodel.cn/api/paas/v4');
  });

  it('openai-chat: Volcengine /api/v3 preserved', () => {
    expect(
      canonicalBaseUrl('https://ark.cn-beijing.volces.com/api/v3/chat/completions', 'openai-chat'),
    ).toBe('https://ark.cn-beijing.volces.com/api/v3');
  });

  it('openai-chat: Google AI Studio /v1beta/openai preserved', () => {
    expect(
      canonicalBaseUrl(
        'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
        'openai-chat',
      ),
    ).toBe('https://generativelanguage.googleapis.com/v1beta/openai');
  });

  // ── openai-responses wire behaves identically to openai-chat ─────────────
  it('openai-responses: /v1/responses → /v1', () => {
    expect(canonicalBaseUrl('https://api.openai.com/v1/responses', 'openai-responses')).toBe(
      'https://api.openai.com/v1',
    );
  });

  // ── openai-codex-responses: pass through untouched ───────────────────────
  // pi-ai's codex wire appends `/codex/responses` from the bare base, so our
  // canonicalization must not strip anything except trailing slashes.
  it('openai-codex-responses: passes bare base through', () => {
    expect(canonicalBaseUrl('https://chatgpt.com/backend-api', 'openai-codex-responses')).toBe(
      'https://chatgpt.com/backend-api',
    );
  });

  it('openai-codex-responses: strips trailing slashes only', () => {
    expect(canonicalBaseUrl('https://chatgpt.com/backend-api///', 'openai-codex-responses')).toBe(
      'https://chatgpt.com/backend-api',
    );
  });

  it('openai-codex-responses: does NOT strip /responses suffix (pi-ai handles that)', () => {
    expect(
      canonicalBaseUrl('https://chatgpt.com/backend-api/codex/responses', 'openai-codex-responses'),
    ).toBe('https://chatgpt.com/backend-api/codex/responses');
  });

  // ── Idempotence across wires ─────────────────────────────────────────────
  it('is idempotent for anthropic', () => {
    const once = canonicalBaseUrl('https://api.anthropic.com/v1/messages', 'anthropic');
    expect(canonicalBaseUrl(once, 'anthropic')).toBe(once);
  });

  it('is idempotent for openai-chat', () => {
    const once = canonicalBaseUrl(
      'https://open.bigmodel.cn/api/paas/v4/chat/completions',
      'openai-chat',
    );
    expect(canonicalBaseUrl(once, 'openai-chat')).toBe(once);
  });
});

describe('modelsEndpointUrl', () => {
  it('anthropic: root + /v1/models', () => {
    expect(modelsEndpointUrl('https://api.anthropic.com/v1/messages', 'anthropic')).toBe(
      'https://api.anthropic.com/v1/models',
    );
  });

  it('anthropic: preserves subpath', () => {
    expect(modelsEndpointUrl('https://api.minimax.io/anthropic', 'anthropic')).toBe(
      'https://api.minimax.io/anthropic/v1/models',
    );
  });

  it('openai-chat: versioned base + /models', () => {
    expect(modelsEndpointUrl('https://api.openai.com', 'openai-chat')).toBe(
      'https://api.openai.com/v1/models',
    );
  });

  it('openai-chat: GLM /api/paas/v4/models', () => {
    expect(
      modelsEndpointUrl('https://open.bigmodel.cn/api/paas/v4/chat/completions', 'openai-chat'),
    ).toBe('https://open.bigmodel.cn/api/paas/v4/models');
  });

  it('openai-chat: Volcengine /api/v3/models', () => {
    expect(
      modelsEndpointUrl('https://ark.cn-beijing.volces.com/api/v3/chat/completions', 'openai-chat'),
    ).toBe('https://ark.cn-beijing.volces.com/api/v3/models');
  });

  it('openai-chat: Google /v1beta/openai/models', () => {
    expect(
      modelsEndpointUrl(
        'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
        'openai-chat',
      ),
    ).toBe('https://generativelanguage.googleapis.com/v1beta/openai/models');
  });

  // ── openai-codex-responses: no discoverable /models endpoint ─────────────
  // ChatGPT subscription's model listing requires OAuth bearer +
  // chatgpt-account-id headers that the keyless discovery path can't supply.
  // Callers short-circuit via ProviderEntry.modelsHint; the throw surfaces
  // the programming error if anyone reaches this function.
  it('openai-codex-responses: throws with an actionable hint', () => {
    expect(() =>
      modelsEndpointUrl('https://chatgpt.com/backend-api', 'openai-codex-responses'),
    ).toThrow(/modelsHint/);
  });
});
