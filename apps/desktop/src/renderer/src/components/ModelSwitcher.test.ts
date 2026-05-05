import { describe, expect, it } from 'vitest';
import {
  filterModels,
  formatCompactModelLabel,
  formatCompactProviderLabel,
  formatModelLabel,
  formatProviderLabel,
} from './ModelSwitcher';

describe('formatProviderLabel', () => {
  it('turns raw provider ids into readable labels', () => {
    expect(formatProviderLabel('codex-coproxy')).toBe('Codex Coproxy');
    expect(formatProviderLabel('openai_compatible')).toBe('Openai Compatible');
  });

  it('preserves already-human provider labels', () => {
    expect(formatProviderLabel('Claude Code (imported)')).toBe('Claude Code (imported)');
  });
});

describe('formatCompactProviderLabel', () => {
  it('removes import metadata from titlebar summaries', () => {
    expect(formatCompactProviderLabel('Claude Code (imported)')).toBe('Claude Code');
    expect(formatCompactProviderLabel('Gemini (imported)')).toBe('Gemini');
    expect(formatCompactProviderLabel('claude-code-imported')).toBe('Claude Code');
  });

  it('preserves meaningful provider qualifiers', () => {
    expect(formatCompactProviderLabel('Ollama (local)')).toBe('Ollama (local)');
  });
});

describe('formatModelLabel', () => {
  it('keeps GPT family names instead of reducing them to version numbers', () => {
    expect(formatModelLabel('gpt-5.5')).toBe('GPT-5.5');
    expect(formatModelLabel('openai/gpt-4o')).toBe('GPT-4o');
  });

  it('formats common Claude and Gemini ids without raw hyphen noise', () => {
    expect(formatModelLabel('claude-opus-4-7')).toBe('Claude Opus 4.7');
    expect(formatModelLabel('gemini-2.5-pro')).toBe('Gemini 2.5 pro');
  });
});

describe('formatCompactModelLabel', () => {
  it('removes duplicated Claude family names for Anthropic-style providers', () => {
    expect(formatCompactModelLabel('Claude Code', 'Claude Opus 4.7')).toBe('Opus 4.7');
    expect(formatCompactModelLabel('Anthropic Claude', 'Claude Sonnet 4.6')).toBe('Sonnet 4.6');
  });

  it('keeps model family names when the provider is a router', () => {
    expect(formatCompactModelLabel('OpenRouter', 'Claude Opus 4.7')).toBe('Claude Opus 4.7');
  });
});

describe('filterModels', () => {
  const models = [
    'claude-sonnet-4-6',
    'claude-opus-4-1',
    'gpt-4o',
    'gpt-4.1',
    'deepseek-ai/DeepSeek-R1-Distill-Qwen-7B',
    'llama3.2:latest',
  ];

  it('returns the full list for an empty query', () => {
    expect(filterModels(models, '')).toEqual(models);
  });

  it('treats a whitespace-only query as empty', () => {
    expect(filterModels(models, '   ')).toEqual(models);
  });

  it('matches substrings case-insensitively', () => {
    expect(filterModels(models, 'sonnet')).toEqual(['claude-sonnet-4-6']);
    expect(filterModels(models, 'CLAUDE')).toEqual(['claude-sonnet-4-6', 'claude-opus-4-1']);
  });

  it('matches path-like model IDs (OpenRouter / HuggingFace style)', () => {
    expect(filterModels(models, 'deepseek')).toEqual(['deepseek-ai/DeepSeek-R1-Distill-Qwen-7B']);
  });

  it('matches tag-style model IDs (Ollama style with colon)', () => {
    expect(filterModels(models, ':latest')).toEqual(['llama3.2:latest']);
  });

  it('returns an empty array when nothing matches', () => {
    expect(filterModels(models, 'xyz-nonexistent')).toEqual([]);
  });
});
