import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  initializeBackgroundDebug,
  isBackgroundChannelAllowed,
  isBackgroundPayloadPathsAllowed,
} from './background-debug';

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
    ).toBe(true);
    expect(isBackgroundChannelAllowed('snapshots:v1:rename-design', { name: 'Renamed' })).toBe(
      true,
    );
  });

  it.each([
    'codesign:v1:generate',
    'codesign:v1:focus-window',
    'codesign:check-for-updates',
    'codex-oauth:v1:login',
    'unknown:future-channel',
  ])('rejects unsupported operation %s', (channel) => {
    expect(isBackgroundChannelAllowed(channel, {})).toBe(false);
  });

  it('keeps peripheral mutations unavailable even in live mode', () => {
    for (const channel of [
      'comments:v1:add',
      'config:v1:set-provider-and-models',
      'codesign:v1:open-external',
      'connection:v1:test',
      'preferences:v1:update',
    ])
      expect(isBackgroundChannelAllowed(channel, {}, true, true)).toBe(false);
    expect(isBackgroundChannelAllowed('codesign:files:v1:write', {})).toBe(true);
    expect(isBackgroundChannelAllowed('done:verify:v1', {}, false, false)).toBe(false);
    expect(isBackgroundChannelAllowed('done:verify:v1', {}, true, true)).toBe(false);
    // Preview and read IPC still serve the original renderer during model sessions.
    expect(isBackgroundChannelAllowed('codesign:files:v1:preview', {}, true)).toBe(true);
    expect(isBackgroundChannelAllowed('codesign:files:v1:preview', {})).toBe(false);
    // The original renderer bootstrap endpoints remain available.
    expect(isBackgroundChannelAllowed('preferences:v1:get', {})).toBe(true);
    expect(isBackgroundChannelAllowed('locale:get-current', {})).toBe(true);
  });

  it('allows only local generation and question resolution in explicit model mode', () => {
    expect(isBackgroundChannelAllowed('codesign:v1:generate', {}, true)).toBe(true);
    expect(isBackgroundChannelAllowed('ask:resolve', {}, true)).toBe(true);
    expect(isBackgroundChannelAllowed('codesign:v1:cancel-generation', {}, true)).toBe(true);
    for (const channel of [
      'permission:resolve',
      'codex-oauth:v1:login',
      'codesign:v1:focus-window',
      'unknown',
    ])
      expect(isBackgroundChannelAllowed(channel, {}, true)).toBe(false);
    expect(isBackgroundChannelAllowed('config:v1:set-provider-and-models', {}, true)).toBe(false);
    expect(
      isBackgroundChannelAllowed(
        'codesign:v1:generate',
        { referenceUrl: 'https://example.com' },
        true,
      ),
    ).toBe(false);
    expect(
      isBackgroundChannelAllowed(
        'codesign:v1:generate',
        { referenceUrl: 'https://example.com' },
        true,
        true,
      ),
    ).toBe(true);
    expect(isBackgroundChannelAllowed('codesign:v1:generate', { attachments: [{}] }, true)).toBe(
      true,
    );
  });

  it('requires root-contained absolute workspace and attachment paths', () => {
    const root = mkdtempSync(join(tmpdir(), 'codesign-background-policy-'));
    mkdirSync(join(root, 'documents'));
    mkdirSync(join(root, 'fixtures'));
    writeFileSync(join(root, 'fixtures', 'image.png'), Buffer.from([1, 2, 3]));
    try {
      expect(
        isBackgroundChannelAllowed(
          'snapshots:v1:create-design',
          { workspacePath: join(root, 'documents') },
          false,
          false,
          root,
        ),
      ).toBe(true);
      expect(
        isBackgroundChannelAllowed(
          'snapshots:v1:create-design',
          { workspacePath: 'workspace' },
          false,
          false,
          root,
        ),
      ).toBe(false);
      expect(isBackgroundPayloadPathsAllowed(root, { artifactSource: 'export const x = 1;' })).toBe(
        true,
      );
      expect(
        isBackgroundPayloadPathsAllowed(root, {
          attachments: [{ path: join(root, 'fixtures', 'image.png'), name: 'image.png', size: 0 }],
        }),
      ).toBe(true);
      expect(
        isBackgroundPayloadPathsAllowed(root, {
          attachments: [{ path: 'fixtures/image.png', name: 'image.png', size: 0 }],
        }),
      ).toBe(false);
      expect(isBackgroundPayloadPathsAllowed(root, { path: 'fixtures/../outside' })).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
