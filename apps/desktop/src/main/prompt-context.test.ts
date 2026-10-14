import { randomBytes } from 'node:crypto';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import JSZip from 'jszip';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { omittedMark } from './document-text';
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

describe('document attachments', () => {
  const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
  const A = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"';
  const S = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"';
  const paragraph = (text: string) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;
  const docx = (...paragraphs: string[]) => ({
    'word/document.xml': `<w:document ${W}><w:body>${paragraphs.map(paragraph).join('')}</w:body></w:document>`,
  });
  const slide = (...lines: string[]) =>
    `<p:sld ${A}>${lines.map((line) => `<a:p><a:r><a:t>${line}</a:t></a:r></a:p>`).join('')}</p:sld>`;

  async function attach(name: string, files: Record<string, string | Buffer>) {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'codesign-document-attachment-'));
    const zip = new JSZip();
    for (const [part, content] of Object.entries(files)) {
      zip.file(part, content, { compression: 'DEFLATE', compressionOptions: { level: 9 } });
    }
    const bytes = await zip.generateAsync({ type: 'nodebuffer' });
    const filePath = path.join(dir, name);
    await fs.writeFile(filePath, bytes);
    return { path: filePath, name, size: bytes.length };
  }

  it('reads a DOCX as text, under its title', async () => {
    const file = await attach('brief.docx', {
      ...docx('Redesign the pricing page', 'Keep it calm &amp; clear'),
      'docProps/core.xml':
        '<cp:coreProperties xmlns:cp="c" xmlns:dc="d"><dc:title>Pricing brief</dc:title></cp:coreProperties>',
    });
    const { attachments } = await preparePromptContext({ attachments: [file] });
    expect(attachments[0]).toEqual({
      name: 'brief.docx',
      path: file.path,
      excerpt: 'Title: Pricing brief\n\nRedesign the pricing page\nKeep it calm & clear',
      note: 'Text extracted from a DOCX file; layout, images and charts are not included.',
    });
  });

  it('reads a document that sits in the workspace, from its workspace-relative path and an unknown size', async () => {
    const file = await attach('brief.docx', docx('From the workspace'));
    const workspaceRoot = path.dirname(file.path);
    const { attachments } = await preparePromptContext({
      workspaceRoot,
      attachments: [{ path: 'brief.docx', name: 'brief.docx', size: 0 }],
    });
    expect(attachments[0]).toMatchObject({
      name: 'brief.docx',
      path: 'brief.docx',
      excerpt: 'From the workspace',
    });
  });

  it('reads a PPTX slide by slide', async () => {
    const file = await attach('deck.pptx', {
      'ppt/slides/slide2.xml': slide('Roadmap'),
      'ppt/slides/slide1.xml': slide('Launch plan', 'Q3'),
    });
    const { attachments } = await preparePromptContext({ attachments: [file] });
    expect(attachments[0]?.excerpt).toBe('Slide 1:\nLaunch plan\nQ3\n\nSlide 2:\nRoadmap');
  });

  it('reads an XLSX sheet by sheet', async () => {
    const file = await attach('content.xlsx', {
      'xl/workbook.xml': `<workbook ${S}><sheets><sheet name="Copy" sheetId="1"/></sheets></workbook>`,
      'xl/sharedStrings.xml': `<sst ${S}><si><t>Headline</t></si><si><t>Ship faster</t></si></sst>`,
      'xl/worksheets/sheet1.xml': `<worksheet ${S}><sheetData><row r="1"><c r="A1" s="1"/><c r="B1" t="s"><v>0</v></c></row><row r="2"><c r="A2" t="s"><v>1</v></c><c r="B2"><v>42</v></c></row></sheetData></worksheet>`,
    });
    const { attachments } = await preparePromptContext({ attachments: [file] });
    expect(attachments[0]?.excerpt).toBe('Sheet "Copy":\nHeadline\nShip faster · 42');
  });

  it('says what the limits left out of the text the model gets', async () => {
    const paragraphs = Array.from({ length: 450 }, (_, n) => `Paragraph ${n}`);
    const file = await attach('long.docx', docx(...paragraphs));
    const { attachments } = await preparePromptContext({ attachments: [file] });
    expect(attachments[0]?.excerpt).toContain('Paragraph 399');
    expect(attachments[0]?.excerpt).not.toContain('Paragraph 400');
    expect(attachments[0]?.excerpt?.endsWith(omittedMark(50, 'paragraph'))).toBe(true);
    expect(attachments[0]?.note).not.toContain('truncated');
  });

  it('cuts the excerpt at the character limit and says so', async () => {
    const file = await attach(
      'wide.docx',
      docx(...Array.from({ length: 60 }, () => 'x'.repeat(480))),
    );
    const { attachments } = await preparePromptContext({ attachments: [file] });
    expect(attachments[0]?.excerpt).toHaveLength(6_000);
    expect(attachments[0]?.note).toContain('Excerpt truncated to the first 6000 characters.');
  });

  it('says a document with no text has none', async () => {
    const file = await attach('empty.docx', docx());
    const { attachments } = await preparePromptContext({ attachments: [file] });
    expect(attachments[0]).toEqual({
      name: 'empty.docx',
      path: file.path,
      note: 'DOCX file with no text in it.',
    });
  });

  describe('a file that cannot be read as the format it claims', () => {
    it('fails with the file named when it is not an archive', async () => {
      const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'codesign-document-attachment-'));
      const filePath = path.join(dir, 'renamed.docx');
      await fs.writeFile(filePath, 'this is plain text');
      await expect(
        preparePromptContext({ attachments: [{ path: filePath, name: 'renamed.docx', size: 18 }] }),
      ).rejects.toMatchObject({
        code: 'ATTACHMENT_READ_FAILED',
        message: 'Could not read "renamed.docx" as a DOCX file.',
        cause: expect.any(Error),
      });
    });

    it('checks the size on disk, not the size the renderer reports', async () => {
      const file = await attach('big.docx', {
        'word/document.xml': randomBytes(11_000_000),
      });
      await expect(
        preparePromptContext({ attachments: [{ ...file, size: 1_000 }] }),
      ).rejects.toMatchObject({
        code: 'ATTACHMENT_TOO_LARGE',
        message: expect.stringContaining('Binary attachment "big.docx" is too large'),
      });
    });

    it('fails with the missing part named when the archive lacks it', async () => {
      const file = await attach('odd.pptx', { 'unrelated.txt': 'x' });
      await expect(preparePromptContext({ attachments: [file] })).rejects.toMatchObject({
        code: 'ATTACHMENT_READ_FAILED',
        message: 'Could not read "odd.pptx" as a PPTX file: it has no ppt/slides/slide1.xml.',
      });
    });

    it('fails as too large when the archive unpacks past the limit, without unpacking it', async () => {
      const file = await attach('bomb.docx', {
        'word/document.xml': Buffer.alloc(40 * 1024 * 1024, 0x20),
      });
      expect(file.size).toBeLessThan(1024 * 1024);
      const start = performance.now();
      await expect(preparePromptContext({ attachments: [file] })).rejects.toMatchObject({
        code: 'ATTACHMENT_TOO_LARGE',
        message: expect.stringContaining('holds more than 32MB of text once unpacked'),
      });
      expect(performance.now() - start).toBeLessThan(2_000);
    });

    it('fails the whole send, naming the file, when only one of several attachments is bad', async () => {
      const good = await attach('good.docx', docx('Fine'));
      const bad = await attach('bad.xlsx', { 'unrelated.txt': 'x' });
      await expect(preparePromptContext({ attachments: [good, bad] })).rejects.toMatchObject({
        code: 'ATTACHMENT_READ_FAILED',
        message: expect.stringContaining('"bad.xlsx"'),
      });
    });
  });

  it('keeps the filename note for formats it does not read, so they are not reported as broken', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'codesign-document-attachment-'));
    const files = [];
    for (const name of ['report.pdf', 'old.doc', 'old.ppt', 'old.xls']) {
      const filePath = path.join(dir, name);
      await fs.writeFile(filePath, Buffer.from([0x25, 0x50, 0x00, 0x01, 0x02]));
      files.push({ path: filePath, name, size: 5 });
    }
    const { attachments } = await preparePromptContext({ attachments: files });
    expect(attachments.map((attachment) => attachment.note)).toEqual([
      'Binary or unsupported format (.pdf). Use the filename as a hint, not quoted content.',
      'Binary or unsupported format (.doc). Use the filename as a hint, not quoted content.',
      'Binary or unsupported format (.ppt). Use the filename as a hint, not quoted content.',
      'Binary or unsupported format (.xls). Use the filename as a hint, not quoted content.',
    ]);
  });

  it('loads the document reader only when a document is attached', async () => {
    const source = await fs.readFile(path.join(__dirname, 'prompt-context.ts'), 'utf8');
    const staticImports = source.split('\n').filter((line) => /^import\b(?!\s+type)/.test(line));
    expect(staticImports.filter((line) => /document-text|jszip/.test(line))).toEqual([]);
    expect(source).toMatch(/await import\(\s*'\.\/document-text'\s*\)/);
  });
});
