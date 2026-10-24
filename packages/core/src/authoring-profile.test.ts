import type { SourceIdentityV1 } from '@open-codesign/shared';
import { describe, expect, it } from 'vitest';
import {
  authoringProfileFor,
  isAuthoringResourceEligible,
  nativeSkillPath,
} from './authoring-profile.js';

const native = (path: string): SourceIdentityV1 => ({
  schemaVersion: 1,
  path,
  format: 'html',
  runtimeMode: 'native-html',
});

describe('host-derived authoring profile', () => {
  it.each([
    'index.html',
    'pages/main.htm',
    'pages/source.jsx',
  ])('uses runtime mode, not suffix: %s', (path) => {
    expect(authoringProfileFor(native(path))).toBe('native-html');
  });
  it('preserves legacy and omitted identities', () => {
    expect(authoringProfileFor()).toBe('legacy');
    expect(
      authoringProfileFor({
        schemaVersion: 1,
        path: 'index.html',
        format: 'html',
        runtimeMode: 'legacy-auto',
      }),
    ).toBe('legacy');
  });
  it('limits native resources without changing subsequent legacy eligibility', () => {
    for (const name of ['data-viz-recharts', 'custom-method']) {
      expect(isAuthoringResourceEligible('skill', name, native('page.htm'))).toBe(false);
      expect(isAuthoringResourceEligible('skill', name)).toBe(true);
    }
    expect(isAuthoringResourceEligible('scaffold', 'terminal', native('page.htm'))).toBe(true);
    expect(isAuthoringResourceEligible('scaffold', 'iphone-16-pro-frame', native('page.htm'))).toBe(
      false,
    );
    expect(isAuthoringResourceEligible('brand-ref', 'brand:custom', native('page.htm'))).toBe(true);
    expect(nativeSkillPath('craft-polish', native('page.htm'))).toBe('native-html/craft-polish.md');
    expect(nativeSkillPath('craft-polish')).toBe('craft-polish.md');
  });
});
