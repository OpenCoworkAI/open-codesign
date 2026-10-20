// Structural parser views avoid coupling source editing to Babel's implementation types.
export interface AstNode {
  type: string;
  start: number;
  end: number;
  name?: unknown;
  value?: unknown;
  property?: unknown;
  key?: unknown;
  computed?: unknown;
  object?: unknown;
  left?: unknown;
  argument?: unknown;
  elements?: unknown;
  properties?: unknown;
  id?: unknown;
  params?: unknown;
  param?: unknown;
  specifiers?: unknown;
  local?: unknown;
  kind?: unknown;
  declarations?: unknown;
  init?: unknown;
  callee?: unknown;
  optional?: unknown;
  method?: unknown;
  operator?: unknown;
  body?: unknown;
  extra?: unknown;
  expression?: unknown;
  openingElement?: unknown;
  children?: unknown;
  attributes?: unknown;
  shorthand?: unknown;
  program?: unknown;
  declaration?: unknown;
  async?: unknown;
  generator?: unknown;
  right?: unknown;
  test?: unknown;
  consequent?: unknown;
  alternate?: unknown;
  selfClosing?: unknown;
  arguments?: unknown;
  parameter?: unknown;
  [key: string]: unknown;
}

export interface TextProvenance {
  start: number;
  end: number;
  value: string;
  /** A shared source definition, not a guarantee of one rendered instance. */
  origin: string;
}

export function node(value: unknown): AstNode | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const candidate = value as Record<string, unknown>;
  return typeof candidate['type'] === 'string' &&
    typeof candidate['start'] === 'number' &&
    typeof candidate['end'] === 'number' &&
    Number.isInteger(candidate['start']) &&
    Number.isInteger(candidate['end']) &&
    candidate['start'] >= 0 &&
    candidate['end'] >= candidate['start']
    ? (value as AstNode)
    : undefined;
}

export function children(value: unknown): AstNode[] {
  return Array.isArray(value)
    ? value.flatMap((item: unknown) => {
        const child = node(item);
        return child ? [child] : [];
      })
    : [];
}

export function nameOf(value: unknown): string | undefined {
  const current = node(value);
  if (current?.type === 'Identifier' || current?.type === 'JSXIdentifier') {
    return typeof current.name === 'string' ? current.name : undefined;
  }
  return current?.type === 'StringLiteral' && typeof current.value === 'string'
    ? current.value
    : undefined;
}

function edges(current: AstNode): { child: AstNode; key: string }[] {
  return Object.entries(current).flatMap(([key, value]) => {
    if (
      key === 'loc' ||
      key === 'extra' ||
      key === 'tokens' ||
      key === 'comments' ||
      key.endsWith('Comments')
    )
      return [];
    const child = node(value);
    return (child ? [child] : children(value)).map((item) => ({ child: item, key }));
  });
}

export function walk(root: AstNode, visit: (current: AstNode) => void): void {
  const seen = new Set<AstNode>();
  function visitNode(current: AstNode): void {
    if (seen.has(current)) return;
    seen.add(current);
    visit(current);
    for (const { child } of edges(current)) visitNode(child);
  }
  visitNode(root);
}

interface Scope {
  parent?: Scope;
  functionScope: boolean;
  bindings: Map<string, Binding>;
}
interface Binding {
  name: string;
  scope: Scope;
  init: AstNode | undefined;
  immutable: boolean;
  written: boolean;
}
interface Parent {
  node: AstNode;
  key: string;
}
interface StaticValue {
  source: AstNode;
  fields?: Map<string, Resolved>;
  neighbors: Set<StaticValue>;
}
interface Resolved {
  value: StaticValue;
  trace: string[];
  owners: Set<StaticValue>;
}

function isFunction(current: AstNode): boolean {
  return [
    'FunctionDeclaration',
    'FunctionExpression',
    'ArrowFunctionExpression',
    'ObjectMethod',
    'ClassMethod',
    'ClassPrivateMethod',
    'TSDeclareFunction',
  ].includes(current.type);
}

function patternNames(pattern: AstNode | undefined): AstNode[] {
  if (!pattern) return [];
  switch (pattern.type) {
    case 'Identifier':
      return [pattern];
    case 'AssignmentPattern':
      return patternNames(node(pattern.left));
    case 'RestElement':
      return patternNames(node(pattern.argument));
    case 'TSParameterProperty':
      return patternNames(node(pattern.parameter));
    case 'TSAsExpression':
    case 'TSTypeAssertion':
    case 'TSNonNullExpression':
    case 'ParenthesizedExpression':
      return patternNames(node(pattern.expression));
    case 'ArrayPattern':
      return children(pattern.elements).flatMap(patternNames);
    case 'ObjectPattern':
      return children(pattern.properties).flatMap((property) =>
        patternNames(node(property.type === 'RestElement' ? property.argument : property.value)),
      );
    default:
      return [];
  }
}

function staticKey(current: AstNode, member: boolean): string | undefined {
  const key = node(member ? current.property : current.key);
  if (!key) return undefined;
  if (!current.computed && key.type === 'Identifier') return nameOf(key);
  if (key.type === 'StringLiteral' && typeof key.value === 'string') return key.value;
  if (key.type === 'NumericLiteral' && typeof key.value === 'number' && Number.isFinite(key.value))
    return String(key.value);
  return undefined;
}

function label(current: AstNode): string {
  if (current.type === 'Identifier') return nameOf(current) ?? 'binding';
  if (current.type === 'MemberExpression') {
    const object = node(current.object);
    const key = staticKey(current, true);
    if (object && key !== undefined)
      return `${label(object)}${current.computed ? `[${JSON.stringify(key)}]` : `.${key}`}`;
  }
  return current.type === 'ArrayExpression' ? 'array literal' : 'object literal';
}

/**
 * Resolve only strings whose complete lexical provenance is statically known.
 * Pass nodes from this same AST; spans include the literal's quote delimiters.
 * Container escape/mutation checks are whole-tree and intentionally conservative.
 */
export function createTextResolver(
  ast: unknown,
): (expression: unknown) => TextProvenance | undefined {
  const root = node(ast);
  if (!root) return () => undefined;
  const scopes = new Map<AstNode, Scope>();
  const parents = new Map<AstNode, Parent>();
  const declarations = new Set<AstNode>();
  const all: AstNode[] = [];
  let dynamicScope = false;
  const top: Scope = { functionScope: true, bindings: new Map() };

  function declare(
    scope: Scope,
    pattern: AstNode | undefined,
    declaration: AstNode,
    init?: AstNode,
  ) {
    for (const identifier of patternNames(pattern)) {
      const name = nameOf(identifier);
      if (!name) continue;
      declarations.add(identifier);
      const existing = scope.bindings.get(name);
      if (existing) {
        existing.immutable = false;
        continue;
      }
      scope.bindings.set(name, {
        name,
        scope,
        init,
        immutable:
          declaration.type === 'VariableDeclarator' && pattern?.type === 'Identifier' && !!init,
        written: false,
      });
    }
  }

  function index(current: AstNode, inherited: Scope): void {
    if (scopes.has(current)) return;
    let scope = inherited;
    if (
      current.type === 'FunctionDeclaration' ||
      current.type === 'ClassDeclaration' ||
      current.type === 'TSDeclareFunction' ||
      current.type === 'TSEnumDeclaration' ||
      current.type === 'TSModuleDeclaration' ||
      current.type === 'TSImportEqualsDeclaration'
    )
      declare(inherited, node(current.id), current);
    if (
      isFunction(current) ||
      [
        'Program',
        'BlockStatement',
        'CatchClause',
        'ForStatement',
        'ForInStatement',
        'ForOfStatement',
        'SwitchStatement',
        'ClassDeclaration',
        'ClassExpression',
        'StaticBlock',
        'TSModuleBlock',
      ].includes(current.type)
    ) {
      scope = {
        parent: inherited,
        functionScope:
          isFunction(current) || current.type === 'Program' || current.type === 'StaticBlock',
        bindings: new Map(),
      };
    }
    scopes.set(current, scope);
    all.push(current);
    if (isFunction(current)) {
      declare(scope, node(current.id), current);
      for (const param of children(current.params)) declare(scope, param, current);
    }
    if (current.type === 'ClassExpression' || current.type === 'ClassDeclaration')
      declare(scope, node(current.id), current);
    if (current.type === 'CatchClause') declare(scope, node(current.param), current);
    if (current.type === 'ImportDeclaration') {
      for (const specifier of children(current.specifiers))
        declare(scope, node(specifier.local), specifier);
    }
    if (current.type === 'VariableDeclaration') {
      let target = scope;
      if (current.kind === 'var') {
        while (!target.functionScope && target.parent) target = target.parent;
      }
      for (const declaration of children(current.declarations)) {
        declare(target, node(declaration.id), declaration, node(declaration.init));
        if (current.kind !== 'const') {
          for (const identifier of patternNames(node(declaration.id))) {
            const binding = target.bindings.get(nameOf(identifier) ?? '');
            if (binding) binding.immutable = false;
          }
        }
      }
    }
    if (
      current.type === 'WithStatement' ||
      (current.type === 'Identifier' && nameOf(current) === 'eval')
    )
      dynamicScope = true;
    for (const { child, key } of edges(current)) {
      parents.set(child, { node: current, key });
      index(child, scope);
    }
  }
  index(root, top);

  function bindingOf(identifier: AstNode): Binding | undefined {
    const name = nameOf(identifier);
    if (!name) return undefined;
    let scope = scopes.get(identifier);
    while (scope) {
      const binding = scope.bindings.get(name);
      if (binding) return binding;
      scope = scope.parent;
    }
    return undefined;
  }
  for (const current of all) {
    const target =
      current.type === 'AssignmentExpression' ||
      current.type === 'ForInStatement' ||
      current.type === 'ForOfStatement'
        ? node(current.left)
        : current.type === 'UpdateExpression'
          ? node(current.argument)
          : undefined;
    for (const identifier of patternNames(target)) {
      const binding = bindingOf(identifier);
      if (binding) binding.written = true;
    }
  }

  const cache = new Map<AstNode, Resolved | undefined>();
  const resolving = new Set<AstNode>();
  function resolve(current: AstNode | undefined): Resolved | undefined {
    if (!current || !scopes.has(current)) return undefined;
    if (cache.has(current)) return cache.get(current);
    if (resolving.has(current)) return undefined;
    resolving.add(current);
    const result = resolveUncached(current);
    resolving.delete(current);
    cache.set(current, result);
    return result;
  }
  function isDeferredCapture(current: AstNode, binding: Binding): boolean {
    let scope = scopes.get(current);
    while (scope && scope !== binding.scope) {
      if (scope.functionScope) return true;
      scope = scope.parent;
    }
    return false;
  }
  function resolveUncached(current: AstNode): Resolved | undefined {
    if (current.type === 'Identifier') {
      const binding = bindingOf(current);
      if (
        dynamicScope ||
        !binding?.immutable ||
        binding.written ||
        !binding.init ||
        (binding.init.end > current.start && !isDeferredCapture(current, binding))
      )
        return undefined;
      const result = resolve(binding.init);
      return result ? { ...result, trace: [`const ${binding.name}`, ...result.trace] } : undefined;
    }
    if (current.type === 'MemberExpression' && !current.optional) {
      const object = resolve(node(current.object));
      const key = staticKey(current, true);
      const field = key === undefined ? undefined : object?.value.fields?.get(key);
      if (!object || !field) return undefined;
      return {
        value: field.value,
        trace: [label(current), ...object.trace, ...field.trace],
        owners: new Set([...object.owners, object.value, ...field.owners]),
      };
    }
    const value: StaticValue = { source: current, neighbors: new Set() };
    if (['StringLiteral', 'NumericLiteral', 'BooleanLiteral', 'NullLiteral'].includes(current.type))
      return { value, trace: [], owners: new Set() };
    if (current.type !== 'ObjectExpression' && current.type !== 'ArrayExpression') return undefined;
    value.fields = new Map();
    const entries: { key: string; expression: AstNode }[] = [];
    if (current.type === 'ObjectExpression') {
      for (const property of children(current.properties)) {
        const key = staticKey(property, false);
        const expression = node(property.value);
        if (
          property.type !== 'ObjectProperty' ||
          property.method ||
          (property.kind !== undefined && property.kind !== 'init') ||
          key === undefined ||
          key === '__proto__' ||
          !expression ||
          entries.some((entry) => entry.key === key)
        )
          return undefined;
        entries.push({ key, expression });
      }
    } else {
      if (!Array.isArray(current.elements)) return undefined;
      for (const [index, element] of current.elements.entries()) {
        const expression = node(element);
        if (!expression || expression.type === 'SpreadElement') return undefined;
        entries.push({ key: String(index), expression });
      }
    }
    for (const { key, expression } of entries) {
      const field = resolve(expression);
      if (!field) return undefined;
      value.fields.set(key, field);
      // Aliases and containing objects share risk, even through nested arrays.
      for (const related of [...field.owners, ...(field.value.fields ? [field.value] : [])]) {
        value.neighbors.add(related);
        related.neighbors.add(value);
      }
    }
    return { value, trace: [], owners: new Set() };
  }

  function isWriteTarget(current: AstNode): boolean {
    const parent = parents.get(current);
    if (!parent) return false;
    if (
      (parent.node.type === 'AssignmentExpression' && parent.key === 'left') ||
      (parent.node.type === 'UpdateExpression' && parent.key === 'argument') ||
      (parent.node.type === 'UnaryExpression' && parent.node.operator === 'delete') ||
      ((parent.node.type === 'ForInStatement' || parent.node.type === 'ForOfStatement') &&
        parent.key === 'left')
    )
      return true;
    if (
      (parent.key === 'expression' &&
        [
          'TSAsExpression',
          'TSTypeAssertion',
          'TSNonNullExpression',
          'TSSatisfiesExpression',
          'ParenthesizedExpression',
        ].includes(parent.node.type)) ||
      ['ObjectPattern', 'ArrayPattern', 'RestElement', 'AssignmentPattern'].includes(
        parent.node.type,
      ) ||
      (parent.node.type === 'ObjectProperty' && parent.key === 'value')
    )
      return isWriteTarget(parent.node);
    return false;
  }
  function isExported(declaration: AstNode): boolean {
    const statement = parents.get(declaration)?.node;
    return parents.get(statement ?? declaration)?.node.type === 'ExportNamedDeclaration';
  }
  // A literal-array prototype alias can replace map without naming Array at all.
  const standardArrayPrototype = !all.some((current) => {
    if (
      current.type === 'Identifier' &&
      ['Array', 'Object', 'Reflect', 'Proxy', 'Function', 'eval'].includes(nameOf(current) ?? '')
    )
      return true;
    if (current.type !== 'MemberExpression' && current.type !== 'OptionalMemberExpression')
      return false;
    const key = staticKey(current, true);
    return key === undefined || ['__proto__', 'constructor', 'prototype'].includes(key);
  });
  function isPropertyName(current: AstNode): boolean {
    const parent = parents.get(current);
    return (
      !!parent &&
      !parent.node.computed &&
      ((parent.key === 'property' && parent.node.type === 'MemberExpression') ||
        (parent.key === 'key' && parent.node.type === 'ObjectProperty'))
    );
  }
  function safeParameterUse(current: AstNode, values: StaticValue[]): boolean {
    if (isWriteTarget(current)) return false;
    if (values.every((value) => !value.fields)) return true;
    const parent = parents.get(current);
    if (parent?.node.type !== 'MemberExpression' || parent.key !== 'object') return false;
    const member = parent.node;
    const key = staticKey(member, true);
    if (key === undefined || member.optional) return false;
    if (key === 'map' && values.every((value) => value.source.type === 'ArrayExpression'))
      return safeMap(member, values);
    const fields = values.map((value) => value.fields?.get(key)?.value);
    if (fields.some((field) => !field)) return false;
    return safeParameterUse(
      member,
      fields.filter((field): field is StaticValue => !!field),
    );
  }
  function safeMap(member: AstNode, arrays: StaticValue[]): boolean {
    if (!standardArrayPrototype || arrays.some((value) => value.source.type !== 'ArrayExpression'))
      return false;
    const parent = parents.get(member);
    if (parent?.node.type !== 'CallExpression' || parent.key !== 'callee' || parent.node.optional)
      return false;
    const args = children(parent.node.arguments);
    const callback = args[0];
    if (
      args.length !== 1 ||
      !callback ||
      !['ArrowFunctionExpression', 'FunctionExpression'].includes(callback.type) ||
      callback.async ||
      callback.generator
    )
      return false;
    const params = children(callback.params);
    if (
      params.length > 2 ||
      params.some((param) => param.type !== 'Identifier' || bindingOf(param)?.written)
    )
      return false;
    const parameter = params[0];
    const binding = parameter ? bindingOf(parameter) : undefined;
    const elements = arrays.flatMap((array) =>
      [...(array.fields?.values() ?? [])].map((field) => field.value),
    );
    let safe = true;
    walk(callback, (current) => {
      if (current.type === 'ThisExpression' || nameOf(current) === 'arguments') safe = false;
      if (
        binding &&
        !declarations.has(current) &&
        !isPropertyName(current) &&
        (current.type === 'Identifier' || current.type === 'JSXIdentifier') &&
        bindingOf(current) === binding &&
        !safeParameterUse(current, elements)
      )
        safe = false;
    });
    return safe;
  }
  function safeContainerUse(current: AstNode): boolean {
    const parent = parents.get(current);
    if (!parent) return false;
    const owner = parent.node;
    if (owner.type === 'MemberExpression' && parent.key === 'object') {
      if (staticKey(owner, true) === 'map') {
        const receiver = resolve(current);
        if (receiver && safeMap(owner, [receiver.value])) return true;
      }
      return staticKey(owner, true) !== undefined && !isWriteTarget(owner) && !!resolve(owner);
    }
    if (owner.type === 'VariableDeclarator' && parent.key === 'init') {
      const id = node(owner.id);
      const binding = id?.type === 'Identifier' ? bindingOf(id) : undefined;
      return !!binding?.immutable && !binding.written && !isExported(owner);
    }
    if (owner.type === 'ObjectProperty' && parent.key === 'value') {
      const container = parents.get(owner)?.node;
      return container?.type === 'ObjectExpression' && !!resolve(container);
    }
    return owner.type === 'ArrayExpression' && parent.key === 'elements' && !!resolve(owner);
  }

  const unsafe = new Set<StaticValue>();
  function invalidate(value: StaticValue): void {
    if (unsafe.has(value)) return;
    unsafe.add(value);
    for (const neighbor of value.neighbors) invalidate(neighbor);
  }
  // Build every container graph first so later escape discovery reaches earlier aliases.
  for (const current of all) resolve(current);
  for (const current of all) {
    if (declarations.has(current)) continue;
    const parent = parents.get(current);
    if (
      current.type === 'Identifier' &&
      parent &&
      ((parent.key === 'property' &&
        parent.node.type === 'MemberExpression' &&
        !parent.node.computed) ||
        (parent.key === 'key' && parent.node.type === 'ObjectProperty' && !parent.node.computed))
    )
      continue;
    const result = resolve(current);
    if (result?.value.fields && !safeContainerUse(current)) invalidate(result.value);
  }

  return (expression) => {
    const current = node(expression);
    const result = resolve(current);
    if (
      !result ||
      result.value.source.type !== 'StringLiteral' ||
      typeof result.value.source.value !== 'string' ||
      [...result.owners].some((owner) => unsafe.has(owner))
    )
      return undefined;
    const literal = result.value.source;
    return {
      start: literal.start,
      end: literal.end,
      value: String(literal.value),
      origin: [...result.trace, 'string literal'].join(' → '),
    };
  };
}
