import { describe, expect, it } from 'vitest';
import { Artifact } from './index';

const BASE_ARTIFACT = {
  id: 'design-1',
  type: 'html' as const,
  title: 'Design',
  content: '<main>legacy</main>',
  createdAt: '2026-05-04T00:00:00.000Z',
};

describe('Artifact', () => {
  it('parses legacy artifacts without source metadata', () => {
    const parsed = Artifact.parse(BASE_ARTIFACT);

    expect(parsed.sourceFormat).toBeUndefined();
    expect(parsed.renderRuntime).toBeUndefined();
    expect(parsed.entryPath).toBeUndefined();
  });

  it.each([
    { schemaVersion: 1, path: 'pages/main.html', format: 'html', runtimeMode: 'native-html' },
    { schemaVersion: 1, path: 'pages/App.tsx', format: 'tsx', runtimeMode: 'legacy-auto' },
  ])('accepts optional versioned source identity: $path', (source) => {
    const parsed = Artifact.parse({ ...BASE_ARTIFACT, source, sourceFormat: source.format });
    expect(parsed.source).toEqual(source);
    expect(parsed.sourceFormat).toBe(source.format);
    expect(
      Artifact.safeParse({ ...BASE_ARTIFACT, source: { ...source, schemaVersion: 2 } }).success,
    ).toBe(false);
  });

  it('parses design source metadata separately from export artifact type', () => {
    const parsed = Artifact.parse({
      ...BASE_ARTIFACT,
      content: 'function App() { return <main />; }',
      sourceFormat: 'jsx',
      renderRuntime: 'react',
      entryPath: 'App.jsx',
    });

    expect(parsed.type).toBe('html');
    expect(parsed.sourceFormat).toBe('jsx');
    expect(parsed.renderRuntime).toBe('react');
    expect(parsed.entryPath).toBe('App.jsx');
  });
});
