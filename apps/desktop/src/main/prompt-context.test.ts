import { afterEach, describe, expect, it, vi } from 'vitest';
import { preparePromptContext } from './prompt-context';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('preparePromptContext', () => {
  it('throws a CodesignError when an attachment cannot be read', async () => {
    await expect(
      preparePromptContext({
        attachments: [{ path: 'Z:/missing/brief.md', name: 'brief.md', size: 12 }],
      }),
    ).rejects.toMatchObject({
      name: 'CodesignError',
      code: 'ATTACHMENT_READ_FAILED',
    });
  });

  it('throws a CodesignError when an attachment is too large', async () => {
    await expect(
      preparePromptContext({
        attachments: [{ path: 'C:/repo/huge.txt', name: 'huge.txt', size: 300_000 }],
      }),
    ).rejects.toMatchObject({
      name: 'CodesignError',
      code: 'ATTACHMENT_TOO_LARGE',
    });
  });

  it('throws a CodesignError for oversized reference responses', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response('<!doctype html><html><body>too big</body></html>', {
          status: 200,
          headers: {
            'content-type': 'text/html; charset=utf-8',
            'content-length': '300000',
          },
        }),
      ),
    );

    await expect(
      preparePromptContext({
        referenceUrl: 'https://example.com/reference',
      }),
    ).rejects.toMatchObject({
      name: 'CodesignError',
      code: 'REFERENCE_URL_TOO_LARGE',
    });
  });
});
