import { describe, expect, it } from 'vitest';
import { createDesignSourceArtifact, createHtmlArtifact } from './artifact-collect';

describe('artifact collection', () => {
  it('marks generated workspace content as JSX design source metadata', () => {
    const artifact = createDesignSourceArtifact('function App() { return <main />; }', 0);

    expect(artifact.type).toBe('html');
    expect(artifact.sourceFormat).toBe('jsx');
    expect(artifact.renderRuntime).toBe('react');
    expect(artifact.entryPath).toBe('App.jsx');
  });

  it('preserves exact native source and its nested identity without asset expansion', () => {
    const source = {
      schemaVersion: 1,
      path: 'pages/main.html',
      format: 'html',
      runtimeMode: 'native-html',
    } as const;
    const content = '﻿<img src="../assets/photo.png">\r\n';
    expect(createDesignSourceArtifact(content, 0, source.path, source)).toMatchObject({
      type: 'html',
      sourceFormat: 'html',
      renderRuntime: 'static-html',
      entryPath: source.path,
      source,
      content,
    });
  });

  it('keeps createHtmlArtifact as a compatibility wrapper', () => {
    const artifact = createHtmlArtifact('function App() { return <main />; }', 0);

    expect(artifact.sourceFormat).toBe('jsx');
    expect(artifact.renderRuntime).toBe('react');
    expect(artifact.entryPath).toBe('App.jsx');
  });
});
