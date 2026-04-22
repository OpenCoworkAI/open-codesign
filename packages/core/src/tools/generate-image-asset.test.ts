import { describe, expect, it, vi } from 'vitest';
import { makeGenerateImageAssetTool } from './generate-image-asset';
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

    expect(generate).toHaveBeenCalledWith(
      {
        prompt: 'A cinematic ink-wash hero background',
        purpose: 'hero',
        filenameHint: 'hero',
        aspectRatio: '16:9',
        alt: 'Ink-wash mountains',
      },
      undefined,
    );
    expect(fs.files.get('assets/hero.png')).toBe('data:image/png;base64,aW1n');
    expect(result.details.path).toBe('assets/hero.png');
    const content = result.content[0];
    expect(content?.type).toBe('text');
    expect(content?.type === 'text' ? content.text : '').toContain('src="assets/hero.png"');
  });
});
