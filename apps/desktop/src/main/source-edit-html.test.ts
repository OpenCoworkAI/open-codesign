import { createHash } from 'node:crypto';
import {
  SourceEditApplyResultV1,
  SourceEditInspectResultV1,
  type SourceEditOperation,
} from '@open-codesign/shared';
import { describe, expect, it } from 'vitest';
import {
  analyzeHtmlSourceEdit,
  planHtmlSourceEdit,
  planHtmlSourceEditBatch,
} from './source-edit-html';

function inspectHtml(source: string, path = 'index.html') {
  const result = analyzeHtmlSourceEdit({ path, source });
  expect(SourceEditInspectResultV1.safeParse(result).success).toBe(true);
  if (result.status !== 'ready') throw new Error(`${result.reason}: ${result.message}`);
  return result;
}

function applyHtml(
  source: string,
  operation: SourceEditOperation,
  tagName = 'h1',
  path = 'index.html',
) {
  const inspected = inspectHtml(source, path);
  const target = inspected.targets.find((t) => t.tagName === tagName);
  if (!target) throw new Error(`Missing target ${tagName}`);
  return planHtmlSourceEdit({
    path,
    source,
    expectedSourceHash: inspected.sourceHash,
    targetId: target.id,
    operation,
    scope: 'source-definition',
  });
}

function appliedHtml(
  source: string,
  operation: SourceEditOperation,
  tagName = 'h1',
  path = 'index.html',
) {
  const result = applyHtml(source, operation, tagName, path);
  expect(SourceEditApplyResultV1.safeParse(result).success).toBe(true);
  if (result.status !== 'applied') throw new Error(`${result.reason}: ${result.message}`);
  expect(
    source.slice(0, result.patch.start) + result.patch.replacement + source.slice(result.patch.end),
  ).toBe(result.content);
  expect(result.sourceHash).toBe(createHash('sha256').update(result.content, 'utf8').digest('hex'));
  return result;
}

const doc = `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Demo</title>
  <style>body { margin: 0; }</style>
</head>
<body>
  <main class="container p-4">
    <h1 title="Welcome" style="color: #111111; gap: 12px">Hello &amp; Welcome</h1>
    <p>Second paragraph</p>
    <img src="hero.png" alt="Hero" />
    <svg class="icon" viewBox="0 0 10 10"><path d="M0 0h10v10z" /></svg>
  </main>
  <script type="text/babel">const Unused = () => <div />; </script>
</body>
</html>`;

describe('static HTML/HTM source edit adapter', () => {
  it('excludes head/script/style/meta/svg-internals while exposing safe HTML targets and metadata', () => {
    const inspected = inspectHtml(doc, 'page.htm');
    const tags = inspected.targets.map((t) => t.tagName);
    expect(tags).toEqual(['body', 'main', 'h1', 'p', 'img', 'svg']);
    expect(tags).not.toContain('html');
    expect(tags).not.toContain('head');
    expect(tags).not.toContain('meta');
    expect(tags).not.toContain('style');
    expect(tags).not.toContain('script');
    expect(tags).not.toContain('path');

    const h1 = inspected.targets.find((t) => t.tagName === 'h1');
    expect(h1?.capabilities).toMatchObject({
      canUpsertStyle: true,
      canUpsertAttribute: true,
      canEditClassName: true,
      canReorderUp: false,
      canReorderDown: true,
      canDuplicate: true,
      canDelete: true,
      sharedDefinition: false,
      styleMode: 'html',
    });
    expect(h1?.sourceLocation).toMatchObject({ startLine: 10, startCol: 5 });
    expect(h1?.editableFields).toEqual([
      { kind: 'set-text', value: 'Hello & Welcome' },
      { kind: 'set-attribute', name: 'title', value: 'Welcome' },
      { kind: 'set-style', property: 'color', value: '#111111' },
      { kind: 'set-style', property: 'gap', value: '12px' },
    ]);

    const main = inspected.targets.find((t) => t.tagName === 'main');
    expect(main?.className).toBe('container p-4');

    const svg = inspected.targets.find((t) => t.tagName === 'svg');
    expect(svg?.capabilities?.canUpsertStyle).toBe(false);
    expect(svg?.capabilities?.canUpsertAttribute).toBe(false);
  });

  it('preserves BOM and CRLF offsets across HTML inspect and edit', () => {
    const crlf = '\uFEFF<!doctype html>\r\n<html><body><h1>Hi</h1></body></html>';
    const inspected = inspectHtml(crlf);
    expect(inspected.sourceHash).toBe(createHash('sha256').update(crlf, 'utf8').digest('hex'));
    const edited = appliedHtml(crlf, { kind: 'set-text', value: 'Updated <safe>' });
    expect(edited.content.startsWith('\uFEFF')).toBe(true);
    expect(edited.content).toContain('<h1>Updated &lt;safe&gt;</h1>');
  });

  it('edits, upserts, and removes inline CSS declarations and background conflicts cleanly', () => {
    const updated = appliedHtml(doc, {
      kind: 'set-style',
      property: 'padding',
      value: '16px 24px',
    });
    expect(updated.content).toContain('style="color: #111111; gap: 12px; padding: 16px 24px"');

    const numericNormalized = appliedHtml(doc, { kind: 'set-style', property: 'gap', value: '24' });
    expect(numericNormalized.content).toContain('gap: 24px');

    const removedOne = appliedHtml(doc, { kind: 'remove-style', property: 'color' });
    expect(removedOne.content).toContain('style="gap: 12px"');
    const removedLast = appliedHtml(removedOne.content, { kind: 'remove-style', property: 'gap' });
    expect(removedLast.content).toContain('<h1 title="Welcome">');

    const withBg = '<div style="background: linear-gradient(red, blue)">Box</div>';
    const solid = appliedHtml(
      withBg,
      { kind: 'set-style', property: 'backgroundColor', value: '#224466' },
      'div',
    );
    expect(solid.content).toContain('style="background-color: #224466"');
    expect(solid.content).not.toContain('linear-gradient');

    const varHtml = '<div style="color: var(--ocd-tweak-accent)">Token</div>';
    const inspectedVar = inspectHtml(varHtml);
    expect(inspectedVar.targets[0]?.styleBindings).toEqual([
      {
        property: 'color',
        expression: 'var(--ocd-tweak-accent)',
        tokenName: 'accent',
        editable: true,
      },
    ]);
  });

  it('supports attributes, unsafe URL scheme rejection, and class edits', () => {
    expect(
      appliedHtml(doc, { kind: 'set-attribute', name: 'aria-label', value: 'Main heading' })
        .content,
    ).toContain('aria-label="Main heading"');
    expect(appliedHtml(doc, { kind: 'remove-attribute', name: 'title' }).content).not.toContain(
      'title="Welcome"',
    );
    expect(
      appliedHtml(doc, { kind: 'set-class-name', value: 'hero-title text-2xl' }).content,
    ).toContain('class="hero-title text-2xl"');
    expect(
      appliedHtml(
        doc,
        { kind: 'set-attribute', name: 'src', value: 'data:image/png;base64,AAAA' },
        'img',
      ).content,
    ).toContain('src="data:image/png;base64,AAAA"');

    for (const unsafe of [
      'javascript:alert(1)',
      '  &#106;avascript:alert(1)',
      'vbscript:msgbox(1)',
      'data:text/html,<script>alert(1)</script>',
      'file:///etc/passwd',
    ]) {
      expect(
        applyHtml(doc, { kind: 'set-attribute', name: 'src', value: unsafe }, 'img'),
      ).toMatchObject({
        status: 'rejected',
        reason: 'invalid-operation',
      });
    }
    expect(
      applyHtml(
        doc,
        { kind: 'set-attribute', name: 'href', value: 'data:image/png;base64,AAAA' },
        'p',
      ),
    ).toMatchObject({ status: 'rejected', reason: 'invalid-operation' });
  });

  it('supports structural ops (toggle-visibility, reorder-sibling, duplicate, delete) and batches', () => {
    const hidden = appliedHtml(doc, { kind: 'toggle-visibility', hidden: true }, 'p');
    expect(hidden.content).toContain('<p style="display: none">Second paragraph</p>');
    const shown = appliedHtml(hidden.content, { kind: 'toggle-visibility', hidden: false }, 'p');
    expect(shown.content).toContain('<p>Second paragraph</p>');

    const reordered = appliedHtml(doc, { kind: 'reorder-sibling', direction: 'down' });
    expect(reordered.content.indexOf('<p>Second paragraph</p>')).toBeLessThan(
      reordered.content.indexOf('<h1 '),
    );

    const duplicated = appliedHtml(doc, { kind: 'duplicate-element' }, 'p');
    expect(duplicated.content.match(/<p>Second paragraph<\/p>/g)).toHaveLength(2);

    const deleted = appliedHtml(doc, { kind: 'delete-element' }, 'p');
    expect(deleted.content).not.toContain('<p>Second paragraph</p>');

    const inspected = inspectHtml(doc);
    const h1 = inspected.targets.find((t) => t.tagName === 'h1');
    if (!h1) throw new Error('Missing h1');
    const batched = planHtmlSourceEditBatch({
      path: 'index.html',
      source: doc,
      expectedSourceHash: inspected.sourceHash,
      targetId: h1.id,
      scope: 'source-definition',
      operations: [
        { kind: 'set-text', value: 'Batched' },
        { kind: 'set-style', property: 'color', value: '#ff0000' },
        { kind: 'set-class-name', value: 'title-lg' },
      ],
    });
    expect(batched.status).toBe('applied');
    if (batched.status !== 'applied') throw new Error(batched.message);
    expect(batched.content).toContain('Batched');
    expect(batched.content).toContain('color: #ff0000');
    expect(batched.content).toContain('class="title-lg"');
  });

  it('enforces duplicate attribute, provenance, and runtime-reserved protections in HTML', () => {
    const dup = '<div title="a" title="b">Hi</div>';
    expect(inspectHtml(dup).targets[0]?.editableFields).toEqual([]);
    const prov = '<div data-codesign-source-id="x">Hi</div>';
    expect(inspectHtml(prov).targets[0]?.editableFields).toEqual([]);
    expect(applyHtml(doc, { kind: 'set-text', value: '<!-- AGENT_BODY_BEGIN -->' })).toMatchObject({
      status: 'rejected',
      reason: 'runtime-reserved-value',
    });
  });
});
