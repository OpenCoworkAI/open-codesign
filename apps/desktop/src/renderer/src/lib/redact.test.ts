import { describe, expect, it } from 'vitest';
import {
  PATH_OMITTED,
  PROMPT_OMITTED,
  URL_OMITTED,
  applyRedaction,
  redactPaths,
  redactUrls,
  scrubPromptInLine,
} from './redact';

describe('scrubPromptInLine', () => {
  it('replaces prompt values with a redaction placeholder', () => {
    const input = 'prompt: "design a meditation app"';
    expect(scrubPromptInLine(input)).toBe('prompt: "[prompt omitted]"');
  });

  it('scrubs JSON-quoted "prompt" key as emitted by structured loggers', () => {
    const input = 'generate.request {"prompt":"build a dashboard","model":"sonnet"}';
    expect(scrubPromptInLine(input)).toBe(
      'generate.request {"prompt":"[prompt omitted]","model":"sonnet"}',
    );
  });

  it('scrubs template-literal prompt form', () => {
    const input = 'prompt = `multi\nline\npayload`';
    expect(scrubPromptInLine(input)).toBe('prompt = `[prompt omitted]`');
  });
});

describe('redactPaths', () => {
  it('redacts absolute macOS user paths', () => {
    const input = 'Failed at /Users/alice/Documents/secret.md';
    expect(redactPaths(input)).toBe('Failed at [path omitted]');
  });

  it('redacts Windows backslash drive-letter paths', () => {
    const input = 'Failed at C:\\Users\\alice\\project\\foo.ts';
    expect(redactPaths(input)).toBe('Failed at [path omitted]');
  });

  it('redacts Windows forward-slash drive-letter paths (Electron/Node style)', () => {
    const input = 'Failed at C:/Users/alice/project/foo.ts';
    expect(redactPaths(input)).toBe('Failed at [path omitted]');
  });
});

describe('redactUrls', () => {
  it('redacts https URLs', () => {
    const input = 'see https://example.com/foo/bar?x=1';
    expect(redactUrls(input)).toBe('see [url omitted]');
  });
});

describe('applyRedaction', () => {
  it('applies all three redactions when all flags are off', () => {
    const input = 'error: prompt: "hi" at /Users/alice/foo.ts — see https://example.com/bug';
    const result = applyRedaction(input, {
      includePromptText: false,
      includePaths: false,
      includeUrls: false,
    });
    expect(result).toBe('error: prompt: "[prompt omitted]" at [path omitted] — see [url omitted]');
  });

  it('honors include flags — passes input through untouched when all are on', () => {
    const input = 'prompt: "x" at /Users/a/b https://e.com';
    const result = applyRedaction(input, {
      includePromptText: true,
      includePaths: true,
      includeUrls: true,
    });
    expect(result).toBe(input);
  });

  it('handles empty string', () => {
    expect(
      applyRedaction('', {
        includePromptText: false,
        includePaths: false,
        includeUrls: false,
      }),
    ).toBe('');
  });
});

describe('renderer placeholder strings match main-process', () => {
  // These must stay byte-equal to diagnostic-summary.ts constants. If main
  // changes its wording, update these AND the copy in redact.ts at the same
  // time or the preview in the Report dialog will drift from the bundle.
  it('prompt / path / url placeholders are byte-equal', () => {
    expect(PROMPT_OMITTED).toBe('[prompt omitted]');
    expect(PATH_OMITTED).toBe('[path omitted]');
    expect(URL_OMITTED).toBe('[url omitted]');
  });
});
