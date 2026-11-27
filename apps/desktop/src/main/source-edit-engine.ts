import { parse } from '@babel/parser';
import {
  SOURCE_EDIT_BATCH_MAX_OPERATIONS,
  type SourceEditApplyResultV1,
  SourceEditAttributeName,
  type SourceEditInspectResultV1,
  type SourceEditLocation,
  type SourceEditMapField,
  type SourceEditMapItemBinding,
  type SourceEditMapSource,
  SourceEditOperation,
  type SourceEditPatch,
  type SourceEditRejectedV1,
  type SourceEditScope,
  type SourceEditSelectionMode,
  type SourceEditStyleBinding,
  SourceEditStyleProperty,
  type SourceEditTarget,
  type SourceEditTargetCapabilities,
  type SourceEditUnsupported,
  sourceEditFieldKey,
} from '@open-codesign/shared';
import {
  analyzeHtmlSourceEdit,
  canUpsertAttributeForTag,
  extractCssVarTokenName,
  minimalPatch,
  planHtmlSourceEdit,
  planHtmlSourceEditBatch,
  rejectEdit,
  runtimeReservedValue,
  SVG_VECTOR_TAGS,
  sha256Hex,
  validAttributeValue,
  validStyle,
} from './source-edit-html';
import {
  type AstNode,
  children,
  createProvenanceResolvers,
  nameOf,
  node,
  type StaticMapCallProvenance,
  type StaticMapFieldResolution,
  walk,
} from './source-edit-provenance';
import { looksLikeTailwindClassName } from './source-edit-tailwind';

interface FieldSpan {
  operation: SourceEditOperation;
  start: number;
  end: number;
  expressionContainer: boolean;
}

interface StylePropertyEntry {
  property: SourceEditStyleProperty;
  propNode: AstNode;
  valueNode: AstNode;
  staticValue?: string;
}

type StyleObjectState =
  | { kind: 'absent' }
  | { kind: 'dynamic' | 'ambiguous'; attrNode: AstNode }
  | {
      kind: 'object';
      attrNode: AstNode;
      objectNode: AstNode;
      lastSpreadIndex: number;
      editableProps: Map<SourceEditStyleProperty, StylePropertyEntry>;
    };

interface ClassNameAttrState {
  attrNode?: AstNode;
  valueNode?: AstNode;
  staticValue?: string;
  dynamic: boolean;
}

interface TargetMapInfo {
  arrayNode: AstNode;
  arrayElements: AstNode[];
  fieldsByKey: Map<string, StaticMapFieldResolution>;
  isMapRoot: boolean;
}

interface LocatedTarget {
  target: SourceEditTarget;
  fields: FieldSpan[];
  attrNodes: Map<SourceEditAttributeName, AstNode>;
  dynamicAttrs: Set<SourceEditAttributeName>;
  styleState: StyleObjectState;
  classNameState: ClassNameAttrState;
  prevSibling?: AstNode;
  nextSibling?: AstNode;
  selfClosing: boolean;
  mapInfo?: TargetMapInfo;
}

interface Analysis {
  sourceHash: string;
  targets: LocatedTarget[];
  mapItemBindings: SourceEditMapItemBinding[];
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

function buildLineStarts(source: string): number[] {
  const starts = [0];
  for (let i = 0; i < source.length; i += 1) {
    const ch = source.charCodeAt(i);
    if (ch === 10) {
      starts.push(i + 1);
    } else if (ch === 13) {
      if (source.charCodeAt(i + 1) === 10) {
        starts.push(i + 2);
        i += 1;
      } else {
        starts.push(i + 1);
      }
    }
  }
  return starts;
}

function offsetToLineCol(
  lineStarts: readonly number[],
  offset: number,
): { line: number; col: number } {
  let low = 0;
  let high = lineStarts.length - 1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    const start = lineStarts[mid] ?? 0;
    if (start <= offset) {
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  const lineIndex = Math.max(0, high);
  const lineStart = lineStarts[lineIndex] ?? 0;
  return { line: lineIndex + 1, col: offset - lineStart + 1 };
}

function sourceLocationFor(
  lineStarts: readonly number[],
  start: number,
  end: number,
): SourceEditLocation {
  const s = offsetToLineCol(lineStarts, start);
  const e = offsetToLineCol(lineStarts, end);
  return {
    startLine: s.line,
    startCol: s.col,
    endLine: e.line,
    endCol: e.col,
  };
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
  if (
    value?.type === 'UnaryExpression' &&
    value.operator === '-' &&
    node(value.argument)?.type === 'NumericLiteral'
  ) {
    const arg = node(value.argument);
    if (arg && typeof arg.value === 'number' && Number.isFinite(arg.value)) {
      return String(-arg.value);
    }
  }
  return staticString(value);
}

function extractTokenName(literal: AstNode, source: string): string | undefined {
  if (literal.type === 'StringLiteral' && typeof literal.value === 'string') {
    return extractCssVarTokenName(literal.value);
  }
  const raw = source.slice(literal.start, literal.end);
  const cssVar = extractCssVarTokenName(raw);
  if (cssVar) return cssVar;
  if (literal.type === 'MemberExpression' && !literal.optional && !literal.computed) {
    const propName = nameOf(node(literal.property));
    const obj = node(literal.object);
    if (propName && obj) {
      const objName = nameOf(obj);
      if (objName && ['TWEAK_DEFAULTS', 't', 'tokens', 'theme', 'ds'].includes(objName)) {
        return propName;
      }
      if (obj.type === 'MemberExpression' && nameOf(node(obj.property)) === 'tokens') {
        return propName;
      }
    }
  }
  const tokenMatch = /\b(?:TWEAK_DEFAULTS|t|tokens|theme)\.([A-Za-z_$][A-Za-z0-9_$]*)/.exec(raw);
  return tokenMatch?.[1];
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

function inspectStyleObject(
  opening: AstNode,
  source: string,
  isSvg: boolean,
  hasBoundary: boolean,
): {
  styleState: StyleObjectState;
  fields: FieldSpan[];
  styleBindings: SourceEditStyleBinding[];
  unsupported: SourceEditUnsupported[];
  canUpsertStyle: boolean;
} {
  const fields: FieldSpan[] = [];
  const styleBindings: SourceEditStyleBinding[] = [];
  const unsupported: SourceEditUnsupported[] = [];

  const styleAttr = children(opening.attributes).find((attr) => nameOf(attr.name) === 'style');
  if (!styleAttr) {
    return {
      styleState: { kind: 'absent' },
      fields,
      styleBindings,
      unsupported,
      canUpsertStyle: !hasBoundary && !isSvg,
    };
  }

  const value = node(styleAttr.value);
  const object = value?.type === 'JSXExpressionContainer' ? node(value.expression) : undefined;
  if (object?.type !== 'ObjectExpression') {
    unsupported.push(
      problem(
        'style',
        'shared-or-dynamic-style',
        'Style must be a directly owned inline object, not a variable or expression.',
      ),
    );
    return {
      styleState: { kind: 'dynamic', attrNode: styleAttr },
      fields,
      styleBindings,
      unsupported,
      canUpsertStyle: false,
    };
  }

  const properties = children(object.properties);
  let lastSpreadIndex = -1;
  for (let i = 0; i < properties.length; i += 1) {
    if (properties[i]?.type === 'SpreadElement') lastSpreadIndex = i;
  }

  let ambiguous = false;
  let segmentSeen = new Set<string>();
  for (let i = 0; i < properties.length; i += 1) {
    const property = properties[i];
    if (!property) continue;
    if (property.type === 'SpreadElement') {
      segmentSeen = new Set<string>();
      continue;
    }
    const key = nameOf(property.key);
    if (
      property.type !== 'ObjectProperty' ||
      property.computed === true ||
      property.shorthand === true ||
      key === undefined ||
      segmentSeen.has(key)
    ) {
      ambiguous = true;
      break;
    }
    segmentSeen.add(key);
  }

  if (ambiguous) {
    unsupported.push(
      problem(
        'style',
        'ambiguous-style',
        'Style spreads, duplicate/computed keys, methods and shorthand are not editable.',
      ),
    );
    return {
      styleState: { kind: 'ambiguous', attrNode: styleAttr },
      fields,
      styleBindings,
      unsupported,
      canUpsertStyle: false,
    };
  }

  const editableProps = new Map<SourceEditStyleProperty, StylePropertyEntry>();
  let styleCount = 0;

  for (let i = lastSpreadIndex + 1; i < properties.length; i += 1) {
    const property = properties[i];
    if (!property || property.type !== 'ObjectProperty') continue;
    const key = SourceEditStyleProperty.safeParse(nameOf(property.key));
    if (!key.success) continue;
    const literal = node(property.value);
    if (!literal) continue;
    const styleValue = staticStyle(literal);
    const tokenName = extractTokenName(literal, source);

    if (styleValue !== undefined) {
      editableProps.set(key.data, {
        property: key.data,
        propNode: property,
        valueNode: literal,
        staticValue: styleValue,
      });
      fields.push({
        operation: { kind: 'set-style', property: key.data, value: styleValue },
        start: literal.start,
        end: literal.end,
        expressionContainer: false,
      });
      if (tokenName) {
        styleBindings.push({
          property: key.data,
          expression: styleValue.slice(0, 1_000),
          tokenName,
          editable: true,
        });
      }
      styleCount += 1;
    } else {
      editableProps.set(key.data, {
        property: key.data,
        propNode: property,
        valueNode: literal,
      });
      styleBindings.push({
        property: key.data,
        expression: source.slice(literal.start, literal.end).slice(0, 1_000),
        ...(tokenName ? { tokenName } : {}),
        editable: false,
      });
      unsupported.push(
        problem('style', 'dynamic-style-value', `${key.data} is not a static string or number.`),
      );
    }
  }

  if (styleCount === 0 && styleBindings.length === 0) {
    unsupported.push(
      problem('style', 'no-static-style', 'No existing static allowlisted inline style property.'),
    );
  }

  return {
    styleState: {
      kind: 'object',
      attrNode: styleAttr,
      objectNode: object,
      lastSpreadIndex,
      editableProps,
    },
    fields,
    styleBindings,
    unsupported,
    canUpsertStyle: !hasBoundary && !isSvg,
  };
}

function fieldsFor(
  element: AstNode,
  source: string,
  tagName: string,
  hasBoundary: boolean,
  resolveText: (
    expression: unknown,
  ) => { start: number; end: number; value: string; origin: string } | undefined,
): {
  fields: FieldSpan[];
  unsupported: SourceEditUnsupported[];
  directText?: string;
  textSources: NonNullable<SourceEditTarget['textSources']>;
  textLayout: NonNullable<SourceEditTarget['textLayout']>;
  attrNodes: Map<SourceEditAttributeName, AstNode>;
  dynamicAttrs: Set<SourceEditAttributeName>;
  styleState: StyleObjectState;
  styleBindings: SourceEditStyleBinding[];
  classNameState: ClassNameAttrState;
  canUpsertStyle: boolean;
  canUpsertAttribute: boolean;
} {
  const fields: FieldSpan[] = [];
  const unsupported: SourceEditUnsupported[] = [];
  const isSvg = SVG_VECTOR_TAGS.has(tagName);
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
  const attrNodes = new Map<SourceEditAttributeName, AstNode>();
  const dynamicAttrs = new Set<SourceEditAttributeName>();
  let classNameState: ClassNameAttrState = { dynamic: false };

  for (const attribute of children(opening?.attributes)) {
    const name = nameOf(attribute.name);
    const value = node(attribute.value);
    if (name === 'className') {
      const classText =
        value?.type === 'JSXExpressionContainer'
          ? staticString(node(value.expression))
          : staticString(value);
      if (value && classText !== undefined) {
        classNameState = {
          attrNode: attribute,
          valueNode: value,
          staticValue: classText,
          dynamic: false,
        };
      } else {
        classNameState = { attrNode: attribute, dynamic: true };
      }
      continue;
    }
    const attributeName = SourceEditAttributeName.safeParse(name);
    if (attributeName.success) {
      attrNodes.set(attributeName.data, attribute);
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
      } else {
        dynamicAttrs.add(attributeName.data);
        unsupported.push(
          problem('attributes', 'dynamic-attribute', `${name} is not a static string attribute.`),
        );
      }
    }
  }

  const styleInfo = opening
    ? inspectStyleObject(opening, source, isSvg, hasBoundary)
    : {
        styleState: { kind: 'absent' } as StyleObjectState,
        fields: [],
        styleBindings: [],
        unsupported: [],
        canUpsertStyle: false,
      };
  fields.push(...styleInfo.fields);
  unsupported.push(...styleInfo.unsupported);

  const canUpsertAttribute = !hasBoundary && !isSvg;
  if (isSvg && attrNodes.size === 0) {
    unsupported.push(
      problem(
        'attributes',
        'no-static-attribute',
        'Only existing static attributes are supported on vector primitives.',
      ),
    );
  }
  if (isSvg && styleInfo.styleState.kind === 'absent') {
    unsupported.push(
      problem(
        'style',
        'no-inline-style',
        'Only existing inline style properties are supported on vector primitives.',
      ),
    );
  }

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
    attrNodes,
    dynamicAttrs,
    styleState: styleInfo.styleState,
    styleBindings: styleInfo.styleBindings,
    classNameState,
    canUpsertStyle: styleInfo.canUpsertStyle,
    canUpsertAttribute,
  };
}

function collectMapFieldsInSubtree(
  element: AstNode,
  mapProv: StaticMapCallProvenance,
  allMapCallbacks: ReadonlySet<AstNode>,
): Map<string, StaticMapFieldResolution> {
  const fieldsByKey = new Map<string, StaticMapFieldResolution>();

  function scan(current: AstNode): void {
    if (current !== element && allMapCallbacks.has(current)) return;
    if (current.type === 'JSXElement') {
      const opening = node(current.openingElement);
      for (const attr of children(opening?.attributes)) {
        const attrName = nameOf(attr.name);
        if (!attrName || !['title', 'placeholder', 'alt', 'aria-label'].includes(attrName))
          continue;
        const val = node(attr.value);
        if (val?.type === 'JSXExpressionContainer') {
          const resolved = mapProv.resolveItemExpression(node(val.expression));
          if (resolved && !fieldsByKey.has(resolved.key)) {
            fieldsByKey.set(resolved.key, resolved);
          }
        }
      }
      for (const child of children(current.children)) {
        scan(child);
      }
      return;
    }
    if (current.type === 'JSXFragment') {
      for (const child of children(current.children)) {
        scan(child);
      }
      return;
    }
    if (current.type === 'JSXExpressionContainer') {
      const expr = node(current.expression);
      if (expr) {
        const resolved = mapProv.resolveItemExpression(expr);
        if (resolved && !fieldsByKey.has(resolved.key)) {
          fieldsByKey.set(resolved.key, resolved);
          return;
        }
        if (expr.type === 'CallExpression' && allMapCallbacks.has(expr)) return;
      }
    }
    for (const value of Object.values(current)) {
      const child = node(value);
      if (child) scan(child);
      else for (const item of children(value)) scan(item);
    }
  }

  scan(element);
  return fieldsByKey;
}

function callbackReturnedJsx(callback: AstNode): AstNode | undefined {
  const body = node(callback.body);
  if (!body) return undefined;
  if (body.type === 'JSXElement') return body;
  if (body.type !== 'BlockStatement') return undefined;
  const statements = children(body.body);
  const returns = statements.filter((st) => st.type === 'ReturnStatement');
  if (returns.length !== 1) return undefined;
  if (
    statements.some(
      (st) =>
        ![
          'VariableDeclaration',
          'ReturnStatement',
          'FunctionDeclaration',
          'TSTypeAliasDeclaration',
          'TSInterfaceDeclaration',
        ].includes(st.type),
    )
  ) {
    return undefined;
  }
  const arg = node(returns[0]?.argument);
  return arg?.type === 'JSXElement' ? arg : undefined;
}

function isMeaningfulJsxSibling(child: AstNode): boolean {
  if (child.type === 'JSXText') return jsxText(String(child.value)).length !== 0;
  if (
    child.type === 'JSXExpressionContainer' &&
    node(child.expression)?.type === 'JSXEmptyExpression'
  ) {
    return false;
  }
  return true;
}

function analyze(
  path: string,
  source: string,
  selectionMode: SourceEditSelectionMode = 'preview',
): Analysis | SourceEditRejectedV1 {
  if (selectionMode === 'source')
    return rejectEdit(
      'source-mode-removed',
      'Source-list editing has been removed. Select the element in the current preview.',
    );
  if (!/\.(jsx|tsx)$/i.test(path))
    return rejectEdit('unsupported-path', 'Source editing requires a real HTML, JSX, or TSX file.');
  let ast: AstNode;
  try {
    ast = parseSource(path, source);
  } catch {
    return rejectEdit('parse-error', 'Source could not be parsed as JSX/TSX.');
  }
  const program = node(ast.program);
  if (!program) return rejectEdit('parse-error', 'No source program.');
  // The current preview compiles React into a script, not an ES module loader.
  if (
    children(program.body).some((statement) =>
      /^(?:Import|Export|TSImport|TSExport|TSNamespaceExport)/.test(statement.type),
    )
  ) {
    return rejectEdit(
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
    return rejectEdit(
      'unsupported-entry',
      'Exactly one directly declared App or _App function is required by the existing preview entry contract.',
    );
  const entry = entries[0];
  if (!entry) return rejectEdit('unsupported-entry', 'No entry.');
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
    return rejectEdit(
      'unsupported-entry',
      'App/_App must directly return a static JSX structure without props forwarding or conditional entry returns.',
    );
  }

  const { resolveText, maps: mapProvenances } = createProvenanceResolvers(ast, source);
  const lineStarts = buildLineStarts(source);
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

  // Mark elements directly in the single-use App/_App JSX return tree (not inside .map(), helpers, variables, or conditionals).
  const directAppElements = new Set<number>();
  function markDirectApp(current: AstNode): void {
    if (current.type === 'JSXFragment') {
      for (const child of children(current.children)) {
        if (child.type === 'JSXElement' || child.type === 'JSXFragment') markDirectApp(child);
      }
      return;
    }
    if (current.type !== 'JSXElement') return;
    directAppElements.add(current.start);
    for (const child of children(current.children)) {
      if (child.type === 'JSXElement' || child.type === 'JSXFragment') markDirectApp(child);
    }
  }
  markDirectApp(root);

  function enclosingComponentName(current: AstNode): string | undefined {
    let ancestor = parents.get(current);
    const visited = new Set<AstNode>();
    while (ancestor && !visited.has(ancestor)) {
      visited.add(ancestor);
      if (ancestor.type === 'FunctionDeclaration') {
        const name = nameOf(node(ancestor.id));
        if (name && name.length <= 160) return name;
      }
      if (ancestor.type === 'FunctionExpression' || ancestor.type === 'ArrowFunctionExpression') {
        const ownName = nameOf(node(ancestor.id));
        if (ownName && ownName.length <= 160) return ownName;
        const parent = parents.get(ancestor);
        if (parent?.type === 'VariableDeclarator' && node(parent.init) === ancestor) {
          const varName = nameOf(node(parent.id));
          if (varName && varName.length <= 160) return varName;
        }
      }
      ancestor = parents.get(ancestor);
    }
    return undefined;
  }

  // Register valid static .map() bindings whose returned root element passes textBoundary.
  const mapByCallback = new Map<AstNode, { prov: StaticMapCallProvenance; rootElement: AstNode }>();
  const allMapCallbacks = new Set<AstNode>();
  const mapItemBindings: SourceEditMapItemBinding[] = [];

  for (const prov of mapProvenances) {
    const rootEl = callbackReturnedJsx(prov.callback);
    if (!rootEl || !isHost(rootEl) || textBoundary(rootEl)) continue;
    const rootOpening = node(rootEl.openingElement);
    if (!rootOpening) continue;
    const rootInsertionOffset = rootOpening.end - (rootOpening.selfClosing === true ? 2 : 1);
    const existingIndexName = prov.secondParam ? nameOf(prov.secondParam) : undefined;
    mapItemBindings.push({
      targetId: `${rootEl.start}:${rootEl.end}`,
      paramsStart: prov.firstParam.start,
      paramsEnd: prov.firstParam.end,
      wrapParens: prov.wrapParens,
      ...(existingIndexName ? { existingIndexName } : {}),
      rootInsertionOffset,
    });
    mapByCallback.set(prov.callback, { prov, rootElement: rootEl });
    allMapCallbacks.add(prov.callback);
  }

  function nearestMapFor(element: AstNode):
    | {
        prov: StaticMapCallProvenance;
        rootElement: AstNode;
      }
    | undefined {
    let cursor: AstNode | undefined = element;
    const visited = new Set<AstNode>();
    while (cursor && !visited.has(cursor)) {
      visited.add(cursor);
      const entryMap = mapByCallback.get(cursor);
      if (entryMap) {
        // Confirm element is the returned root or a descendant of it.
        let check: AstNode | undefined = element;
        while (check) {
          if (check === entryMap.rootElement) return entryMap;
          if (check === cursor) break;
          check = parents.get(check);
        }
        return undefined;
      }
      cursor = parents.get(cursor);
    }
    return undefined;
  }

  const siblingLookupByParent = new Map<
    AstNode,
    Map<AstNode, { prevSibling?: AstNode; nextSibling?: AstNode }>
  >();
  function siblingsForElement(
    parentNode: AstNode,
    element: AstNode,
  ): { prevSibling?: AstNode; nextSibling?: AstNode } {
    let byElement = siblingLookupByParent.get(parentNode);
    if (!byElement) {
      byElement = new Map();
      const meaningful = children(parentNode.children).filter(isMeaningfulJsxSibling);
      for (let i = 0; i < meaningful.length; i += 1) {
        const entry = meaningful[i];
        if (!entry) continue;
        const prev = i > 0 ? meaningful[i - 1] : undefined;
        const next = i < meaningful.length - 1 ? meaningful[i + 1] : undefined;
        const prevSibling =
          prev && (prev.type === 'JSXElement' || prev.type === 'JSXFragment') ? prev : undefined;
        const nextSibling =
          next && (next.type === 'JSXElement' || next.type === 'JSXFragment') ? next : undefined;
        byElement.set(entry, {
          ...(prevSibling ? { prevSibling } : {}),
          ...(nextSibling ? { nextSibling } : {}),
        });
      }
      siblingLookupByParent.set(parentNode, byElement);
    }
    return byElement.get(element) ?? {};
  }

  const targets: LocatedTarget[] = [];
  walk(ast, (current) => {
    if (current.type !== 'JSXElement' || !isHost(current)) return;
    const opening = node(current.openingElement);
    const tagName = nameOf(opening?.name);
    if (!opening || !tagName) return;

    const boundary = textBoundary(current);
    const isSvg = SVG_VECTOR_TAGS.has(tagName);
    const activeMap = !boundary ? nearestMapFor(current) : undefined;
    const details = fieldsFor(current, source, tagName, Boolean(boundary), resolveText);

    if (boundary) {
      details.fields = [];
      details.textSources = [];
      details.textLayout = details.textLayout.map((part) =>
        part.kind === 'text' ? { kind: 'dynamic' } : part,
      );
      details.unsupported = [boundary];
      details.styleBindings = [];
    }

    const parent = parents.get(current);
    const staticParent =
      !boundary && (parent?.type === 'JSXElement' || parent?.type === 'JSXFragment');
    const siblingInfo = staticParent && parent ? siblingsForElement(parent, current) : {};
    const prevSibling = siblingInfo.prevSibling;
    const nextSibling = siblingInfo.nextSibling;

    let mapSource: SourceEditMapSource | undefined;
    let mapInfo: TargetMapInfo | undefined;
    if (activeMap) {
      const fieldsByKey = collectMapFieldsInSubtree(current, activeMap.prov, allMapCallbacks);
      const mapFields: SourceEditMapField[] = [...fieldsByKey.values()].map((field) => ({
        key: field.key,
        ...(field.property ? { property: field.property } : {}),
        values: field.values,
      }));
      mapSource = {
        arrayName: activeMap.prov.arrayName,
        itemCount: activeMap.prov.arrayElements.length,
        fields: mapFields,
      };
      mapInfo = {
        arrayNode: activeMap.prov.arrayNode,
        arrayElements: activeMap.prov.arrayElements,
        fieldsByKey,
        isMapRoot: current === activeMap.rootElement,
      };
    }

    const sharedDefinition = !directAppElements.has(current.start);
    const enclosingComponent = enclosingComponentName(current);
    const staticClassValue = details.classNameState.staticValue;
    const boundedClassName =
      staticClassValue !== undefined && staticClassValue.length <= 4_000
        ? staticClassValue
        : undefined;
    const hasInlineStyle = details.styleState.kind !== 'absent';
    const styleMode: SourceEditTargetCapabilities['styleMode'] =
      boundedClassName !== undefined &&
      !hasInlineStyle &&
      looksLikeTailwindClassName(boundedClassName)
        ? 'tailwind'
        : 'inline';

    const canEditClassName =
      !boundary &&
      !details.classNameState.dynamic &&
      (!isSvg || details.classNameState.staticValue !== undefined);

    const mapItemCount = mapInfo?.arrayElements.length ?? 0;
    const canMapReorder = Boolean(mapInfo?.isMapRoot && mapItemCount > 1);
    const canMapMutateItem = Boolean(mapInfo?.isMapRoot && mapItemCount > 0);

    const capabilities: SourceEditTargetCapabilities = {
      canUpsertStyle: !boundary && details.canUpsertStyle,
      canUpsertAttribute: !boundary && details.canUpsertAttribute,
      canEditClassName,
      canReorderUp: Boolean(prevSibling) || canMapReorder,
      canReorderDown: Boolean(nextSibling) || canMapReorder,
      canDuplicate: staticParent || canMapMutateItem,
      canDelete: staticParent || canMapMutateItem,
      sharedDefinition,
      ...(enclosingComponent ? { enclosingComponent } : {}),
      styleMode,
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
        ...(details.directText !== undefined ? { directText: details.directText } : {}),
        textSources: details.textSources,
        textLayout: details.textLayout,
        unsupported: details.unsupported,
        capabilities,
        ...(details.styleBindings.length > 0 ? { styleBindings: details.styleBindings } : {}),
        ...(boundedClassName !== undefined ? { className: boundedClassName } : {}),
        ...(mapSource ? { mapSource } : {}),
        sourceLocation: sourceLocationFor(lineStarts, current.start, current.end),
      },
      fields: details.fields,
      attrNodes: details.attrNodes,
      dynamicAttrs: details.dynamicAttrs,
      styleState: details.styleState,
      classNameState: details.classNameState,
      ...(prevSibling ? { prevSibling } : {}),
      ...(nextSibling ? { nextSibling } : {}),
      selfClosing: opening.selfClosing === true,
      ...(mapInfo ? { mapInfo } : {}),
    });
  });

  if (
    targets.length > 10_000 ||
    targets.some(({ target }) => (target.textLayout?.length ?? 0) > 10_000)
  )
    return rejectEdit(
      'unsupported-targets',
      'This source exceeds the supported preview target or text-layout limit.',
    );
  return { sourceHash: sha256Hex(source), targets, mapItemBindings };
}

/**
 * Candidates identify exact source definitions, never private DOM instances.
 * Indirect fields need lexical literal provenance; ordered child layouts let the
 * preview verify individual static segments beside dynamic content. No source executes
 * here, and legacy source-list mode is refused rather than providing a bypass.
 */
export function analyzeSourceEdit(input: {
  path: string;
  source: string;
  selectionMode?: SourceEditSelectionMode | undefined;
}): SourceEditInspectResultV1 {
  if (/\.(html|htm)$/i.test(input.path)) {
    return analyzeHtmlSourceEdit(input);
  }
  const result = analyze(input.path, input.source, input.selectionMode);
  if ('status' in result) return result;
  return {
    schemaVersion: 1,
    status: 'ready',
    path: input.path,
    sourceHash: result.sourceHash,
    targets: result.targets.map(({ target }) => target),
    ...(result.mapItemBindings.length > 0 ? { mapItemBindings: result.mapItemBindings } : {}),
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

function formatStyleLiteral(value: string): string {
  return /^-?(?:\d+(?:\.\d+)?|\.\d+)$/.test(value) ? String(Number(value)) : quote(value);
}

function formatClassNameValue(value: string): string {
  return /["\r\n<>\\&\u2028\u2029]/.test(value) ? `{${quote(value)}}` : quote(value);
}

function lineIndentBefore(source: string, offset: number): { indent: string; eol: string } | null {
  const lastLf = source.lastIndexOf('\n', offset - 1);
  const lastCr = source.lastIndexOf('\r', offset - 1);
  const lineBreak = Math.max(lastLf, lastCr);
  if (lineBreak < 0) return null;
  const prefix = source.slice(lineBreak + 1, offset);
  if (!/^[ \t]*$/.test(prefix)) return null;
  const eol =
    lineBreak > 0 && source[lineBreak] === '\n' && source[lineBreak - 1] === '\r' ? '\r\n' : '\n';
  return { indent: prefix, eol };
}

function removeSpanPreservingIndent(source: string, start: number, end: number): SourceEditPatch {
  const lastLf = source.lastIndexOf('\n', start - 1);
  const lineStart = lastLf + 1;
  const before = source.slice(lineStart, start);
  const nextLf = source.indexOf('\n', end);
  const nextCr = source.indexOf('\r', end);
  const lineEnd =
    nextLf < 0 && nextCr < 0
      ? source.length
      : nextLf < 0
        ? nextCr
        : nextCr < 0
          ? nextLf
          : Math.min(nextLf, nextCr);
  const after = source.slice(end, lineEnd);
  if (/^[ \t]*$/.test(before) && /^[ \t]*$/.test(after) && lineEnd < source.length) {
    const eolLen = source[lineEnd] === '\r' && source[lineEnd + 1] === '\n' ? 2 : 1;
    return {
      start: lineStart,
      end: lineEnd + eolLen,
      expectedText: source.slice(lineStart, lineEnd + eolLen),
      replacement: '',
    };
  }
  let adjStart = start;
  const adjEnd = end;
  if (source[adjStart - 1] === ' ' && source[adjEnd] === ' ') adjStart -= 1;
  return {
    start: adjStart,
    end: adjEnd,
    expectedText: source.slice(adjStart, adjEnd),
    replacement: '',
  };
}

function removeJsxAttributePatch(source: string, attrNode: AstNode): SourceEditPatch {
  const lineRemoved = removeSpanPreservingIndent(source, attrNode.start, attrNode.end);
  if (lineRemoved.start !== attrNode.start || lineRemoved.end !== attrNode.end) {
    return lineRemoved;
  }
  let start = attrNode.start;
  let end = attrNode.end;
  if (source[start - 1] === ' ' || source[start - 1] === '\t') {
    start -= 1;
  } else if (source[end] === ' ' || source[end] === '\t') {
    end += 1;
  }
  return {
    start,
    end,
    expectedText: source.slice(start, end),
    replacement: '',
  };
}

function applySpans(
  source: string,
  edits: readonly { start: number; end: number; replacement: string }[],
): string {
  const sorted = [...edits].sort((a, b) => b.start - a.start);
  let out = source;
  for (const edit of sorted) {
    out = out.slice(0, edit.start) + edit.replacement + out.slice(edit.end);
  }
  return out;
}

function insertOpeningAttributePatch(
  source: string,
  located: LocatedTarget,
  attrText: string,
): SourceEditPatch {
  const offset = located.target.insertionOffset;
  const needsLeadingSpace = !/\s/.test(source[offset - 1] ?? '');
  const needsTrailingSpace = located.selfClosing && /\s/.test(source[offset - 1] ?? '');
  const replacement = `${needsLeadingSpace ? ' ' : ''}${attrText}${needsTrailingSpace ? ' ' : ''}`;
  return {
    start: offset,
    end: offset,
    expectedText: '',
    replacement,
  };
}

function removeObjectPropertyEdits(
  source: string,
  objectNode: AstNode,
  attrNode: AstNode,
  propNode: AstNode,
): { start: number; end: number; replacement: string }[] {
  const properties = children(objectNode.properties);
  if (properties.length === 1) {
    const attrPatch = removeJsxAttributePatch(source, attrNode);
    return [{ start: attrPatch.start, end: attrPatch.end, replacement: attrPatch.replacement }];
  }
  const idx = properties.indexOf(propNode);
  if (idx < properties.length - 1) {
    const next = properties[idx + 1];
    if (next) {
      return [{ start: propNode.start, end: next.start, replacement: '' }];
    }
  }
  const prev = properties[idx - 1];
  if (!prev) return [];
  const after = source.slice(propNode.end, objectNode.end - 1);
  const trailingComma = after.indexOf(',');
  if (trailingComma >= 0) {
    const between = source.slice(prev.end, propNode.start);
    const prevComma = between.indexOf(',');
    if (prevComma >= 0) {
      return [
        {
          start: prev.end + prevComma + 1,
          end: propNode.end + trailingComma + 1,
          replacement: '',
        },
      ];
    }
  }
  return [{ start: prev.end, end: propNode.end, replacement: '' }];
}

function insertObjectPropertyEdit(
  source: string,
  objectNode: AstNode,
  entryText: string,
): { start: number; end: number; replacement: string } {
  const properties = children(objectNode.properties);
  if (properties.length === 0) {
    return {
      start: objectNode.start + 1,
      end: objectNode.end - 1,
      replacement: ` ${entryText} `,
    };
  }
  const lastProp = properties[properties.length - 1];
  if (!lastProp) {
    return { start: objectNode.end - 1, end: objectNode.end - 1, replacement: ` ${entryText} ` };
  }
  const between = source.slice(lastProp.end, objectNode.end - 1);
  const commaIdx = between.indexOf(',');
  const indentInfo = lineIndentBefore(source, lastProp.start);
  const isMultiline = source.slice(objectNode.start, objectNode.end).includes('\n');

  if (commaIdx >= 0) {
    const insertAt = lastProp.end + commaIdx + 1;
    const replacement =
      isMultiline && indentInfo
        ? `${indentInfo.eol}${indentInfo.indent}${entryText},`
        : ` ${entryText}`;
    return { start: insertAt, end: insertAt, replacement };
  }
  const replacement =
    isMultiline && indentInfo
      ? `,${indentInfo.eol}${indentInfo.indent}${entryText}`
      : `, ${entryText}`;
  return { start: lastProp.end, end: lastProp.end, replacement };
}

function planStyleSet(
  source: string,
  located: LocatedTarget,
  property: SourceEditStyleProperty,
  value: string,
): SourceEditPatch | SourceEditRejectedV1 {
  const literal = formatStyleLiteral(value);
  const styleState = located.styleState;

  if (styleState.kind === 'absent') {
    if (!located.target.capabilities?.canUpsertStyle) {
      return rejectEdit(
        'unsupported-field',
        located.target.unsupported[0]?.message ?? 'Style insertion is not supported here.',
      );
    }
    return insertOpeningAttributePatch(source, located, `style={{ ${property}: ${literal} }}`);
  }

  if (styleState.kind !== 'object') {
    return rejectEdit(
      'unsupported-field',
      located.target.unsupported[0]?.message ?? 'This inline style object is not editable.',
    );
  }

  const existing = styleState.editableProps.get(property);
  const conflictProperty: SourceEditStyleProperty | undefined =
    property === 'backgroundColor'
      ? 'background'
      : property === 'background'
        ? 'backgroundColor'
        : undefined;
  const conflict = conflictProperty ? styleState.editableProps.get(conflictProperty) : undefined;

  if (!existing && !conflict && !located.target.capabilities?.canUpsertStyle) {
    return rejectEdit(
      'unsupported-field',
      located.target.unsupported[0]?.message ?? 'Style insertion is not supported here.',
    );
  }

  if (existing && !existing.staticValue && !located.target.capabilities?.canUpsertStyle) {
    return rejectEdit(
      'unsupported-field',
      located.target.unsupported[0]?.message ?? 'Dynamic style overrides are not supported here.',
    );
  }

  if (existing && !conflict) {
    return {
      start: existing.valueNode.start,
      end: existing.valueNode.end,
      expectedText: source.slice(existing.valueNode.start, existing.valueNode.end),
      replacement: literal,
    };
  }

  if (existing && conflict) {
    const edits = [
      {
        start: existing.valueNode.start,
        end: existing.valueNode.end,
        replacement: literal,
      },
      ...removeObjectPropertyEdits(
        source,
        styleState.objectNode,
        styleState.attrNode,
        conflict.propNode,
      ),
    ];
    const next = applySpans(source, edits);
    return minimalPatch(source, next);
  }

  if (!existing && conflict) {
    return {
      start: conflict.propNode.start,
      end: conflict.propNode.end,
      expectedText: source.slice(conflict.propNode.start, conflict.propNode.end),
      replacement: `${property}: ${literal}`,
    };
  }

  const edit = insertObjectPropertyEdit(source, styleState.objectNode, `${property}: ${literal}`);
  return {
    start: edit.start,
    end: edit.end,
    expectedText: source.slice(edit.start, edit.end),
    replacement: edit.replacement,
  };
}

function planStyleRemove(
  source: string,
  located: LocatedTarget,
  property: SourceEditStyleProperty,
): SourceEditPatch | SourceEditRejectedV1 {
  if (located.target.unsupported.some((item) => item.field === 'target')) {
    return rejectEdit(
      'unsupported-field',
      located.target.unsupported[0]?.message ?? 'This element is not editable.',
    );
  }
  if (located.styleState.kind !== 'object') {
    return rejectEdit('unsupported-field', 'This style property is not present on the element.');
  }
  const existing = located.styleState.editableProps.get(property);
  if (!existing) {
    return rejectEdit('unsupported-field', 'This style property is not present on the element.');
  }
  const edits = removeObjectPropertyEdits(
    source,
    located.styleState.objectNode,
    located.styleState.attrNode,
    existing.propNode,
  );
  const next = applySpans(source, edits);
  return minimalPatch(source, next);
}

function planArrayStructuralOp(
  source: string,
  located: LocatedTarget,
  op:
    | { kind: 'duplicate-element'; itemIndex: number }
    | { kind: 'delete-element'; itemIndex: number }
    | { kind: 'reorder-sibling'; direction: 'up' | 'down'; itemIndex: number },
): SourceEditPatch | SourceEditRejectedV1 {
  const mapInfo = located.mapInfo;
  if (!mapInfo) {
    return rejectEdit('unsupported-field', 'This element is not backed by a static mapped array.');
  }
  const elements = mapInfo.arrayElements;
  if (op.itemIndex < 0 || op.itemIndex >= elements.length) {
    return rejectEdit('unsupported-field', 'Mapped item index is out of range.');
  }

  if (op.kind === 'duplicate-element') {
    const el = elements[op.itemIndex];
    if (!el) return rejectEdit('unsupported-field', 'Mapped item not found.');
    const elText = source.slice(el.start, el.end);
    const indentInfo = lineIndentBefore(source, el.start);
    const isMultiline = source.slice(mapInfo.arrayNode.start, mapInfo.arrayNode.end).includes('\n');
    const replacement =
      isMultiline && indentInfo ? `,${indentInfo.eol}${indentInfo.indent}${elText}` : `, ${elText}`;
    return {
      start: el.end,
      end: el.end,
      expectedText: '',
      replacement,
    };
  }

  if (op.kind === 'delete-element') {
    const el = elements[op.itemIndex];
    if (!el) return rejectEdit('unsupported-field', 'Mapped item not found.');
    if (elements.length === 1) {
      return {
        start: mapInfo.arrayNode.start + 1,
        end: mapInfo.arrayNode.end - 1,
        expectedText: source.slice(mapInfo.arrayNode.start + 1, mapInfo.arrayNode.end - 1),
        replacement: '',
      };
    }
    if (op.itemIndex < elements.length - 1) {
      const next = elements[op.itemIndex + 1];
      if (!next) return rejectEdit('unsupported-field', 'Mapped item not found.');
      return {
        start: el.start,
        end: next.start,
        expectedText: source.slice(el.start, next.start),
        replacement: '',
      };
    }
    const prev = elements[op.itemIndex - 1];
    if (!prev) return rejectEdit('unsupported-field', 'Mapped item not found.');
    const after = source.slice(el.end, mapInfo.arrayNode.end - 1);
    const trailingComma = after.indexOf(',');
    if (trailingComma >= 0) {
      const between = source.slice(prev.end, el.start);
      const prevComma = between.indexOf(',');
      if (prevComma >= 0) {
        return {
          start: prev.end + prevComma + 1,
          end: el.end + trailingComma + 1,
          expectedText: source.slice(prev.end + prevComma + 1, el.end + trailingComma + 1),
          replacement: '',
        };
      }
    }
    return {
      start: prev.end,
      end: el.end,
      expectedText: source.slice(prev.end, el.end),
      replacement: '',
    };
  }

  const pair =
    op.direction === 'up'
      ? op.itemIndex > 0
        ? { a: elements[op.itemIndex - 1], b: elements[op.itemIndex] }
        : null
      : op.itemIndex < elements.length - 1
        ? { a: elements[op.itemIndex], b: elements[op.itemIndex + 1] }
        : null;
  if (!pair?.a || !pair.b) {
    return rejectEdit('unsupported-field', 'Mapped item cannot be reordered in that direction.');
  }
  const aText = source.slice(pair.a.start, pair.a.end);
  const mid = source.slice(pair.a.end, pair.b.start);
  const bText = source.slice(pair.b.start, pair.b.end);
  return {
    start: pair.a.start,
    end: pair.b.end,
    expectedText: source.slice(pair.a.start, pair.b.end),
    replacement: `${bText}${mid}${aText}`,
  };
}

function planSingleJsxEdit(
  source: string,
  located: LocatedTarget,
  op: SourceEditOperation,
): SourceEditPatch | SourceEditRejectedV1 {
  const caps = located.target.capabilities;
  switch (op.kind) {
    case 'set-text': {
      const field = located.fields.find((candidate) => sameField(candidate.operation, op));
      if (!field) {
        return rejectEdit(
          'unsupported-field',
          located.target.unsupported[0]?.message ?? 'This static field is not editable.',
        );
      }
      if (runtimeReservedValue(op.value)) {
        return rejectEdit(
          'runtime-reserved-value',
          'This value contains preview runtime control text (mount, document/tweak marker or App/_App declaration) that cannot yet be safely edited as a literal.',
        );
      }
      const literal = quote(op.value);
      return {
        start: field.start,
        end: field.end,
        expectedText: source.slice(field.start, field.end),
        replacement: field.expressionContainer ? `{${literal}}` : literal,
      };
    }
    case 'set-attribute': {
      if (!validAttributeValue(op.name, op.value)) {
        return rejectEdit(
          'invalid-operation',
          `Unsafe URL scheme in ${op.name} attribute is not allowed.`,
        );
      }
      if (runtimeReservedValue(op.value)) {
        return rejectEdit(
          'runtime-reserved-value',
          'This value contains preview runtime control text (mount, document/tweak marker or App/_App declaration) that cannot yet be safely edited as a literal.',
        );
      }
      const field = located.fields.find((candidate) => sameField(candidate.operation, op));
      if (field) {
        const literal = quote(op.value);
        return {
          start: field.start,
          end: field.end,
          expectedText: source.slice(field.start, field.end),
          replacement: field.expressionContainer ? `{${literal}}` : literal,
        };
      }
      if (located.dynamicAttrs.has(op.name) || located.attrNodes.has(op.name)) {
        return rejectEdit(
          'unsupported-field',
          located.target.unsupported[0]?.message ?? `${op.name} is not a static string attribute.`,
        );
      }
      if (!caps?.canUpsertAttribute || !canUpsertAttributeForTag(located.target.tagName, op.name)) {
        return rejectEdit(
          'unsupported-field',
          located.target.unsupported[0]?.message ?? 'Attribute insertion is not supported here.',
        );
      }
      return insertOpeningAttributePatch(source, located, `${op.name}={${quote(op.value)}}`);
    }
    case 'remove-attribute': {
      if (located.target.unsupported.some((item) => item.field === 'target')) {
        return rejectEdit(
          'unsupported-field',
          located.target.unsupported[0]?.message ?? 'This element is not editable.',
        );
      }
      const attrNode = located.attrNodes.get(op.name);
      if (!attrNode || located.dynamicAttrs.has(op.name)) {
        return rejectEdit(
          'unsupported-field',
          'This static attribute is not present on the element.',
        );
      }
      return removeJsxAttributePatch(source, attrNode);
    }
    case 'set-style': {
      if (!validStyle(op.property, op.value)) {
        return rejectEdit(
          'invalid-style',
          'Use a valid CSS literal, safe calc/clamp, or var(--...) custom property; URLs and expressions are unsupported.',
        );
      }
      if (runtimeReservedValue(op.value)) {
        return rejectEdit(
          'runtime-reserved-value',
          'This value contains preview runtime control text (mount, document/tweak marker or App/_App declaration) that cannot yet be safely edited as a literal.',
        );
      }
      return planStyleSet(source, located, op.property, op.value);
    }
    case 'remove-style':
      return planStyleRemove(source, located, op.property);
    case 'set-class-name': {
      if (!caps?.canEditClassName) {
        return rejectEdit(
          'unsupported-field',
          located.target.unsupported[0]?.message ?? 'Class name editing is not supported here.',
        );
      }
      if (runtimeReservedValue(op.value)) {
        return rejectEdit(
          'runtime-reserved-value',
          'This value contains preview runtime control text (mount, document/tweak marker or App/_App declaration) that cannot yet be safely edited as a literal.',
        );
      }
      const formatted = formatClassNameValue(op.value);
      if (located.classNameState.valueNode) {
        const valNode = located.classNameState.valueNode;
        return {
          start: valNode.start,
          end: valNode.end,
          expectedText: source.slice(valNode.start, valNode.end),
          replacement: formatted,
        };
      }
      return insertOpeningAttributePatch(source, located, `className=${formatted}`);
    }
    case 'toggle-visibility': {
      if (located.target.unsupported.some((item) => item.field === 'target')) {
        return rejectEdit(
          'unsupported-field',
          located.target.unsupported[0]?.message ?? 'This element is not editable.',
        );
      }
      if (op.hidden) {
        return planStyleSet(source, located, 'display', 'none');
      }
      if (
        located.styleState.kind === 'object' &&
        located.styleState.editableProps.get('display')?.staticValue === 'none'
      ) {
        return planStyleRemove(source, located, 'display');
      }
      return { start: 0, end: 0, expectedText: '', replacement: '' };
    }
    case 'duplicate-element': {
      if (op.itemIndex !== undefined) {
        return planArrayStructuralOp(source, located, {
          kind: 'duplicate-element',
          itemIndex: op.itemIndex,
        });
      }
      if (!caps?.canDuplicate || located.mapInfo?.isMapRoot) {
        return rejectEdit(
          'unsupported-field',
          located.target.unsupported[0]?.message ?? 'This element cannot be duplicated.',
        );
      }
      const elementText = source.slice(located.target.start, located.target.end);
      const indentInfo = lineIndentBefore(source, located.target.start);
      const replacement = indentInfo
        ? `${indentInfo.eol}${indentInfo.indent}${elementText}`
        : elementText;
      return {
        start: located.target.end,
        end: located.target.end,
        expectedText: '',
        replacement,
      };
    }
    case 'delete-element': {
      if (op.itemIndex !== undefined) {
        return planArrayStructuralOp(source, located, {
          kind: 'delete-element',
          itemIndex: op.itemIndex,
        });
      }
      if (!caps?.canDelete || located.mapInfo?.isMapRoot) {
        return rejectEdit(
          'unsupported-field',
          located.target.unsupported[0]?.message ?? 'This element cannot be deleted.',
        );
      }
      return removeSpanPreservingIndent(source, located.target.start, located.target.end);
    }
    case 'reorder-sibling': {
      if (op.itemIndex !== undefined) {
        return planArrayStructuralOp(source, located, {
          kind: 'reorder-sibling',
          direction: op.direction,
          itemIndex: op.itemIndex,
        });
      }
      const sibling = op.direction === 'up' ? located.prevSibling : located.nextSibling;
      if (!sibling) {
        return rejectEdit(
          'unsupported-field',
          'This element cannot be reordered in that direction.',
        );
      }
      const pair =
        op.direction === 'up'
          ? {
              a: { start: sibling.start, end: sibling.end },
              b: { start: located.target.start, end: located.target.end },
            }
          : {
              a: { start: located.target.start, end: located.target.end },
              b: { start: sibling.start, end: sibling.end },
            };
      const aText = source.slice(pair.a.start, pair.a.end);
      const mid = source.slice(pair.a.end, pair.b.start);
      const bText = source.slice(pair.b.start, pair.b.end);
      return {
        start: pair.a.start,
        end: pair.b.end,
        expectedText: source.slice(pair.a.start, pair.b.end),
        replacement: `${bText}${mid}${aText}`,
      };
    }
    case 'set-map-item-text': {
      const mapInfo = located.mapInfo;
      if (!mapInfo) {
        return rejectEdit('unsupported-field', 'This element is not inside a static mapped array.');
      }
      const field = mapInfo.fieldsByKey.get(op.fieldKey);
      if (!field) {
        return rejectEdit('unsupported-field', `Mapped field "${op.fieldKey}" is not editable.`);
      }
      const span = field.valueSpans[op.itemIndex];
      if (!span) {
        return rejectEdit('unsupported-field', 'Mapped item index is out of range.');
      }
      if (runtimeReservedValue(op.value)) {
        return rejectEdit(
          'runtime-reserved-value',
          'This value contains preview runtime control text (mount, document/tweak marker or App/_App declaration) that cannot yet be safely edited as a literal.',
        );
      }
      return {
        start: span.start,
        end: span.end,
        expectedText: source.slice(span.start, span.end),
        replacement: quote(op.value),
      };
    }
  }
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
  if (/\.(html|htm)$/i.test(input.path)) {
    return planHtmlSourceEdit(input);
  }
  if (input.selectionMode === 'source')
    return rejectEdit(
      'source-mode-removed',
      'Source-list editing has been removed. Select the element in the current preview.',
    );
  if (input.scope !== 'source-definition')
    return rejectEdit(
      'invalid-scope',
      'Only source-definition editing is supported, not an arbitrary selected instance.',
    );
  const operation = SourceEditOperation.safeParse(input.operation);
  if (!operation.success)
    return rejectEdit('invalid-operation', 'Only allowlisted literal operations are supported.');
  if (sha256Hex(input.source) !== input.expectedSourceHash)
    return rejectEdit(
      'stale-source',
      'The source changed; inspect the current file before editing.',
    );
  const analysis = analyze(input.path, input.source, input.selectionMode);
  if ('status' in analysis) return analysis;
  const located = analysis.targets.find(({ target }) => target.id === input.targetId);
  if (!located)
    return rejectEdit(
      'invalid-target',
      'The target does not identify an original JSX host definition in the current source.',
    );
  const patch = planSingleJsxEdit(input.source, located, operation.data);
  if ('status' in patch) return patch;
  const content =
    input.source.slice(0, patch.start) + patch.replacement + input.source.slice(patch.end);
  try {
    parseSource(input.path, content);
  } catch {
    return rejectEdit(
      'reparse-failed',
      'The patched source failed parsing; no content was applied.',
    );
  }
  return {
    schemaVersion: 1,
    status: 'applied',
    path: input.path,
    content,
    sourceHash: sha256Hex(content),
    patch,
    scope: 'source-definition',
  };
}

/**
 * Plans several fields of one selected definition as a single write. Literal
 * replacements never change the parsed element order, so each step re-analyzes
 * the intermediate source and re-locates the same host (and text segment) by
 * position rather than trusting offsets that earlier steps have shifted.
 */
export function planSourceEditBatch(input: {
  path: string;
  source: string;
  expectedSourceHash: string;
  targetId: string;
  operations: readonly SourceEditOperation[];
  scope: SourceEditScope;
  selectionMode?: SourceEditSelectionMode | undefined;
}): SourceEditApplyResultV1 {
  if (input.operations.length === 0 || input.operations.length > SOURCE_EDIT_BATCH_MAX_OPERATIONS)
    return rejectEdit(
      'invalid-operation',
      `A batch must contain between 1 and ${SOURCE_EDIT_BATCH_MAX_OPERATIONS} field edits.`,
    );
  if (/\.(html|htm)$/i.test(input.path)) {
    return planHtmlSourceEditBatch(input);
  }
  const keys = input.operations.map((operation) => {
    const parsed = SourceEditOperation.safeParse(operation);
    return parsed.success ? sourceEditFieldKey(parsed.data) : null;
  });
  if (keys.some((key) => key === null) || new Set(keys).size !== keys.length)
    return rejectEdit('invalid-operation', 'Each field may appear at most once in a batch.');
  if (
    input.operations.length > 1 &&
    input.operations.some((op) =>
      ['duplicate-element', 'delete-element', 'reorder-sibling'].includes(op.kind),
    )
  ) {
    return rejectEdit(
      'invalid-operation',
      'Structural operations cannot be combined with other operations in a single batch.',
    );
  }
  if (input.scope !== 'source-definition')
    return rejectEdit(
      'invalid-scope',
      'Only source-definition editing is supported, not an arbitrary selected instance.',
    );
  if (sha256Hex(input.source) !== input.expectedSourceHash)
    return rejectEdit(
      'stale-source',
      'The source changed; inspect the current file before editing.',
    );

  const first = analyze(input.path, input.source, input.selectionMode);
  if ('status' in first) return first;
  const index = first.targets.findIndex(({ target }) => target.id === input.targetId);
  const initial = first.targets[index];
  if (!initial)
    return rejectEdit(
      'invalid-target',
      'The target does not identify an original JSX host definition in the current source.',
    );
  const initialTextIds = initial.fields
    .filter((field) => field.operation.kind === 'set-text')
    .map((field) => (field.operation.kind === 'set-text' ? field.operation.textId : undefined));
  const textOrdinals = input.operations.map((operation) =>
    operation.kind === 'set-text' ? initialTextIds.indexOf(operation.textId) : -1,
  );
  if (
    input.operations.some((operation, i) => operation.kind === 'set-text' && textOrdinals[i] === -1)
  )
    return rejectEdit('unsupported-field', 'This static field is not editable.');

  let current = input.source;
  for (let i = 0; i < input.operations.length; i += 1) {
    const analysis = i === 0 ? first : analyze(input.path, current, input.selectionMode);
    if ('status' in analysis) return analysis;
    const located = analysis.targets[index];
    if (!located || located.target.tagName !== initial.target.tagName)
      return rejectEdit('stale-source', 'The selected definition moved while applying the batch.');
    let operation = input.operations[i] as SourceEditOperation;
    if (operation.kind === 'set-text') {
      const textFields = located.fields.filter((field) => field.operation.kind === 'set-text');
      const textField = textFields[textOrdinals[i] ?? -1]?.operation;
      if (!textField || textField.kind !== 'set-text')
        return rejectEdit('unsupported-field', 'This static field is not editable.');
      operation =
        textField.textId === undefined
          ? { kind: 'set-text', value: operation.value }
          : { kind: 'set-text', value: operation.value, textId: textField.textId };
    }
    const step = planSourceEdit({
      path: input.path,
      source: current,
      expectedSourceHash: sha256Hex(current),
      targetId: located.target.id,
      operation,
      scope: input.scope,
      selectionMode: input.selectionMode,
    });
    if (step.status !== 'applied') return step;
    current = step.content;
  }
  return {
    schemaVersion: 1,
    status: 'applied',
    path: input.path,
    content: current,
    sourceHash: sha256Hex(current),
    patch: minimalPatch(input.source, current),
    scope: 'source-definition',
  };
}
