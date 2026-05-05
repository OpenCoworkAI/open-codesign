import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const fakeState = {
  setView: vi.fn(),
  view: 'hub',
  previousView: 'workspace',
  currentDesignId: null,
  designs: [],
  hubTab: 'recent',
  setHubTab: vi.fn(),
  unreadErrorCount: 1,
  refreshDiagnosticEvents: vi.fn(),
  openSettingsTab: vi.fn(),
};

vi.mock('@open-codesign/i18n', () => ({
  useT: () => (key: string, _opts?: Record<string, unknown>) => key,
}));

vi.mock('@open-codesign/ui', () => ({
  IconButton: (props: { label: string; children: ReactNode; onClick?: () => void }) => (
    <button type="button" aria-label={props.label} onClick={props.onClick}>
      {props.children}
    </button>
  ),
  Wordmark: () => <div>Open CoDesign</div>,
}));

vi.mock('./LanguageToggle', () => ({
  LanguageToggle: () => <button type="button">Language</button>,
}));

vi.mock('./ModelSwitcher', () => ({
  ModelSwitcher: () => <button type="button">Model</button>,
}));

vi.mock('./ThemeToggle', () => ({
  ThemeToggle: () => <button type="button">Theme</button>,
}));

vi.mock('../store', () => ({
  useCodesignStore: (selector: (state: typeof fakeState) => unknown) => selector(fakeState),
}));

import { dragStyle, noDragStyle, TOPBAR_DRAG_SPACER_TEST_ID, TopBar } from './TopBar';

describe('TopBar window drag regions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('__APP_VERSION__', 'test');
  });

  it('keeps a dedicated titlebar drag spacer while controls remain no-drag', () => {
    const html = renderToStaticMarkup(<TopBar />);

    expect((dragStyle as { WebkitAppRegion?: string }).WebkitAppRegion).toBe('drag');
    expect((noDragStyle as { WebkitAppRegion?: string }).WebkitAppRegion).toBe('no-drag');
    expect(html).toContain(`data-testid="${TOPBAR_DRAG_SPACER_TEST_ID}"`);
    expect(html).toContain('-webkit-app-region:drag');
    expect(html).toContain('-webkit-app-region:no-drag');
  });

  it('keeps the hub chrome clear of macOS controls and prevents tab labels from wrapping', () => {
    const html = renderToStaticMarkup(<TopBar />);

    expect(html).toContain('padding-left:var(--size-titlebar-pad-left)');
    expect(html).toContain('min-w-max');
    expect(html).toContain('whitespace-nowrap');
  });
});
