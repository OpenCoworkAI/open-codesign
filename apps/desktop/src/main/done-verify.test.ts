import { describe, expect, it } from 'vitest';
import { formatRuntimeLoadError } from './done-verify';

describe('done runtime verifier error formatting', () => {
  it('redacts self-contained data URLs from load failures', () => {
    const longDataUrl = `data:text/html;base64,${'a'.repeat(4096)}`;

    const message = formatRuntimeLoadError('did-fail-load', 'ERR_INVALID_URL', longDataUrl);

    expect(message).toBe('did-fail-load: ERR_INVALID_URL [data:text/html;base64,...truncated]');
    expect(message).not.toContain('aaaa');
    expect(message.length).toBeLessThan(100);
  });
});
