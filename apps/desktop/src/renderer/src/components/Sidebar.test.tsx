import type { LocalInputFile, OnboardingState } from '@open-codesign/shared';
import { describe, expect, it } from 'vitest';
import { buildComposerContextItems } from './Sidebar';

function file(path: string, name: string): LocalInputFile {
  return { path, name, size: 128 };
}

describe('buildComposerContextItems', () => {
  it('includes attached files, reference URL, and design system when present', () => {
    const config = {
      designSystem: {
        rootPath: 'D:/repo/design-system',
        summary: 'Tokens + components',
        colors: [],
        fonts: [],
        spacing: [],
        radius: [],
        shadows: [],
        sourceFiles: [],
      },
    } as OnboardingState;

    const items = buildComposerContextItems({
      inputFiles: [
        file('D:/repo/brief.md', 'brief.md'),
        file('D:/repo/tokens.json', 'tokens.json'),
      ],
      referenceUrl: 'https://example.com/spec',
      config,
    });

    expect(items.map((item) => item.icon)).toEqual(['file', 'file', 'url', 'designSystem']);
    expect(items.map((item) => item.label)).toEqual([
      'brief.md',
      'tokens.json',
      'https://example.com/spec',
      'Tokens + components',
    ]);
  });

  it('omits empty URL and missing design system', () => {
    const items = buildComposerContextItems({
      inputFiles: [file('D:/repo/brief.md', 'brief.md')],
      referenceUrl: '   ',
      config: null,
    });

    expect(items).toHaveLength(1);
    expect(items[0]?.icon).toBe('file');
    expect(items[0]?.label).toBe('brief.md');
  });
});
