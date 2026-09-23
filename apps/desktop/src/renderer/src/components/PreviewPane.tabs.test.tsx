import { initI18n } from '@open-codesign/i18n';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { type CodesignState, useCodesignStore } from '../store';
import { PreviewPane } from './PreviewPane';

vi.mock('../store', async () => {
  const actual = await vi.importActual<typeof import('../store')>('../store');
  return {
    ...actual,
    useCodesignStore: Object.assign(
      (selector: (state: CodesignState) => unknown) => selector(actual.useCodesignStore.getState()),
      actual.useCodesignStore,
    ),
  };
});

vi.mock('./FilesTabView', () => ({
  FilesTabView: () => <aside data-testid="workspace-file-browser" />,
  WorkspaceFilePreview: ({ path }: { path: string }) => (
    <main data-testid="dedicated-file-preview">{path}</main>
  ),
}));
vi.mock('./PreviewToolbar', () => ({ PreviewToolbar: () => null }));
vi.mock('./CanvasErrorBar', () => ({ CanvasErrorBar: () => null }));

const initialState = useCodesignStore.getState();

beforeAll(async () => {
  await initI18n('en');
});

beforeEach(() => {
  useCodesignStore.setState({
    ...initialState,
    currentDesignId: 'design',
    previewSource: '<main>Existing design</main>',
    canvasTabs: [{ kind: 'files' }, { kind: 'file', path: 'App.jsx' }],
  });
});

describe('canvas file tab content', () => {
  it('keeps the workspace browser in the Files tab', () => {
    useCodesignStore.setState({ activeCanvasTab: 0 });
    const html = renderToStaticMarkup(<PreviewPane onPickStarter={vi.fn()} />);
    expect(html).toContain('data-testid="workspace-file-browser"');
    expect(html).not.toContain('data-testid="dedicated-file-preview"');
  });

  it.each([
    'App.jsx',
    'DESIGN.md',
    'assets/logo.svg',
  ])('shows only the requested file when switching to the %s tab', (path) => {
    useCodesignStore.setState({
      canvasTabs: [{ kind: 'files' }, { kind: 'file', path }],
      activeCanvasTab: 1,
    });
    const html = renderToStaticMarkup(<PreviewPane onPickStarter={vi.fn()} />);
    expect(html).toContain(`data-testid="dedicated-file-preview">${path}</main>`);
    expect(html).not.toContain('data-testid="workspace-file-browser"');
  });
});
