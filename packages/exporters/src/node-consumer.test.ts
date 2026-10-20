import { resolve } from 'node:path';
import ts from 'typescript';
import { expect, it } from 'vitest';

it('preserves missing-DOM diagnostics for Node-only consumers of exporters', () => {
  const consumerPath = resolve('src/__node_export_consumer__.ts');
  const source = ts.createSourceFile(
    consumerPath,
    "import { exportPptx } from './pptx'; void exportPptx; document.createElement('div'); window.scrollTo(0, 0);",
    ts.ScriptTarget.ES2023,
    true,
  );
  const options: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2023,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    lib: ['lib.es2023.d.ts'],
    types: ['node'],
    strict: true,
    skipLibCheck: true,
    noEmit: true,
  };
  const host = ts.createCompilerHost(options);
  const readSource = host.getSourceFile.bind(host);
  host.getSourceFile = (fileName, ...args) =>
    resolve(fileName) === consumerPath ? source : readSource(fileName, ...args);
  const program = ts.createProgram([consumerPath], options, host);
  expect(
    program
      .getSemanticDiagnostics(source)
      .map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')),
  ).toEqual([
    expect.stringContaining("Cannot find name 'document'"),
    expect.stringContaining("Cannot find name 'window'"),
  ]);
}, 30_000);
