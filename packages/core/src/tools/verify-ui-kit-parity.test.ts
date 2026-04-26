import { describe, expect, it } from 'vitest';
import type { TextEditorFsCallbacks } from './text-editor.js';
import { makeVerifyUiKitParityTool } from './verify-ui-kit-parity.js';

function makeFs(files: Record<string, string>): TextEditorFsCallbacks {
  return {
    view: (path: string) => {
      const content = files[path];
      if (content === undefined) return null;
      return { content, numLines: content.split('\n').length };
    },
    create: (path: string) => ({ path }),
    strReplace: (path: string) => ({ path }),
    insert: (path: string) => ({ path }),
    listDir: () => [],
  };
}

const SOURCE_HTML = `
<html>
  <body>
    <header><h1>Acme Analytics</h1><nav><a href="#">Home</a><a href="#">Settings</a></nav></header>
    <main>
      <section class="metrics">
        <div class="metric"><span>MRR</span><span>$12,400</span></div>
        <div class="metric"><span>Churn</span><span>2.1%</span></div>
        <div class="metric"><span>NPS</span><span>62</span></div>
        <div class="metric"><span>ARR</span><span>$148k</span></div>
      </section>
      <section class="chart" style="background: #c96442; padding: 16px"></section>
      <table>
        <thead><tr><th>User</th><th>Action</th></tr></thead>
        <tbody>
          <tr><td>alice</td><td>signup</td></tr>
          <tr><td>bob</td><td>login</td></tr>
        </tbody>
      </table>
    </main>
    <footer style="color: #6b6661; font-size: 14px">© Acme</footer>
  </body>
</html>
`;

const HIGH_PARITY_DECOMP = `
<html>
  <body>
    <header><h1>Acme Analytics</h1><nav><a href="#">Home</a><a href="#">Settings</a></nav></header>
    <main>
      <section class="metrics">
        <div class="metric"><span>MRR</span><span>$12,400</span></div>
        <div class="metric"><span>Churn</span><span>2.1%</span></div>
        <div class="metric"><span>NPS</span><span>62</span></div>
        <div class="metric"><span>ARR</span><span>$148k</span></div>
      </section>
      <section class="chart"></section>
      <table>
        <thead><tr><th>User</th><th>Action</th></tr></thead>
        <tbody>
          <tr><td>alice</td><td>signup</td></tr>
          <tr><td>bob</td><td>login</td></tr>
        </tbody>
      </table>
    </main>
    <footer>© Acme</footer>
  </body>
</html>
`;

const LOW_PARITY_DECOMP = `
<html>
  <body>
    <div>just one tile</div>
  </body>
</html>
`;

const TOKENS_CSS = `
:root {
  /* color */
  --color-brand: #c96442;
  --color-text-muted: #6b6661;
  /* spacing */
  --space-md: 16px;
  --text-sm: 14px;
}
`;

describe('makeVerifyUiKitParityTool', () => {
  it('reports OK when decomposed faithfully mirrors the source', async () => {
    const fs = makeFs({
      'index.html': SOURCE_HTML,
      'ui_kits/x/index.html': HIGH_PARITY_DECOMP,
      'ui_kits/x/tokens.css': TOKENS_CSS,
    });
    const tool = makeVerifyUiKitParityTool(fs);
    const result = await tool.execute('t', { slug: 'x' }, undefined);
    expect(result.details.status).toBe('ok');
    expect(result.details.parityScore).toBeGreaterThanOrEqual(0.85);
    expect(result.details.signals.elementCountParity).toBeGreaterThan(0.9);
  });

  it('reports needs_iteration when decomposed is structurally thin', async () => {
    const fs = makeFs({
      'index.html': SOURCE_HTML,
      'ui_kits/x/index.html': LOW_PARITY_DECOMP,
      'ui_kits/x/tokens.css': '',
    });
    const tool = makeVerifyUiKitParityTool(fs);
    const result = await tool.execute('t', { slug: 'x' }, undefined);
    expect(result.details.status).toBe('needs_iteration');
    expect(result.details.parityScore).toBeLessThan(0.85);
    expect(result.details.gaps.length).toBeGreaterThan(0);
  });

  it('reports missing artifacts when decomposed file is absent', async () => {
    const fs = makeFs({ 'index.html': SOURCE_HTML });
    const tool = makeVerifyUiKitParityTool(fs);
    const result = await tool.execute('t', { slug: 'never-decomposed' }, undefined);
    expect(result.details.status).toBe('needs_iteration');
    expect(result.details.parityScore).toBe(0);
    expect(result.details.gaps[0]?.message).toContain('missing artifact');
  });

  it('flags hardcoded values not present in tokens.css', async () => {
    const fs = makeFs({
      'index.html': SOURCE_HTML,
      'ui_kits/x/index.html': HIGH_PARITY_DECOMP,
      'ui_kits/x/tokens.css': ':root { --space-md: 16px; }', // missing colors + 14px
    });
    const tool = makeVerifyUiKitParityTool(fs);
    const result = await tool.execute('t', { slug: 'x' }, undefined);
    const tokenGaps = result.details.gaps.filter((g) => g.kind === 'token');
    expect(tokenGaps.length).toBeGreaterThan(0);
    expect(tokenGaps.some((g) => g.message.includes('#c96442'))).toBe(true);
    expect(result.details.signals.tokenCoverage).toBeLessThan(1);
  });

  it('returns 0 score gracefully when fs is undefined', async () => {
    const tool = makeVerifyUiKitParityTool(undefined);
    const result = await tool.execute('t', { slug: 'x' }, undefined);
    expect(result.details.status).toBe('needs_iteration');
    expect(result.details.parityScore).toBe(0);
  });

  it('reports element parity > 0.9 when source and decomposed are byte-identical', async () => {
    const fs = makeFs({
      'index.html': SOURCE_HTML,
      'ui_kits/x/index.html': SOURCE_HTML,
      'ui_kits/x/tokens.css': TOKENS_CSS,
    });
    const tool = makeVerifyUiKitParityTool(fs);
    const result = await tool.execute('t', { slug: 'x' }, undefined);
    expect(result.details.signals.elementCountParity).toBe(1);
    expect(result.details.signals.visibleTextCoverage).toBe(1);
  });

  it('summary text reflects pass/fail status', async () => {
    const fsOk = makeFs({
      'index.html': SOURCE_HTML,
      'ui_kits/x/index.html': SOURCE_HTML,
      'ui_kits/x/tokens.css': TOKENS_CSS,
    });
    const fsFail = makeFs({
      'index.html': SOURCE_HTML,
      'ui_kits/x/index.html': LOW_PARITY_DECOMP,
      'ui_kits/x/tokens.css': '',
    });
    const tool = makeVerifyUiKitParityTool(fsOk);
    const okResult = await tool.execute('t', { slug: 'x' }, undefined);
    const okFirst = okResult.content[0];
    if (okFirst?.type !== 'text') throw new Error('expected text');
    expect(okFirst.text).toContain('Parity OK');

    const failTool = makeVerifyUiKitParityTool(fsFail);
    const failResult = await failTool.execute('t', { slug: 'x' }, undefined);
    const failFirst = failResult.content[0];
    if (failFirst?.type !== 'text') throw new Error('expected text');
    expect(failFirst.text).toContain('needs iteration');
  });
});
