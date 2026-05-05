import { initI18n } from '@open-codesign/i18n';
import type { ChatMessageRow } from '@open-codesign/shared';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeAll, describe, expect, it } from 'vitest';
import { ChatMessageList } from './ChatMessageList';
import { formatAttachmentSize, UserMessage } from './UserMessage';

beforeAll(async () => {
  await initI18n('en');
});

describe('UserMessage attachments', () => {
  it('renders sent attachment names and sizes with the user message', () => {
    const html = renderToStaticMarkup(
      <UserMessage
        text="Use this screenshot"
        attachments={[
          {
            path: 'references/screenshot-1777986674494.png',
            name: 'screenshot-1777986674494.png',
            size: 42_000,
          },
        ]}
      />,
    );

    expect(html).toContain('Use this screenshot');
    expect(html).toContain('screenshot-1777986674494.png');
    expect(html).toContain('41 KB');
  });

  it('formats attachment sizes for compact chips', () => {
    expect(formatAttachmentSize(0)).toBe('');
    expect(formatAttachmentSize(512)).toBe('512 B');
    expect(formatAttachmentSize(42_000)).toBe('41 KB');
    expect(formatAttachmentSize(4_200_000)).toBe('4.0 MB');
  });

  it('renders attachments from persisted chat rows', () => {
    const rows: ChatMessageRow[] = [
      {
        schemaVersion: 1,
        id: 1,
        designId: 'design-1',
        seq: 0,
        kind: 'user',
        payload: {
          text: 'Use this screenshot',
          attachments: [
            {
              path: 'references/screenshot-1777986674494.png',
              name: 'screenshot-1777986674494.png',
              size: 42_000,
            },
          ],
        },
        snapshotId: null,
        createdAt: '2026-05-05T00:00:00.000Z',
      },
    ];

    const html = renderToStaticMarkup(
      <ChatMessageList messages={rows} loading={false} isGenerating={false} />,
    );

    expect(html).toContain('Use this screenshot');
    expect(html).toContain('screenshot-1777986674494.png');
    expect(html).toContain('41 KB');
  });
});
