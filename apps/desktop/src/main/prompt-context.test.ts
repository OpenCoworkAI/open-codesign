import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
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

  it('throws a CodesignError when a text attachment is too large', async () => {
    await expect(
      preparePromptContext({
        attachments: [{ path: 'C:/repo/huge.txt', name: 'huge.txt', size: 300_000 }],
      }),
    ).rejects.toMatchObject({
      name: 'CodesignError',
      code: 'ATTACHMENT_TOO_LARGE',
    });
  });

  it('allows binary attachments (png) up to 10MB - 500KB png passes', async () => {
    await expect(
      preparePromptContext({
        attachments: [{ path: 'C:/repo/image.png', name: 'image.png', size: 543_034 }],
      }),
    ).rejects.toMatchObject({
      code: 'ATTACHMENT_READ_FAILED',
    });
  });

  it('encodes supported image attachments as data URLs', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'codesign-image-attachment-'));
    const filePath = path.join(dir, 'shot.png');
    const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
    await fs.writeFile(filePath, pngBytes);

    const result = await preparePromptContext({
      attachments: [{ path: filePath, name: 'shot.png', size: pngBytes.length }],
    });

    expect(result.attachments).toHaveLength(1);
    expect(result.attachments[0]).toMatchObject({
      name: 'shot.png',
      mediaType: 'image/png',
    });
    expect(result.attachments[0]?.imageDataUrl).toBe(
      `data:image/png;base64,${pngBytes.toString('base64')}`,
    );
    expect(result.attachments[0]?.excerpt).toBeUndefined();
  });

  it('throws ATTACHMENT_TOO_LARGE for unknown extension text > 256KB', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'codesign-attachment-'));
    const filePath = path.join(dir, 'data.bin');
    const text = 'a'.repeat(300_000);
    await fs.writeFile(filePath, text);

    await expect(
      preparePromptContext({
        attachments: [{ path: filePath, name: 'data.bin', size: Buffer.byteLength(text) }],
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

  it('loads workspace AGENTS.md, DESIGN.md, and safe project settings', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'codesign-project-context-'));
    await fs.mkdir(path.join(dir, '.codesign'), { recursive: true });
    await fs.writeFile(path.join(dir, 'AGENTS.md'), 'Follow project density rules.', 'utf8');
    await fs.writeFile(path.join(dir, 'DESIGN.md'), '# Tokens\nUse Inter.', 'utf8');
    await fs.writeFile(
      path.join(dir, '.codesign', 'settings.json'),
      JSON.stringify({
        schemaVersion: 1,
        preferredSkills: ['chart-rendering'],
        apiKey: 'must-not-enter-prompt',
        arbitrary: 'ignored',
      }),
      'utf8',
    );

    const result = await preparePromptContext({ workspaceRoot: dir });

    expect(result.projectContext.agentsMd).toContain('project density');
    expect(result.projectContext.designMd).toContain('Use Inter');
    expect(result.projectContext.settingsJson).toContain('preferredSkills');
    expect(result.projectContext.settingsJson).not.toContain('apiKey');
    expect(result.projectContext.settingsJson).not.toContain('arbitrary');
  });

  it('throws when project settings are malformed JSON', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'codesign-project-context-bad-'));
    await fs.mkdir(path.join(dir, '.codesign'), { recursive: true });
    await fs.writeFile(path.join(dir, '.codesign', 'settings.json'), '{bad json', 'utf8');

    await expect(preparePromptContext({ workspaceRoot: dir })).rejects.toMatchObject({
      name: 'CodesignError',
      code: 'CONFIG_PARSE_FAILED',
    });
  });
});
