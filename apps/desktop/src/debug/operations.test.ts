import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { validateDebugOperation } from './operation-client';
import { DEBUG_OPERATIONS, findDebugOperation } from './operations';

const preloadPath = resolve(import.meta.dirname, '../preload/index.ts');

interface PreloadOperation {
  kind: 'call' | 'event';
  channel: string;
  parameters: { name: string; type: string; required: boolean }[];
}

const STRING_ALIASES = new Set(['StorageKind', 'PreviewMode']);

function typeSummary(source: string): string {
  const type = source.replace(/\s+/g, ' ').trim();
  if (type === 'inferred') return 'string';
  if (STRING_ALIASES.has(type)) return 'string';
  if (/^\{/.test(type) || /^(Record|Partial|Pick|Omit)<|^[A-Z]/.test(type)) return 'object';
  if (type.endsWith('[]') || type.startsWith('Array<')) return 'array';
  if (/^string( \| null)?$/.test(type)) return type;
  if (/^number( \| null)?$/.test(type)) return type;
  if (type === 'boolean') return type;
  if (type === 'unknown') return type;
  return 'object';
}

function readPreloadOperations(): Map<string, PreloadOperation> {
  const source = readFileSync(preloadPath, 'utf8');
  const file = ts.createSourceFile(preloadPath, source, ts.ScriptTarget.Latest, true);
  const api = file.statements
    .filter(ts.isVariableStatement)
    .flatMap((statement) => [...statement.declarationList.declarations])
    .find((declaration) => declaration.name.getText(file) === 'api')?.initializer;
  if (!api || !ts.isObjectLiteralExpression(api)) throw new Error('Preload API object missing');

  const result = new Map<string, PreloadOperation>();
  const visitObject = (object: ts.ObjectLiteralExpression, prefix = '') => {
    for (const property of object.properties) {
      if (!ts.isPropertyAssignment(property)) continue;
      const name =
        ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)
          ? property.name.text
          : undefined;
      if (!name) continue;
      const path = prefix ? `${prefix}.${name}` : name;
      if (ts.isObjectLiteralExpression(property.initializer)) {
        visitObject(property.initializer, path);
        continue;
      }
      let found: { kind: 'call' | 'event'; channel: string } | undefined;
      const visit = (node: ts.Node) => {
        if (
          ts.isCallExpression(node) &&
          ts.isPropertyAccessExpression(node.expression) &&
          node.expression.expression.getText(file) === 'ipcRenderer' &&
          ['invoke', 'send', 'on', 'once'].includes(node.expression.name.text)
        ) {
          const channel = node.arguments[0];
          if (channel && ts.isStringLiteral(channel)) {
            found = {
              kind:
                node.expression.name.text === 'on' || node.expression.name.text === 'once'
                  ? 'event'
                  : 'call',
              channel: channel.text,
            };
          }
        }
        ts.forEachChild(node, visit);
      };
      visit(property.initializer);
      if (found) {
        const parameters =
          ts.isArrowFunction(property.initializer) || ts.isFunctionExpression(property.initializer)
            ? property.initializer.parameters
                .filter(
                  (parameter) =>
                    !(
                      found?.kind === 'event' &&
                      /^(?:cb|callback|listener)$/i.test(parameter.name.getText(file))
                    ),
                )
                .map((parameter) => {
                  const name = parameter.name.getText(file);
                  const type =
                    parameter.type?.getText(file) ??
                    (parameter.initializer ? 'inferred' : 'unknown');
                  const summary = typeSummary(type);
                  const definition = type
                    .replace(/\/\*[\s\S]*?\*\//g, '')
                    .replace(/\s+/g, ' ')
                    .trim();
                  return {
                    name: name === '_input' ? 'input' : name,
                    type: summary,
                    required: !parameter.questionToken && !parameter.initializer,
                    ...(['object', 'array', 'unknown'].includes(summary) || STRING_ALIASES.has(type)
                      ? { definition }
                      : {}),
                  };
                })
            : [];
        result.set(path, { ...found, parameters });
      }
    }
  };
  visitObject(api);
  return result;
}

describe('core background debug operations', () => {
  it('matches the selected real preload methods without requiring full API coverage', () => {
    const preload = readPreloadOperations();
    for (const operation of DEBUG_OPERATIONS) {
      if (operation.name.startsWith('test.')) continue;
      expect(preload.get(operation.name), operation.name).toEqual({
        kind: operation.kind,
        channel: operation.channel,
        parameters: operation.parameters,
      });
    }
    expect(new Set(DEBUG_OPERATIONS.map((item) => item.name)).size).toBe(DEBUG_OPERATIONS.length);
  });

  it('excludes peripheral features and rejects attempts to call them', () => {
    for (const name of [
      'doneVerify',
      'files.preview',
      'files.list',
      'snapshots.getDesign',
      'chat.list',
      'generationStatus',
      'config.importCodexConfig',
      'settings.addProvider',
      'preferences.update',
      'memory.updateUser',
      'comments.add',
      'diagnostics.exportDiagnostics',
      'snapshots.renameDesign',
      'snapshots.duplicateDesign',
      'test.files.write',
      'test.clipboard.read',
      'test.dialog.enqueue',
      'constructor',
      '__proto__',
    ]) {
      expect(findDebugOperation(name), name).toBeUndefined();
      expect(() => validateDebugOperation(name, [], 'live')).toThrow('Unknown debug operation');
    }
  });

  it('gates generation while keeping the file workflow available', () => {
    expect(() => validateDebugOperation('generate', [{}])).toThrow('Select fixture or live');
    expect(() => validateDebugOperation('generate', [{}], 'fixture')).not.toThrow();
    expect(() =>
      validateDebugOperation('files.write', ['design', 'App.jsx', 'source']),
    ).not.toThrow();
    expect(findDebugOperation('test.exportDestination')?.channel).toBe('codesign:debug:operation');
  });
});
