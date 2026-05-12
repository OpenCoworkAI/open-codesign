import { fileURLToPath } from 'node:url';

function parseUrl(raw: string): URL | null {
  try {
    return new URL(raw);
  } catch {
    return null;
  }
}

function sameHttpOrigin(a: URL, b: URL): boolean {
  return a.protocol === b.protocol && a.hostname === b.hostname && a.port === b.port;
}

function sameFilePath(a: URL, b: URL): boolean {
  try {
    return fileURLToPath(a) === fileURLToPath(b);
  } catch {
    return false;
  }
}

export function isTrustedMainWindowNavigationUrl(rawUrl: string, trustedAppUrl: string): boolean {
  const target = parseUrl(rawUrl);
  const trusted = parseUrl(trustedAppUrl);
  if (target === null || trusted === null) return false;

  if (trusted.protocol === 'http:' || trusted.protocol === 'https:') {
    return sameHttpOrigin(target, trusted);
  }

  if (trusted.protocol === 'file:') {
    return target.protocol === 'file:' && sameFilePath(target, trusted);
  }

  return false;
}
