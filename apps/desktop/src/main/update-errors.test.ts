import { describe, expect, it } from 'vitest';
import { isMissingUpdateMetadataError } from './update-errors';

describe('isMissingUpdateMetadataError', () => {
  it('detects missing electron-updater channel metadata', () => {
    expect(
      isMissingUpdateMetadataError(
        new Error('Cannot find latest-linux.yml in the latest release artifacts (HttpError: 404)'),
      ),
    ).toBe(true);
    expect(isMissingUpdateMetadataError(new Error('Cannot find latest.yml: 404'))).toBe(true);
  });

  it('does not classify other update failures as missing metadata', () => {
    expect(isMissingUpdateMetadataError(new Error('HttpError: 500'))).toBe(false);
    expect(isMissingUpdateMetadataError(new Error('latest.yml signature check failed'))).toBe(
      false,
    );
  });
});
