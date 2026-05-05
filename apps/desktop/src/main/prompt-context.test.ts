import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { preparePromptContext } from './prompt-context';

const VALID_DESIGN_MD = `---
version: alpha
name: Project System
colors:
  primary: "#111111"
typography:
  body:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: 400
rounded:
  sm: 4px
spacing:
  sm: 8px
---

## Overview

Use Inter with compact project density.

## Colors

Use primary for text and key actions.
`;

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('preparePromptContext', () => {
  const resolvePublicReferenceHost = async () => ['93.184.216.34'];
  const makeReferenceFetcher = (...responses: Response[]) => {
    const pending = [...responses];
    return vi.fn(
      async (
        _safeUrl: string,
        _signal: AbortSignal,
        _resolveReferenceHost: (hostname: string) => Promise<string[]>,
      ) => {
        const next = pending.shift();
        if (!next) throw new Error('unexpected reference fetch');
        return next;
      },
    );
  };

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

  it('resolves workspace-relative attachments against the current workspace root', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'codesign-relative-attachment-'));
    const relativePath = 'references/brief.md';
    const filePath = path.join(dir, relativePath);
    const text = 'Use the uploaded benchmark chart as the content reference.';
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, text);

    const result = await preparePromptContext({
      workspaceRoot: dir,
      attachments: [{ path: relativePath, name: 'brief.md', size: Buffer.byteLength(text) }],
    });

    expect(result.attachments[0]).toMatchObject({
      name: 'brief.md',
      path: relativePath,
      excerpt: text,
    });
  });

  it('rebases stale auto-managed workspace attachment paths after a workspace rename', async () => {
    const parent = await fs.mkdtemp(path.join(os.tmpdir(), 'codesign-renamed-attachment-'));
    const newWorkspace = path.join(parent, '数据对比图页面');
    const relativePath = 'references/shot.png';
    const filePath = path.join(newWorkspace, relativePath);
    const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, pngBytes);

    const stalePath = path.join(parent, 'Untitled-design-1-25', relativePath);
    const result = await preparePromptContext({
      workspaceRoot: newWorkspace,
      attachments: [{ path: stalePath, name: 'shot.png', size: pngBytes.length }],
    });

    expect(result.attachments[0]).toMatchObject({
      name: 'shot.png',
      path: relativePath,
      mediaType: 'image/png',
      imageDataUrl: `data:image/png;base64,${pngBytes.toString('base64')}`,
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
    // Binary attachments (images) can be up to 10MB - allowed larger than text
    await expect(
      preparePromptContext({
        attachments: [{ path: 'C:/repo/image.png', name: 'image.png', size: 543_034 }],
      }),
    ).rejects.toMatchObject({
      code: 'ATTACHMENT_READ_FAILED',
    });
    // It fails because the file doesn't exist, but importantly - NOT ATTACHMENT_TOO_LARGE
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
    expect(result.attachments[0]?.note).toContain('visual pixels may only be available');
    expect(result.attachments[0]?.note).not.toContain('Use the visual content directly');
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
    const fetchReference = makeReferenceFetcher(
      new Response('<!doctype html><html><body>too big</body></html>', {
        status: 200,
        headers: {
          'content-type': 'text/html; charset=utf-8',
          'content-length': '300000',
        },
      }),
    );

    await expect(
      preparePromptContext({
        referenceUrl: 'https://example.com/reference',
        resolveReferenceHost: resolvePublicReferenceHost,
        fetchReference,
      }),
    ).rejects.toMatchObject({
      name: 'CodesignError',
      code: 'REFERENCE_URL_TOO_LARGE',
    });
  });

  it('rejects non-http reference URLs before fetch', async () => {
    const fetchReference = vi.fn();

    await expect(
      preparePromptContext({
        referenceUrl: 'file:///Users/me/secret.html',
        fetchReference,
      }),
    ).rejects.toMatchObject({
      name: 'CodesignError',
      code: 'REFERENCE_URL_UNSUPPORTED',
    });

    expect(fetchReference).not.toHaveBeenCalled();
  });

  it('rejects reference URLs with embedded credentials before fetch', async () => {
    const fetchReference = vi.fn();

    await expect(
      preparePromptContext({
        referenceUrl: 'https://user:pass@example.com/reference',
        fetchReference,
      }),
    ).rejects.toMatchObject({
      name: 'CodesignError',
      code: 'REFERENCE_URL_UNSUPPORTED',
    });

    expect(fetchReference).not.toHaveBeenCalled();
  });

  it('rejects localhost and private-address reference URLs before fetch', async () => {
    const fetchReference = vi.fn();

    await expect(
      preparePromptContext({
        referenceUrl: 'http://localhost.:3000/private',
        fetchReference,
      }),
    ).rejects.toMatchObject({
      name: 'CodesignError',
      code: 'REFERENCE_URL_UNSUPPORTED',
    });

    await expect(
      preparePromptContext({
        referenceUrl: 'http://192.168.1.20/private',
        fetchReference,
      }),
    ).rejects.toMatchObject({
      name: 'CodesignError',
      code: 'REFERENCE_URL_UNSUPPORTED',
    });

    await expect(
      preparePromptContext({
        referenceUrl: 'http://198.51.100.10/reference',
        fetchReference,
      }),
    ).rejects.toMatchObject({
      name: 'CodesignError',
      code: 'REFERENCE_URL_UNSUPPORTED',
    });

    await expect(
      preparePromptContext({
        referenceUrl: 'http://[::ffff:127.0.0.1]/private',
        fetchReference,
      }),
    ).rejects.toMatchObject({
      name: 'CodesignError',
      code: 'REFERENCE_URL_UNSUPPORTED',
    });

    expect(fetchReference).not.toHaveBeenCalled();
  });

  it('follows validated http reference URL redirects manually', async () => {
    const fetchReference = makeReferenceFetcher(
      new Response(null, {
        status: 302,
        headers: { location: '/final' },
      }),
      new Response('<!doctype html><title>Final</title><p>Reference body</p>', {
        status: 200,
        headers: { 'content-type': 'text/html; charset=utf-8' },
      }),
    );

    const result = await preparePromptContext({
      referenceUrl: 'https://example.com/start',
      resolveReferenceHost: resolvePublicReferenceHost,
      fetchReference,
    });

    expect(fetchReference).toHaveBeenCalledTimes(2);
    expect(fetchReference.mock.calls[0]?.[0]).toBe('https://example.com/start');
    expect(fetchReference.mock.calls[1]?.[0]).toBe('https://example.com/final');
    expect(result.referenceUrl).toMatchObject({
      url: 'https://example.com/final',
      title: 'Final',
      excerpt: 'Final Reference body',
    });
  });

  it('rejects reference URL redirects to unsupported schemes before following them', async () => {
    const fetchReference = makeReferenceFetcher(
      new Response(null, {
        status: 302,
        headers: { location: 'file:///Users/me/secret.html' },
      }),
    );

    await expect(
      preparePromptContext({
        referenceUrl: 'https://example.com/start',
        resolveReferenceHost: resolvePublicReferenceHost,
        fetchReference,
      }),
    ).rejects.toMatchObject({
      name: 'CodesignError',
      code: 'REFERENCE_URL_UNSUPPORTED',
    });

    expect(fetchReference).toHaveBeenCalledTimes(1);
  });

  it('rejects reference URL redirects with embedded credentials before following them', async () => {
    const fetchReference = makeReferenceFetcher(
      new Response(null, {
        status: 302,
        headers: { location: 'https://user:pass@example.com/secret' },
      }),
    );

    await expect(
      preparePromptContext({
        referenceUrl: 'https://example.com/start',
        resolveReferenceHost: resolvePublicReferenceHost,
        fetchReference,
      }),
    ).rejects.toMatchObject({
      name: 'CodesignError',
      code: 'REFERENCE_URL_UNSUPPORTED',
    });

    expect(fetchReference).toHaveBeenCalledTimes(1);
  });

  it('rejects reference URLs whose host resolves to a private address before fetch', async () => {
    const fetchReference = vi.fn();

    await expect(
      preparePromptContext({
        referenceUrl: 'https://example.com/reference',
        resolveReferenceHost: async () => ['127.0.0.1'],
        fetchReference,
      }),
    ).rejects.toMatchObject({
      name: 'CodesignError',
      code: 'REFERENCE_URL_UNSUPPORTED',
    });

    expect(fetchReference).not.toHaveBeenCalled();
  });

  it('rejects connection-time DNS rebinding in the default reference fetcher', async () => {
    const resolveReferenceHost = vi
      .fn<() => Promise<string[]>>()
      .mockResolvedValueOnce(['93.184.216.34'])
      .mockResolvedValueOnce(['127.0.0.1']);

    await expect(
      preparePromptContext({
        referenceUrl: 'http://example.com/reference',
        resolveReferenceHost,
      }),
    ).rejects.toMatchObject({
      name: 'CodesignError',
      code: 'REFERENCE_URL_UNSUPPORTED',
    });

    expect(resolveReferenceHost).toHaveBeenCalledTimes(2);
  });

  it('times out while resolving reference URL hosts before fetch', async () => {
    vi.useFakeTimers();
    const fetchReference = vi.fn();

    const pending = preparePromptContext({
      referenceUrl: 'https://example.com/reference',
      resolveReferenceHost: async () => new Promise<string[]>(() => {}),
      fetchReference,
    });
    const assertion = expect(pending).rejects.toMatchObject({
      name: 'CodesignError',
      code: 'REFERENCE_URL_FETCH_TIMEOUT',
    });
    await vi.advanceTimersByTimeAsync(4_001);

    await assertion;
    expect(fetchReference).not.toHaveBeenCalled();
  });

  it('rejects reference URL redirects to private addresses before following them', async () => {
    const fetchReference = makeReferenceFetcher(
      new Response(null, {
        status: 302,
        headers: { location: 'http://127.0.0.1:11434/secret' },
      }),
    );

    await expect(
      preparePromptContext({
        referenceUrl: 'https://example.com/start',
        resolveReferenceHost: resolvePublicReferenceHost,
        fetchReference,
      }),
    ).rejects.toMatchObject({
      name: 'CodesignError',
      code: 'REFERENCE_URL_UNSUPPORTED',
    });

    expect(fetchReference).toHaveBeenCalledTimes(1);
  });

  it('loads workspace AGENTS.md, DESIGN.md, and safe project settings', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'codesign-project-context-'));
    await fs.mkdir(path.join(dir, '.codesign'), { recursive: true });
    await fs.writeFile(path.join(dir, 'AGENTS.md'), 'Follow project density rules.', 'utf8');
    await fs.writeFile(path.join(dir, 'DESIGN.md'), VALID_DESIGN_MD, 'utf8');
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
    expect(result.projectContext.designMd).toContain('version: alpha');
    expect(result.projectContext.designMd).toContain('Use Inter with compact project density.');
    expect(result.projectContext.settingsJson).toContain('preferredSkills');
    expect(result.projectContext.settingsJson).not.toContain('apiKey');
    expect(result.projectContext.settingsJson).not.toContain('arbitrary');
  });

  it('passes invalid workspace DESIGN.md as repair context instead of blocking generation', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'codesign-project-context-design-'));
    await fs.writeFile(
      path.join(dir, 'DESIGN.md'),
      `---
project: Studio Loop Welcome Email
version: 1
---

## Brand

Use a deep indigo welcome-email system.
`,
      'utf8',
    );

    const result = await preparePromptContext({ workspaceRoot: dir });

    expect(result.projectContext.designMd).toBeUndefined();
    expect(result.projectContext.invalidDesignMd?.errors).toEqual([
      'project: Unknown Google DESIGN.md top-level field "project"',
      'name: name is required',
      'version: version must be a string',
    ]);
    expect(result.projectContext.invalidDesignMd?.raw).toContain('project: Studio Loop');
  });

  it('rejects project context files that traverse workspace symlinks', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'codesign-project-context-link-'));
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'codesign-project-context-out-'));
    await fs.writeFile(path.join(outside, 'AGENTS.md'), 'leaked instruction', 'utf8');
    try {
      await fs.symlink(outside, path.join(dir, 'linked'), 'dir');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'EPERM') return;
      throw err;
    }
    await fs.symlink(path.join(outside, 'AGENTS.md'), path.join(dir, 'AGENTS.md'));

    await expect(preparePromptContext({ workspaceRoot: dir })).rejects.toMatchObject({
      name: 'CodesignError',
      code: 'CONFIG_SCHEMA_INVALID',
    });
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
