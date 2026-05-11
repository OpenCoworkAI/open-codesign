import { describe, expect, it } from 'vitest';
import {
  inspectWorkspaceFiles,
  makeInspectWorkspaceTool,
  summarizeWorkspaceInspection,
} from './inspect-workspace.js';

describe('inspect_workspace', () => {
  it('classifies workspace files into design-oriented groups', async () => {
    const inspection = inspectWorkspaceFiles([
      { file: 'App.jsx', contents: 'function App() {}' },
      { file: 'styles/tokens.css', contents: ':root { --color-brand: #111; }' },
      { file: 'DESIGN.md', contents: '---\nversion: alpha\n---' },
      { file: 'docs/brief.md', contents: '# Brief' },
      { file: 'assets/logo.svg', contents: '<svg />' },
      { file: 'references/brief.pdf' },
      { file: 'references/deck.pptx' },
    ]);

    expect(inspection.entryCandidates).toEqual(['App.jsx']);
    expect(inspection.sourceFiles).toContain('App.jsx');
    expect(inspection.styleFiles).toContain('styles/tokens.css');
    expect(inspection.designDocs).toContain('DESIGN.md');
    expect(inspection.referenceDocs).toContain('docs/brief.md');
    expect(inspection.referenceDocs).toContain('references/brief.pdf');
    expect(inspection.referenceDocs).toContain('references/deck.pptx');
    expect(inspection.assets).toContain('assets/logo.svg');
    expect(inspection.totalFiles).toBe(7);
    expect(inspection.truncated).toBe(false);
    expect(summarizeWorkspaceInspection(inspection)).toContain('assets/logo.svg');
  });

  it('returns an empty inventory for an empty workspace', async () => {
    const tool = makeInspectWorkspaceTool(async () => inspectWorkspaceFiles([]));
    const result = await tool.execute('inspect-1', {});

    expect(result.details).toMatchObject({
      entryCandidates: [],
      sourceFiles: [],
      totalFiles: 0,
      truncated: false,
    });
    expect(result.content[0]).toMatchObject({
      type: 'text',
      text: expect.stringContaining('0 file'),
    });
  });

  it('surfaces asset paths in the tool text seen by the model', async () => {
    const tool = makeInspectWorkspaceTool(async () =>
      inspectWorkspaceFiles([
        { file: 'App.jsx', contents: 'function App() {}' },
        { file: 'references/logo.png' },
        { file: 'references/brand-screenshot.webp' },
      ]),
    );

    const result = await tool.execute('inspect-assets', {});
    const text = (result.content[0] as { text: string }).text;

    expect(text).toContain('2 asset(s)');
    expect(text).toContain('references/logo.png');
    expect(text).toContain('references/brand-screenshot.webp');
  });

  it('bounds large groups and marks the inventory as truncated', () => {
    const inspection = inspectWorkspaceFiles(
      Array.from({ length: 80 }, (_, index) => ({
        file: `screens/screen-${index}.jsx`,
        contents: 'export default function Screen() {}',
      })),
    );

    expect(inspection.sourceFiles.length).toBeLessThan(80);
    expect(inspection.totalFiles).toBe(80);
    expect(inspection.truncated).toBe(true);
  });
});
