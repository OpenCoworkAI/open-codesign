import { describe, expect, it } from 'vitest';
import { initializeBackgroundDebug, isBackgroundChannelAllowed } from './background-debug';

describe('background development host policy', () => {
  it('does not touch Electron in a normal launch', () => {
    expect(process.env['CODESIGN_BACKGROUND_DEBUG_ROOT']).toBeUndefined();
    const untouched = new Proxy({} as typeof import('electron'), {
      get() {
        throw new Error('Normal application should be untouched');
      },
    });
    expect(initializeBackgroundDebug(untouched)).toBe(false);
  });

  it('allows real design creation only in the automatically allocated workspace', () => {
    expect(isBackgroundChannelAllowed('snapshots:v1:create-design', { name: 'Test' })).toBe(true);
    expect(
      isBackgroundChannelAllowed('snapshots:v1:create-design', {
        workspacePath: 'C:/Users/example',
      }),
    ).toBe(false);
    expect(
      isBackgroundChannelAllowed('snapshots:v1:create-design', { demoInputId: 'example' }),
    ).toBe(false);
    expect(isBackgroundChannelAllowed('snapshots:v1:rename-design', { name: 'Renamed' })).toBe(
      true,
    );
  });

  it.each([
    'codesign:v1:generate',
    'codesign:v1:focus-window',
    'codesign:v1:open-external',
    'snapshots:v1:workspace:pick',
    'snapshots:v1:workspace:update',
    'config:v1:detect-external-configs',
    'config:v1:set-provider-and-models',
    'preferences:v1:update',
    'unknown:future-channel',
  ])('rejects unsupported operation %s', (channel) => {
    expect(isBackgroundChannelAllowed(channel, {})).toBe(false);
  });

  it('allows only local generation and question resolution in explicit model mode', () => {
    expect(isBackgroundChannelAllowed('codesign:v1:generate', {}, true)).toBe(true);
    expect(isBackgroundChannelAllowed('ask:resolve', {}, true)).toBe(true);
    expect(isBackgroundChannelAllowed('codesign:v1:cancel-generation', {}, true)).toBe(true);
    for (const channel of [
      'permission:resolve',
      'codex-oauth:v1:login',
      'config:v1:set-provider-and-models',
      'codesign:v1:focus-window',
      'unknown',
    ])
      expect(isBackgroundChannelAllowed(channel, {}, true)).toBe(false);
    expect(
      isBackgroundChannelAllowed(
        'codesign:v1:generate',
        { referenceUrl: 'https://example.com' },
        true,
      ),
    ).toBe(false);
    expect(isBackgroundChannelAllowed('codesign:v1:generate', { attachments: [{}] }, true)).toBe(
      false,
    );
  });
});
