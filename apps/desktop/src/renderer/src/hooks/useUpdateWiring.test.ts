import { describe, expect, it } from 'vitest';
import { isValidVersion } from './useUpdateWiring';

describe('isValidVersion', () => {
  it.each([
    ['0.1.0', true],
    ['1.2.3', true],
    ['10.20.30', true],
    ['1.0.0-beta.1', true],
    ['1.0.0-rc.0', true],
    ['1.0.0+build.123', true],
    ['1.0.0-beta+build.sha', true],
    ['v1.0.0', false],
    ['1.0', false],
    ['1', false],
    ['', false],
    ['../../evil', false],
    ['1.0.0; rm -rf', false],
    ['1.0.0%20x', false],
  ])('isValidVersion(%j) === %s', (input, expected) => {
    expect(isValidVersion(input)).toBe(expected);
  });
});
