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

// A structural view keeps parser implementation types out of the wire contract.
interface AstNode {
  type: string;
  start: number;
  end: number;
  name?: unknown;
  value?: unknown;
  openingElement?: unknown;
  expression?: unknown;
  children?: unknown;
  attributes?: unknown;
  computed?: unknown;
  shorthand?: unknown;
  properties?: unknown;
  key?: unknown;
  program?: unknown;
  body?: unknown;
  declaration?: unknown;
  id?: unknown;
  kind?: unknown;
  declarations?: unknown;
  init?: unknown;
  argument?: unknown;
  params?: unknown;
  async?: unknown;
  generator?: unknown;
  property?: unknown;
  left?: unknown;
  selfClosing?: unknown;
  object?: unknown;
  callee?: unknown;
  arguments?: unknown;
  elements?: unknown;
  operator?: unknown;
  right?: unknown;
  test?: unknown;
  consequent?: unknown;
  alternate?: unknown;
}
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

function node(value: unknown): AstNode | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const candidate = value as Record<string, unknown>;
  return typeof candidate['type'] === 'string' &&
    typeof candidate['start'] === 'number' &&
    typeof candidate['end'] === 'number'
    ? (value as AstNode)
    : undefined;
}
function children(value: unknown): AstNode[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item: unknown) => {
    const child = node(item);
    return child ? [child] : [];
  });
}
function walk(root: AstNode, visit: (current: AstNode) => void): void {
  visit(root);
  for (const [key, value] of Object.entries(root)) {
    if (
      key === 'loc' ||
      key === 'extra' ||
      key.endsWith('Comments') ||
      key === 'comments' ||
      key === 'tokens'
    )
      continue;
    const child = node(value);
    if (child) walk(child, visit);
    else for (const item of children(value)) walk(item, visit);
  }
}
function nameOf(value: unknown): string | undefined {
  const current = node(value);
  if (current?.type === 'Identifier' || current?.type === 'JSXIdentifier') {
    return typeof current.name === 'string' ? current.name : undefined;
  }
  if (current?.type === 'StringLiteral')
    return typeof current.value === 'string' ? current.value : undefined;
  return undefined;
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
    if (name === 'children')
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

function fieldsFor(element: AstNode): {
  fields: FieldSpan[];
  unsupported: SourceEditUnsupported[];
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
  const only = meaningful.length === 1 ? meaningful[0] : undefined;
  const text =
    only?.type === 'JSXText'
      ? jsxText(String(only.value))
      : only?.type === 'JSXExpressionContainer'
        ? staticString(node(only.expression))
        : undefined;
  if (only && text !== undefined) {
    fields.push({
      operation: { kind: 'set-text', value: text },
      start: only.start,
      end: only.end,
      expressionContainer: true,
    });
  } else
    unsupported.push(
      problem(
        'text',
        'non-static-text',
        'Text requires one direct static text child or string expression.',
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
  return { fields: boundedFields, unsupported };
}

function stateBindings(body: AstNode | undefined): {
  setters: Set<string>;
  values: Set<string>;
  definitions: Set<number>;
} {
  const setters = new Set<string>();
  const values = new Set<string>();
  const definitions = new Set<number>();
  for (const statement of children(body?.body)) {
    if (statement.type !== 'VariableDeclaration' || statement.kind !== 'const') continue;
    for (const binding of children(statement.declarations)) {
      const id = node(binding.id);
      const init = node(binding.init);
      const callee = node(init?.callee);
      const isUseState =
        nameOf(callee) === 'useState' ||
        (callee?.type === 'MemberExpression' &&
          callee.computed !== true &&
          nameOf(callee.object) === 'React' &&
          nameOf(callee.property) === 'useState');
      if (
        id?.type !== 'ArrayPattern' ||
        init?.type !== 'CallExpression' ||
        !isUseState ||
        !Array.isArray(id.elements)
      )
        continue;
      const setter = nameOf(id.elements[1]);
      const value = nameOf(id.elements[0]);
      if (setter) {
        setters.add(setter);
        const declaration = node(id.elements[1]);
        if (declaration) definitions.add(declaration.start);
      }
      if (value) values.add(value);
    }
  }
  return { setters, values, definitions };
}

function pureStateValue(expression: AstNode | undefined, values: Set<string>): boolean {
  if (!expression) return false;
  if (
    ['StringLiteral', 'NumericLiteral', 'BooleanLiteral', 'NullLiteral'].includes(expression.type)
  )
    return true;
  if (expression.type === 'Identifier') return values.has(nameOf(expression) ?? '');
  if (expression.type === 'UnaryExpression')
    return (
      ['!', '+', '-', '~', 'typeof'].includes(String(expression.operator)) &&
      pureStateValue(node(expression.argument), values)
    );
  if (expression.type === 'BinaryExpression' || expression.type === 'LogicalExpression')
    return (
      pureStateValue(node(expression.left), values) &&
      pureStateValue(node(expression.right), values)
    );
  if (expression.type === 'ConditionalExpression')
    return (
      pureStateValue(node(expression.test), values) &&
      pureStateValue(node(expression.consequent), values) &&
      pureStateValue(node(expression.alternate), values)
    );
  if (
    expression.type === 'ArrowFunctionExpression' &&
    expression.async !== true &&
    children(expression.params).every((param) => param.type === 'Identifier')
  ) {
    const locals = new Set(values);
    for (const param of children(expression.params)) locals.add(nameOf(param) ?? '');
    const body = node(expression.body);
    const statements = children(body?.body);
    const returned =
      body?.type === 'BlockStatement' &&
      statements.length === 1 &&
      statements[0]?.type === 'ReturnStatement'
        ? node(statements[0].argument)
        : body;
    return pureStateValue(returned, locals);
  }
  return false;
}

function isStateHandler(attribute: AstNode, bindings: ReturnType<typeof stateBindings>): boolean {
  const value = node(attribute.value);
  const handler = value?.type === 'JSXExpressionContainer' ? node(value.expression) : undefined;
  if (
    !handler ||
    !['ArrowFunctionExpression', 'FunctionExpression'].includes(handler.type) ||
    handler.async === true ||
    handler.generator === true
  )
    return false;
  const params = children(handler.params);
  if (
    params.some(
      (param) =>
        param.type !== 'Identifier' ||
        bindings.setters.has(nameOf(param) ?? '') ||
        bindings.values.has(nameOf(param) ?? ''),
    )
  )
    return false;
  const body = node(handler.body);
  const expressions =
    body?.type === 'BlockStatement'
      ? children(body.body).map((statement) =>
          statement.type === 'ExpressionStatement'
            ? node(statement.expression)
            : statement.type === 'ReturnStatement'
              ? node(statement.argument)
              : undefined,
        )
      : [body];
  return (
    expressions.length > 0 &&
    expressions.every((expression) => {
      if (
        expression?.type !== 'CallExpression' ||
        !bindings.setters.has(nameOf(expression.callee) ?? '')
      )
        return false;
      const args = children(expression.arguments);
      return args.length === 1 && pureStateValue(args[0], bindings.values);
    })
  );
}

function analyze(
  path: string,
  source: string,
  selectionMode: SourceEditSelectionMode = 'preview',
): Analysis | SourceEditRejectedV1 {
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
  const bindings = stateBindings(body);
  const directStateReactReferences = new Set<number>();
  walk(ast, (current) => {
    if (
      current.type === 'MemberExpression' &&
      current.computed !== true &&
      nameOf(current.object) === 'React' &&
      nameOf(current.property) === 'useState'
    ) {
      const object = node(current.object);
      if (object) directStateReactReferences.add(object.start);
    }
  });
  let unsafe: SourceEditRejectedV1 | undefined;
  function flag(reason: string, message: string): void {
    if (
      !unsafe ||
      reason === 'unsafe-source' ||
      (reason === 'cross-file-source' && unsafe.reason !== 'unsafe-source')
    )
      unsafe = reject(reason, message);
  }
  walk(ast, (current) => {
    const declarations =
      current.type === 'VariableDeclarator'
        ? [node(current.id)]
        : current.type === 'FunctionDeclaration' ||
            current.type === 'FunctionExpression' ||
            current.type === 'ArrowFunctionExpression'
          ? [node(current.id), ...children(current.params)]
          : [];
    for (const declaration of declarations) {
      if (!declaration) continue;
      walk(declaration, (binding) => {
        const name = nameOf(binding);
        if (
          binding.type === 'Identifier' &&
          (name === 'React' ||
            name === 'useState' ||
            (bindings.setters.has(name ?? '') && !bindings.definitions.has(binding.start)))
        )
          flag(
            'unsafe-source',
            'Shadowed React hooks or state setters have ambiguous execution ownership.',
          );
      });
    }
    if (
      current.type === 'ImportDeclaration' ||
      current.type === 'ImportExpression' ||
      current.type === 'Import'
    )
      flag(
        'cross-file-source',
        'Imported execution and cross-file ownership are outside this source-definition MVP.',
      );
    if (
      (current.type === 'Identifier' || current.type === 'JSXIdentifier') &&
      current.name === entry.id.name &&
      current.start !== entry.id.start
    )
      flag(
        'reused-entry',
        'A referenced or reused entry cannot establish the direct auto-mounted source boundary.',
      );
    if (
      current.type === 'Identifier' &&
      current.name === 'React' &&
      !directStateReactReferences.has(current.start)
    )
      flag(
        'unsafe-source',
        'Only direct React.useState access is supported; aliased React execution cannot establish the state-only hook boundary.',
      );
    const referencedHook =
      current.type === 'Identifier'
        ? nameOf(current)
        : current.type === 'MemberExpression' || current.type === 'OptionalMemberExpression'
          ? nameOf(current.property)
          : undefined;
    if (referencedHook && /^use[A-Z]/.test(referencedHook) && referencedHook !== 'useState')
      flag(
        'unsafe-source',
        'Only directly owned useState hooks are supported; effect and other hook execution is outside the static editing boundary.',
      );
    if (
      (current.type === 'MemberExpression' || current.type === 'OptionalMemberExpression') &&
      nameOf(current.object) === 'React' &&
      current.computed === true
    )
      flag(
        'unsafe-source',
        'Dynamic or reflective React access cannot establish the supported state-only hook boundary.',
      );
    if (current.type === 'ThisExpression' || current.type === 'MetaProperty')
      flag(
        'unsafe-source',
        'Implicit global or module reflection is outside the static editing boundary.',
      );
    if (
      current.type === 'Identifier' &&
      [
        'document',
        'window',
        'globalThis',
        'self',
        'global',
        'top',
        'parent',
        'frames',
        'ReactDOM',
        'eval',
        'Function',
        'Reflect',
        'Proxy',
        'setTimeout',
        'setInterval',
        'setImmediate',
        'clearTimeout',
        'clearInterval',
        'clearImmediate',
        'queueMicrotask',
        'requestAnimationFrame',
        'cancelAnimationFrame',
        'requestIdleCallback',
        'cancelIdleCallback',
        'scheduler',
        'postMessage',
        'MessageChannel',
        'MessagePort',
        'jQuery',
        '$',
      ].includes(String(current.name))
    )
      flag(
        'unsafe-source',
        'Imperative DOM/global execution is outside the supported ownership boundary.',
      );
    if (
      (current.type === 'MemberExpression' || current.type === 'OptionalMemberExpression') &&
      [
        'innerHTML',
        'outerHTML',
        'textContent',
        'insertAdjacentHTML',
        'appendChild',
        'replaceChildren',
        'createElement',
        'cloneElement',
        'createPortal',
        'getElementById',
        'querySelector',
        'querySelectorAll',
        'setAttribute',
        'removeAttribute',
        'setProperty',
        'constructor',
        '__proto__',
        'defineProperty',
        'defineProperties',
        'setPrototypeOf',
        'assign',
      ].includes(nameOf(current.property) ?? '')
    )
      flag('unsafe-source', 'Imperative element creation or mutation obscures source ownership.');
    if (
      current.type === 'JSXAttribute' &&
      ['ref', 'dangerouslySetInnerHTML'].includes(nameOf(current.name) ?? '')
    )
      flag('unsafe-source', 'Refs and raw HTML may imperatively mutate the rendered definition.');
    if (
      current.type === 'JSXAttribute' &&
      /^on/i.test(nameOf(current.name) ?? '') &&
      !isStateHandler(current, bindings)
    )
      flag(
        'unsafe-source',
        'Only inline handlers calling directly owned state setters with pure values are supported.',
      );
    if (current.type === 'UnaryExpression' && current.operator === 'delete')
      flag('unsafe-source', 'Imperative deletion is outside the static source ownership boundary.');
    if (
      (current.type === 'AssignmentExpression' &&
        node(current.left)?.type === 'MemberExpression') ||
      (current.type === 'UpdateExpression' && node(current.argument)?.type === 'MemberExpression')
    )
      flag('unsafe-source', 'Member mutation is outside the static source ownership boundary.');
  });
  // A source-list selection names an AST definition, not a live DOM node.
  // Opaque execution prevents preview ownership claims but cannot change the
  // exact literal span selected in the current, hash-checked source.
  if (unsafe && selectionMode !== 'source') return unsafe;

  const allowed = new Set<number>();
  const excluded = new Map<number, SourceEditUnsupported>();
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
    if (own) excluded.set(current.start, own);
    else allowed.add(current.start);
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
    const details = allowed.has(current.start)
      ? fieldsFor(current)
      : {
          fields: [],
          unsupported: [
            excluded.get(current.start) ??
              problem(
                'target',
                'non-direct-source',
                'Only direct static App/_App host structure is editable; callbacks, maps, expressions and reused definitions are not.',
              ),
          ],
        };
    targets.push({
      target: {
        id: `${current.start}:${current.end}`,
        tagName,
        start: current.start,
        end: current.end,
        insertionOffset: opening.end - (opening.selfClosing === true ? 2 : 1),
        scope: 'source-definition',
        editableFields: details.fields.map((field) => field.operation),
        unsupported: details.unsupported,
      },
      fields: details.fields,
    });
  });
  return { sourceHash: hash(source), targets };
}

/**
 * MVP support matrix (always source-definition scope, never instance uniqueness):
 * - One auto-mounted App/_App; direct host/fragment structure only.
 * - One static JSXText/string-expression child; existing static title/placeholder/alt.
 * - Existing string/number properties in a directly owned inline style object.
 * - Dynamic/map/custom-component descendants remain annotated, but are not editable.
 * - Pure inline state-setter handlers are supported; opaque/imperative handlers are not.
 * - Imports/exports, non-state hooks, global/DOM/ref mutation, reused entries,
 *   computed/shared styles and executable/customized hosts are unsupported.
 * Explicit source-list mode retains the structural/field constraints but makes
 * no live ownership claim, so opaque execution does not reject the whole file.
 * Source-list results must never be used to instrument a selectable preview.
 * Dynamic children alone do not invalidate a static parent's own layout fields.
 * Scheduling/global rejection bounds this MVP; it is not a general JavaScript safety proof.
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
  return a.kind === 'set-text';
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
