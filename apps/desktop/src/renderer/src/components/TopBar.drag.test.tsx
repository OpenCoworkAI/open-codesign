import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const fakeState = {
  setView: vi.fn(),
  view: 'hub',
  previousView: 'workspace',
  currentDesignId: null as string | null,
  designs: [] as Design[],
  hubTab: 'recent',
  setHubTab: vi.fn(),
  unreadErrorCount: 1,
  refreshDiagnosticEvents: vi.fn(),
  openSettingsTab: vi.fn(),
  config: {
    provider: 'a-very-long-provider-name',
    modelPrimary: 'gpt-6-astra-with-a-very-long-model-name',
  },
  completeOnboarding: vi.fn(),
  reportableErrorToast: vi.fn(),
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
    fakeState.view = 'hub';
    fakeState.currentDesignId = null;
    fakeState.designs = [];
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
    expect(html).not.toContain('min-w-max');
    expect(html).toContain('flex-wrap');
    expect(html).toContain('relative shrink-0 font-medium');
    expect(html).toContain('whitespace-nowrap');
  });

  it('assigns independent grid areas to navigation, model selection and window controls', () => {
    const html = renderToStaticMarkup(<TopBar />);
    const css = readFileSync(new URL('./TopBar.css', import.meta.url), 'utf8');

    for (const area of ['brand', 'navigation', 'drag', 'model', 'controls']) {
      expect(html).toContain(`codesign-topbar-${area}`);
      expect(css).toContain(`grid-area: ${area}`);
    }
    expect(css).toContain('"brand drag controls"');
    expect(css).toContain('"navigation navigation model"');
    expect(css).toContain('@media (min-width: 62.5rem)');
    expect(css).toContain('.codesign-topbar:not([data-view="hub"])');
    expect(css).toContain('@media (min-width: 75rem)');
    expect(css).toContain('"brand navigation drag model controls"');
    expect(css).toContain('minmax(var(--space-6), 1fr)');
  });

  it('keeps a compact home target with version identification and a token-sized single row', () => {
    fakeState.view = 'workspace';
    const html = renderToStaticMarkup(<TopBar />);
    const css = readFileSync(new URL('./TopBar.css', import.meta.url), 'utf8');

    expect(html).toContain('data-view="workspace"');
    expect(html).toContain('codesign-topbar-brand inline-flex h-10');
    expect(html).toContain('title="Open CoDesign vtest"');
    expect(html).toContain('aria-label="topbar.openMyDesigns"');
    expect(css).toContain('grid-template-rows: var(--size-titlebar-height)');
    expect(css).toContain('minmax(0, 1fr) var(--space-6)');
  });

  it('retains every hub navigation label and active-page semantics', () => {
    const html = renderToStaticMarkup(<TopBar />);

    for (const tab of ['recent', 'all', 'examples', 'resources']) {
      expect(html).toContain(`hub.tabs.${tab}`);
    }
    expect(html.match(/aria-current="page"/g)).toHaveLength(1);
    expect(html).toContain('aria-label="hub.tabs.all"');
    expect(html).toContain('aria-haspopup="listbox"');
    expect(html).toContain('aria-label="settings.title"');
  });

  it('bounds the model popup by the active header rows and leaves its options scrollable', () => {
    const css = readFileSync(new URL('./TopBar.css', import.meta.url), 'utf8');
    expect(css).toContain(
      'max-height: calc(100dvh - var(--codesign-topbar-content-height) - var(--space-2))',
    );
    expect(css).toContain('[role="listbox"] > .codesign-scroll-area');
    expect(css).toContain('min-height: 0');
    expect(css).toContain('[role="listbox"] > :not(.codesign-scroll-area)');
    expect(css).toContain('--codesign-topbar-content-height: var(--size-titlebar-height)');
  });

  it('lets long design names shrink while preserving the full tooltip and navigation label', () => {
    const name = 'A long design title '.repeat(30);
    fakeState.view = 'workspace';
    fakeState.currentDesignId = 'long-design';
    fakeState.designs = [
      {
        schemaVersion: 1,
        id: 'long-design',
        name,
        createdAt: '2026-01-01',
        updatedAt: '2026-01-01',
        thumbnailText: null,
        deletedAt: null,
        workspacePath: null,
      },
    ];
    const html = renderToStaticMarkup(<TopBar />);

    expect(html).toContain('min-w-0 max-w-[520px]');
    expect(html).toContain(`class="truncate" title="${name}"`);
    expect(html).toContain('aria-label="topbar.openMyDesigns"');
  });

  it('keeps model text shrinkable without losing the full model title', () => {
    const html = renderToStaticMarkup(<TopBar />);

    expect(html).toContain('relative w-full min-w-0');
    expect(html).toContain('h-10 w-full min-w-0');
    expect(html).toContain('min-w-0 basis-[45%] truncate');
    expect(html).toContain('min-w-0 basis-[55%] truncate');
    expect(html).toContain(` · ${fakeState.config.modelPrimary}"`);
    expect(html).not.toContain('min-w-[220px]');
  });

  it('preserves accessible back navigation from settings', () => {
    fakeState.view = 'settings';
    const html = renderToStaticMarkup(<TopBar />);

    expect(html).toContain('aria-label="topbar.closeSettings"');
    expect(html).toContain('topbar.settingsLabel');
    expect(html).not.toContain('<nav');
    expect(html).toContain('-webkit-app-region:no-drag');
  });
});

import { readFileSync } from 'node:fs';
import type { Design } from '@open-codesign/shared';
