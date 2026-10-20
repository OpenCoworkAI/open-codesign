import { initI18n } from '@open-codesign/i18n';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { ChatSidebarFrame } from './ChatSidebarFrame';

beforeAll(() => initI18n('en'));

describe('chat sidebar frame', () => {
  function render(collapsed: boolean, fullscreen = false) {
    return renderToStaticMarkup(
      <ChatSidebarFrame
        collapsed={collapsed}
        fullscreen={fullscreen}
        width={387}
        onCollapsedChange={vi.fn()}
        onResizeStart={vi.fn()}
      >
        <textarea defaultValue="Unsaved draft" />
      </ChatSidebarFrame>,
    );
  }

  it('retains the sidebar subtree and exposes an expanded-state button', () => {
    const html = render(false);
    expect(html).toContain('width:387px');
    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain('Collapse sidebar');
    expect(html).toContain('Unsaved draft');
  });

  it('keeps children mounted in a hidden body and hides resize interaction while collapsed', () => {
    const html = render(true);
    expect(html).toContain('width:var(--space-12)');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('Expand sidebar');
    expect(html).toContain('Unsaved draft');
    expect(html).toMatch(/<div id="[^"]+" hidden=""/);
    expect(html).toContain('hidden="" role="separator"');
  });

  it('hides the complete rail in fullscreen without removing its content', () => {
    const html = render(true, true);
    expect(html).toMatch(/^<div hidden=""/);
    expect(html).toContain('Unsaved draft');
    expect(html).toContain('Expand sidebar');
  });
});
