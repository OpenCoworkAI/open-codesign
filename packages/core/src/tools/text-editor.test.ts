import { describe, expect, it } from 'vitest';
import { makeTextEditorTool, type TextEditorFsCallbacks } from './text-editor.js';

function makeFs(content: string, extraFiles: Record<string, string> = {}): TextEditorFsCallbacks {
  const files = new Map<string, string>([['App.jsx', content], ...Object.entries(extraFiles)]);
  return makeMapFs(files);
}

function makeMapFs(files: Map<string, string>): TextEditorFsCallbacks {
  return {
    view: (path) => {
      const file = files.get(path);
      return file === undefined ? null : { content: file, numLines: file.split('\n').length };
    },
    create: (path, fileText) => {
      files.set(path, fileText);
      return { path };
    },
    strReplace: (path, oldStr, newStr) => {
      const current = files.get(path);
      if (current === undefined) throw new Error(`missing ${path}`);
      if (!current.includes(oldStr)) throw new Error(`old_str not found in ${path}`);
      files.set(path, current.replace(oldStr, newStr));
      return { path };
    },
    insert: (path, line, text) => {
      const current = files.get(path);
      if (current === undefined) throw new Error(`missing ${path}`);
      const lines = current.split('\n');
      lines.splice(line, 0, text);
      files.set(path, lines.join('\n'));
      return { path };
    },
    listDir: (dir) => {
      if (dir !== '.') return [];
      return Array.from(files.keys()).sort();
    },
  };
}

function makeEmptyFs(): TextEditorFsCallbacks {
  return makeMapFs(new Map());
}

describe('str_replace_based_edit_tool', () => {
  it('treats -1 range bounds as EOF instead of a full-file range', async () => {
    const tool = makeTextEditorTool(makeFs(['one', 'two', 'three'].join('\n')));

    const result = await tool.execute('call-1', {
      command: 'view',
      path: 'App.jsx',
      view_range: [-1, -1],
    });

    const first = result.content[0];
    expect(first?.type).toBe('text');
    const text = first?.type === 'text' ? first.text : '';
    expect(text).toContain('App.jsx · lines 3-3 of 3');
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
        path: 'App.jsx',
        old_str: 'one',
      }),
    ).rejects.toThrow(/str_replace requires new_str/);

    await expect(
      tool.execute('call-3', {
        command: 'insert',
        path: 'App.jsx',
        new_str: 'two',
      }),
    ).rejects.toThrow(/insert requires numeric insert_line/);
  });

  it('normalizes Windows path separators before touching the virtual workspace', async () => {
    const tool = makeTextEditorTool(makeMapFs(new Map([['src/App.jsx', 'one']])));

    const result = await tool.execute('call-1', {
      command: 'view',
      path: 'src\\App.jsx',
    });

    expect(result.details).toMatchObject({ command: 'view', path: 'src/App.jsx' });
    expect(result.content[0]?.type === 'text' ? result.content[0].text : '').toBe('one');
  });

  it('rejects absolute and traversal paths before reaching the virtual workspace', async () => {
    const tool = makeTextEditorTool(makeFs('one'));

    await expect(
      tool.execute('call-1', {
        command: 'view',
        path: '../App.jsx',
      }),
    ).rejects.toThrow(/workspace-relative/);

    await expect(
      tool.execute('call-2', {
        command: 'view',
        path: 'C:\\Users\\Musson\\App.jsx',
      }),
    ).rejects.toThrow(/workspace-relative/);

    await expect(
      tool.execute('call-3', {
        command: 'view',
        path: '/tmp/App.jsx',
      }),
    ).rejects.toThrow(/workspace-relative/);
  });

  it('returns a recoverable error when editing an existing file before viewing it', async () => {
    const tool = makeTextEditorTool(makeFs('one'));

    const result = await tool.execute('call-1', {
      command: 'str_replace',
      path: 'App.jsx',
      old_str: 'one',
      new_str: 'two',
    });

    const first = result.content[0];
    expect(first?.type).toBe('text');
    expect(first?.type === 'text' ? first.text : '').toContain(
      'View App.jsx before editing it in this run',
    );
  });

  it('allows str_replace after viewing the file', async () => {
    const tool = makeTextEditorTool(makeFs('one'));

    await tool.execute('call-1', { command: 'view', path: 'App.jsx' });
    const result = await tool.execute('call-2', {
      command: 'str_replace',
      path: 'App.jsx',
      old_str: 'one',
      new_str: 'two',
    });

    expect(result.details).toMatchObject({ command: 'str_replace', path: 'App.jsx' });
  });

  it('allows insert after a range view of the file', async () => {
    const tool = makeTextEditorTool(makeFs(['one', 'two'].join('\n')));

    await tool.execute('call-1', { command: 'view', path: 'App.jsx', view_range: [1, 1] });
    const result = await tool.execute('call-2', {
      command: 'insert',
      path: 'App.jsx',
      insert_line: 1,
      new_str: 'inserted',
    });

    expect(result.details).toMatchObject({ command: 'insert', path: 'App.jsx' });
  });

  it('allows mutating a file created in the same run without a separate view', async () => {
    const tool = makeTextEditorTool(makeFs('one'));

    await tool.execute('call-1', { command: 'create', path: 'new.jsx', file_text: 'alpha' });
    const result = await tool.execute('call-2', {
      command: 'str_replace',
      path: 'new.jsx',
      old_str: 'alpha',
      new_str: 'beta',
    });

    expect(result.details).toMatchObject({ command: 'str_replace', path: 'new.jsx' });
  });

  it('allows a complete first App.jsx create instead of forcing incremental writes', async () => {
    const tool = makeTextEditorTool(makeEmptyFs());
    const completeSource = [
      'function App() {',
      '  return <main>',
      ...Array.from({ length: 230 }, (_, i) => `    <section>Row ${i}</section>`),
      '  </main>;',
      '}',
      "ReactDOM.createRoot(document.getElementById('root')).render(<App />);",
    ].join('\n');

    const result = await tool.execute('complete-create', {
      command: 'create',
      path: 'App.jsx',
      file_text: completeSource,
    });

    const text = result.content[0]?.type === 'text' ? result.content[0].text : '';
    expect(text).toContain('Created App.jsx');
    expect(result.details).toMatchObject({
      command: 'create',
      path: 'App.jsx',
      result: { path: 'App.jsx' },
    });
  });

  it('allows a compact first App.jsx create', async () => {
    const fs = makeEmptyFs();
    const tool = makeTextEditorTool(fs);

    const result = await tool.execute('small-create', {
      command: 'create',
      path: 'App.jsx',
      file_text:
        "function App() { return <main>Draft</main>; }\nReactDOM.createRoot(document.getElementById('root')).render(<App />);",
    });

    expect(result.content[0]?.type === 'text' ? result.content[0].text : '').toContain(
      'Created App.jsx',
    );
    expect(fs.view('App.jsx')).not.toBeNull();
  });

  it('blocks repeated failed exact edits until the agent rewrites the file', async () => {
    const tool = makeTextEditorTool(makeFs('one two three'));
    await tool.execute('view', { command: 'view', path: 'App.jsx' });

    for (let i = 0; i < 3; i += 1) {
      const result = await tool.execute(`miss-${i}`, {
        command: 'str_replace',
        path: 'App.jsx',
        old_str: `missing-${i}`,
        new_str: 'replacement',
      });
      expect(result.content[0]?.type).toBe('text');
      expect(result.content[0]?.type === 'text' ? result.content[0].text : '').toContain(
        'Edit failed',
      );
    }

    const blocked = await tool.execute('blocked', {
      command: 'str_replace',
      path: 'App.jsx',
      old_str: 'one',
      new_str: 'ONE',
    });
    expect(blocked.content[0]?.type === 'text' ? blocked.content[0].text : '').toContain(
      'Too many failed exact edits',
    );

    await tool.execute('rewrite', {
      command: 'create',
      path: 'App.jsx',
      file_text: 'one two three',
    });
    const afterRewrite = await tool.execute('after-rewrite', {
      command: 'str_replace',
      path: 'App.jsx',
      old_str: 'one',
      new_str: 'ONE',
    });
    expect(afterRewrite.content[0]?.type === 'text' ? afterRewrite.content[0].text : '').toContain(
      'Edited App.jsx',
    );
  });

  it('does not treat workspace write failures as exact edit misses', async () => {
    const fs = makeFs('one');
    const originalReplace = fs.strReplace;
    let failOnce = true;
    fs.strReplace = (path, oldStr, newStr) => {
      if (failOnce) {
        failOnce = false;
        throw new Error('Workspace write-through failed for App.jsx: permission request timed out');
      }
      return originalReplace(path, oldStr, newStr);
    };
    const tool = makeTextEditorTool(fs);
    await tool.execute('view', { command: 'view', path: 'App.jsx' });

    const failed = await tool.execute('write-fail', {
      command: 'str_replace',
      path: 'App.jsx',
      old_str: 'one',
      new_str: 'two',
    });
    const failedText = failed.content[0]?.type === 'text' ? failed.content[0].text : '';
    expect(failedText).toContain('could not write App.jsx to the workspace');
    expect(failedText).toContain('Stop retrying this edit');

    const afterWriteRestored = await tool.execute('write-ok', {
      command: 'str_replace',
      path: 'App.jsx',
      old_str: 'one',
      new_str: 'two',
    });
    expect(
      afterWriteRestored.content[0]?.type === 'text' ? afterWriteRestored.content[0].text : '',
    ).toContain('Edited App.jsx');
  });

  it('does not tell the agent to re-read after workspace insert write failures', async () => {
    const fs = makeFs('jsx', { 'App.css': 'body {}' });
    const originalInsert = fs.insert;
    let failOnce = true;
    fs.insert = (path, line, text) => {
      if (failOnce) {
        failOnce = false;
        throw new Error('Workspace write-through failed for App.css: permission request timed out');
      }
      return originalInsert(path, line, text);
    };
    const tool = makeTextEditorTool(fs);
    await tool.execute('view-css', { command: 'view', path: 'App.css' });

    const failed = await tool.execute('insert-fail', {
      command: 'insert',
      path: 'App.css',
      insert_line: 1,
      new_str: '.card {}',
    });
    const failedText = failed.content[0]?.type === 'text' ? failed.content[0].text : '';
    expect(failedText).toContain('could not write App.css to the workspace');
    expect(failedText).not.toContain('Re-read the target range');

    const afterWriteRestored = await tool.execute('insert-ok', {
      command: 'insert',
      path: 'App.css',
      insert_line: 1,
      new_str: '.card {}',
    });
    expect(
      afterWriteRestored.content[0]?.type === 'text' ? afterWriteRestored.content[0].text : '',
    ).toContain('Inserted at App.css:1');
  });

  it('does not treat a directory view as viewing a concrete file', async () => {
    const tool = makeTextEditorTool(makeFs('one'));

    await tool.execute('call-1', { command: 'view', path: '.' });
    const result = await tool.execute('call-2', {
      command: 'insert',
      path: 'App.jsx',
      insert_line: 1,
      new_str: 'inserted',
    });

    const first = result.content[0];
    expect(first?.type).toBe('text');
    expect(first?.type === 'text' ? first.text : '').toContain(
      'View App.jsx before editing it in this run',
    );
  });
});
