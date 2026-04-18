import { describe, expect, it } from 'vitest';
import { formatIframeError } from './components/PreviewPane';

describe('formatIframeError', () => {
  it('omits location when source or lineno is missing', () => {
    expect(formatIframeError('error', 'something broke')).toBe('error: something broke');
    expect(formatIframeError('error', 'something broke', 'app.js')).toBe('error: something broke');
    expect(formatIframeError('error', 'something broke', undefined, 10)).toBe(
      'error: something broke',
    );
  });

  it('appends source and lineno when both are present', () => {
    expect(formatIframeError('unhandledrejection', 'promise failed', 'app.js', 42)).toBe(
      'unhandledrejection: promise failed (app.js:42)',
    );
  });
});
