import { describe, expect, it } from 'vitest';
import { isGeminiOpenAICompat, normalizeGeminiModelId } from './gemini-compat';

describe('isGeminiOpenAICompat', () => {
  it('detects the official Gemini OpenAI-compat endpoint', () => {
    expect(isGeminiOpenAICompat('https://generativelanguage.googleapis.com/v1beta/openai/')).toBe(
      true,
    );
  });

  it('returns false for non-Gemini bases', () => {
    expect(isGeminiOpenAICompat('https://api.openai.com/v1')).toBe(false);
  });

  it('returns false when baseUrl is undefined', () => {
    expect(isGeminiOpenAICompat(undefined)).toBe(false);
  });
});

describe('normalizeGeminiModelId', () => {
  it('strips the models/ prefix for Gemini hosts', () => {
    expect(
      normalizeGeminiModelId(
        'models/gemini-3.1-pro-preview',
        'https://generativelanguage.googleapis.com/v1beta/openai/',
      ),
    ).toBe('gemini-3.1-pro-preview');
  });

  it('leaves non-Gemini model ids untouched', () => {
    expect(normalizeGeminiModelId('gpt-4', 'https://api.openai.com/v1')).toBe('gpt-4');
  });

  it('does not strip models/ prefix when baseUrl is not a Gemini host', () => {
    expect(normalizeGeminiModelId('models/foo', 'https://api.openai.com/v1')).toBe('models/foo');
  });

  it('is a no-op when baseUrl is undefined', () => {
    expect(normalizeGeminiModelId('models/gemini-2-pro', undefined)).toBe('models/gemini-2-pro');
  });
});
