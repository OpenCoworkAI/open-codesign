import { describe, expect, it } from 'vitest';
import { filterModels } from './ModelSwitcher';

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
