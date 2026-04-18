import type { ChatMessage, ModelRef, StoredDesignSystem } from '@open-codesign/shared';
import { CodesignError, STORED_DESIGN_SYSTEM_SCHEMA_VERSION } from '@open-codesign/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';

const completeMock = vi.fn();

vi.mock('@open-codesign/providers', () => ({
  complete: (...args: unknown[]) => completeMock(...args),
  completeWithRetry: (
    _model: unknown,
    _messages: unknown,
    _opts: unknown,
    _retryOpts: unknown,
    impl: (...args: unknown[]) => unknown,
  ) => impl(_model, _messages, _opts),
}));

import { applyComment, generate } from './index';

const MODEL: ModelRef = { provider: 'anthropic', modelId: 'claude-sonnet-4-6' };

const SAMPLE_HTML = `<!doctype html><html lang="en"><body><h1>Hi</h1></body></html>`;

const RESPONSE = `Here is your design.

<artifact identifier="design-1" type="html" title="Hello world">
${SAMPLE_HTML}
</artifact>`;

const FENCED_RESPONSE = `Here is the revised HTML artifact.

\`\`\`html
${SAMPLE_HTML}
\`\`\``;

const DESIGN_SYSTEM: StoredDesignSystem = {
  schemaVersion: STORED_DESIGN_SYSTEM_SCHEMA_VERSION,
  rootPath: '/repo',
  summary: 'Muted neutrals with warm copper accents.',
  extractedAt: '2026-04-18T00:00:00.000Z',
  sourceFiles: ['tailwind.config.ts'],
  colors: ['#f4efe8', '#b45f3d'],
  fonts: ['IBM Plex Sans'],
  spacing: ['0.75rem', '1rem'],
  radius: ['18px'],
  shadows: ['0 12px 40px rgba(0,0,0,0.12)'],
};

afterEach(() => {
  completeMock.mockReset();
});

describe('generate()', () => {
  it('throws CodesignError on empty prompt', async () => {
    await expect(
      generate({ prompt: '   ', history: [], model: MODEL, apiKey: 'sk-test' }),
    ).rejects.toBeInstanceOf(CodesignError);
    expect(completeMock).not.toHaveBeenCalled();
  });

  it('extracts the artifact body and the surrounding text', async () => {
    completeMock.mockResolvedValueOnce({
      content: RESPONSE,
      inputTokens: 12,
      outputTokens: 34,
      costUsd: 0.0001,
    });

    const result = await generate({
      prompt: 'design a meditation app',
      history: [],
      model: MODEL,
      apiKey: 'sk-test',
    });

    expect(result.artifacts).toHaveLength(1);
    const first = result.artifacts[0];
    if (!first) throw new Error('expected one artifact');
    expect(first.id).toBe('design-1');
    expect(first.type).toBe('html');
    expect(first.content.trim()).toBe(SAMPLE_HTML);
    expect(result.message).toContain('Here is your design.');
    expect(result.inputTokens).toBe(12);
    expect(result.outputTokens).toBe(34);
    expect(result.costUsd).toBeCloseTo(0.0001);
  });

  it('passes the design-generator system prompt by default', async () => {
    completeMock.mockResolvedValueOnce({
      content: RESPONSE,
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
    });

    await generate({
      prompt: 'design a meditation app',
      history: [],
      model: MODEL,
      apiKey: 'sk-test',
    });

    const messages = completeMock.mock.calls[0]?.[1] as ChatMessage[];
    const system = messages[0];
    if (!system) throw new Error('expected system message');
    expect(system.role).toBe('system');
    expect(system.content).toContain('open-codesign');
    expect(system.content).toContain('artifact');
  });

  it('injects design system, file context, and reference URL into the user prompt', async () => {
    completeMock.mockResolvedValueOnce({
      content: RESPONSE,
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
    });

    await generate({
      prompt: 'design a warm landing page',
      history: [],
      model: MODEL,
      apiKey: 'sk-test',
      designSystem: DESIGN_SYSTEM,
      attachments: [
        {
          name: 'brief.md',
          path: '/tmp/brief.md',
          excerpt: 'Audience: climate founders. Tone: premium and calm.',
        },
      ],
      referenceUrl: {
        url: 'https://example.com',
        title: 'Example',
        description: 'A warm editorial layout',
      },
    });

    const messages = completeMock.mock.calls[0]?.[1] as ChatMessage[];
    const user = messages[messages.length - 1];
    if (!user) throw new Error('expected user message');
    expect(user.content).toContain('design a warm landing page');
    expect(user.content).toContain('Design system to follow');
    expect(user.content).toContain('Muted neutrals with warm copper accents.');
    expect(user.content).toContain('brief.md');
    expect(user.content).toContain('https://example.com');
  });

  it('falls back to fenced HTML when the model skips artifact tags', async () => {
    completeMock.mockResolvedValueOnce({
      content: FENCED_RESPONSE,
      inputTokens: 3,
      outputTokens: 4,
      costUsd: 0,
    });

    const result = await generate({
      prompt: 'design a dashboard',
      history: [],
      model: MODEL,
      apiKey: 'sk-test',
    });

    expect(result.artifacts).toHaveLength(1);
    expect(result.artifacts[0]?.content).toBe(SAMPLE_HTML);
    expect(result.message).toContain('Here is the revised HTML artifact.');
    expect(result.message).not.toContain('```html');
  });
});

describe('applyComment()', () => {
  it('throws on empty comment', async () => {
    await expect(
      applyComment({
        html: SAMPLE_HTML,
        comment: '   ',
        selection: {
          selector: '#hero',
          tag: 'section',
          outerHTML: '<section id="hero">Hi</section>',
          rect: { top: 0, left: 0, width: 100, height: 100 },
        },
        model: MODEL,
        apiKey: 'sk-test',
      }),
    ).rejects.toBeInstanceOf(CodesignError);
  });

  it('builds a revision prompt around the selected element', async () => {
    completeMock.mockResolvedValueOnce({
      content: RESPONSE,
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
    });

    await applyComment({
      html: SAMPLE_HTML,
      comment: 'Make this hero tighter and more premium.',
      selection: {
        selector: '#hero',
        tag: 'section',
        outerHTML: '<section id="hero">Hi</section>',
        rect: { top: 0, left: 0, width: 100, height: 100 },
      },
      model: MODEL,
      apiKey: 'sk-test',
      designSystem: DESIGN_SYSTEM,
    });

    const messages = completeMock.mock.calls[0]?.[1] as ChatMessage[];
    const system = messages[0];
    const user = messages[1];
    if (!system || !user) throw new Error('expected revision messages');
    expect(system.content).toContain('revise an existing artifact');
    expect(user.content).toContain('Make this hero tighter and more premium.');
    expect(user.content).toContain('#hero');
    expect(user.content).toContain(SAMPLE_HTML);
    expect(user.content).toContain('Muted neutrals with warm copper accents.');
    expect(user.content).toContain('Prioritize the selected element first');
    expect(user.content).toContain('Do not use Markdown code fences');
  });

  it('returns a parsed artifact for fenced revision responses', async () => {
    completeMock.mockResolvedValueOnce({
      content: FENCED_RESPONSE,
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
    });

    const result = await applyComment({
      html: SAMPLE_HTML,
      comment: 'Make the title more playful.',
      selection: {
        selector: 'h1',
        tag: 'h1',
        outerHTML: '<h1>Hi</h1>',
        rect: { top: 0, left: 0, width: 80, height: 24 },
      },
      model: MODEL,
      apiKey: 'sk-test',
    });

    expect(result.artifacts).toHaveLength(1);
    expect(result.artifacts[0]?.content).toBe(SAMPLE_HTML);
    expect(result.message).toContain('Here is the revised HTML artifact.');
  });
});
