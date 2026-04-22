/**
 * Unit tests for renderer-logger.ts
 *
 * The bridge is stateful (singleton `bridgeInstalled` flag) so each test
 * runs against a fresh module import via `vi.resetModules()`.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// We need to mock window.codesign BEFORE importing the module under test.
// Each test re-imports the module so the singleton guard resets.

describe('installRendererLogBridge', () => {
  let logSpy: ReturnType<typeof vi.fn>;
  let origWarn: typeof console.warn;
  let origError: typeof console.error;

  beforeEach(() => {
    origWarn = console.warn;
    origError = console.error;
    logSpy = vi.fn().mockResolvedValue(undefined);

    // Provide a minimal window.codesign stub.
    Object.defineProperty(globalThis, 'window', {
      value: {
        ...((globalThis as typeof globalThis & { window?: unknown }).window ?? {}),
        codesign: {
          diagnostics: {
            log: logSpy,
          },
        },
        addEventListener: vi.fn(),
      },
      writable: true,
    });
  });

  afterEach(() => {
    // Restore console before resetModules so the next test starts with a clean
    // prototype — otherwise patches stack across re-imports and one console call
    // triggers every previously installed forwarder (all of which now point at
    // the fresh logSpy because they read window.codesign at call time).
    console.warn = origWarn;
    console.error = origError;
    vi.resetModules();
  });

  it('forwards console.error to window.codesign.diagnostics.log', async () => {
    const { installRendererLogBridge } = await import('./renderer-logger');
    installRendererLogBridge();

    console.error('something went wrong');

    expect(logSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        schemaVersion: 1,
        level: 'error',
        scope: 'console',
        message: expect.stringContaining('something went wrong'),
      }),
    );
  });

  it('forwards console.warn to window.codesign.diagnostics.log', async () => {
    const { installRendererLogBridge } = await import('./renderer-logger');
    installRendererLogBridge();

    console.warn('a warning occurred');

    expect(logSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        schemaVersion: 1,
        level: 'warn',
        scope: 'console',
        message: expect.stringContaining('a warning occurred'),
      }),
    );
  });

  it('is idempotent — calling twice does not double-patch', async () => {
    const { installRendererLogBridge } = await import('./renderer-logger');
    installRendererLogBridge();
    installRendererLogBridge();

    console.error('once');

    // Should be called exactly once, not twice.
    expect(logSpy).toHaveBeenCalledTimes(1);
  });

  it('rendererLogger.error forwards to window.codesign.diagnostics.log', async () => {
    const { installRendererLogBridge, rendererLogger } = await import('./renderer-logger');
    installRendererLogBridge();

    rendererLogger.error('my-scope', 'explicit error', { key: 'value' });

    expect(logSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        schemaVersion: 1,
        level: 'error',
        scope: 'my-scope',
        message: 'explicit error',
        data: { key: 'value' },
      }),
    );
  });

  it('does not throw when window.codesign is unavailable', async () => {
    Object.defineProperty(globalThis, 'window', {
      value: { codesign: undefined, addEventListener: vi.fn() },
      writable: true,
    });

    const { installRendererLogBridge } = await import('./renderer-logger');
    // Should not throw even without bridge available.
    expect(() => installRendererLogBridge()).not.toThrow();
    expect(() => console.error('no bridge')).not.toThrow();
  });

  it('preserves object structure in console.error args', async () => {
    const { installRendererLogBridge } = await import('./renderer-logger');
    installRendererLogBridge();

    console.error('[store]', { detail: { id: 42 }, op: 'update' });

    expect(logSpy).toHaveBeenCalledTimes(1);
    const entry = logSpy.mock.calls[0]?.[0] as { message: string } | undefined;
    expect(entry?.message).not.toContain('[object Object]');
    expect(entry?.message).toContain('"id":42');
    expect(entry?.message).toContain('"op":"update"');
  });

  it('handles Error instances without throwing', async () => {
    const { installRendererLogBridge } = await import('./renderer-logger');
    installRendererLogBridge();

    console.error('failed:', new Error('boom'));

    const entry = logSpy.mock.calls[0]?.[0] as { message: string } | undefined;
    expect(entry?.message).toContain('boom');
  });

  it('handles circular objects without throwing', async () => {
    const { installRendererLogBridge } = await import('./renderer-logger');
    installRendererLogBridge();

    const a: Record<string, unknown> = { name: 'a' };
    a['self'] = a;

    expect(() => {
      console.error('circ', a);
    }).not.toThrow();
    expect(logSpy).toHaveBeenCalledTimes(1);
  });

  it('truncates oversized payloads with a length marker', async () => {
    const { installRendererLogBridge } = await import('./renderer-logger');
    installRendererLogBridge();

    const huge = { blob: 'x'.repeat(50_000) };
    console.error('[store]', huge);

    const entry = logSpy.mock.calls[0]?.[0] as { message: string } | undefined;
    expect(entry?.message).toContain('…[truncated');
    expect(entry?.message.length).toBeLessThan(10_000);
  });

  it('forwards %s format placeholder with substitution', async () => {
    const { installRendererLogBridge } = await import('./renderer-logger');
    installRendererLogBridge();

    // React DevTools shape: console.warn('%s\n\nAn error occurred in the <%s> ...', 'Error text', 'ProviderCard')
    console.warn('%s\nAn error occurred in the <%s> component', 'Error text', 'ProviderCard');

    const entry = logSpy.mock.calls[0]?.[0] as { message: string } | undefined;
    expect(entry?.message).toContain('Error text');
    expect(entry?.message).toContain('<ProviderCard>');
    expect(entry?.message).not.toContain('%s');
  });

  it('forwards %o with JSON serialization', async () => {
    const { installRendererLogBridge } = await import('./renderer-logger');
    installRendererLogBridge();

    console.error('state = %o', { id: 42, name: 'alice' });

    const entry = logSpy.mock.calls[0]?.[0] as { message: string } | undefined;
    expect(entry?.message).toContain('"id":42');
    expect(entry?.message).toContain('"name":"alice"');
    expect(entry?.message).not.toContain('%o');
  });

  it('falls back to concatenation when first arg is not a string', async () => {
    const { installRendererLogBridge } = await import('./renderer-logger');
    installRendererLogBridge();

    console.error({ code: 'X' }, 'ohno');

    const entry = logSpy.mock.calls[0]?.[0] as { message: string } | undefined;
    expect(entry?.message).toContain('"code":"X"');
    expect(entry?.message).toContain('ohno');
  });
});
