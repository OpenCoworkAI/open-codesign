import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  formatRuntimeLoadError,
  isDoneVerifierRequestAllowed,
  isRuntimeVerifierConsoleNoise,
} from './done-verify';

describe('done runtime verifier error formatting', () => {
  it('redacts self-contained data URLs from load failures', () => {
    const longDataUrl = `data:text/html;base64,${'a'.repeat(4096)}`;

    const message = formatRuntimeLoadError('did-fail-load', 'ERR_INVALID_URL', longDataUrl);

    expect(message).toBe('did-fail-load: ERR_INVALID_URL [data:text/html;base64,...truncated]');
    expect(message).not.toContain('aaaa');
    expect(message.length).toBeLessThan(100);
  });

  it('filters Electron CSP warnings from artifact verification', () => {
    expect(
      isRuntimeVerifierConsoleNoise(
        '%cElectron Security Warning (Insecure Content-Security-Policy) font-weight: bold',
      ),
    ).toBe(true);
    expect(isRuntimeVerifierConsoleNoise('ReferenceError: missingValue is not defined')).toBe(
      false,
    );
  });

  it('filters Babel transformer warnings from artifact verification', () => {
    expect(isRuntimeVerifierConsoleNoise('You are using the in-browser Babel transformer.')).toBe(
      true,
    );
  });

  it('allows only the verifier file for file:// requests', () => {
    const verifyFilePath = join(tmpdir(), 'codesign-done', 'verify.html');
    expect(isDoneVerifierRequestAllowed(pathToFileURL(verifyFilePath).href, verifyFilePath)).toBe(
      true,
    );
    expect(
      isDoneVerifierRequestAllowed(
        pathToFileURL(join(tmpdir(), 'private.txt')).href,
        verifyFilePath,
      ),
    ).toBe(false);
    expect(isDoneVerifierRequestAllowed('https://fonts.googleapis.com/css2', verifyFilePath)).toBe(
      true,
    );
  });
});
