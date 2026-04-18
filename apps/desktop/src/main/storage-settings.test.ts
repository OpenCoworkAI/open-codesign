import { describe, expect, it } from 'vitest';
import { buildAppPaths } from './storage-settings';

describe('buildAppPaths', () => {
  it('returns file paths and their containing folders for config and logs', () => {
    const paths = buildAppPaths(
      '/tmp/open-codesign/config.toml',
      '/tmp/open-codesign/logs/main.log',
      '/tmp/open-codesign',
    );

    expect(paths).toEqual({
      config: '/tmp/open-codesign/config.toml',
      configFolder: '/tmp/open-codesign',
      logs: '/tmp/open-codesign/logs/main.log',
      logsFolder: '/tmp/open-codesign/logs',
      data: '/tmp/open-codesign',
    });
  });
});
