import { describe, expect, it, vi } from 'vitest';

vi.mock('@open-codesign/i18n', () => ({
  useT: () => (key: string) => key,
}));

vi.mock('../store', () => ({
  useCodesignStore: () => vi.fn(),
}));

import { isAbsoluteHttpUrl } from './ConnectionDiagnosticPanel';

describe('isAbsoluteHttpUrl', () => {
  it('rejects an empty string so /v1 quick-fix cannot produce a bare "/v1"', () => {
    expect(isAbsoluteHttpUrl('')).toBe(false);
    expect(isAbsoluteHttpUrl('   ')).toBe(false);
  });

  it('rejects relative or scheme-less values', () => {
    expect(isAbsoluteHttpUrl('api.example.com')).toBe(false);
    expect(isAbsoluteHttpUrl('/v1')).toBe(false);
    expect(isAbsoluteHttpUrl('ftp://api.example.com')).toBe(false);
  });

  it('accepts http and https absolute URLs', () => {
    expect(isAbsoluteHttpUrl('https://api.example.com')).toBe(true);
    expect(isAbsoluteHttpUrl('http://localhost:8080')).toBe(true);
    expect(isAbsoluteHttpUrl('  https://api.example.com  ')).toBe(true);
  });
});
