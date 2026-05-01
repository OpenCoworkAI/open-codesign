import { describe, expect, it } from 'vitest';
import { makeTextEditorTool, type TextEditorFsCallbacks } from './text-editor.js';

function makeFs(content: string): TextEditorFsCallbacks {
  return {
    view: (path) =>
      path === 'index.html' ? { content, numLines: content.split('\n').length } : null,
    create: (path) => ({ path }),
    strReplace: (path) => ({ path }),
    insert: (path) => ({ path }),
    listDir: () => [],
  };
}

describe('str_replace_based_edit_tool', () => {
  it('treats -1 range bounds as EOF instead of a full-file range', async () => {
    const tool = makeTextEditorTool(makeFs(['one', 'two', 'three'].join('\n')));

    const result = await tool.execute('call-1', {
      command: 'view',
      path: 'index.html',
      view_range: [-1, -1],
    });

    const first = result.content[0];
    expect(first?.type).toBe('text');
    const text = first?.type === 'text' ? first.text : '';
    expect(text).toContain('index.html · lines 3-3 of 3');
    expect(text).toContain('three');
    expect(text).not.toContain('one');
    expect(text).not.toContain('two');
  });

  it('rejects command-specific missing fields instead of silently defaulting them', async () => {
    const tool = makeTextEditorTool(makeFs('one'));

    await expect(
      tool.execute('call-1', {
        command: 'create',
        path: 'new.html',
      }),
    ).rejects.toThrow(/create requires file_text/);

    await expect(
      tool.execute('call-2', {
        command: 'str_replace',
        path: 'index.html',
        old_str: 'one',
      }),
    ).rejects.toThrow(/str_replace requires new_str/);

    await expect(
      tool.execute('call-3', {
        command: 'insert',
        path: 'index.html',
        new_str: 'two',
      }),
    ).rejects.toThrow(/insert requires numeric insert_line/);
  });
});
