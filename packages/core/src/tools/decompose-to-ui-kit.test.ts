import { describe, expect, it } from 'vitest';
import { makeDecomposeToUiKitTool } from './decompose-to-ui-kit.js';
import type { TextEditorFsCallbacks } from './text-editor.js';

interface CreatedFile {
  path: string;
  content: string;
}

function makeStubFs(): { fs: TextEditorFsCallbacks; created: CreatedFile[] } {
  const created: CreatedFile[] = [];
  const fs: TextEditorFsCallbacks = {
    view: () => null,
    create: (path: string, content: string) => {
      created.push({ path, content });
      return { path };
    },
    strReplace: (path: string) => ({ path }),
    insert: (path: string) => ({ path }),
    listDir: () => [],
  };
  return { fs, created };
}

describe('makeDecomposeToUiKitTool', () => {
  it('emits all expected files for a typical decomposition', async () => {
    const { fs, created } = makeStubFs();
    const tool = makeDecomposeToUiKitTool(fs);

    const result = await tool.execute(
      'test-call',
      {
        slug: 'saas-dashboard',
        indexHtml: '<html><body>...</body></html>',
        components: [
          {
            name: 'MetricCard',
            filename: 'MetricCard.tsx',
            source: 'export const MetricCard = (p: { label: string }) => null;',
            propsSummary: 'label, value, delta, trend',
          },
          {
            name: 'Sidebar',
            filename: 'Sidebar.tsx',
            source: 'export const Sidebar = () => null;',
          },
        ],
        tokens: [
          { name: '--color-brand', value: '#c96442', category: 'color' },
          { name: '--space-md', value: '16px', category: 'spacing' },
        ],
        readmeNotes: 'Mock dashboard for testing.',
      },
      undefined,
    );

    expect(result.details.componentCount).toBe(2);
    expect(result.details.tokenCount).toBe(2);
    expect(created.map((c) => c.path)).toEqual([
      'ui_kits/saas-dashboard/index.html',
      'ui_kits/saas-dashboard/components/MetricCard.tsx',
      'ui_kits/saas-dashboard/components/Sidebar.tsx',
      'ui_kits/saas-dashboard/tokens.css',
      'ui_kits/saas-dashboard/manifest.json',
      'ui_kits/saas-dashboard/README.md',
    ]);
  });

  it('sanitizes weird slugs to kebab-case ascii', async () => {
    const { fs, created } = makeStubFs();
    const tool = makeDecomposeToUiKitTool(fs);

    await tool.execute(
      't',
      {
        slug: 'My Cool Design!! 你好',
        indexHtml: '',
        components: [],
        tokens: [],
      },
      undefined,
    );

    expect(created[0]?.path).toMatch(/^ui_kits\/my-cool-design/);
  });

  it('falls back to "untitled" when slug is empty after sanitization', async () => {
    const { fs, created } = makeStubFs();
    const tool = makeDecomposeToUiKitTool(fs);

    await tool.execute(
      't',
      {
        slug: '!!!',
        indexHtml: '',
        components: [],
        tokens: [],
      },
      undefined,
    );

    expect(created[0]?.path).toBe('ui_kits/untitled/index.html');
  });

  it('manifest carries schemaVersion = 1', async () => {
    const { fs, created } = makeStubFs();
    const tool = makeDecomposeToUiKitTool(fs);

    await tool.execute('t', { slug: 'x', indexHtml: '', components: [], tokens: [] }, undefined);

    const manifest = created.find((c) => c.path.endsWith('manifest.json'));
    if (!manifest) throw new Error('manifest.json was not written');
    const parsed = JSON.parse(manifest.content);
    expect(parsed.schemaVersion).toBe(1);
    expect(parsed.generator).toBe('open-codesign decompose_to_ui_kit');
    expect(parsed.slug).toBe('x');
    expect(parsed.components).toEqual([]);
    expect(typeof parsed.generatedAt).toBe('string');
  });

  it('groups tokens.css by category in stable order', async () => {
    const { fs, created } = makeStubFs();
    const tool = makeDecomposeToUiKitTool(fs);

    await tool.execute(
      't',
      {
        slug: 'x',
        indexHtml: '',
        components: [],
        tokens: [
          { name: '--c1', value: 'red', category: 'color' },
          { name: '--s1', value: '8px', category: 'spacing' },
          { name: '--c2', value: 'blue', category: 'color' },
        ],
      },
      undefined,
    );

    const tokensFile = created.find((c) => c.path.endsWith('tokens.css'));
    if (!tokensFile) throw new Error('tokens.css was not written');
    const css = tokensFile.content;
    expect(css).toContain('/* color */');
    expect(css).toContain('/* spacing */');
    expect(css).toContain('--c1: red;');
    expect(css).toContain('--c2: blue;');
    expect(css).toContain('--s1: 8px;');
    expect(css.indexOf('/* color */')).toBeLessThan(css.indexOf('/* spacing */'));
  });

  it('prefixes raw token names with --', async () => {
    const { fs, created } = makeStubFs();
    const tool = makeDecomposeToUiKitTool(fs);

    await tool.execute(
      't',
      {
        slug: 'x',
        indexHtml: '',
        components: [],
        tokens: [{ name: 'color-brand', value: '#c96442', category: 'color' }],
      },
      undefined,
    );

    const tokensFile = created.find((c) => c.path.endsWith('tokens.css'));
    if (!tokensFile) throw new Error('tokens.css was not written');
    expect(tokensFile.content).toContain('--color-brand: #c96442;');
  });

  it('README lists every component with its props summary', async () => {
    const { fs, created } = makeStubFs();
    const tool = makeDecomposeToUiKitTool(fs);

    await tool.execute(
      't',
      {
        slug: 'x',
        indexHtml: '',
        components: [
          {
            name: 'Card',
            filename: 'Card.tsx',
            source: '',
            propsSummary: 'title, body',
          },
          { name: 'Btn', filename: 'Btn.tsx', source: '' },
        ],
        tokens: [],
        readmeNotes: 'Test handoff notes.',
      },
      undefined,
    );

    const readmeFile = created.find((c) => c.path.endsWith('README.md'));
    if (!readmeFile) throw new Error('README.md was not written');
    const readme = readmeFile.content;
    expect(readme).toContain('# x');
    expect(readme).toContain('**Card** (`components/Card.tsx`) — title, body');
    expect(readme).toContain('**Btn** (`components/Btn.tsx`)');
    expect(readme).toContain('Test handoff notes.');
  });

  it('handles empty components + tokens gracefully', async () => {
    const { fs, created } = makeStubFs();
    const tool = makeDecomposeToUiKitTool(fs);

    const result = await tool.execute(
      't',
      { slug: 'empty', indexHtml: '', components: [], tokens: [] },
      undefined,
    );

    expect(result.details.componentCount).toBe(0);
    expect(result.details.tokenCount).toBe(0);
    expect(created).toHaveLength(4);
    const readmeFile = created.find((c) => c.path.endsWith('README.md'));
    if (!readmeFile) throw new Error('README.md was not written');
    expect(readmeFile.content).toContain('_(none extracted)_');
  });

  it('returns AgentToolResult with summary text + structured details', async () => {
    const { fs } = makeStubFs();
    const tool = makeDecomposeToUiKitTool(fs);

    const result = await tool.execute(
      't',
      {
        slug: 'x',
        indexHtml: '',
        components: [{ name: 'X', filename: 'X.tsx', source: '' }],
        tokens: [{ name: '--a', value: 'b', category: 'color' }],
      },
      undefined,
    );

    const first = result.content[0];
    expect(first?.type).toBe('text');
    if (first?.type !== 'text') throw new Error('expected text content');
    expect(first.text).toContain('Decomposed into 5 files');
    expect(first.text).toContain('Components: X');
    expect(first.text).toContain('Tokens: 1 extracted across 1 category');
    expect(result.details.outputPaths).toHaveLength(5);
  });

  it('no-ops file writes when fs is undefined but still returns details', async () => {
    const tool = makeDecomposeToUiKitTool(undefined);

    const result = await tool.execute(
      't',
      {
        slug: 'no-fs',
        indexHtml: '',
        components: [{ name: 'X', filename: 'X.tsx', source: '' }],
        tokens: [],
      },
      undefined,
    );

    expect(result.details.componentCount).toBe(1);
    expect(result.details.outputPaths).toEqual([]);
  });
});
