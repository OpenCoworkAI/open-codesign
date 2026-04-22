import type { DiagnosticEventRow } from '@open-codesign/shared';
import { describe, expect, it } from 'vitest';
import {
  type PreviewLabels,
  buildReportInput,
  formatPreview,
  pickRecentReport,
  validateNotes,
} from './ReportEventDialog';

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
    const result = buildReportInput(42, 'repro steps', {
      prompt: true,
      paths: false,
      urls: true,
      timeline: false,
    });
    expect(result).toEqual({
      eventId: 42,
      notes: 'repro steps',
      includePromptText: true,
      includePaths: false,
      includeUrls: true,
      includeTimeline: false,
    });
  });

  it('passes all-default flags through', () => {
    const result = buildReportInput(1, '', {
      prompt: false,
      paths: false,
      urls: false,
      timeline: true,
    });
    expect(result.includePromptText).toBe(false);
    expect(result.includePaths).toBe(false);
    expect(result.includeUrls).toBe(false);
    expect(result.includeTimeline).toBe(true);
    expect(result.eventId).toBe(1);
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
      { reported: true, ts: now - 5 * 60_000, issueUrl: 'https://x/1' },
      now,
    );
    expect(result).toEqual({ relative: '5m', issueUrl: 'https://x/1' });
  });
});

const LABELS: PreviewLabels = {
  code: 'Code',
  scope: 'Scope',
  runId: 'Run id',
  fingerprint: 'Fingerprint',
  message: 'Message',
  upstream: 'Upstream context',
};

function makeEvent(overrides: Partial<DiagnosticEventRow> = {}): DiagnosticEventRow {
  return {
    id: 1,
    schemaVersion: 1,
    ts: 1_700_000_000_000,
    level: 'error',
    code: 'E.TEST',
    scope: 'renderer',
    runId: undefined,
    fingerprint: 'fp-abc',
    message: 'hello world',
    stack: undefined,
    transient: false,
    count: 1,
    context: undefined,
    ...overrides,
  };
}

describe('formatPreview', () => {
  it('redacts paths in message when includePaths=false', () => {
    const event = makeEvent({ message: 'failed at /Users/alice/foo.ts' });
    const out = formatPreview(
      event,
      { includePromptText: false, includePaths: false, includeUrls: false },
      LABELS,
    );
    expect(out).toContain('Message: failed at <redacted path>');
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
    expect(out).toContain('Request-Id: req_123');
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
    expect(out).toContain('Body head: see <redacted url> at <redacted path>');
  });
});
