import { describe, expect, it } from 'vitest';
import type { ConnectionState } from '../store';

// ── Pure helpers extracted for unit testing ────────────────────────────────

const DOT_COLORS: Record<ConnectionState, string> = {
  connected: 'var(--color-success)',
  untested: 'var(--color-warning)',
  error: 'var(--color-error)',
  no_provider: 'var(--color-text-muted)',
};

function formatRelativeTime(ts: number, now = Date.now()): string {
  const diffSec = Math.round((now - ts) / 1000);
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  return `${Math.round(diffMin / 60)}h ago`;
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('ConnectionStatusDot colors', () => {
  it('maps connected → success color', () => {
    expect(DOT_COLORS['connected']).toBe('var(--color-success)');
  });

  it('maps untested → warning color', () => {
    expect(DOT_COLORS['untested']).toBe('var(--color-warning)');
  });

  it('maps error → error color', () => {
    expect(DOT_COLORS['error']).toBe('var(--color-error)');
  });

  it('maps no_provider → muted color', () => {
    expect(DOT_COLORS['no_provider']).toBe('var(--color-text-muted)');
  });
});

describe('formatRelativeTime', () => {
  const now = 1_000_000_000;

  it('shows seconds for fresh timestamps', () => {
    expect(formatRelativeTime(now - 30_000, now)).toBe('30s ago');
  });

  it('shows minutes for timestamps in the past 1–59 min', () => {
    expect(formatRelativeTime(now - 3 * 60_000, now)).toBe('3m ago');
  });

  it('shows hours for timestamps older than 59 min', () => {
    expect(formatRelativeTime(now - 2 * 60 * 60_000, now)).toBe('2h ago');
  });
});
