import { describe, expect, it, vi } from 'vitest';
import type { CoreLogger } from '../logger.js';
import { enrichImagePromptForPurpose, makeGenerateImageAssetTool } from './generate-image-asset';
import type { TextEditorFsCallbacks } from './text-editor';

function memoryFs(): TextEditorFsCallbacks & { files: Map<string, string> } {
  const files = new Map<string, string>();
  return {
    files,
    view(path) {
      const content = files.get(path);
      if (content === undefined) return null;
      return { content, numLines: content.split('\n').length };
    },
    create(path, content) {
      files.set(path, content);
      return { path };
    },
    strReplace(path, oldStr, newStr) {
      const current = files.get(path);
      if (current === undefined) throw new Error('missing');
      const next = current.replace(oldStr, newStr);
      files.set(path, next);
      return { path };
    },
    insert(path, line, text) {
      const lines = (files.get(path) ?? '').split('\n');
      lines.splice(line, 0, text);
      files.set(path, lines.join('\n'));
      return { path };
    },
    listDir() {
      return [...files.keys()];
    },
  };
}

describe('generate_image_asset tool', () => {
  it('stores generated assets in the virtual filesystem and returns a local path', async () => {
    const fs = memoryFs();
    const generate = vi.fn(async () => ({
      path: 'assets/hero.png',
      dataUrl: 'data:image/png;base64,aW1n',
      mimeType: 'image/png',
      model: 'gpt-image-2',
      provider: 'openai',
    }));
    const tool = makeGenerateImageAssetTool(generate, fs);

    const result = await tool.execute('tool-1', {
      prompt: 'A cinematic ink-wash hero background',
      purpose: 'hero',
      filenameHint: 'hero',
      aspectRatio: '16:9',
      alt: 'Ink-wash mountains',
    });

    expect(generate).toHaveBeenCalledTimes(1);
    expect(generate).toHaveBeenCalledWith(
      expect.objectContaining({
        purpose: 'hero',
        aspectRatio: '16:9',
        prompt: expect.stringContaining('Editorial hero composition'),
      }),
      undefined,
    );
    expect(generate).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: expect.stringMatching(/^A cinematic ink-wash hero background/),
      }),
      undefined,
    );
    expect(fs.files.get('assets/hero.png')).toBe('data:image/png;base64,aW1n');
    expect(result.details.path).toBe('assets/hero.png');
    const content = result.content[0];
    expect(content?.type).toBe('text');
    expect(content?.type === 'text' ? content.text : '').toContain('src="assets/hero.png"');
  });

  it('emits structured start/ok logs with prompt preview and duration', async () => {
    const fs = memoryFs();
    const events: Array<{ event: string; data?: Record<string, unknown> }> = [];
    const logger: CoreLogger = {
      info: (event, data) => events.push({ event, ...(data ? { data } : {}) }),
      warn: () => {},
      error: () => {},
    };
    const generate = vi.fn(async () => ({
      path: 'assets/hero.png',
      dataUrl: 'data:image/png;base64,aW1n',
      mimeType: 'image/png',
      model: 'gpt-image-2',
      provider: 'openai',
    }));
    const tool = makeGenerateImageAssetTool(generate, fs, logger);
    await tool.execute('t', {
      prompt: 'hero shot with shallow DOF',
      purpose: 'hero',
      aspectRatio: '16:9',
    });
    const names = events.map((e) => e.event);
    expect(names).toContain('[image_asset] step=start');
    expect(names).toContain('[image_asset] step=ok');
    const start = events.find((e) => e.event === '[image_asset] step=start');
    expect(start?.data?.['purpose']).toBe('hero');
    expect(start?.data?.['aspectRatio']).toBe('16:9');
    expect(typeof start?.data?.['promptPreview']).toBe('string');
    const ok = events.find((e) => e.event === '[image_asset] step=ok');
    expect(ok?.data?.['path']).toBe('assets/hero.png');
    expect(typeof ok?.data?.['ms']).toBe('number');
  });

  it('emits a fail log when the backend throws', async () => {
    const fs = memoryFs();
    const errors: Array<{ event: string; data?: Record<string, unknown> }> = [];
    const logger: CoreLogger = {
      info: () => {},
      warn: () => {},
      error: (event, data) => errors.push({ event, ...(data ? { data } : {}) }),
    };
    const generate = vi.fn(async () => {
      throw new Error('rate limited');
    });
    const tool = makeGenerateImageAssetTool(generate, fs, logger);
    await expect(tool.execute('t', { prompt: 'x', purpose: 'background' })).rejects.toThrow(
      'rate limited',
    );
    expect(errors.map((e) => e.event)).toContain('[image_asset] step=fail');
  });
});

describe('enrichImagePromptForPurpose', () => {
  it('appends a purpose-specific suffix for known purposes', () => {
    const out = enrichImagePromptForPurpose('a misty mountain', 'background');
    expect(out.startsWith('a misty mountain')).toBe(true);
    expect(out).toContain('Seamless full-bleed');
  });

  it('returns the prompt unchanged for purpose=other', () => {
    expect(enrichImagePromptForPurpose('raw', 'other')).toBe('raw');
  });

  it('skips duplicate enrichment when the prompt already mentions the marker', () => {
    const prompt = 'Editorial hero composition of two cyclists';
    expect(enrichImagePromptForPurpose(prompt, 'hero')).toBe(prompt);
  });
});
