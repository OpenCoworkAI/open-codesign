import { createHash } from 'node:crypto';
import {
  SourceEditApplyResultV1,
  SourceEditInspectResultV1,
  type SourceEditOperation,
} from '@open-codesign/shared';
import { type DefaultTreeAdapterTypes as Html, parse } from 'parse5';
import { describe, expect, it } from 'vitest';
import { analyzeSourceEdit, planSourceEdit } from './source-edit-engine';

function inspect(source: string, path = 'pages/start.htm') {
  const result = SourceEditInspectResultV1.parse(analyzeSourceEdit({ path, source }));
  if (result.status !== 'ready') throw new Error(`${result.reason}: ${result.message}`);
  return result;
}
function apply(source: string, operation: SourceEditOperation, tag = 'h1') {
  const analysis = inspect(source);
  const target = analysis.targets.find((item) => item.tagName === tag);
  if (!target) throw new Error(`Missing ${tag}`);
  return SourceEditApplyResultV1.parse(
    planSourceEdit({
      path: analysis.path,
      source,
      expectedSourceHash: analysis.sourceHash,
      targetId: target.id,
      scope: 'source-definition',
      operation,
    }),
  );
}
function changed(source: string, operation: SourceEditOperation, tag = 'h1') {
  const result = apply(source, operation, tag);
  if (result.status !== 'applied') throw new Error(`${result.reason}: ${result.message}`);
  expect(result.patch.expectedText).toBe(source.slice(result.patch.start, result.patch.end));
  expect(result.content).toBe(
    source.slice(0, result.patch.start) + result.patch.replacement + source.slice(result.patch.end),
  );
  expect(result.sourceHash).toBe(createHash('sha256').update(result.content).digest('hex'));
  return result;
}
function element(source: string, tag: string): Html.Element {
  const pending: Html.Node[] = [parse(source)];
  while (pending.length) {
    const node = pending.pop();
    if (!node) continue;
    if ('tagName' in node && node.tagName === tag) return node;
    if ('childNodes' in node) pending.push(...node.childNodes);
  }
  throw new Error('No element');
}
const source =
  '<!doctype html>\r\n<html><head><style>h1{color:navy}</style></head><body><h1 TITLE = \'Old &amp; 标题\' style="color: red !important; font-family: \'A; B\'; --x: rgb(1,2,3); gap: 4px">你好 &amp; 世界 😀</h1><script>document.title="Keep script";</script></body></html>';

describe('HTML source-position editing', () => {
  it('preserves a UTF-8 BOM and CRLF bytes outside the selected text span', () => {
    const html = '\uFEFF<!doctype html>\r\n<html><body><h1>原文</h1></body></html>\r\n';
    expect(changed(html, { kind: 'set-text', value: 'New' }).content).toBe(
      html.replace('原文', 'New'),
    );
  });
  it('uses source positions to distinguish identical sibling elements', () => {
    const html = '<main><h1>Same</h1><h1>Same</h1></main>';
    const analysis = inspect(html);
    const target = analysis.targets.filter((item) => item.tagName === 'h1')[1];
    if (!target) throw new Error('Missing second target');
    const result = planSourceEdit({
      path: 'index.html',
      source: html,
      expectedSourceHash: analysis.sourceHash,
      targetId: target.id,
      scope: 'source-definition',
      operation: { kind: 'set-text', value: 'Second' },
    });
    expect(result).toMatchObject({
      status: 'applied',
      content: '<main><h1>Same</h1><h1>Second</h1></main>',
    });
  });
  it('decodes text for the panel and writes one escaped span, retaining CRLF, scripts and unrelated markup', () => {
    expect(
      inspect(source).targets.find((item) => item.tagName === 'h1')?.editableFields,
    ).toContainEqual({ kind: 'set-text', value: '你好 & 世界 😀' });
    const value = '新标题 <script>alert("x")</script> & 😀';
    const result = changed(source, { kind: 'set-text', value });
    expect(result.content).toBe(
      source.replace(
        '你好 &amp; 世界 😀',
        '新标题 &lt;script&gt;alert("x")&lt;/script&gt; &amp; 😀',
      ),
    );
    expect((element(result.content, 'h1').childNodes[0] as Html.TextNode).value).toBe(value);
  });
  it('updates quoted attributes while preserving name case, spacing and other attributes', () => {
    const result = changed(source, {
      kind: 'set-attribute',
      name: 'title',
      value: '" onmouseover="bad <>&\n',
    });
    expect(result.content).toContain('TITLE = "&quot; onmouseover=&quot;bad &lt;&gt;&amp;&#10;"');
    expect(
      element(result.content, 'h1').attrs.filter((attr) => attr.name === 'onmouseover'),
    ).toEqual([]);
    expect(element(result.content, 'h1').attrs.find((attr) => attr.name === 'title')?.value).toBe(
      '" onmouseover="bad <>&\n',
    );
  });
  it.each([
    '<h1 title=old>Text</h1>',
    '<h1 title>Text</h1>',
    '<h1>Text</h1>',
  ])('sets a missing, unquoted or boolean-form literal attribute: %s', (html) => {
    const result = changed(html, { kind: 'set-attribute', name: 'title', value: 'A " B' });
    expect(element(result.content, 'h1').attrs.find((attr) => attr.name === 'title')?.value).toBe(
      'A " B',
    );
    expect(
      element(result.content, 'h1').attrs.filter((attr) => attr.name === 'title'),
    ).toHaveLength(1);
  });
  it('adds placeholder and alt fields to HTML form/image elements, including uppercase void tags', () => {
    let result = changed(
      '<main><INPUT /><IMG/></main>',
      { kind: 'set-attribute', name: 'placeholder', value: '姓名' },
      'input',
    );
    expect(result.content).toContain(' placeholder="姓名"/>');
    result = changed(result.content, { kind: 'set-attribute', name: 'alt', value: 'Photo' }, 'img');
    expect(result.content).toContain('<IMG alt="Photo"/>');
  });
  it('does not reinterpret a trailing slash belonging to an unquoted attribute value', () => {
    const html = '<main><img alt=existing/></main>';
    expect(element(html, 'img').attrs.find((attr) => attr.name === 'alt')?.value).toBe('existing/');
    const result = changed(html, { kind: 'set-attribute', name: 'title', value: 'Added' }, 'img');
    expect(result.content).toBe('<main><img alt=existing/ title="Added"></main>');
    expect(element(result.content, 'img').attrs.find((attr) => attr.name === 'alt')?.value).toBe(
      'existing/',
    );
  });
  it('updates only the requested inline CSS value and keeps priority, custom values and quoted semicolons', () => {
    expect(
      changed(source, { kind: 'set-style', property: 'color', value: '#123456' }).content,
    ).toBe(source.replace('color: red !important', 'color: #123456 !important'));
    expect(changed(source, { kind: 'set-style', property: 'gap', value: '24' }).content).toBe(
      source.replace('gap: 4px', 'gap: 24px'),
    );
  });
  it('adds inline style properties to elements without rewriting sibling source', () => {
    const result = changed('<h1 id=x>Text</h1><p>Keep</p>', {
      kind: 'set-style',
      property: 'padding',
      value: '4 8',
    });
    expect(result.content).toBe('<h1 id=x style="padding: 4px 8px;">Text</h1><p>Keep</p>');
    const second = changed(result.content, { kind: 'set-style', property: 'color', value: 'blue' });
    expect(second.content).toContain('style="padding: 4px 8px; color: blue;"');
  });
  it('edits styles with comments/parenthesized semicolons and leaves unrelated declarations intact', () => {
    const html = '<h1 style="background-image: url(\'x;y.png\'); /* keep */ color: red;">Text</h1>';
    expect(changed(html, { kind: 'set-style', property: 'color', value: 'green' }).content).toBe(
      html.replace('color: red', 'color: green'),
    );
  });
  it('preserves CSS comment-separated important priorities', () => {
    const html = '<h1 style="color:red !/* keep */important; padding: 4px">Text</h1>';
    expect(changed(html, { kind: 'set-style', property: 'color', value: 'blue' }).content).toBe(
      html.replace('color:red', 'color:blue'),
    );
  });
  it('handles long comment-separated priorities without backtracking and preserves their bytes', () => {
    const comments = '/**/'.repeat(8000);
    const html = `<h1 style="color:red !${comments}important${comments}; padding:4px">Text</h1>`;
    expect(changed(html, { kind: 'set-style', property: 'color', value: 'blue' }).content).toBe(
      html.replace('color:red', 'color:blue'),
    );
  });
  it('does not treat quoted exclamations or non-priority suffixes as CSS priority', () => {
    const html = '<h1 style="--label: \'!important\'; color:red /* keep */">Text</h1>';
    expect(changed(html, { kind: 'set-style', property: 'color', value: 'blue' }).content).toBe(
      '<h1 style="--label: \'!important\'; color:blue">Text</h1>',
    );
  });
  it.each([
    'url(https://example.com)',
    'red;display:none',
    'var(--color)',
    '-1px',
    '1px}',
    'expression(x)',
  ])('rejects unsupported style values: %s', (value) => {
    expect(apply(source, { kind: 'set-style', property: 'color', value })).toMatchObject({
      status: 'rejected',
      reason: 'invalid-style',
    });
  });
  it.each([
    'color:red;COLOR:blue',
    'color:&#114;ed',
    'color:var(--x',
    'co\\6cor:red',
    'co/**/lor:red',
  ])('preserves ambiguous inline CSS while retaining independent text fields: %s', (style) => {
    const html = `<h1 style="${style}">Text</h1>`;
    const target = inspect(html).targets[0];
    expect(target?.unsupported).toContainEqual(expect.objectContaining({ field: 'style' }));
    expect(apply(html, { kind: 'set-style', property: 'color', value: 'blue' })).toMatchObject({
      status: 'rejected',
      reason: 'unsupported-field',
    });
    expect(changed(html, { kind: 'set-text', value: 'Changed' }).content).toBe(
      html.replace('>Text<', '>Changed<'),
    );
  });
  it('does not flatten nested markup or comments to change parent text', () => {
    for (const html of ['<h1>Hi <span>there</span></h1>', '<h1>Hi<!--keep--></h1>']) {
      expect(apply(html, { kind: 'set-text', value: 'New' })).toMatchObject({
        status: 'rejected',
        reason: 'unsupported-field',
      });
      expect(
        changed(html, { kind: 'set-style', property: 'fontSize', value: '2rem' }).content,
      ).toContain('font-size: 2rem');
    }
  });
  it('does not create targets for scripts, styles, templates, foreign nodes or synthesized tbody', () => {
    const result = inspect(
      '<!doctype html><html><head><style>p{color:red}</style></head><body><template><h1>Hidden</h1></template><svg><text>SVG</text></svg><script>const x="<h1>String</h1>";</script><table><tr><td>Cell</td></tr></table><h1>Visible</h1></body></html>',
    );
    const tags = result.targets.map((target) => target.tagName);
    for (const tag of ['script', 'style', 'template', 'svg', 'text', 'tbody'])
      expect(tags).not.toContain(tag);
    expect(tags.filter((tag) => tag === 'h1')).toHaveLength(1);
    for (const target of result.targets) expect(target.id).toBe(`${target.start}:${target.end}`);
  });
  it.each([
    '<h1 title=a title=b>Text</h1>',
    '<main><h1>Text',
    '<p data-codesign-source-id="fake">Text</p>',
    '<meta http-equiv=refresh content=0><h1>Text</h1>',
    '<!-- CODESIGN_OVERLAY_SCRIPT --><h1>Text</h1>',
    'function App(){return <h1>Text</h1>}',
  ])('rejects unsafe/ambiguous original mappings: %s', (html) => {
    expect(analyzeSourceEdit({ path: 'index.html', source: html })).toMatchObject({
      status: 'rejected',
    });
  });
  it('allows empty text leaves and preserves markup-looking text values as text', () => {
    const value = 'ReactDOM.createRoot <!-- CODESIGN_OVERLAY_SCRIPT --> &lt;';
    const result = changed('<h1></h1>', { kind: 'set-text', value });
    expect((element(result.content, 'h1').childNodes[0] as Html.TextNode).value).toBe(value);
  });
  it('rejects stale hashes, forged target IDs and invalid Unicode values', () => {
    const analysis = inspect(source);
    const operation = { kind: 'set-text' as const, value: 'New' };
    const input = {
      path: analysis.path,
      source,
      expectedSourceHash: analysis.sourceHash,
      targetId: analysis.targets.find((target) => target.tagName === 'h1')?.id ?? '',
      operation,
      scope: 'source-definition' as const,
    };
    expect(planSourceEdit({ ...input, source: `${source}\n` })).toMatchObject({
      status: 'rejected',
      reason: 'stale-source',
    });
    expect(planSourceEdit({ ...input, targetId: '1:2' })).toMatchObject({
      status: 'rejected',
      reason: 'invalid-target',
    });
    for (const value of ['\0', '\uD800'])
      expect(planSourceEdit({ ...input, operation: { ...operation, value } })).toMatchObject({
        status: 'rejected',
        reason: 'invalid-value',
      });
  });
});
