import { describe, expect, it } from 'vitest';
import { canSaveProvider } from './Settings';

describe('canSaveProvider', () => {
  it('requires a validated API key before enabling save', () => {
    expect(
      canSaveProvider({
        apiKey: 'sk-test',
        validated: false,
        validating: false,
      }),
    ).toBe(false);
  });

  it('stays disabled while validation is still in progress', () => {
    expect(
      canSaveProvider({
        apiKey: 'sk-test',
        validated: true,
        validating: true,
      }),
    ).toBe(false);
  });

  it('allows saving only after validation succeeds', () => {
    expect(
      canSaveProvider({
        apiKey: 'sk-test',
        validated: true,
        validating: false,
      }),
    ).toBe(true);
  });
});
