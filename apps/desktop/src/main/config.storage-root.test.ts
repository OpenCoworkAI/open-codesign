import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { defaultConfigDir } from './config';

afterEach(() => vi.unstubAllEnvs());

describe('XDG config directory', () => {
  it.runIf(process.platform === 'win32')(
    'uses an absolute child directory for a bare drive',
    () => {
      vi.stubEnv('XDG_CONFIG_HOME', 'D:');
      expect(defaultConfigDir()).toBe('D:\\open-codesign');
    },
  );

  it.runIf(process.platform === 'win32')(
    'allows a drive root as the base, not the final config folder',
    () => {
      vi.stubEnv('XDG_CONFIG_HOME', 'D:\\');
      expect(defaultConfigDir()).toBe('D:\\open-codesign');
    },
  );

  it('retains the application subdirectory for a custom base', () => {
    vi.stubEnv('XDG_CONFIG_HOME', process.cwd());
    expect(defaultConfigDir()).toBe(join(process.cwd(), 'open-codesign'));
  });
});
