import { createHash } from 'node:crypto';
import {
  type SourceEditApplyResultV1,
  SourceEditAttributeName,
  type SourceEditInspectResultV1,
  SourceEditOperation,
  type SourceEditPatch,
  type SourceEditRejectedV1,
  SourceEditStyleProperty,
  type SourceEditTarget,
  type SourceEditUnsupported,
} from '@open-codesign/shared';
import { type DefaultTreeAdapterTypes as Html, parse } from 'parse5';
import { validSourceEditStyle } from './source-edit-values';

interface Span {
  start: number;
  end: number;
}
interface AttributeSpan extends Span {
  value: string;
  rawValue: string;
  quoted: boolean;
  valueStart: number;
  valueEnd: number;
  hasEquals: boolean;
}
interface CssValue extends Span {
  name: string;
  value: string;
}
interface LocatedTarget {
  target: SourceEditTarget;
  element: Html.Element;
  text?: Span;
  styles?: { attribute?: AttributeSpan; values: CssValue[] };
}
type Analysis = { sourceHash: string; targets: LocatedTarget[] };
const htmlNamespace = 'http://www.w3.org/1999/xhtml';
const excluded = new Set([
  'head',
  'title',
  'script',
  'style',
  'template',
  'noscript',
  'iframe',
  'object',
  'embed',
  'base',
  'link',
  'meta',
  'xmp',
  'plaintext',
]);
const mayOmitEndTag = new Set([
  'html',
  'head',
  'body',
  'p',
  'li',
  'dt',
  'dd',
  'rt',
  'rp',
  'optgroup',
  'option',
  'colgroup',
  'thead',
  'tbody',
  'tfoot',
  'tr',
  'td',
  'th',
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr',
]);
const cssNames: Record<SourceEditStyleProperty, string> = {
  color: 'color',
  backgroundColor: 'background-color',
  fontSize: 'font-size',
  gap: 'gap',
  padding: 'padding',
  borderRadius: 'border-radius',
  maxWidth: 'max-width',
};
const hash = (source: string) => createHash('sha256').update(source, 'utf8').digest('hex');
const reject = (reason: string, message: string): SourceEditRejectedV1 => ({
  schemaVersion: 1,
  status: 'rejected',
  reason,
  message,
});
const problem = (
  field: SourceEditUnsupported['field'],
  reason: string,
  message: string,
): SourceEditUnsupported => ({ field, reason, message });

function attributeSpan(
  source: string,
  element: Html.Element,
  name: string,
): AttributeSpan | undefined {
  const attr = element.attrs.find((item) => item.name === name);
  const loc = element.sourceCodeLocation?.attrs?.[name];
  if (!attr || !loc) return undefined;
  const raw = source.slice(loc.startOffset, loc.endOffset);
  const prefix = /^[^\t\n\f\r =/>]+[\t\n\f\r ]*(?:=[\t\n\f\r ]*)?/.exec(raw)?.[0] ?? '';
  const hasEquals = prefix.includes('=');
  const start = loc.startOffset + prefix.length;
  const quote = source[start];
  const quoted = hasEquals && (quote === '"' || quote === "'");
  const valueStart = hasEquals ? start + (quoted ? 1 : 0) : loc.endOffset;
  const valueEnd = hasEquals ? loc.endOffset - (quoted ? 1 : 0) : loc.endOffset;
  return {
    start: loc.startOffset,
    end: loc.endOffset,
    value: attr.value,
    rawValue: source.slice(valueStart, valueEnd),
    valueStart,
    valueEnd,
    quoted,
    hasEquals,
  };
}

function skipCssTrivia(source: string, start: number, end: number): number {
  let cursor = start;
  while (cursor < end) {
    if (/\s/.test(source[cursor] ?? '')) cursor++;
    else if (source.startsWith('/*', cursor)) {
      const close = source.indexOf('*/', cursor + 2);
      if (close < 0 || close + 2 > end) return end + 1;
      cursor = close + 2;
    } else break;
  }
  return cursor;
}

/** Split declarations without treating quoted/commented/parenthesized semicolons as boundaries. */
function cssValues(source: string): CssValue[] | null {
  const values: CssValue[] = [];
  const names = new Set<string>();
  let start = 0,
    colon = -1,
    quote = '',
    depth = 0,
    comment = false,
    priorityBang = -1;
  function declaration(end: number): boolean {
    const raw = source.slice(start, end);
    if (!raw.replace(/\/\*[\s\S]*?\*\//g, '').trim()) return true;
    if (colon < start) return false;
    const name = source
      .slice(start, colon)
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/^[\t\n\f\r ]+|[\t\n\f\r ]+$/g, '')
      .toLowerCase();
    if (!/^(?:--[a-z0-9_-]+|[a-z-]+)$/.test(name)) return false;
    let valueStart = colon + 1;
    while (/\s/.test(source[valueStart] ?? '') && valueStart < end) valueStart++;
    let valueEnd = end;
    while (valueEnd > valueStart && /\s/.test(source[valueEnd - 1] ?? '')) valueEnd--;
    if (priorityBang >= valueStart) {
      const keyword = skipCssTrivia(source, priorityBang + 1, valueEnd);
      if (
        source.slice(keyword, keyword + 9).toLowerCase() === 'important' &&
        skipCssTrivia(source, keyword + 9, valueEnd) === valueEnd
      ) {
        valueEnd = priorityBang;
        while (valueEnd > valueStart && /\s/.test(source[valueEnd - 1] ?? '')) valueEnd--;
      }
    }
    if (valueStart === valueEnd || names.has(name)) return false;
    names.add(name);
    values.push({
      name,
      value: source.slice(valueStart, valueEnd),
      start: valueStart,
      end: valueEnd,
    });
    return true;
  }
  for (let i = 0; i <= source.length; i++) {
    const char = source[i];
    if (comment) {
      if (char === '*' && source[i + 1] === '/') {
        comment = false;
        i++;
      }
      continue;
    }
    if (quote) {
      if (char === '\\') {
        i++;
        continue;
      }
      if (char === quote) quote = '';
      continue;
    }
    if (char === '/' && source[i + 1] === '*') {
      comment = true;
      i++;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === '\\' || char === '{' || char === '}') return null;
    if (char === '(') depth++;
    if (char === ')' && --depth < 0) return null;
    if (char === ':' && depth === 0 && colon < start) colon = i;
    if (char === '!' && depth === 0 && colon >= start) priorityBang = i;
    if ((char === ';' || i === source.length) && depth === 0) {
      if (!declaration(i)) return null;
      start = i + 1;
      colon = -1;
      priorityBang = -1;
    }
  }
  return quote || comment || depth ? null : values;
}

function analyze(source: string): Analysis | SourceEditRejectedV1 {
  if (!source.trimStart().startsWith('<') || source.length > 2 * 1024 * 1024)
    return reject('unsupported-source', 'HTML editing requires original HTML markup within 2 MiB.');
  let parseError = false;
  // Treat a UTF-8 BOM as parser whitespace without shifting any source offsets.
  const doc = parse(source.startsWith('\uFEFF') ? `\n${source.slice(1)}` : source, {
    sourceCodeLocationInfo: true,
    onParseError(error) {
      if (error.code !== 'missing-doctype') parseError = true;
    },
  });
  if (parseError)
    return reject(
      'ambiguous-html',
      'Repair malformed or duplicate HTML markup before selecting source elements.',
    );
  const all: { element: Html.Element; excluded: boolean }[] = [];
  const pending: { node: Html.Node; hidden: boolean }[] = [{ node: doc, hidden: false }];
  const starts = new Set<number>();
  while (pending.length) {
    const current = pending.pop();
    if (!current) break;
    const node = current.node;
    if (
      node.nodeName === '#comment' &&
      'data' in node &&
      /^(?:CODESIGN_OVERLAY_SCRIPT|OPEN-CODESIGN-PREVIEW-VIEWPORT)$/.test(node.data.trim())
    )
      return reject(
        'wrapped-source',
        'Open the original HTML file rather than an instrumented preview document.',
      );
    let hidden = current.hidden;
    if ('tagName' in node) {
      if (node.attrs.some((attr) => attr.name === 'data-codesign-source-id'))
        return reject(
          'reserved-provenance',
          'Remove authored source-edit provenance attributes before editing.',
        );
      if (
        node.tagName === 'meta' &&
        node.attrs.some(
          (attr) => attr.name === 'http-equiv' && attr.value.toLowerCase() === 'refresh',
        )
      )
        return reject(
          'navigating-source',
          'Automatic document refresh must be disabled before source editing.',
        );
      hidden ||=
        node.namespaceURI !== htmlNamespace ||
        excluded.has(node.tagName) ||
        node.tagName.includes('-');
      const loc = node.sourceCodeLocation;
      if (loc?.startTag) {
        if (!loc.endTag && !mayOmitEndTag.has(node.tagName))
          return reject(
            'ambiguous-html',
            'Close non-void HTML elements before selecting their source definitions.',
          );
        if (starts.has(loc.startTag.startOffset))
          return reject(
            'ambiguous-html',
            'Parser-reconstructed elements cannot be mapped uniquely to source.',
          );
        starts.add(loc.startTag.startOffset);
        all.push({ element: node, excluded: hidden });
      }
      if ('content' in node && node.tagName === 'template')
        pending.push({ node: (node as Html.Template).content, hidden: true });
    }
    if ('childNodes' in node)
      for (const child of node.childNodes) pending.push({ node: child, hidden });
  }
  if (all.length > 10_000)
    return reject('too-many-targets', 'HTML source has too many elements for local editing.');
  const targets: LocatedTarget[] = [];
  for (const { element, excluded: hidden } of all) {
    const loc = element.sourceCodeLocation;
    if (hidden || !loc?.startTag) continue;
    const end = loc.startTag.endOffset;
    // In <img alt=x/>, the slash belongs to the unquoted value, not a self-close token.
    const slashIsAttributeValue = Object.values(loc.attrs ?? {}).some(
      (attr) => attr.startOffset <= end - 2 && attr.endOffset > end - 2,
    );
    const insertionOffset = source[end - 2] === '/' && !slashIsAttributeValue ? end - 2 : end - 1;
    const target: SourceEditTarget = {
      id: `${loc.startOffset}:${loc.endOffset}`,
      tagName: element.tagName,
      start: loc.startOffset,
      end: loc.endOffset,
      insertionOffset,
      scope: 'source-definition',
      editableFields: [],
      unsupported: [],
    };
    const located: LocatedTarget = { target, element };
    if (
      loc.endTag &&
      element.tagName !== 'textarea' &&
      element.childNodes.every((child) => child.nodeName === '#text')
    ) {
      located.text = { start: loc.startTag.endOffset, end: loc.endTag.startOffset };
      target.editableFields.push({
        kind: 'set-text',
        value: element.childNodes.map((child) => (child as Html.TextNode).value).join(''),
      });
    } else if (element.childNodes.length) {
      target.unsupported.push(
        problem(
          'text',
          'nested-content',
          'Select a text leaf to change its text without replacing nested markup or comments.',
        ),
      );
    }
    for (const name of SourceEditAttributeName.options) {
      const existing = element.attrs.find((attr) => attr.name === name);
      if (
        existing ||
        name === 'title' ||
        (name === 'alt' && element.tagName === 'img') ||
        (name === 'placeholder' && ['input', 'textarea'].includes(element.tagName))
      )
        target.editableFields.push({ kind: 'set-attribute', name, value: existing?.value ?? '' });
    }
    const style = attributeSpan(source, element, 'style');
    const values = style ? (style.rawValue === style.value ? cssValues(style.rawValue) : null) : [];
    if (values) {
      located.styles = { ...(style ? { attribute: style } : {}), values };
      for (const property of SourceEditStyleProperty.options)
        target.editableFields.push({
          kind: 'set-style',
          property,
          value: values.find((value) => value.name === cssNames[property])?.value ?? '',
        });
    } else
      target.unsupported.push(
        problem(
          'style',
          'ambiguous-style',
          'Encoded, duplicate or ambiguous inline CSS is preserved; edit it in source first.',
        ),
      );
    targets.push(located);
  }
  targets.sort((a, b) => a.target.start - b.target.start);
  return { sourceHash: hash(source), targets };
}

export function analyzeHtmlSourceEdit(input: {
  path: string;
  source: string;
}): SourceEditInspectResultV1 {
  const result = analyze(input.source);
  if ('status' in result) return result;
  return {
    schemaVersion: 1,
    status: 'ready',
    path: input.path,
    sourceHash: result.sourceHash,
    targets: result.targets.map(({ target }) => target),
  };
}

function escapeText(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('\r', '&#13;');
}
function escapeAttribute(value: string): string {
  return escapeText(value)
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
    .replaceAll('\n', '&#10;')
    .replaceAll('\t', '&#9;');
}
function setAttribute(
  source: string,
  located: LocatedTarget,
  name: string,
  value: string,
): SourceEditPatch {
  const attr = attributeSpan(source, located.element, name);
  const replacement = `"${escapeAttribute(value)}"`;
  if (!attr)
    return {
      start: located.target.insertionOffset,
      end: located.target.insertionOffset,
      expectedText: '',
      replacement: ` ${name}=${replacement}`,
    };
  if (!attr.hasEquals)
    return { start: attr.end, end: attr.end, expectedText: '', replacement: `=${replacement}` };
  // Replace the value and its quotes together, retaining the exact name/spacing and other attributes.
  const start = attr.valueStart - (attr.quoted ? 1 : 0);
  const end = attr.valueEnd + (attr.quoted ? 1 : 0);
  return { start, end, expectedText: source.slice(start, end), replacement };
}

export function planHtmlSourceEdit(input: {
  path: string;
  source: string;
  expectedSourceHash: string;
  targetId: string;
  operation: SourceEditOperation;
  scope: 'source-definition';
}): SourceEditApplyResultV1 {
  if (input.scope !== 'source-definition')
    return reject('invalid-scope', 'Only source-definition edits are supported.');
  const parsed = SourceEditOperation.safeParse(input.operation);
  if (!parsed.success)
    return reject('invalid-operation', 'Only supported literal fields may be changed.');
  if (hash(input.source) !== input.expectedSourceHash)
    return reject('stale-source', 'The source changed; inspect the current file before editing.');
  const analysis = analyze(input.source);
  if ('status' in analysis) return analysis;
  const located = analysis.targets.find(({ target }) => target.id === input.targetId);
  if (!located)
    return reject(
      'invalid-target',
      'The element does not identify an original HTML source definition.',
    );
  const operation = parsed.data;
  const offered = located.target.editableFields.some(
    (field) =>
      field.kind === operation.kind &&
      (field.kind === 'set-text' ||
        (field.kind === 'set-attribute' &&
          operation.kind === 'set-attribute' &&
          field.name === operation.name) ||
        (field.kind === 'set-style' &&
          operation.kind === 'set-style' &&
          field.property === operation.property)),
  );
  if (!offered)
    return reject(
      'unsupported-field',
      'This element does not have a uniquely editable source field.',
    );
  const value = operation.value;
  if (
    value.includes('\0') ||
    [...value].some((char) => char.length === 1 && /[\uD800-\uDFFF]/.test(char))
  )
    return reject(
      'invalid-value',
      'The value must contain valid Unicode text without NUL characters.',
    );
  let patch: SourceEditPatch;
  if (operation.kind === 'set-text' && located.text) {
    patch = {
      ...located.text,
      expectedText: input.source.slice(located.text.start, located.text.end),
      replacement: escapeText(value),
    };
  } else if (operation.kind === 'set-attribute') {
    patch = setAttribute(input.source, located, operation.name, value);
  } else if (operation.kind === 'set-style' && located.styles) {
    if (!validSourceEditStyle(operation.property, value))
      return reject(
        'invalid-style',
        'Use a literal color or nonnegative CSS size, without URLs, variables or arbitrary declarations.',
      );
    const name = cssNames[operation.property];
    const css =
      operation.property === 'color' || operation.property === 'backgroundColor' || value === 'none'
        ? value
        : value
            .split(' ')
            .map((part) => (/^\d*\.?\d+$/.test(part) && Number(part) !== 0 ? `${part}px` : part))
            .join(' ');
    const attr = located.styles.attribute;
    const prior = located.styles.values.find((item) => item.name === name);
    if (attr && prior && attr.quoted) {
      const start = attr.valueStart + prior.start,
        end = attr.valueStart + prior.end;
      patch = {
        start,
        end,
        expectedText: input.source.slice(start, end),
        replacement: escapeAttribute(css),
      };
    } else {
      const existing = attr?.rawValue ?? '';
      const next = prior
        ? existing.slice(0, prior.start) + css + existing.slice(prior.end)
        : `${existing}${existing.trim() && !existing.trimEnd().endsWith(';') ? ';' : ''}${existing ? ' ' : ''}${name}: ${css};`;
      patch = setAttribute(input.source, located, 'style', next);
    }
  } else
    return reject(
      'unsupported-field',
      'This HTML field cannot be changed without replacing nested markup.',
    );
  const content =
    input.source.slice(0, patch.start) + patch.replacement + input.source.slice(patch.end);
  const after = analyze(content);
  if ('status' in after)
    return reject('reparse-failed', 'The patched HTML is ambiguous; no edit was applied.');
  return {
    schemaVersion: 1,
    status: 'applied',
    path: input.path,
    content,
    sourceHash: after.sourceHash,
    patch,
    scope: 'source-definition',
  };
}
