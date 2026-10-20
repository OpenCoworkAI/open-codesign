import { initI18n } from '@open-codesign/i18n';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { useLazyDesignFileTree } from '../hooks/useDesignFiles';
import { useCodesignStore } from '../store';
import { FilesTabView } from './FilesTabView';

vi.mock('../store', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../store')>();
  return {
    ...actual,
    useCodesignStore: Object.assign(
      (selector: (state: ReturnType<typeof actual.useCodesignStore.getState>) => unknown) =>
        selector(actual.useCodesignStore.getState()),
      actual.useCodesignStore,
    ),
  };
});

vi.mock('../hooks/useDesignFiles', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../hooks/useDesignFiles')>()),
  useLazyDesignFileTree: vi.fn(),
}));

beforeAll(async () => {
  await initI18n('en');
});

beforeEach(() => {
  vi.stubGlobal('window', { innerWidth: 1280, localStorage: { getItem: () => null } });
  useCodesignStore.setState({ currentDesignId: null, designs: [], previewSource: null });
  vi.mocked(useLazyDesignFileTree).mockReturnValue({
    files: [],
    tree: [],
    loading: false,
    backend: 'workspace',
    loadDirectory: vi.fn(),
  });
});

afterEach(() => vi.unstubAllGlobals());

describe('empty workspace layout', () => {
  it('keeps workspace controls and one guided preview without reserving a blank file tree', () => {
    const html = renderToStaticMarkup(<FilesTabView />);
    expect(html).toContain('codesign-empty-workspace');
    expect(html.match(/No files yet/g)).toHaveLength(1);
    expect(html).toContain('Describe your design in the chat');
    expect(html).toContain('Choose');
    expect(html).not.toContain('role="separator"');
    expect(html).not.toContain('<aside');
  });

  it('shows loading rather than a resolved empty instruction during initial discovery', () => {
    vi.mocked(useLazyDesignFileTree).mockReturnValue({
      files: [],
      tree: [],
      loading: true,
      backend: 'workspace',
      loadDirectory: vi.fn(),
    });
    const html = renderToStaticMarkup(<FilesTabView />);
    expect(html).toContain('Loading');
    expect(html).not.toContain('No files yet');
  });

  it('puts preview disclosure beside workspace actions without an expanded configuration card', () => {
    const html = renderToStaticMarkup(<FilesTabView />);
    expect(html).toContain('codesign-workspace-summary flex min-w-0 flex-wrap');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('aria-controls=');
    expect(html).toContain('Show preview options');
    expect(html).toContain('Detect');
    expect(html).toContain('var(--size-control-sm)');
    expect(html).not.toContain('<select');
  });

  it.each([
    ['managed-file', 'Integrated'],
    ['connected-url', 'Connected'],
    ['external-app', 'External'],
    ['none', 'Off'],
  ] as const)('keeps the saved %s authority visible even when its options are closed', (mode, label) => {
    useCodesignStore.setState({
      currentDesignId: 'preview-fixture',
      designs: [
        {
          schemaVersion: 1,
          id: 'preview-fixture',
          name: 'Preview fixture',
          createdAt: '2026-09-17',
          updatedAt: '2026-09-17',
          thumbnailText: null,
          deletedAt: null,
          workspacePath: 'C:\\fixture',
          previewMode: mode,
          previewUrl: mode === 'connected-url' ? 'http://localhost:4317' : null,
        },
      ],
    });
    const html = renderToStaticMarkup(<FilesTabView />);
    expect(html).toContain(label);
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('aria-label="Open folder"');
    expect(html).not.toContain('<select');
  });

  it('retains a real file tree during background refreshes', () => {
    vi.mocked(useLazyDesignFileTree).mockReturnValue({
      files: [{ path: 'brief.md', kind: 'text', updatedAt: '2026-09-17' }],
      tree: [
        {
          name: 'brief.md',
          path: 'brief.md',
          type: 'file',
          file: { path: 'brief.md', kind: 'text', updatedAt: '2026-09-17' },
        },
      ],
      loading: true,
      backend: 'workspace',
      loadDirectory: vi.fn(),
    });
    const html = renderToStaticMarkup(<FilesTabView />);
    expect(html).toContain('title="brief.md"');
    expect(html).toContain('role="separator"');
    expect(html).not.toContain('codesign-empty-workspace');
  });
});
