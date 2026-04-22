import type { ReportableError } from '@open-codesign/shared';
import { describe, expect, it } from 'vitest';
import {
  type PreviewLabels,
  buildReportInput,
  formatPreview,
  parseIssueNumber,
  pickRecentReport,
  validateNotes,
} from './ReportEventDialog';

function makeError(overrides: Partial<ReportableError> = {}): ReportableError {
  return {
    localId: 'local-1',
    ts: 1_700_000_000_000,
    code: 'E.TEST',
    scope: 'renderer',
    fingerprint: 'fp-abc',
    message: 'hello world',
    ...overrides,
  };
}

describe('validateNotes', () => {
  it('accepts empty string', () => {
    expect(validateNotes('')).toBe(true);
  });

  it('accepts up to 2000 chars', () => {
    expect(validateNotes('x'.repeat(2000))).toBe(true);
  });

  it('rejects 2001 chars', () => {
    expect(validateNotes('x'.repeat(2001))).toBe(false);
  });
});

describe('buildReportInput', () => {
  it('returns a correctly shaped object with the 4 toggles', () => {
    const error = makeError();
    const result = buildReportInput(error, 'repro steps', {
      prompt: true,
      paths: false,
      urls: true,
      timeline: false,
    });
    expect(result).toEqual({
      error,
      notes: 'repro steps',
      includePromptText: true,
      includePaths: false,
      includeUrls: true,
      includeTimeline: false,
    });
  });

  it('passes all-default flags through', () => {
    const error = makeError({ localId: 'local-2' });
    const result = buildReportInput(error, '', {
      prompt: false,
      paths: false,
      urls: false,
      timeline: true,
    });
    expect(result.includePromptText).toBe(false);
    expect(result.includePaths).toBe(false);
    expect(result.includeUrls).toBe(false);
    expect(result.includeTimeline).toBe(true);
    expect(result.error.localId).toBe('local-2');
    expect(result.notes).toBe('');
  });
});

describe('pickRecentReport', () => {
  it('returns null for unreported fingerprint', () => {
    expect(pickRecentReport({ reported: false })).toBeNull();
  });

  it('returns null when payload is missing ts/issueUrl', () => {
    expect(pickRecentReport({ reported: true })).toBeNull();
  });

  it('returns a warning view model for a fresh report', () => {
    const now = 1_000_000;
    const result = pickRecentReport(
      {
        reported: true,
        ts: now - 5 * 60_000,
        issueUrl: 'https://github.com/owner/repo/issues/42',
      },
      now,
      'en',
    );
    expect(result).toEqual({
      relative: '5 minutes ago',
      issueUrl: 'https://github.com/owner/repo/issues/42',
      issueNumber: '42',
    });
  });

  it('returns null issueNumber when URL has no /issues/ segment', () => {
    const now = 1_000_000;
    const result = pickRecentReport(
      { reported: true, ts: now - 60_000, issueUrl: 'https://x/1' },
      now,
      'en',
    );
    expect(result?.issueNumber).toBeNull();
  });

  it('localizes the relative time into zh-CN', () => {
    const now = 1_000_000;
    const result = pickRecentReport(
      { reported: true, ts: now - 5 * 60_000, issueUrl: 'https://x/1' },
      now,
      'zh-CN',
    );
    expect(result?.relative).toContain('5');
    // zh-CN output is either "5分钟前" or "5 分钟前" depending on ICU — assert
    // it isn't Latin shorthand and isn't English.
    expect(result?.relative).not.toBe('5m');
    expect(result?.relative).not.toBe('5 minutes ago');
  });
});

describe('parseIssueNumber', () => {
  it('extracts the numeric id from a standard GitHub issue URL', () => {
    expect(parseIssueNumber('https://github.com/owner/repo/issues/123')).toBe('123');
  });

  it('extracts the id even when trailing query/hash fragments are present', () => {
    expect(parseIssueNumber('https://github.com/o/r/issues/7#comment-1')).toBe('7');
    expect(parseIssueNumber('https://github.com/o/r/issues/7?foo=bar')).toBe('7');
  });

  it('returns null when the URL has no /issues/ segment', () => {
    expect(parseIssueNumber('https://example.com/bug/1')).toBeNull();
  });
});

describe('confirm-step translation', () => {
  it('interpolates the seconds placeholder in both locales', async () => {
    const en = (await import('@open-codesign/i18n/locales/en')).default as unknown as Record<
      string,
      Record<string, unknown>
    >;
    const zh = (await import('@open-codesign/i18n/locales/zh-CN')).default as unknown as Record<
      string,
      Record<string, unknown>
    >;
    const enValue = (en['diagnostics'] as Record<string, Record<string, unknown>>)['report']?.[
      'confirmOpenAnyway'
    ];
    const zhValue = (zh['diagnostics'] as Record<string, Record<string, unknown>>)['report']?.[
      'confirmOpenAnyway'
    ];
    expect(typeof enValue).toBe('string');
    expect(typeof zhValue).toBe('string');
    expect(String(enValue)).toContain('{{seconds}}');
    expect(String(zhValue)).toContain('{{seconds}}');
  });
});

const LABELS: PreviewLabels = {
  code: 'Code',
  scope: 'Scope',
  runId: 'Run id',
  fingerprint: 'Fingerprint',
  message: 'Message',
  upstream: 'Upstream context',
  upstreamProvider: 'Provider',
  upstreamStatus: 'Status',
  upstreamRequestId: 'Request id',
  upstreamRetry: 'Retry',
  upstreamBodyHead: 'Body head',
};

const LABELS_ZH: PreviewLabels = {
  code: '错误码',
  scope: '范围',
  runId: '运行 id',
  fingerprint: '指纹',
  message: '消息',
  upstream: '上游上下文',
  upstreamProvider: '服务商',
  upstreamStatus: '状态码',
  upstreamRequestId: '请求 id',
  upstreamRetry: '重试次数',
  upstreamBodyHead: '响应体开头',
};

function makeEvent(overrides: Partial<ReportableError> = {}): ReportableError {
  return makeError(overrides);
}

describe('formatPreview', () => {
  it('redacts paths in message when includePaths=false', () => {
    const event = makeEvent({ message: 'failed at /Users/alice/foo.ts' });
    const out = formatPreview(
      event,
      { includePromptText: false, includePaths: false, includeUrls: false },
      LABELS,
    );
    expect(out).toContain('Message: failed at [path omitted]');
    expect(out).not.toContain('/Users/alice');
  });

  it('renders upstream block for provider scope with context', () => {
    const event = makeEvent({
      scope: 'provider',
      context: {
        upstream_provider: 'anthropic',
        upstream_status: 504,
        upstream_request_id: 'req_123',
        retry_count: 2,
        redacted_body_head: '{"type":"error","message":"timeout"}',
      },
    });
    const out = formatPreview(
      event,
      { includePromptText: true, includePaths: true, includeUrls: true },
      LABELS,
    );
    expect(out).toContain('--- Upstream context ---');
    expect(out).toContain('Provider: anthropic');
    expect(out).toContain('Status: 504');
    expect(out).toContain('Request id: req_123');
    expect(out).toContain('Retry: 2');
    expect(out).toContain('Body head: {"type":"error","message":"timeout"}');
  });

  it('omits upstream block for non-provider scope even with context', () => {
    const event = makeEvent({
      scope: 'renderer',
      context: { upstream_provider: 'anthropic' },
    });
    const out = formatPreview(
      event,
      { includePromptText: false, includePaths: false, includeUrls: false },
      LABELS,
    );
    expect(out).not.toContain('Upstream context');
    expect(out).not.toContain('Provider:');
  });

  it('redacts the upstream redacted_body_head too', () => {
    const event = makeEvent({
      scope: 'provider',
      context: {
        redacted_body_head: 'see https://example.com/bug at /Users/alice/x',
      },
    });
    const out = formatPreview(
      event,
      { includePromptText: false, includePaths: false, includeUrls: false },
      LABELS,
    );
    expect(out).toContain('Body head: see [url omitted] at [path omitted]');
  });

  it('omits status row when upstream_status is null', () => {
    const event = makeEvent({
      scope: 'provider',
      context: {
        upstream_provider: 'anthropic',
        upstream_status: null,
        upstream_request_id: 'req_abc',
      },
    });
    const out = formatPreview(
      event,
      { includePromptText: false, includePaths: false, includeUrls: false },
      LABELS,
    );
    expect(out).not.toContain('Status:');
    expect(out).not.toContain('null');
    expect(out).toContain('Request id: req_abc');
  });

  it('omits request_id row when upstream_request_id is null', () => {
    const event = makeEvent({
      scope: 'provider',
      context: {
        upstream_provider: 'anthropic',
        upstream_status: 500,
        upstream_request_id: null,
      },
    });
    const out = formatPreview(
      event,
      { includePromptText: false, includePaths: false, includeUrls: false },
      LABELS,
    );
    expect(out).not.toContain('Request id:');
    expect(out).not.toContain('null');
    expect(out).toContain('Status: 500');
  });

  it('appends ellipsis to body head when it exceeds 400 chars', () => {
    const longBody = 'a'.repeat(450);
    const event = makeEvent({
      scope: 'provider',
      context: { redacted_body_head: longBody },
    });
    const out = formatPreview(
      event,
      { includePromptText: false, includePaths: false, includeUrls: true },
      LABELS,
    );
    expect(out).toContain(`Body head: ${'a'.repeat(400)}…`);
    expect(out).not.toContain('a'.repeat(401));
  });

  it('uses localized upstream labels (zh-CN)', () => {
    const event = makeEvent({
      scope: 'provider',
      context: {
        upstream_provider: 'anthropic',
        upstream_status: 504,
        upstream_request_id: 'req_123',
        retry_count: 2,
        redacted_body_head: 'payload',
      },
    });
    const out = formatPreview(
      event,
      { includePromptText: true, includePaths: true, includeUrls: true },
      LABELS_ZH,
    );
    expect(out).toContain('--- 上游上下文 ---');
    expect(out).toContain('服务商: anthropic');
    expect(out).toContain('状态码: 504');
    expect(out).toContain('请求 id: req_123');
    expect(out).toContain('重试次数: 2');
    expect(out).toContain('响应体开头: payload');
  });
});
