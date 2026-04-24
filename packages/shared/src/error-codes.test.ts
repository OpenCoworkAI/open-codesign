import { describe, expect, it } from 'vitest';
import type { CodesignErrorCode } from './error-codes';
import { ERROR_CODE_DESCRIPTIONS, ERROR_CODES } from './error-codes';

describe('ERROR_CODES', () => {
  it('every value equals its key (identity constant)', () => {
    for (const [key, value] of Object.entries(ERROR_CODES)) {
      expect(value).toBe(key);
    }
  });

  it('has no duplicate values', () => {
    const values = Object.values(ERROR_CODES);
    const unique = new Set(values);
    expect(unique.size).toBe(values.length);
  });
});

describe('ERROR_CODE_DESCRIPTIONS', () => {
  it('has an entry for every ERROR_CODES key', () => {
    const codes = Object.values(ERROR_CODES) as CodesignErrorCode[];
    for (const code of codes) {
      expect(
        ERROR_CODE_DESCRIPTIONS[code],
        `Missing description for ERROR_CODES.${code}`,
      ).toBeDefined();
    }
  });

  it('every description has a non-empty userFacing string', () => {
    for (const [code, desc] of Object.entries(ERROR_CODE_DESCRIPTIONS)) {
      expect(
        desc.userFacing.length,
        `ERROR_CODE_DESCRIPTIONS.${code}.userFacing is empty`,
      ).toBeGreaterThan(0);
    }
  });

  it('every description has a valid category', () => {
    const validCategories = new Set([
      'ipc',
      'provider',
      'generation',
      'snapshot',
      'preferences',
      'connection',
      'other',
    ]);
    for (const [code, desc] of Object.entries(ERROR_CODE_DESCRIPTIONS)) {
      expect(
        validCategories.has(desc.category),
        `ERROR_CODE_DESCRIPTIONS.${code}.category "${desc.category}" is not a valid category`,
      ).toBe(true);
    }
  });

  it('has no extra keys beyond the registered codes', () => {
    const registeredCodes = new Set(Object.values(ERROR_CODES));
    for (const key of Object.keys(ERROR_CODE_DESCRIPTIONS)) {
      expect(
        registeredCodes.has(key as CodesignErrorCode),
        `ERROR_CODE_DESCRIPTIONS has unexpected key "${key}"`,
      ).toBe(true);
    }
  });
});

describe('ERROR_CODE_DESCRIPTIONS i18n keys', () => {
  it('every code has a userFacingKey matching err.<CODE>', () => {
    for (const code of Object.values(ERROR_CODES)) {
      const desc = ERROR_CODE_DESCRIPTIONS[code];
      expect(desc.userFacingKey, `missing userFacingKey for ${code}`).toBe(`err.${code}`);
    }
  });
});
