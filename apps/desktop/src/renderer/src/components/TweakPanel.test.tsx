import { createRef } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { shouldSyncPreviewSourceAfterTweakPersist, TweakPanel } from './TweakPanel';

const previewSource =
  'const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{"accentColor":"#f97316"}/*EDITMODE-END*/;';

const fakeState = {
  currentDesignId: 'design-1',
  previewSource,
  setPreviewSource: vi.fn(),
};

vi.mock('@open-codesign/i18n', () => ({
  useT: () => (key: string) =>
    ({
      'tweaks.close': 'Close tweaks',
      'tweaks.emptyHint': 'No controls yet',
      'tweaks.emptyTitle': 'No controls',
      'tweaks.openLabel': 'Open tweaks',
      'tweaks.pickColor': 'Pick color',
      'tweaks.reset': 'Reset tweaks',
      'tweaks.title': 'Tweaks',
    })[key] ?? key,
}));

vi.mock('../store', () => ({
  useCodesignStore: Object.assign(
    (selector: (state: typeof fakeState) => unknown) => selector(fakeState),
    { getState: () => fakeState },
  ),
}));

describe('TweakPanel', () => {
  it('renders as a fixed collapsed trigger by default', () => {
    const html = renderToStaticMarkup(<TweakPanel iframeRef={createRef<HTMLIFrameElement>()} />);

    expect(html).toContain('aria-label="Open tweaks"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('right-[var(--space-4)]');
    expect(html).toContain('bottom-[var(--space-4)]');
    expect(html).not.toContain('top-[var(--space-4)]');
    expect(html).not.toContain('Close tweaks');
    expect(html).not.toContain('cursor-grab');
  });

  it('does not sync previewSource after a successful workspace write', () => {
    expect(shouldSyncPreviewSourceAfterTweakPersist({ wrote: true })).toBe(false);
    expect(shouldSyncPreviewSourceAfterTweakPersist({ wrote: false })).toBe(true);
  });

  it('shows the supplied active source instead of unrelated stored declarations', () => {
    const html = renderToStaticMarkup(
      <TweakPanel
        iframeRef={createRef<HTMLIFrameElement>()}
        presentation="inspector"
        source={{ path: 'screens/Tasks.jsx', content: 'function App() { return null; }' }}
      />,
    );
    expect(html).toContain('screens/Tasks.jsx');
    expect(html).toContain('No controls yet');
    expect(html).not.toContain('#f97316');
  });

  it('shows a protocol error inside the panel instead of throwing during render', () => {
    const html = renderToStaticMarkup(
      <TweakPanel
        iframeRef={createRef<HTMLIFrameElement>()}
        presentation="inspector"
        source={{
          path: 'App.jsx',
          content: '/*EDITMODE-BEGIN*/{invalid:true}/*EDITMODE-END*/',
        }}
      />,
    );
    expect(html).toContain('role="alert"');
    expect(html).toContain('EDITMODE block contains invalid JSON');
    expect(html).toContain('App.jsx');
  });
});
