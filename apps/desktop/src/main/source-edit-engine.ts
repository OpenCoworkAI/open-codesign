import { createHash } from 'node:crypto';
import { parse } from '@babel/parser';
import {
  type SourceEditApplyResultV1,
  SourceEditAttributeName,
  type SourceEditInspectResultV1,
  SourceEditOperation,
  type SourceEditPatch,
  type SourceEditRejectedV1,
  type SourceEditScope,
  type SourceEditSelectionMode,
  SourceEditStyleProperty,
  type SourceEditTarget,
  type SourceEditUnsupported,
} from '@open-codesign/shared';
import {
  type AstNode,
  children,
  createTextResolver,
  nameOf,
  node,
  walk,
} from './source-edit-provenance';

interface FieldSpan {
  operation: SourceEditOperation;
  start: number;
  end: number;
  expressionContainer: boolean;
}
interface LocatedTarget {
  target: SourceEditTarget;
  fields: FieldSpan[];
}
interface Analysis {
  sourceHash: string;
  targets: LocatedTarget[];
}

function reject(reason: string, message: string): SourceEditRejectedV1 {
  return { schemaVersion: 1, status: 'rejected', reason, message };
}
function hash(source: string): string {
  return createHash('sha256').update(source, 'utf8').digest('hex');
}
function parseSource(path: string, source: string): AstNode {
  const ast = node(
    parse(source, {
      sourceType: 'module',
      plugins: /\.tsx$/i.test(path) ? ['jsx', 'typescript'] : ['jsx'],
      errorRecovery: false,
    }),
  );
  if (!ast) throw new Error('Parser returned no positioned source tree.');
  return ast;
}
function isHost(element: AstNode): boolean {
  const name = nameOf(node(element.openingElement)?.name);
  return name !== undefined && /^[a-z]/.test(name);
}
function problem(
  field: SourceEditUnsupported['field'],
  reason: string,
  message: string,
): SourceEditUnsupported {
  return { field, reason, message };
}

// Match JSX's line folding (not HTML trim): first/last-line spaces remain significant.
function jsxText(value: string): string {
  const lines = value.split(/\r\n|\n|\r/);
  let lastNonEmpty = 0;
  for (let i = 0; i < lines.length; i += 1) if (/[^ \t]/.test(lines[i] ?? '')) lastNonEmpty = i;
  let result = '';
  for (let i = 0; i < lines.length; i += 1) {
    let line = (lines[i] ?? '').replace(/\t/g, ' ');
    if (i !== 0) line = line.replace(/^ +/, '');
    if (i !== lines.length - 1) line = line.replace(/ +$/, '');
    if (line) result += line + (i !== lastNonEmpty ? ' ' : '');
  }
  return result;
}
function staticString(value: AstNode | undefined): string | undefined {
  if (value?.type === 'StringLiteral' && typeof value.value === 'string') return value.value;
  return undefined;
}
function staticStyle(value: AstNode | undefined): string | undefined {
  if (
    value?.type === 'NumericLiteral' &&
    typeof value.value === 'number' &&
    Number.isFinite(value.value)
  )
    return String(value.value);
  return staticString(value);
}

function openingProblem(opening: AstNode): SourceEditUnsupported | undefined {
  const tag = nameOf(opening.name) ?? '';
  if (
    tag.includes('-') ||
    ['script', 'style', 'iframe', 'object', 'embed', 'base', 'link', 'meta'].includes(tag)
  )
    return problem(
      'target',
      'unsupported-host',
      'Custom elements and executable/raw-content hosts are not editable.',
    );
  const seen = new Set<string>();
  for (const attribute of children(opening.attributes)) {
    const name = nameOf(attribute.name);
    if (attribute.type !== 'JSXAttribute' || !name)
      return problem(
        'target',
        'spread-attributes',
        'Spread or namespaced attributes have ambiguous ownership.',
      );
    if (seen.has(name))
      return problem(
        'target',
        'duplicate-attributes',
        'Duplicate JSX attributes are not editable.',
      );
    seen.add(name);
    if (/^data-(?:codesign|ocd)(?:-|$)/i.test(name))
      return problem(
        'target',
        'reserved-provenance',
        'Reserved preview provenance attributes cannot be authored or edited.',
      );
    if (name === 'children' || name === 'dangerouslySetInnerHTML')
      return problem(
        'target',
        'children-prop',
        'A children prop obscures the direct source children.',
      );
    if (name === 'is' || name === 'contentEditable')
      return problem(
        'target',
        'mutable-host',
        'Customized or user-mutable host content is not a static source boundary.',
      );
  }
  return undefined;
}

function fieldsFor(
  element: AstNode,
  resolveText: ReturnType<typeof createTextResolver>,
): {
  fields: FieldSpan[];
  unsupported: SourceEditUnsupported[];
  directText?: string;
  textSources: NonNullable<SourceEditTarget['textSources']>;
  textLayout: NonNullable<SourceEditTarget['textLayout']>;
} {
  const fields: FieldSpan[] = [];
  const unsupported: SourceEditUnsupported[] = [];
  const meaningful = children(element.children).filter((child) => {
    if (child.type === 'JSXText') return jsxText(String(child.value)).length !== 0;
    return !(
      child.type === 'JSXExpressionContainer' &&
      node(child.expression)?.type === 'JSXEmptyExpression'
    );
  });
  const textSources: NonNullable<SourceEditTarget['textSources']> = [];
  const textLayout: NonNullable<SourceEditTarget['textLayout']> = [];
  let directText: string | undefined = '';
  for (const child of meaningful) {
    if (child.type === 'JSXElement' || child.type === 'JSXFragment') {
      textLayout.push(
        child.type === 'JSXElement' && isHost(child)
          ? { kind: 'element', targetId: `${child.start}:${child.end}` }
          : { kind: 'dynamic' },
      );
      continue;
    }
    const expression = child.type === 'JSXExpressionContainer' ? node(child.expression) : undefined;
    const resolved = expression ? resolveText(expression) : undefined;
    const text = child.type === 'JSXText' ? jsxText(String(child.value)) : resolved?.value;
    if (text === undefined) {
      textLayout.push({ kind: 'dynamic' });
      directText = undefined;
      unsupported.push(
        problem(
          'text',
          'unresolved-text-source',
          'This text is computed, mutable, or supplied by a map/component parameter. Its literal source cannot be determined; edit the source manually.',
        ),
      );
      continue;
    }
    if (directText !== undefined) directText += text;
    const indirect = expression?.type !== 'StringLiteral' && child.type !== 'JSXText';
    const textId = meaningful.length === 1 && !indirect ? undefined : `${child.start}:${child.end}`;
    const start = indirect && resolved ? resolved.start : child.start;
    const end = indirect && resolved ? resolved.end : child.end;
    textLayout.push(
      text.length <= 100_000
        ? { kind: 'text', value: text, ...(textId ? { textId } : {}) }
        : { kind: 'dynamic' },
    );
    fields.push({
      operation: { kind: 'set-text', value: text, ...(textId ? { textId } : {}) },
      start,
      end,
      expressionContainer: !indirect,
    });
    textSources.push({
      ...(textId ? { textId } : {}),
      start,
      end,
      origin:
        indirect && resolved
          ? resolved.origin
          : 'JSX text definition (all uses of this definition)',
    });
  }
  if (!fields.length && !unsupported.length)
    unsupported.push(
      problem(
        'text',
        'non-static-text',
        'This element has no directly owned text. Select its text-bearing child.',
      ),
    );

  const opening = node(element.openingElement);
  let attributeCount = 0;
  let styleFound = false;
  for (const attribute of children(opening?.attributes)) {
    const name = nameOf(attribute.name);
    const value = node(attribute.value);
    const attributeName = SourceEditAttributeName.safeParse(name);
    if (attributeName.success) {
      const textValue =
        value?.type === 'JSXExpressionContainer'
          ? staticString(node(value.expression))
          : staticString(value)?.replace(/\n\s+/g, ' ');
      if (value && textValue !== undefined) {
        fields.push({
          operation: { kind: 'set-attribute', name: attributeName.data, value: textValue },
          start: value.start,
          end: value.end,
          expressionContainer: true,
        });
        attributeCount += 1;
      } else
        unsupported.push(
          problem('attributes', 'dynamic-attribute', `${name} is not a static string attribute.`),
        );
    }
    if (name !== 'style') continue;
    styleFound = true;
    const object = value?.type === 'JSXExpressionContainer' ? node(value.expression) : undefined;
    if (object?.type !== 'ObjectExpression') {
      unsupported.push(
        problem(
          'style',
          'shared-or-dynamic-style',
          'Style must be a directly owned inline object, not a variable or expression.',
        ),
      );
      continue;
    }
    const properties = children(object.properties);
    const seen = new Set<string>();
    let ambiguous = false;
    for (const property of properties) {
      const key = nameOf(property.key);
      if (
        property.type !== 'ObjectProperty' ||
        property.computed === true ||
        property.shorthand === true ||
        key === undefined ||
        seen.has(key)
      )
        ambiguous = true;
      if (key !== undefined) seen.add(key);
    }
    if (ambiguous) {
      unsupported.push(
        problem(
          'style',
          'ambiguous-style',
          'Style spreads, duplicate/computed keys, methods and shorthand are not editable.',
        ),
      );
      continue;
    }
    let styleCount = 0;
    for (const property of properties) {
      const key = SourceEditStyleProperty.safeParse(nameOf(property.key));
      if (!key.success) continue;
      const literal = node(property.value);
      const styleValue = staticStyle(literal);
      if (literal && styleValue !== undefined) {
        fields.push({
          operation: { kind: 'set-style', property: key.data, value: styleValue },
          start: literal.start,
          end: literal.end,
          expressionContainer: false,
        });
        styleCount += 1;
      } else
        unsupported.push(
          problem('style', 'dynamic-style-value', `${key.data} is not a static string or number.`),
        );
    }
    if (styleCount === 0)
      unsupported.push(
        problem(
          'style',
          'no-static-style',
          'No existing static allowlisted inline style property.',
        ),
      );
  }
  if (attributeCount === 0)
    unsupported.push(
      problem(
        'attributes',
        'no-static-attribute',
        'Only existing static title, placeholder and alt attributes are supported.',
      ),
    );
  if (!styleFound)
    unsupported.push(
      problem(
        'style',
        'no-inline-style',
        'Only existing properties of a direct inline style object are supported.',
      ),
    );
  const boundedFields = fields.filter((field) => {
    if (SourceEditOperation.safeParse(field.operation).success) return true;
    const category =
      field.operation.kind === 'set-text'
        ? 'text'
        : field.operation.kind === 'set-style'
          ? 'style'
          : 'attributes';
    unsupported.push(
      problem(
        category,
        'literal-too-large',
        'This literal exceeds the supported edit payload limit.',
      ),
    );
    return false;
  });
  return {
    fields: boundedFields,
    unsupported,
    textSources: textSources.filter((origin) =>
      boundedFields.some(
        (field) => field.operation.kind === 'set-text' && field.operation.textId === origin.textId,
      ),
    ),
    textLayout,
    ...(directText !== undefined ? { directText } : {}),
  };
}

function analyze(
  path: string,
  source: string,
  selectionMode: SourceEditSelectionMode = 'preview',
): Analysis | SourceEditRejectedV1 {
  if (selectionMode === 'source')
    return reject(
      'source-mode-removed',
      'Source-list editing has been removed. Select the element in the current preview.',
    );
  if (!/\.(jsx|tsx)$/i.test(path))
    return reject('unsupported-path', 'Source editing requires a real JSX or TSX file.');
  let ast: AstNode;
  try {
    ast = parseSource(path, source);
  } catch {
    return reject('parse-error', 'Source could not be parsed as JSX/TSX.');
  }
  const program = node(ast.program);
  if (!program) return reject('parse-error', 'No source program.');
  // The current preview compiles React into a script, not an ES module loader.
  if (
    children(program.body).some((statement) =>
      /^(?:Import|Export|TSImport|TSExport|TSNamespaceExport)/.test(statement.type),
    )
  ) {
    return reject(
      'unsupported-module',
      'Import/export module syntax is not supported by the current App/_App script preview runtime.',
    );
  }
  const entries: { fn: AstNode; id: AstNode }[] = [];
  for (const statement of children(program.body)) {
    const declaration = statement;
    const id = node(declaration.id);
    if (
      declaration.type === 'FunctionDeclaration' &&
      id &&
      ['App', '_App'].includes(nameOf(id) ?? '')
    )
      entries.push({ fn: declaration, id });
    if (
      declaration.type === 'VariableDeclaration' &&
      (declaration.kind === 'const' || declaration.kind === 'let')
    ) {
      for (const binding of children(declaration.declarations)) {
        const bindingId = node(binding.id);
        const init = node(binding.init);
        if (
          bindingId &&
          ['App', '_App'].includes(nameOf(bindingId) ?? '') &&
          init &&
          ['ArrowFunctionExpression', 'FunctionExpression'].includes(init.type)
        )
          entries.push({ fn: init, id: bindingId });
      }
    }
  }
  if (entries.length !== 1)
    return reject(
      'unsupported-entry',
      'Exactly one directly declared App or _App function is required by the existing preview entry contract.',
    );
  const entry = entries[0];
  if (!entry) return reject('unsupported-entry', 'No entry.');
  const body = node(entry.fn.body);
  let root = body;
  if (body?.type === 'BlockStatement') {
    const returns = children(body.body).filter((statement) => statement.type === 'ReturnStatement');
    root = returns.length === 1 ? node(returns[0]?.argument) : undefined;
    // Nested callback returns are harmless to the static root; control-flow returns are not.
    if (
      returns.length !== 1 ||
      children(body.body).some(
        (statement) =>
          ![
            'VariableDeclaration',
            'ReturnStatement',
            'ExpressionStatement',
            'FunctionDeclaration',
            'TSTypeAliasDeclaration',
            'TSInterfaceDeclaration',
          ].includes(statement.type),
      )
    )
      root = undefined;
  }
  if (
    !root ||
    !['JSXElement', 'JSXFragment'].includes(root.type) ||
    children(entry.fn.params).length > 0 ||
    entry.fn.async === true ||
    entry.fn.generator === true
  ) {
    return reject(
      'unsupported-entry',
      'App/_App must directly return a static JSX structure without props forwarding or conditional entry returns.',
    );
  }
  // Candidates identify source definitions. The preview independently checks
  // the selected DOM instance; opaque execution elsewhere does not remove fields.
  const resolveText = createTextResolver(ast);
  const parents = new Map<AstNode, AstNode>();
  walk(ast, (current) => {
    for (const value of Object.values(current)) {
      const child = node(value);
      if (child) parents.set(child, current);
      else for (const item of children(value)) parents.set(item, current);
    }
  });
  function textBoundary(current: AstNode): SourceEditUnsupported | undefined {
    let ancestor: AstNode | undefined = current;
    const visited = new Set<AstNode>();
    while (ancestor && !visited.has(ancestor)) {
      visited.add(ancestor);
      if (ancestor.type === 'JSXElement') {
        const opening = node(ancestor.openingElement);
        if (!isHost(ancestor))
          return problem(
            'target',
            'custom-component-ancestor',
            'Forwarded children may be transformed by a component. Select a directly owned text definition instead.',
          );
        if (opening) {
          const issue = openingProblem(opening);
          if (issue) return issue;
        }
      }
      ancestor = parents.get(ancestor);
    }
    return undefined;
  }

  const allowed = new Set<number>();
  function mark(current: AstNode, inherited?: SourceEditUnsupported): void {
    if (current.type === 'JSXFragment') {
      for (const child of children(current.children))
        if (child.type === 'JSXElement' || child.type === 'JSXFragment') mark(child, inherited);
      return;
    }
    if (current.type !== 'JSXElement') return;
    const opening = node(current.openingElement);
    const own =
      inherited ??
      (!isHost(current)
        ? problem(
            'target',
            'custom-component-ancestor',
            'Custom components may reuse, forward or transform their children.',
          )
        : opening
          ? openingProblem(opening)
          : undefined);
    if (!own) allowed.add(current.start);
    for (const child of children(current.children))
      if (child.type === 'JSXElement' || child.type === 'JSXFragment') mark(child, own);
  }
  mark(root);
  const targets: LocatedTarget[] = [];
  walk(ast, (current) => {
    if (current.type !== 'JSXElement' || !isHost(current)) return;
    const opening = node(current.openingElement);
    const tagName = nameOf(opening?.name);
    if (!opening || !tagName) return;
    const boundary = textBoundary(current);
    const details = fieldsFor(current, resolveText);
    const layoutAllowed = allowed.has(current.start);
    if (boundary) {
      details.fields = [];
      details.textSources = [];
      details.textLayout = details.textLayout.map((part) =>
        part.kind === 'text' ? { kind: 'dynamic' } : part,
      );
      details.unsupported = [boundary];
    } else {
      details.fields = details.fields.filter(
        (field) => field.operation.kind === 'set-text' || layoutAllowed,
      );
      if (!layoutAllowed)
        details.unsupported.push(
          problem(
            'target',
            'text-definition-only',
            'Only traced text definitions are editable here. Layout/attribute ownership cannot be established. Shared definitions change every use, not just the clicked instance.',
          ),
        );
    }
    targets.push({
      target: {
        id: `${current.start}:${current.end}`,
        tagName,
        start: current.start,
        end: current.end,
        insertionOffset: opening.end - (opening.selfClosing === true ? 2 : 1),
        scope: 'source-definition',
        editableFields: details.fields.map((field) => field.operation),
        ...(details.directText !== undefined ? { directText: details.directText } : {}),
        textSources: details.textSources,
        textLayout: details.textLayout,
        unsupported: details.unsupported,
      },
      fields: details.fields,
    });
  });
  if (
    targets.length > 10_000 ||
    targets.some(({ target }) => (target.textLayout?.length ?? 0) > 10_000)
  )
    return reject(
      'unsupported-targets',
      'This source exceeds the supported preview target or text-layout limit.',
    );
  return { sourceHash: hash(source), targets };
}

/**
 * Candidates identify exact source definitions, never private DOM instances.
 * Indirect fields need lexical literal provenance; ordered child layouts let the
 * preview verify individual static segments beside dynamic content. Existing
 * attribute/style literals retain direct native App ownership. No source executes
 * here, and legacy source-list mode is refused rather than providing a bypass.
 */
export function analyzeSourceEdit(input: {
  path: string;
  source: string;
  selectionMode?: SourceEditSelectionMode | undefined;
}): SourceEditInspectResultV1 {
  const result = analyze(input.path, input.source, input.selectionMode);
  if ('status' in result) return result;
  return {
    schemaVersion: 1,
    status: 'ready',
    path: input.path,
    sourceHash: result.sourceHash,
    targets: result.targets.map(({ target }) => target),
  };
}

function sameField(a: SourceEditOperation, b: SourceEditOperation): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'set-attribute' && b.kind === 'set-attribute') return a.name === b.name;
  if (a.kind === 'set-style' && b.kind === 'set-style') return a.property === b.property;
  return a.kind === 'set-text' && b.kind === 'set-text' && a.textId === b.textId;
}
function quote(value: string): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}
// The existing preview still scans raw source for these controls, even in strings.
function runtimeReservedValue(value: string): boolean {
  if (value.includes('ReactDOM.createRoot')) return true;
  if (
    [
      '<!-- AGENT_BODY_BEGIN -->',
      '<!-- AGENT_BODY_END -->',
      '<!-- CODESIGN_OVERLAY_SCRIPT -->',
      '<!-- CODESIGN_JSX_RUNTIME -->',
      '<!-- CODESIGN_STANDALONE_RUNTIME -->',
      '<!-- OPEN-CODESIGN-PREVIEW-VIEWPORT -->',
    ].some((marker) => value.includes(marker))
  )
    return true;
  if (/\/\*\s*(?:EDITMODE|TWEAK-SCHEMA)-(?:BEGIN|END)\s*\*\//.test(value)) return true;
  if (/(?:^|[^A-Za-z0-9_$])(?:function|const|let)\s+(?:App|_App)(?=$|[^A-Za-z0-9_$])/.test(value))
    return true;
  for (const match of value.matchAll(/\/\*([\s\S]*?)\*\//g)) {
    const marker = match[1]?.replace(/\s/g, '');
    if (/^(?:EDITMODE|TWEAK-SCHEMA)-(?:BEGIN|END)$/.test(marker ?? '')) return true;
  }
  return false;
}

function validStyle(property: string, value: string): boolean {
  if (value !== value.trim() || !value || /[\\;{}<>]|(?:url|expression|var)\s*\(/i.test(value))
    return false;
  if (property === 'color' || property === 'backgroundColor') {
    return /^(?:#[\da-f]{3,4}|#[\da-f]{6}|#[\da-f]{8}|[a-z]+|(?:rgb|rgba|hsl|hsla)\([\d\s.,%/+-]+\))$/i.test(
      value,
    );
  }
  if (property === 'maxWidth' && value === 'none') return true;
  const parts = value.split(/ +/);
  const max =
    property === 'padding' || property === 'borderRadius' ? 4 : property === 'gap' ? 2 : 1;
  return (
    parts.length <= max &&
    parts.every(
      (part) =>
        /^(?:\d+(?:\.\d+)?|\.\d+)(?:px|em|rem|%|vh|vw|vmin|vmax|ch|ex)?$/.test(part) &&
        Number.isFinite(Number.parseFloat(part)),
    )
  );
}

export function planSourceEdit(input: {
  path: string;
  source: string;
  expectedSourceHash: string;
  targetId: string;
  operation: SourceEditOperation;
  scope: SourceEditScope;
  selectionMode?: SourceEditSelectionMode | undefined;
}): SourceEditApplyResultV1 {
  if (input.selectionMode === 'source')
    return reject(
      'source-mode-removed',
      'Source-list editing has been removed. Select the element in the current preview.',
    );
  if (input.scope !== 'source-definition')
    return reject(
      'invalid-scope',
      'Only source-definition editing is supported, not an arbitrary selected instance.',
    );
  const operation = SourceEditOperation.safeParse(input.operation);
  if (!operation.success)
    return reject('invalid-operation', 'Only allowlisted literal operations are supported.');
  if (hash(input.source) !== input.expectedSourceHash)
    return reject('stale-source', 'The source changed; inspect the current file before editing.');
  const analysis = analyze(input.path, input.source, input.selectionMode);
  if ('status' in analysis) return analysis;
  const located = analysis.targets.find(({ target }) => target.id === input.targetId);
  if (!located)
    return reject(
      'invalid-target',
      'The target does not identify an original JSX host definition in the current source.',
    );
  const field = located.fields.find((candidate) => sameField(candidate.operation, operation.data));
  if (!field)
    return reject(
      'unsupported-field',
      located.target.unsupported[0]?.message ?? 'This static field is not editable.',
    );
  if (
    operation.data.kind === 'set-style' &&
    !validStyle(operation.data.property, operation.data.value)
  )
    return reject(
      'invalid-style',
      'Use a literal color or nonnegative CSS size; URLs, expressions, variables and arbitrary CSS are unsupported.',
    );
  const value = operation.data.value;
  if (runtimeReservedValue(value))
    return reject(
      'runtime-reserved-value',
      'This value contains preview runtime control text (mount, document/tweak marker or App/_App declaration) that cannot yet be safely edited as a literal.',
    );
  const literal =
    operation.data.kind === 'set-style' && /^(?:\d+(?:\.\d+)?|\.\d+)$/.test(value)
      ? String(Number(value))
      : quote(value);
  const patch: SourceEditPatch = {
    start: field.start,
    end: field.end,
    expectedText: input.source.slice(field.start, field.end),
    replacement: field.expressionContainer ? `{${literal}}` : literal,
  };
  const content =
    input.source.slice(0, patch.start) + patch.replacement + input.source.slice(patch.end);
  try {
    parseSource(input.path, content);
  } catch {
    return reject('reparse-failed', 'The patched source failed parsing; no content was applied.');
  }
  return {
    schemaVersion: 1,
    status: 'applied',
    path: input.path,
    content,
    sourceHash: hash(content),
    patch,
    scope: 'source-definition',
  };
}
