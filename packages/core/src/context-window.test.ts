import { describe, expect, it, vi } from 'vitest';

const catalog: Record<string, Array<{ id: string; contextWindow: number }>> = {
  openai: [{ id: 'gpt-4.1', contextWindow: 1_047_576 }],
  'github-copilot': [{ id: 'gpt-4.1', contextWindow: 128_000 }],
};

vi.mock('@mariozechner/pi-ai', () => ({
  getProviders: () => Object.keys(catalog),
  getModels: (provider: string) => catalog[provider] ?? [],
  getModel: (provider: string, modelId: string) =>
    catalog[provider]?.find((entry) => entry.id === modelId),
}));

const { DEFAULT_CONTEXT_WINDOW, resolveContextWindow } = await import('./context-window.js');

describe('resolveContextWindow', () => {
  it('uses the configured window first', () => {
    expect(resolveContextWindow({ provider: 'openai', modelId: 'gpt-4.1' }, 32_768)).toBe(32_768);
  });

  it("uses the catalog entry for the model's own provider", () => {
    expect(resolveContextWindow({ provider: 'openai', modelId: 'gpt-4.1' }, undefined)).toBe(
      1_047_576,
    );
  });

  it('uses the smallest catalog window for the same model id on other providers', () => {
    expect(resolveContextWindow({ provider: 'my-relay', modelId: 'gpt-4.1' }, undefined)).toBe(
      128_000,
    );
  });

  it('falls back to the default for models the catalog does not know', () => {
    expect(resolveContextWindow({ provider: 'ollama', modelId: 'qwen3:32b' }, undefined)).toBe(
      DEFAULT_CONTEXT_WINDOW,
    );
  });
});
